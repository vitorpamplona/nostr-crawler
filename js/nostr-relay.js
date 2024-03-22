// fetch events from relay, returns a promise
const fetchFromRelay = async (relay, filters, events, relayStatus, uiBox, updateRelayStatus) =>
  new Promise((resolve, reject) => {
    try {
      updateRelayStatus(uiBox, relay, "Starting", 0, undefined, undefined, undefined, relayStatus)
      // open websocket
      const ws = new WebSocket(relay)

      let isAuthenticating = false

      // prevent hanging forever
      let myTimeout = setTimeout(() => {
        ws.close()
        reject(relay)
      }, 10_000)

      const subscriptions = Object.fromEntries(filters.map ( (filter, index) => {
        let id = "MYSUB"+index

        let myFilter = filter

        return [ 
          id, {
            id: id,
            counter: 0,
            eoseSessionCounter: 0,
            lastEvent: null,
            done: false,
            filter: myFilter,
            eventIds: new Set()
          }
        ]
      }))
      
      // subscribe to events filtered by author
      ws.onopen = () => {
        clearTimeout(myTimeout)
        myTimeout = setTimeout(() => {
          ws.close()
          reject(relay)
        }, 10_000)
        updateRelayStatus(uiBox, relay, "Downloading", 0, undefined, undefined, undefined, relayStatus)
        
        for (const [key, sub] of Object.entries(subscriptions)) {
          ws.send(JSON.stringify(['REQ', sub.id, sub.filter]))
        }
      }

      // Listen for messages
      ws.onmessage = (event) => {
        const [msgType, subscriptionId, data] = JSON.parse(event.data)
        const subState = subscriptions[subscriptionId]

        if (subState == undefined) return

        // event messages
        if (msgType === 'EVENT') {
          clearTimeout(myTimeout)
          myTimeout = setTimeout(() => {
            ws.close()
            reject(relay)
          }, 10_000)

          try { 
            if (!matchFilter(subState.filter, data)) {
              console.log("Didn't match filter", data, subState.filter)
              return
            }

            if (subState.eventIds.has(data.id)) return

            if (subState.filter.limit && subState.counter >= subState.filter.limit) {
              subState.done = true
              updateRelayStatus(uiBox, relay, "Done", 0, undefined, undefined, undefined, relayStatus)
              ws.close()
              resolve(relay)
              return
            }

            if (!subState.lastEvent || data.created_at < subState.lastEvent.created_at) {
              subState.lastEvent = data
            }

            subState.eventIds.add(data.id)
            subState.counter++
            subState.eoseSessionCounter++

            let until = undefined

            if (subState.lastEvent) {
                until = subState.lastEvent.created_at
            }

            updateRelayStatus(uiBox, relay, undefined, 1, subscriptionId, until, undefined, relayStatus)

            // prevent duplicated events
            if (events[data.id]) return
            else events[data.id] = data

            // show how many events were found until this moment
            $('#events-found').text(`${Object.keys(events).length} events found`)
          } catch(err) {
            console.log(err, event)
            return
          }
        }

        // end of subscription messages
        if (msgType === 'EOSE') {
          // Restarting the filter is necessary to go around Max Limits for each relay. 
          if (subState.eoseSessionCounter == 0 || 
            subState.lastEvent.created_at == 0 || // bug that until becomes undefined
            (subState.filter.limit != undefined && subState.counter >= subState.filter.limit) ||
            (subState.filter.until != undefined && subState.filter.until == subState.lastEvent.created_at)
          ) { 
            subState.done = true
            
            let alldone = Object.values(subscriptions).every(filter => filter.done === true);
            if (alldone) {
              updateRelayStatus(uiBox, relay, "Done", 0, undefined, undefined, undefined, relayStatus)
              ws.close()
              resolve(relay)
            }
          } else {
            subState.eoseSessionCounter = 0
            let newFilter = { ...subState.filter }
            newFilter.until = subState.lastEvent.created_at

            ws.send(JSON.stringify(['REQ', subState.id, newFilter]))
          }
        }

        if (msgType === 'AUTH') {
          isAuthenticating = true
          signNostrAuthEvent(relay, subscriptionId).then(
            (event) => {
              if (event) {
                ws.send(JSON.stringify(['AUTH', event]))
              } else {
                updateRelayStatus(uiBox, relay, "AUTH Req", 0, undefined, undefined, undefined, relayStatus)
                ws.close()
                reject(relay)
              }
            },
            (reason) => {
              updateRelayStatus(uiBox, relay, "AUTH Req", 0, undefined, undefined, undefined, relayStatus)
              ws.close()
              reject(relay)
            },
          ) 
        }

        if (msgType === 'CLOSED' && !isAuthenticating) {
          subState.done = true
        
          let alldone = Object.values(subscriptions).every(filter => filter.done === true);
          if (alldone) {
            updateRelayStatus(uiBox, relay, "Done", 0, undefined, undefined, undefined, relayStatus)
            ws.close()
            resolve(relay)
          }
        }

        if (msgType === 'OK') {
          isAuthenticating = false
          // auth ok.
          for (const [key, sub] of Object.entries(subscriptions)) {
            ws.send(JSON.stringify(['REQ', sub.id, sub.filter]))
          }
        }
      }
      ws.onerror = (err) => {
        updateRelayStatus(uiBox, relay, "Done", 0, undefined, undefined, undefined, relayStatus)
        try {
          ws.close()
          reject(relay)
        } catch {
          reject(relay)
        }
      }
      ws.onclose = (socket, event) => {
        updateRelayStatus(uiBox, relay, "Done", 0,undefined, undefined, undefined, relayStatus)
        resolve(relay)
      }
    } catch (exception) {
      console.log(exception)
      updateRelayStatus(uiBox, relay, "Error", 0,undefined, undefined, undefined, relayStatus)
      try {
        ws.close()
      } catch (exception) {
      }
      
      reject(relay)
    }
  })

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

const sendAllEvents = async (relay, data, relayStatus, ws) => {
  console.log("Sending:", data.length, " events")
  for (evnt of data) {
    ws.send(JSON.stringify(['EVENT', evnt]))
  }
}

// send events to a relay, returns a promisse
const sendToRelay = async (relay, data, relayStatus, uiBox, updateRelayStatus) =>
  new Promise((resolve, reject) => {
    try {
      const ws = new WebSocket(relay)

      updateRelayStatus(uiBox, relay, "Starting", 0,undefined, undefined, undefined, relayStatus)

      // prevent hanging forever
      let myTimeout = setTimeout(() => {
        ws.close()
        reject('timeout')
      }, 10_000)

      // fetch events from relay
      ws.onopen = () => {
        updateRelayStatus(uiBox, relay, "Sending", 0, undefined, undefined, undefined, relayStatus)

        clearTimeout(myTimeout)
        myTimeout = setTimeout(() => {
          ws.close()
          reject('timeout')
        }, 10_000)

        sendAllEvents(relay, data, relayStatus, ws)
      }
      // Listen for messages
      ws.onmessage = (event) => {
        clearTimeout(myTimeout)
        myTimeout = setTimeout(() => {
          ws.close()
          reject('timeout')
        }, 10_000)

        console.log(event.data)

        const [msgType, subscriptionId, inserted, message] = JSON.parse(event.data)
        // event messages
        // end of subscription messages
        if (msgType === 'OK') {
          if (inserted == true) {
            updateRelayStatus(uiBox, relay, undefined, 1, undefined, undefined, message, relayStatus)
          } else {
            updateRelayStatus(uiBox, relay, undefined, 0,undefined, undefined, message, relayStatus)
            //console.log(relay, event.data)
          }
        } else {
          console.log(relay, event.data)
        }

        if (msgType === 'AUTH') {
          signNostrAuthEvent(relay, subscriptionId).then(
            (event) => {
              if (event) {
                ws.send(JSON.stringify(['AUTH', event]))
              } else {
                updateRelayStatus(uiBox, relay, "AUTH Req", 0,undefined, undefined, undefined, relayStatus)
                ws.close()
                reject(relay)
              }
            },
            (reason) => {
              updateRelayStatus(uiBox, relay, "AUTH Req", 0, undefined, undefined, undefined, relayStatus)
              ws.close()
              reject(relay)
            },
          ) 
        }
      }
      ws.onerror = (err) => {
        updateRelayStatus(uiBox, relay, "Error", 0, undefined, undefined, undefined, relayStatus)
        console.log("Error", err)
        ws.close()
        reject(err)
      }
      ws.onclose = (socket, event) => {
        updateRelayStatus(uiBox, relay, "Done", 0, undefined, undefined, undefined, relayStatus)
        resolve()
      }
    } catch (exception) {
      console.log(exception)
      updateRelayStatus(uiBox, relay, "Error", 0, undefined, undefined, undefined, relayStatus)
      try {
        ws.close()
      } catch (exception) {
      }
      reject(exception)
    }
  })

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