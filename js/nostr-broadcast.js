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
  $('#fetching-relays-header').html("<th>Relay</th><th>Status</th><th>Searching Until</th><th>Events</th><th></th>")

  // get all events from relays
  let filterObj = JSON.parse(filter)

  let date = new Date();
  let offset = date.getTimezoneOffset() * 60;

  const startDate = Date.parse($('#startDate').val())
  const endDate = Date.parse($('#endDate').val())

  if ($('#activeDates')[0].checked) {
    filterObj = { ...filterObj,
      since: Math.floor((startDate - startDate % 864e5) / 1000) + offset, // 0:00
      until: Math.floor((endDate - endDate % 864e5 + 864e5 - 1) / 1000) + offset // 23:59
    }
  }

  const data = (await getEvents([filterObj], relaySet, "fetching-relays")).sort((a, b) => b.created_at - a.created_at)

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
  }

  // inform user that broadcasting is done
  $('#broadcasting-status').html(txt.broadcasting + checkMark)
  $('#broadcasting-progress').val(relaySetBroadcast.length)
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

  // show and update fetching progress bar
  $('#fetching-progress').css('visibility', 'visible')
  $('#fetching-progress').prop('max', relaySetBroadcast.length)

  // inform user fetching is done
  $('#fetching-status').html(txt.fetching + checkMark)
  $('#fetching-progress').val(relaySetBroadcast.length)

  const relaySetBroadcast = parseRelaySet($('#relaySetBroadcast').val(), undefined)

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
    $('#broadcasting-relays-header').html("<th>Relay</th><th>Status</th><th></th><th></th><th>Events</th><th>Message</th>")

    await broadcastEvents(data, relaySetBroadcast, "broadcasting-relays")

    // re-enable broadcast button
    $('#fetch-and-broadcast').prop('disabled', false)
    $('#just-broadcast').prop('disabled', false)
  }
  // inform user that broadcasting is done
  $('#broadcasting-status').html(txt.broadcasting + checkMark)
  $('#broadcasting-progress').val(relaySetBroadcast.length)
}