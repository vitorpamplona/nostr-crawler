const parseRelaySet = (commaSeparatedRelayString, defaultSet) => {
  let list = commaSeparatedRelayString.split(",")
  
  if (list && list.length > 0 && list[0] !== "") 
    return list.map((it) => it.trim())
  else 
    return defaultSet
}

// download js file
const downloadFile = (data, fileName) => {
  const prettyJs = JSON.stringify(data, null, 2)
  const tempLink = document.createElement('a')
  const taBlob = new Blob([prettyJs], { type: 'text/json' })
  tempLink.setAttribute('href', URL.createObjectURL(taBlob))
  tempLink.setAttribute('download', fileName)
  tempLink.click()
}

const updateRelayStatus = (uiBox, relay, status, addToCount, subscription, until, message, relayStatusAndCount) => {
  if (relayStatusAndCount[relay] == undefined) {
    relayStatusAndCount[relay] = {}
  }

  let changedStatus = false
  if (status && relayStatusAndCount[relay].status != status) {
    changedStatus = true
    relayStatusAndCount[relay].status = status
  }

  if (!relayStatusAndCount[relay].until) {
    relayStatusAndCount[relay].until = {}
  }

  if (subscription) {
    relayStatusAndCount[relay].until[subscription] = until
    changedStatus = true
  }

  if (message)
    relayStatusAndCount[relay].message = message

  if (relayStatusAndCount[relay].count != undefined) 
    relayStatusAndCount[relay].count = relayStatusAndCount[relay].count + addToCount
  else 
    relayStatusAndCount[relay].count = addToCount

  if (changedStatus)  
    displayRelayStatus(uiBox, relayStatusAndCount)
}

const displayRelayStatus = (uiBox, relayStatusAndCount) => {
  if (Object.keys(relayStatusAndCount).length > 0) {
    Object.keys(relayStatusAndCount).forEach(
      it => {
        let untilStr = "";

        if (relayStatusAndCount[it].until) {
          if (relayStatusAndCount[it].until["my-sub-0"])
            untilStr += "<td> <" + new Date(relayStatusAndCount[it].until["my-sub-0"] * 1000).toLocaleDateString("en-US") + "</td>"
          else
            untilStr += "<td> </td>"
        } else {
          untilStr += "<td> </td>"
        }

        let msg = ""

        if (relayStatusAndCount[it].message)
          msg = relayStatusAndCount[it].message
          
        const relayName = it.replace("wss://", "").replace("ws://", "").split("#")[0].split("?")[0].split("/")[0]
        const line = "<td>" + relayName + "</td><td>" + relayStatusAndCount[it].status + "</td>" + untilStr + "<td>" + relayStatusAndCount[it].count + "</td><td>" + msg + "</td>"

        const elemId = uiBox+relayName.replaceAll(".", "").replaceAll("/", "").replaceAll("-", "").replaceAll(":", "").replaceAll("%", "").replaceAll("⬤ ", "").replaceAll(" ", "").replaceAll("@", "").replaceAll("	", "")

        if (elemId.trim() !== "") { 
          if ($('#' + elemId).length > 0) {
            $('#' + elemId).html(line)
          } else {
            $('#'+uiBox).append(
              $("<tr>" +line+ "</tr>").attr('id', elemId)
            )
          }
        }
      }
    )
  } else {
    $('#'+uiBox+'-header').html("")
    $('#'+uiBox).html("<tr id=\""+uiBox+"-header\"></tr>")
  }
}

// fetch events from relay, returns a promise
const fetchFromRelay = async (relay, filters, events, relayStatus, uiBox) =>
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
        let id = "my-sub-"+index

        let myFilter = filter

        return [ 
          id, {
            id: id,
            counter: 0,
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
        // event messages
        if (msgType === 'EVENT') {
          clearTimeout(myTimeout)
          myTimeout = setTimeout(() => {
            ws.close()
            reject(relay)
          }, 10_000)

          try { 
            const { id } = data

            if (!subscriptions[subscriptionId].lastEvent || data.created_at < subscriptions[subscriptionId].lastEvent.created_at)
            subscriptions[subscriptionId].lastEvent = data

            if (data.id in subscriptions[subscriptionId].eventIds) return

            subscriptions[subscriptionId].eventIds.add(data.id)
            subscriptions[subscriptionId].counter++

            let until = undefined

            if (subscriptions[subscriptionId].lastEvent) {
                until = subscriptions[subscriptionId].lastEvent.created_at
            }

            updateRelayStatus(uiBox, relay, undefined, 1, subscriptionId, until, undefined, relayStatus)

            // prevent duplicated events
            if (events[id]) return
            else events[id] = data

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
          if (subscriptions[subscriptionId].counter < 2 || (subscriptions[subscriptionId].filter.until && subscriptions[subscriptionId].filter.until != subscriptions[subscriptionId].lastEvent.created_at)) { 
            subscriptions[subscriptionId].done = true
            
            let alldone = Object.values(subscriptions).every(filter => filter.done === true);
            if (alldone) {
              updateRelayStatus(uiBox, relay, "Done", 0, undefined, undefined, undefined, relayStatus)
              ws.close()
              resolve(relay)
            }
          } else {
            subscriptions[subscriptionId].counter = 0
            let newFilter = { ...subscriptions[subscriptionId].filter }
            newFilter.until = subscriptions[subscriptionId].lastEvent.created_at
            ws.send(JSON.stringify(['REQ', subscriptions[subscriptionId].id, newFilter]))
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
          subscriptions[subscriptionId].done = true
        
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
const getEvents = async (filters, relaySet, uiBox) => {
  // events hash
  const events = {}

  // batch processing of 10 relays
  await processInPool(relaySet, (relay, poolStatus) => fetchFromRelay(relay, filters, events, poolStatus, uiBox), 10, (progress) => $('#fetching-progress').val(progress))

  // return data as an array of events
  return Object.keys(events).map((id) => events[id])
}

// broadcast events to list of relays
const broadcastEvents = async (data, relaySet, uiBox) => {
  await processInPool(relaySet, (relay, poolStatus) => sendToRelay(relay, data, poolStatus, uiBox), 10, (progress) => $('#broadcasting-progress').val(progress))
}

const processInPool = async (items, processItem, poolSize, onProgress) => {
  let pool = {};
  let poolStatus = {}
  let remaining = [...items]
  
  while (remaining.length) {
    let processing = remaining.splice(0, 1)
    let item = processing[0]
    pool[item] = processItem(item, poolStatus);
      
    if (Object.keys(pool).length > poolSize - 1) {
      try {
        const resolvedId = await Promise.race(Object.values(pool)); // wait for one Promise to finish

        delete pool[resolvedId]; // remove that Promise from the pool
      } catch (resolvedId) {
        delete pool[resolvedId]; // remove that Promise from the pool
      }
    }

    onProgress(items.length - remaining.length)
  }

  await Promise.allSettled(Object.values(pool));

  return poolStatus
}

const sendAllEvents = async (relay, data, relayStatus, ws) => {
  console.log("Sending:", data.length, " events")
  for (evnt of data) {
    ws.send(JSON.stringify(['EVENT', evnt]))
  }
}

// send events to a relay, returns a promisse
const sendToRelay = async (relay, data, relayStatus, uiBox) =>
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

async function generateNostrEventId(msg) {
  const digest = [
      0,
      msg.pubkey,
      msg.created_at,
      msg.kind,
      msg.tags,
      msg.content,
  ];
  const digest_str = JSON.stringify(digest);
  const hash = await sha256Hex(digest_str);

  return hash;
}

function sha256Hex(string) {
  const utf8 = new TextEncoder().encode(string);

  return crypto.subtle.digest('SHA-256', utf8).then((hashBuffer) => {
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray
        .map((bytes) => bytes.toString(16).padStart(2, '0'))
        .join('');

      return hashHex;
  });
}

async function signNostrAuthEvent(relay, auth_challenge) {
  try {
    let msg = {
        kind: 22242, 
        content: "",
        tags: [
          ["relay", relay],
          ["challenge", auth_challenge]
        ],
    };

    // set msg fields
    msg.created_at = Math.floor((new Date()).getTime() / 1000);
    msg.pubkey = await window.nostr.getPublicKey();

    // Generate event id
    msg.id = await generateNostrEventId(msg);

    // Sign event
    signed_msg = await window.nostr.signEvent(msg);
  } catch (e) {
    console.log("Failed to sign message with browser extension", e);
    return undefined;
  }

  return signed_msg;
}