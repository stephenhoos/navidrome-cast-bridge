const stateUrl = '/api/state';
const devicesUrl = '/devices';
const searchUrl = '/search';

const els = {
  statusText: document.querySelector('#statusText'),
  toggleCast: document.querySelector('#toggleCast'),
  toggleText: document.querySelector('#toggleText'),
  deviceSelect: document.querySelector('#deviceSelect'),
  refreshDevices: document.querySelector('#refreshDevices'),
  lastEvent: document.querySelector('#lastEvent'),
  lastCast: document.querySelector('#lastCast'),
  searchForm: document.querySelector('#searchForm'),
  query: document.querySelector('#query'),
  results: document.querySelector('#results')
};

let currentState = { enabled: false, device: '', devices: [] };

async function loadState() {
  const response = await fetch(stateUrl);
  currentState = await response.json();
  renderState();
}

function renderState() {
  els.toggleCast.classList.toggle('on', currentState.enabled);
  els.toggleCast.setAttribute('aria-pressed', String(currentState.enabled));
  els.toggleText.textContent = currentState.enabled ? 'On' : 'Off';
  els.statusText.textContent = `${currentState.devices?.length || 0} Cast devices found`;

  const selected = currentState.device || currentState.devices?.[0]?.fn || currentState.devices?.[0]?.name || '';
  els.deviceSelect.innerHTML = '';

  for (const device of currentState.devices || []) {
    const option = document.createElement('option');
    option.value = device.fn || device.name;
    option.textContent = device.fn || device.name;
    option.selected = option.value === selected;
    els.deviceSelect.append(option);
  }

  if (!els.deviceSelect.options.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No Cast devices found';
    els.deviceSelect.append(option);
  }

  els.lastEvent.textContent = currentState.lastEvent?.track?.title
    ? `${currentState.lastEvent.state}: ${formatSong(currentState.lastEvent.track)}`
    : 'No playback event yet';

  els.lastCast.textContent = currentState.lastCast?.song
    ? `${currentState.lastCast.song} -> ${currentState.lastCast.device}`
    : 'Nothing cast yet';
}

async function patchState(update) {
  const response = await fetch(stateUrl, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update)
  });
  currentState = { ...currentState, ...(await response.json()) };
  await loadState();
}

els.toggleCast.addEventListener('click', async () => {
  await patchState({
    enabled: !currentState.enabled,
    device: els.deviceSelect.value || currentState.device
  });
});

els.deviceSelect.addEventListener('change', async () => {
  await patchState({ device: els.deviceSelect.value });
});

els.refreshDevices.addEventListener('click', loadState);

els.searchForm.addEventListener('submit', async event => {
  event.preventDefault();
  const query = els.query.value.trim();
  if (!query) return;

  els.results.textContent = 'Searching...';
  const response = await fetch(`${searchUrl}?q=${encodeURIComponent(query)}`);
  const data = await response.json();
  renderResults(data.song || []);
});

document.querySelectorAll('[data-action]').forEach(button => {
  button.addEventListener('click', async () => {
    const device = els.deviceSelect.value || currentState.device;
    if (!device) return;

    await fetch('/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device, action: button.dataset.action })
    });
    await loadState();
  });
});

function renderResults(songs) {
  els.results.innerHTML = '';

  if (!songs.length) {
    els.results.textContent = 'No tracks found.';
    return;
  }

  for (const song of songs) {
    const item = document.createElement('div');
    item.className = 'result';

    const img = document.createElement('img');
    img.className = 'cover';
    img.alt = '';
    if (song.coverArt) img.src = `/cover/${encodeURIComponent(song.coverArt)}`;

    const text = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = song.title || 'Untitled';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [song.artist, song.album].filter(Boolean).join(' - ');
    text.append(title, meta);

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Cast';
    button.addEventListener('click', () => castSong(song.id));

    item.append(img, text, button);
    els.results.append(item);
  }
}

async function castSong(songId) {
  const device = els.deviceSelect.value || currentState.device;
  if (!device) return;

  await fetch('/cast', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device, songId })
  });
  await loadState();
}

function formatSong(track) {
  return [track.artist, track.title].filter(Boolean).join(' - ');
}

await loadState();
setInterval(loadState, 5000);
