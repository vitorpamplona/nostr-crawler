// fetch events from relay, returns a promise
function fetchFromRelay(relay, filters, events, relayStatus, uiBox, updateRelayStatus) {
  return openRelay(
      relay, 
      filters,
      [],
      (state) => {
        updateRelayStatus(uiBox, relay, state, 0, undefined, undefined, undefined, relayStatus) 
      },
      (event) => { 
        updateRelayStatus(uiBox, relay, undefined, 1, undefined, undefined, undefined, relayStatus)

        // prevent duplicated events
        if (events[event.id]) return
        else events[event.id] = event

        // show how many events were found until this moment
        $('#events-found').text(`${Object.keys(events).length} events found`)
      }, 
      (eventId, inserted, message) => { 
        if (inserted == true) {
          updateRelayStatus(uiBox, relay, undefined, 1, undefined, undefined, message, relayStatus)
        } else {
          updateRelayStatus(uiBox, relay, undefined, 0, undefined, undefined, message, relayStatus)
        }
      }, 
      (subId, until) => { 
        updateRelayStatus(uiBox, relay, undefined, 0, subId, until, undefined, relayStatus)
      }
    )
}

// query relays for events published by this pubkey
const getEvents = async (filters, relaySet, uiBox, updateRelayStatus) => {
  // events hash
  const events = {}

  // batch processing of 10 relays
  await processInPool(relaySet, (relay, poolStatus) => fetchFromRelay(relay, filters, events, poolStatus, uiBox, updateRelayStatus), 10, (progress) => $('#fetching-progress').val(progress))

  // return data as an array of events
  return Object.keys(events).map((id) => events[id])
}

// broadcast events to list of relays
const broadcastEvents = async (data, relaySet, uiBox, updateRelayStatus) => {
  await processInPool(relaySet, (relay, poolStatus) => sendToRelay(relay, data, poolStatus, uiBox, updateRelayStatus), 10, (progress) => $('#broadcasting-progress').val(progress))
}

function sendToRelay(relay, eventsToSend, relayStatus, uiBox, updateRelayStatus) {
  return openRelay(
      relay, 
      [],
      eventsToSend,
      (state) => {
        updateRelayStatus(uiBox, relay, state, 0, undefined, undefined, undefined, relayStatus) 
      },
      (event) => {}, 
      (eventId, inserted, message) => { 
        if (inserted == true) {
          updateRelayStatus(uiBox, relay, undefined, 1, undefined, undefined, message, relayStatus)
        } else {
          updateRelayStatus(uiBox, relay, undefined, 0, undefined, undefined, message, relayStatus)
        }
      }, 
      (subId, until) => {}
    )
}

// send events to a relay, returns a promisse
function openRelay(relay, filters, eventsToSend, onState, onNewEvent, onOk, onNewUntil) {
  return new Promise((resolve, reject) => {
    try {
      const ws = new WebSocket(relay)
      let isAuthenticating = false

      onState("Starting")

      // prevent hanging forever
      let myTimeout = setTimeout(() => { ws.close(); onState("Timeout"); reject(relay) }, 10_000)

      const subscriptions = Object.fromEntries(filters.map ( (filter, index) => {
        let id = "MYSUB"+index
        return [ 
          id, {
            id: id,
            counter: 0,
            eoseSessionCounter: 0,
            lastEvent: null,
            done: false,
            filter: filter,
            eventIds: new Set()
          }
        ]
      }))

      // connected
      ws.onopen = () => {
        // resets the timeout
        clearTimeout(myTimeout)
        myTimeout = setTimeout(() => { ws.close(); onState("Timeout");  reject(relay) }, 10_000)

        if (Object.keys(subscriptions).length > 0) {
          onState("Downloading")
          for (const [key, sub] of Object.entries(subscriptions)) {
            ws.send(JSON.stringify(['REQ', sub.id, sub.filter]))
          }
        }

        if (eventsToSend && eventsToSend.length > 0) {
          for (evnt of eventsToSend) {
            ws.send(JSON.stringify(['EVENT', evnt]))
          }
        }
      }

      // Listen for messages
      ws.onmessage = (str) => {
        const messageArray = JSON.parse(str.data)
        const [msgType] = messageArray

        if (msgType === 'AUTH') {
          // resets the timeout
          clearTimeout(myTimeout)
          myTimeout = setTimeout(() => { ws.close(); onState("Timeout"); reject(relay) }, 10_000)

          isAuthenticating = true
          signNostrAuthEvent(relay, messageArray[1]).then(
            (event) => {
              if (event) {
                ws.send(JSON.stringify(['AUTH', event]))
              } else {
                onState("AUTH Fail")
                ws.close()
                clearTimeout(myTimeout)
                reject(relay)
              }
            },
            (reason) => {
              onState("AUTH Fail")
              ws.close()
              clearTimeout(myTimeout)
              reject(relay)
            },
          ) 
        }

        if (msgType === 'OK') {
          // resets the timeout
          clearTimeout(myTimeout)
          myTimeout = setTimeout(() => { ws.close(); onState("Timeout");  reject(relay) }, 10_000)
          
          if (isAuthenticating) {
            isAuthenticating = false
            if (messageArray[2]) {
              onState("AUTH Ok")

              // Refresh filters
              for (const [key, sub] of Object.entries(subscriptions)) {
                ws.send(JSON.stringify(['REQ', sub.id, sub.filter]))
              }
            } else {
              onState("AUTH Fail")
            }
          } else {
            onOk(messageArray[1], messageArray[2], messageArray[3])
          }
        } 

        // event messages
        if (msgType === 'EVENT') {
          clearTimeout(myTimeout)
          myTimeout = setTimeout(() => { ws.close(); onState("Timeout"); reject(relay) }, 10_000)

          const subState = subscriptions[messageArray[1]]
          const event = messageArray[2]

          try { 
            if (!matchFilter(subState.filter, event)) {
              console.log("Didn't match filter", event, subState.filter)
              return
            }

            if (subState.eventIds.has(event.id)) return

            if (subState.filter.limit && subState.counter >= subState.filter.limit) {
              subState.done = true
              onState("Done")

              ws.close()
              clearTimeout(myTimeout)
              resolve(relay)
              return
            }

            if (!subState.lastEvent || event.created_at < subState.lastEvent.created_at) {
              subState.lastEvent = event
            }

            subState.eventIds.add(event.id)
            subState.counter++
            subState.eoseSessionCounter++

            onNewEvent(event)
          } catch(err) {
            console.log("Minor Error", relay, err, event)
            return
          }
        }

        if (msgType === 'EOSE') {
          const subState = subscriptions[messageArray[1]]

          // if trully finished
          if (subState.eoseSessionCounter == 0 || 
            subState.lastEvent.created_at == 0 || // bug that until becomes undefined
            (subState.filter.limit != undefined && subState.counter >= subState.filter.limit) ||
            (subState.filter.until != undefined && subState.filter.until == subState.lastEvent.created_at)
          ) { 
            subState.done = true
            
            let alldone = Object.values(subscriptions).every(filter => filter.done === true);
            if (alldone) {
              onState("Done")
              ws.close()
              clearTimeout(myTimeout)
              resolve(relay)
            }
          } else {
            // Restarting the filter is necessary to go around Max Limits for each relay. 

            subState.eoseSessionCounter = 0
            let newFilter = { ...subState.filter }
            newFilter.until = subState.lastEvent.created_at

            ws.send(JSON.stringify(['REQ', subState.id, newFilter]))

            onNewUntil(messageArray[1], newFilter.until)
          }
        }

        if (msgType === 'CLOSED') {
          subState.done = true
        
          let alldone = Object.values(subscriptions).every(filter => filter.done === true);
          if (alldone) {
            onState("Done")
            ws.close()
            clearTimeout(myTimeout)
            resolve(relay)
          }
        }
      }
      ws.onerror = (err, event) => {
        onState("Error")
        //console.log("WS Error", relay, err, event)
        clearTimeout(myTimeout)
        ws.close()
        reject(err)
      }
      ws.onclose = (event) => {
        onState("Done")
        //console.log("WS Close", relay, event)
        clearTimeout(myTimeout)
        resolve()
      }
    } catch (exception) {
      console.log("Major", relay, exception)
      onState("Error")
      try {
        ws.close()
      } catch (exception) {
      }
      clearTimeout(myTimeout)
      reject(exception)
    }
  })
}  

async function signNostrAuthEvent(relay, auth_challenge) {
  let event = {
    kind: 22242, 
    content: "",
    tags: [
      ["relay", relay],
      ["challenge", auth_challenge]
    ],
  };

  return await nostrSign(event)
}