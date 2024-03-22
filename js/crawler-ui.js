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

// button click handler
const fetchAndBroadcast = async () => {
  // reset UI
  $('#fetching-status').html('')
  $('#fetching-progress').css('visibility', 'hidden')
  $('#fetching-progress').val(0)
  $('#file-download').html('')
  $('#events-found').text('')
  $('#broadcasting-status').html('')
  $('#broadcasting-progress').css('visibility', 'hidden')
  $('#broadcasting-progress').val(0)

  $('#broadcasting-relays').html("<tr id=\"broadcasting-relays-header\"></tr>")
  $('#fetching-relays').html("<tr id=\"fetching-relays-header\"></tr>")
  
  // messages to show to user
  const checkMark = '&#10003;'
  const txt = {
    broadcasting: 'Broadcasting to relays... ',
    fetching: 'Fetching from relays... ',
    download: `Downloading Backup file... ${checkMark}`,
  }

  // parse pubkey ('npub' or hexa)
  const relaySet = parseRelaySet($('#relaySet').val(), allAvailableRelays)
  const filter = $('#filter').val()
  if (!filter) return
  // disable button (will be re-enable at the end of the process)
  $('#fetch-and-broadcast').prop('disabled', true)
  $('#just-broadcast').prop('disabled', true)
  // inform user that app is fetching from relays
  $('#fetching-status').text(txt.fetching)
  // show and update fetching progress bar
  $('#fetching-progress').css('visibility', 'visible')
  $('#fetching-progress').prop('max', relaySet.length)

  $('#fetching-relays-header-box').css('display', 'flex')
  $('#fetching-relays-box').css('display', 'flex')
  $('#fetching-relays-header').html("<th>Relay</th><th>Status</th><th>Batch Until</th><th>Events</th><th>Message</th>")

  // get all events from relays
  let filterObj = JSON.parse(filter)

  let date = new Date();
  let offset = date.getTimezoneOffset() * 60;

  const startDate = Date.parse($('#startDate').val())
  const endDate = Date.parse($('#endDate').val())

  if ($('#activeDates')[0].checked) {
    for (const filter of filterObj) {
      filter.since = Math.floor((startDate - startDate % 864e5) / 1000) + offset, // 0:00
      filter.until = Math.floor((endDate - endDate % 864e5 + 864e5 - 1) / 1000) + offset // 23:59
    }
  }

  const data = (await getEvents(filterObj, relaySet, "fetching-relays")).sort((a, b) => b.created_at - a.created_at)

  // inform user fetching is done
  $('#fetching-status').html(txt.fetching + checkMark)
  $('#fetching-progress').val(relaySet.length)

  $('#broadcasting-relays-header-box').css('display', 'none')
  $('#broadcasting-relays-box').css('display', 'none')
  // inform user that backup file (js format) is being downloaded

  $('#file-download').html(txt.download)
  downloadFile(data, 'nostr-backup.json')

  const relaySetBroadcast = parseRelaySet($('#relaySetBroadcast').val(), undefined)

  if (relaySetBroadcast) {
    // inform user that app is broadcasting events to relays
    $('#broadcasting-status').html(txt.broadcasting)
    // show and update broadcasting progress bar
    $('#broadcasting-progress').css('visibility', 'visible')
    $('#broadcasting-progress').prop('max', relaySetBroadcast.length)
    
    $('#broadcasting-relays-header').html("")
    $('#broadcasting-relays').html("<tr id=\"broadcasting-relays-header\"></tr>")

    $('#broadcasting-relays-header-box').css('display', 'flex')
    $('#broadcasting-relays-box').css('display', 'flex')
    $('#broadcasting-relays-header').html("<th>Relay</th><th>Status</th><th></th><th>Events</th><th>Message</th>")
  
    await broadcastEvents(data, relaySetBroadcast, "broadcasting-relays")

    $('#broadcasting-progress').val(relaySetBroadcast.length)
  }

  // inform user that broadcasting is done
  $('#broadcasting-status').html(txt.broadcasting + checkMark)
  // re-enable broadcast button
  $('#fetch-and-broadcast').prop('disabled', false)
  $('#just-broadcast').prop('disabled', false)
}

const filterOnChange = () => {
  $('#fetch-and-broadcast').css('display', '')

  try {
    JSON.parse($('#filter').val())
    $('#filter-error').text("")
  } catch (e) {
    $('#filter-error').text(e)
  }
}

// button click handler
const justBroadcast = async (fileName) => {
  const reader = new FileReader();
  reader.addEventListener('load', (event) => {
    var data = JSON.parse(event.target.result)
    broadcast(data)
  });
  reader.readAsText(fileName)
}

const broadcast = async (data) => {
  // reset UI
  $('#fetching-status').html('')
  $('#fetching-progress').css('visibility', 'hidden')
  $('#fetching-progress').val(0)
  $('#file-download').html('')
  $('#events-found').text('')
  $('#broadcasting-status').html('')
  $('#broadcasting-progress').css('visibility', 'hidden')
  $('#broadcasting-progress').val(0)
  // messages to show to user
  const checkMark = '&#10003;'
  const txt = {
    broadcasting: 'Broadcasting to relays... ',
    fetching: 'Loading from file... ',
    download: `Downloading Backup file... ${checkMark}`,
  }

  const relaySetBroadcast = parseRelaySet($('#relaySetBroadcast').val(), undefined)

  // show and update fetching progress bar
  $('#fetching-progress').css('visibility', 'visible')
  $('#fetching-progress').prop('max', relaySetBroadcast.length)

  // inform user fetching is done
  $('#fetching-status').html(txt.fetching + checkMark)
  $('#fetching-progress').val(relaySetBroadcast.length)

  if (relaySetBroadcast) {
    // disable button (will be re-enable at the end of the process)
    $('#fetch-and-broadcast').prop('disabled', true)
    $('#just-broadcast').prop('disabled', true)

    // inform user that app is broadcasting events to relays
    $('#broadcasting-status').html(txt.broadcasting)
    // show and update broadcasting progress bar
    $('#broadcasting-progress').css('visibility', 'visible')
    $('#broadcasting-progress').prop('max', relaySetBroadcast.length)
    
    $('#broadcasting-relays-header-box').css('display', 'flex')
    $('#broadcasting-relays-box').css('display', 'flex')
    $('#broadcasting-relays-header').html("<th>Relay</th><th>Status</th><th></th><th>Events</th><th>Message</th>")

    await broadcastEvents(data, relaySetBroadcast, "broadcasting-relays")

    // re-enable broadcast button
    $('#fetch-and-broadcast').prop('disabled', false)
    $('#just-broadcast').prop('disabled', false)
  }
  // inform user that broadcasting is done
  $('#broadcasting-status').html(txt.broadcasting + checkMark)
  $('#broadcasting-progress').val(relaySetBroadcast.length)
}

// query relays for events published by this pubkey
const getEvents = async (filters, relaySet, uiBox) => {
  // events hash
  const events = {}

  // batch processing of 10 relays
  await processInPool(relaySet, (relay) => fetchFromRelay(relay, filters, events, uiBox), 10, (progress) => $('#fetching-progress').val(progress))

  // return data as an array of events
  return Object.keys(events).map((id) => events[id])
}

// broadcast events to list of relays
const broadcastEvents = async (data, relaySet, uiBox) => {
  await processInPool(relaySet, (relay) => sendToRelay(relay, data, uiBox), 10, (progress) => $('#broadcasting-progress').val(progress))
}

function displayRelayStatus(uiBoxPrefix, relay, relaySatus) {
  let untilStr = "";

  if (relaySatus.until) {
    untilStr += "<td> <" + new Date(relaySatus.until * 1000).toLocaleDateString("en-US") + "</td>"
  } else {
    untilStr += "<td> </td>"
  }

  let msg = ""

  if (relaySatus.message)
    msg = relaySatus.message
    
  const relayName = relay.replace("wss://", "").replace("ws://", "").split("#")[0].split("?")[0].split("/")[0]
  const line = "<td>" + relayName + "</td><td>" + relaySatus.status + "</td>" + untilStr + "<td>" + relaySatus.count + "</td><td>" + msg + "</td>"

  const elemId = uiBoxPrefix+relayName.replaceAll(".", "").replaceAll("/", "").replaceAll("-", "").replaceAll(":", "").replaceAll("%", "").replaceAll("⬤ ", "").replaceAll(" ", "").replaceAll("@", "").replaceAll("	", "")

  if (elemId.trim() !== "") { 
    if ($('#' + elemId).length > 0) {
      $('#' + elemId).html(line)
    } else {
      $('#'+uiBoxPrefix).append(
        $("<tr>" +line+ "</tr>").attr('id', elemId)
      )
    }
  }
}

// fetch events from relay, returns a promise
function fetchFromRelay(relay, filters, events, uiBox) {
  let relayStatus = {
    count: 0
  }

  return openRelay(
      relay, 
      filters,
      [],
      (state) => {
        if (state && relayStatus.status != state && !(state == "Done" && (relayStatus.status == "Auth Fail" || relayStatus.status == "Error"))) {
          relayStatus.status = state
          displayRelayStatus(uiBox, relay, relayStatus)
        }
      },
      (event) => { 
        relayStatus.count = relayStatus.count + 1

        displayRelayStatus(uiBox, relay, relayStatus)

        // prevent duplicated events
        if (events[event.id]) return
        else events[event.id] = event

        // show how many events were found until this moment
        $('#events-found').text(`${Object.keys(events).length} events found`)
      }, 
      (eventId, inserted, message) => {}, 
      (newFilter) => { 
        if (newFilter.until && relayStatus.until != newFilter.until) {
          relayStatus.until = newFilter.until
          displayRelayStatus(uiBox, relay, relayStatus)
        }
      },
      (errorMessage) => {
        if (errorMessage && relayStatus.message != errorMessage) {
          relayStatus.message = errorMessage
          displayRelayStatus(uiBox, relay, relayStatus)
        }
      }
    )
}

function sendToRelay(relay, eventsToSend, uiBox) {
  let relayStatus = {
    count: 0
  }

  return openRelay(
      relay, 
      [],
      eventsToSend,
      (state) => {
        if (state && relayStatus.status != state && !(state == "Done" && (relayStatus.status == "Auth Fail" || relayStatus.status == "Error"))) {
          relayStatus.status = state
          displayRelayStatus(uiBox, relay, relayStatus)
        }
      },
      (event) => {}, 
      (eventId, inserted, message) => { 
        if (inserted == true) {
          relayStatus.count = relayStatus.count + 1

          if (message && relayStatus.message != message) {
            relayStatus.message = message
          }

          displayRelayStatus(uiBox, relay, relayStatus)
        } else {
          if (message && relayStatus.message != message) {
            relayStatus.message = message
            displayRelayStatus(uiBox, relay, relayStatus)
          }
        }
      }, 
      (newFilter) => {}, 
      (errorMessage) => {
        if (errorMessage && relayStatus.message != errorMessage) {
          relayStatus.message = errorMessage
          displayRelayStatus(uiBox, relay, relayStatus)
        }
      }
    )
}