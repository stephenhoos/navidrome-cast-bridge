import crypto from 'node:crypto';
import os from 'node:os';
import { once } from 'node:events';
import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import { Bonjour } from 'bonjour-service';
import { Client, DefaultMediaReceiver } from 'castv2-client';
import { request } from 'undici';

const config = {
  port: Number(process.env.PORT || 4545),
  navidromeUrl: requiredUrl(process.env.NAVIDROME_URL, 'NAVIDROME_URL'),
  navidromeUser: process.env.NAVIDROME_USER || '',
  navidromePassword: process.env.NAVIDROME_PASSWORD || '',
  bridgePublicUrl: process.env.BRIDGE_PUBLIC_URL,
  subsonicClient: process.env.SUBSONIC_CLIENT || 'navidrome-cast-bridge',
  subsonicVersion: process.env.SUBSONIC_VERSION || '1.16.1'
};

const app = express();
const bonjour = new Bonjour();
const devices = new Map();
const sessions = new Map();
const bridgeState = {
  enabled: process.env.CAST_ENABLED === 'true',
  device: process.env.CAST_DEVICE || '',
  lastEvent: null,
  lastCast: null
};

app.use(express.json());
app.use(morgan('combined'));
app.use(express.static(new URL('../public', import.meta.url).pathname));

bonjour.find({ type: 'googlecast' }, service => {
  const host = firstAddress(service);
  if (!host) return;

  const id = service.txt?.id || service.fqdn || service.name;
  devices.set(id, {
    id,
    name: service.name,
    host,
    port: service.port || 8009,
    model: service.txt?.md,
    fn: service.txt?.fn
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, devices: devices.size });
});

app.get('/devices', (_req, res) => {
  res.json([...devices.values()].sort((a, b) => a.name.localeCompare(b.name)));
});

app.get('/api/state', (_req, res) => {
  res.json({
    ...bridgeState,
    devices: [...devices.values()].sort((a, b) => a.name.localeCompare(b.name))
  });
});

app.patch('/api/state', (req, res) => {
  const { enabled, device } = req.body || {};

  if (typeof enabled === 'boolean') bridgeState.enabled = enabled;
  if (typeof device === 'string') bridgeState.device = device;

  res.json(bridgeState);
});

app.get('/search', async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query) return res.status(400).json({ error: 'Missing q query parameter.' });

    const data = await subsonic('search3', {
      query,
      artistCount: '5',
      albumCount: '5',
      songCount: '25'
    });

    res.json(data['subsonic-response']?.searchResult3 || {});
  } catch (error) {
    next(error);
  }
});

app.post('/plugin/playback', async (req, res, next) => {
  try {
    const event = req.body || {};
    const track = event.track || {};
    bridgeState.lastEvent = {
      state: event.state || '',
      username: event.username || '',
      track: {
        id: track.id || track.ID || track.Id || '',
        title: track.title || track.Title || '',
        artist: track.artist || track.Artist || '',
        album: track.album || track.Album || ''
      },
      receivedAt: new Date().toISOString()
    };
    console.log(`plugin playback event: state=${event.state || ''} user=${event.username || ''} track=${track.artist || ''} - ${track.title || ''}`);

    if (event.autoCast && bridgeState.enabled) {
      await handlePluginCastEvent(event);
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/cast', async (req, res, next) => {
  try {
    const { device, songId } = req.body || {};
    if (!device || !songId) {
      return res.status(400).json({ error: 'Expected JSON body with device and songId.' });
    }

    const target = findDevice(device);
    if (!target) return res.status(404).json({ error: `No Cast device matched "${device}".` });

    const song = await getSong(songId);
    const player = await getPlayer(target);
    const media = mediaInfo(song, publicUrl(req, `/media/${encodeURIComponent(songId)}`));

    await load(player, media);
    bridgeState.enabled = true;
    bridgeState.device = target.fn || target.name;
    bridgeState.lastCast = {
      device: target.fn || target.name,
      song: displaySong(song),
      songId,
      castAt: new Date().toISOString()
    };
    res.json({ ok: true, device: target.name, song: displaySong(song) });
  } catch (error) {
    next(error);
  }
});

app.post('/control', async (req, res, next) => {
  try {
    const { device, action } = req.body || {};
    if (!device || !action) {
      return res.status(400).json({ error: 'Expected JSON body with device and action.' });
    }

    const target = findDevice(device);
    if (!target) return res.status(404).json({ error: `No Cast device matched "${device}".` });

    const player = await getPlayer(target);
    await control(player, action);
    res.json({ ok: true, device: target.name, action });
  } catch (error) {
    next(error);
  }
});

app.get('/media/:songId', async (req, res, next) => {
  try {
    const streamUrl = subsonicUrl('stream', {
      id: req.params.songId,
      estimateContentLength: 'true'
    });

    const upstream = await request(streamUrl);
    res.status(upstream.statusCode);

    for (const [key, value] of Object.entries(upstream.headers)) {
      if (value && safeProxyHeader(key)) res.setHeader(key, value);
    }

    upstream.body.pipe(res);
  } catch (error) {
    next(error);
  }
});

app.get('/cover/:coverArtId', async (req, res, next) => {
  try {
    const coverUrl = subsonicUrl('getCoverArt', { id: req.params.coverArtId, size: '512' });
    const upstream = await request(coverUrl);
    res.status(upstream.statusCode);

    for (const [key, value] of Object.entries(upstream.headers)) {
      if (value && safeProxyHeader(key)) res.setHeader(key, value);
    }

    upstream.body.pipe(res);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Internal server error.' });
});

const server = app.listen(config.port, () => {
  const base = config.bridgePublicUrl || `http://${lanAddress()}:${config.port}`;
  console.log(`Navidrome Cast Bridge listening on http://localhost:${config.port}`);
  console.log(`Speaker-facing URL: ${base}`);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function shutdown() {
  for (const session of sessions.values()) session.client.close();
  bonjour.destroy();
  server.close();
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredUrl(value, name) {
  const raw = required(value, name);
  return new URL(raw.replace(/\/+$/, ''));
}

function authParams() {
  if (!config.navidromeUser) throw new Error('NAVIDROME_USER is required.');
  if (!config.navidromePassword) throw new Error('NAVIDROME_PASSWORD is required.');

  const salt = crypto.randomBytes(8).toString('hex');
  const token = crypto.createHash('md5').update(config.navidromePassword + salt).digest('hex');

  return {
    u: config.navidromeUser,
    t: token,
    s: salt,
    v: config.subsonicVersion,
    c: config.subsonicClient,
    f: 'json'
  };
}

function subsonicUrl(endpoint, params = {}) {
  const url = new URL(`/rest/${endpoint}.view`, config.navidromeUrl);
  const merged = { ...params, ...authParams() };
  for (const [key, value] of Object.entries(merged)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function subsonic(endpoint, params) {
  const response = await request(subsonicUrl(endpoint, params));
  const body = await response.body.json();
  const envelope = body['subsonic-response'];

  if (!envelope || envelope.status !== 'ok') {
    const message = envelope?.error?.message || `Subsonic ${endpoint} failed`;
    throw new Error(message);
  }

  return body;
}

async function getSong(songId) {
  const data = await subsonic('getSong', { id: songId });
  return data['subsonic-response'].song;
}

function mediaInfo(song, contentId) {
  const contentType = contentTypeFor(song);
  const metadata = {
    type: 3,
    metadataType: 3,
    title: song.title,
    artist: song.artist,
    albumName: song.album,
    images: song.coverArt ? [{ url: publicStaticUrl(`/cover/${encodeURIComponent(song.coverArt)}`) }] : []
  };

  return {
    contentId,
    contentType,
    streamType: 'BUFFERED',
    duration: song.duration,
    metadata
  };
}

function contentTypeFor(song) {
  const suffix = String(song.suffix || '').toLowerCase();
  const bySuffix = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    opus: 'audio/ogg'
  };

  return song.contentType || bySuffix[suffix] || 'audio/mpeg';
}

async function getPlayer(device) {
  const existing = sessions.get(device.id);
  if (existing) return existing.player;

  const client = new Client();
  client.on('error', error => {
    console.error(`Cast client error for ${device.name}:`, error.message);
    client.close();
    sessions.delete(device.id);
  });

  client.connect({ host: device.host, port: device.port });
  await once(client, 'connect');

  const player = await new Promise((resolve, reject) => {
    client.launch(DefaultMediaReceiver, (error, launchedPlayer) => {
      if (error) reject(error);
      else resolve(launchedPlayer);
    });
  });

  sessions.set(device.id, { client, player });
  return player;
}

async function load(player, media) {
  await new Promise((resolve, reject) => {
    player.load(media, { autoplay: true }, error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function control(player, action) {
  const commands = {
    play: cb => player.play(cb),
    pause: cb => player.pause(cb),
    stop: cb => player.stop(cb)
  };

  const command = commands[action];
  if (!command) throw new Error(`Unsupported action "${action}".`);

  await new Promise((resolve, reject) => {
    command(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function handlePluginCastEvent(event) {
  const targetName = event.castDevice || bridgeState.device;
  if (!targetName) return;

  const target = findDevice(targetName);
  if (!target) throw new Error(`No Cast device matched "${event.castDevice}".`);

  const player = await getPlayer(target);
  const state = String(event.state || '').toLowerCase();

  if (state === 'paused') {
    await control(player, 'pause');
    return;
  }

  if (state === 'stopped' || state === 'expired') {
    await control(player, 'stop');
    return;
  }

  if (state !== 'playing' && state !== 'now_playing') return;

  const songId = event.track?.id || event.track?.ID || event.track?.Id;
  if (!songId) throw new Error('Plugin playback event did not include a track id.');

  const song = await getSong(songId);
  const media = mediaInfo(song, publicStaticUrl(`/media/${encodeURIComponent(songId)}`));
  await load(player, media);
  bridgeState.lastCast = {
    device: target.fn || target.name,
    song: displaySong(song),
    songId,
    castAt: new Date().toISOString()
  };
}

function findDevice(value) {
  const needle = String(value).toLowerCase();
  return [...devices.values()].find(device => {
    return device.id.toLowerCase() === needle ||
      device.name.toLowerCase() === needle ||
      String(device.fn || '').toLowerCase() === needle ||
      device.host === value ||
      String(device.fn || '').toLowerCase().includes(needle) ||
      device.name.toLowerCase().includes(needle);
  });
}

function firstAddress(service) {
  const addresses = service.addresses || [];
  return addresses.find(address => /^\d+\.\d+\.\d+\.\d+$/.test(address)) || addresses[0] || service.host;
}

function safeProxyHeader(key) {
  return !['connection', 'keep-alive', 'transfer-encoding'].includes(key.toLowerCase());
}

function publicUrl(req, path) {
  const base = config.bridgePublicUrl || `${req.protocol}://${req.get('host')}`;
  return new URL(path, base).toString();
}

function publicStaticUrl(path) {
  const base = config.bridgePublicUrl || `http://${lanAddress()}:${config.port}`;
  return new URL(path, base).toString();
}

function lanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return '127.0.0.1';
}

function displaySong(song) {
  return [song.artist, song.title].filter(Boolean).join(' - ');
}
