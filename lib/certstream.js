// lib/certstream.js
'use strict';
const WebSocket = require('ws');
const fs = require('node:fs');
const path = require('node:path');

const { PLATFORMS, getPlatform, isValidDeployment } = require('./platforms.js');

const CERTSTREAM_URL = 'wss://certstream.calidog.io';
const CRTSH_POLL_MS = 60_000;

const STATE_FILE = path.join(__dirname, '..', '.crtsh-state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (_) {}
}

// Per-platform cursor so restarts don't replay already-seen certs
const state = loadState();
console.log(`[crt.sh] resuming state for ${Object.keys(state).length} platform(s)`);

function extractHostnames(certData) {
  if (!certData?.data?.leaf_cert?.all_domains) return [];
  const seen = new Set();
  const results = [];
  for (const raw of certData.data.leaf_cert.all_domains) {
    for (const h of raw.split('\n').map(s => s.trim().replace(/^\*\./, ''))) {
      if (!h || !isValidDeployment(h) || seen.has(h)) continue;
      seen.add(h);
      results.push(h);
    }
  }
  return results;
}

async function pollPlatform(platform, queue, onNew) {
  const crtshUrl = `https://crt.sh/?q=%.${platform.domain}&output=json`;
  try {
    const res = await fetch(crtshUrl, { signal: AbortSignal.timeout(30_000) });
    if (res.status === 429) {
      console.warn(`[crt.sh] rate limited on ${platform.domain} - backing off`);
      return;
    }
    if (!res.ok) return;
    const certs = await res.json();
    if (!Array.isArray(certs)) return;

    const lastId = state[platform.domain] || 0;
    let newMaxId = lastId;

    for (const cert of certs) {
      if (cert.id <= lastId) break; // crt.sh returns newest first
      if (cert.id > newMaxId) newMaxId = cert.id;
      for (const raw of (cert.name_value || '').split('\n')) {
        const hostname = raw.trim().replace(/^\*\./, '');
        if (hostname && isValidDeployment(hostname)) {
          const entry = queue.push(hostname);
          if (entry) onNew(entry);
        }
      }
    }

    if (newMaxId > lastId) {
      state[platform.domain] = newMaxId;
      saveState(state);
    }
  } catch (_) {}
}

// Schedule each platform on its own staggered interval so crt.sh only
// sees one request every ~5 seconds rather than 12 in a burst.
function schedulePlatformPolling(queue, onNew) {
  const STAGGER_MS = 5_000; // 5s between each platform's first poll
  PLATFORMS.forEach((platform, i) => {
    setTimeout(() => {
      pollPlatform(platform, queue, onNew);
      setInterval(() => pollPlatform(platform, queue, onNew), CRTSH_POLL_MS);
    }, i * STAGGER_MS);
  });
}

function connect(queue, onNew, retryDelay = 1000) {
  schedulePlatformPolling(queue, onNew);

  function tryConnect() {
    const ws = new WebSocket(CERTSTREAM_URL);

    ws.on('open', () => {
      retryDelay = 1000;
      console.log('[certstream] connected');
    });

    ws.on('message', (data) => {
      try {
        const cert = JSON.parse(data);
        for (const hostname of extractHostnames(cert)) {
          const entry = queue.push(hostname);
          if (entry) onNew(entry);
        }
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
      }
    });

    ws.on('error', (err) => {
      console.error('[certstream] ws error:', err.code || err.message);
    });

    ws.on('close', () => {
      const next = Math.min(retryDelay * 2, 60_000);
      console.log(`[certstream] closed - retry in ${retryDelay}ms`);
      setTimeout(() => { retryDelay = next; tryConnect(); }, retryDelay);
    });
  }

  tryConnect();
}

module.exports = { connect, pollPlatform, isValidDeployment, extractHostnames };
