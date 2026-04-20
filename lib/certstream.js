// lib/certstream.js
// Primary source: certstream.calidog.io WebSocket — aggregates ALL CT logs globally.
//   Gives us Render/Railway/Fly.io/Deno via LE certs (Google Argon/Xenon unreachable directly).
// Secondary: Cloudflare Nimbus direct poll — low latency for CF Pages/Workers.
// Supplement: crt.sh polling — catches wildcard-cert platforms when service is up.
'use strict';

const WebSocket = require('ws');
const fs = require('node:fs');
const path = require('node:path');
const { X509Certificate } = require('crypto');
const { PLATFORMS, isValidDeployment } = require('./platforms.js');

const STATE_FILE = path.join(__dirname, '..', '.crtsh-state.json');

// Nimbus direct poll — still fast and reliable for CF Pages/Workers
const NIMBUS_URL   = 'https://ct.cloudflare.com/logs/nimbus2026';
const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 256;

// crt.sh supplement — all platforms, one every 2 minutes (~24min full cycle)
const CRTSH_PLATFORMS = PLATFORMS;
const CRTSH_POLL_MS   = 2 * 60_000;

// ─── Persisted state ─────────────────────────────────────────────────────────

let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) {}

let logState     = state.logs  || state;
let crtshCursors = state.crtsh || {};

if (state.logs === undefined && Object.values(state).some(v => typeof v === 'number' && v > 1_000_000)) {
  logState = state;
  crtshCursors = {};
}

console.log(`[ct] resuming state for ${Object.keys(logState).length} log(s), ${Object.keys(crtshCursors).length} crt.sh cursor(s)`);

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ logs: logState, crtsh: crtshCursors })); } catch (_) {}
}

// ─── certstream WebSocket ─────────────────────────────────────────────────────
// Streams all new cert issuances from every CT log in real time.
// This gets us Google Argon/Xenon coverage (LE certs → Render/Railway/Fly.io/Deno)
// without needing to reach Google's servers directly.

function connectCertstreamWS(queue, onNew) {
  let ws;
  let reconnectDelay = 5_000;

  function connect() {
    ws = new WebSocket('wss://certstream.calidog.io/');

    ws.on('open', () => {
      console.log('[certstream] connected — streaming all CT logs');
      reconnectDelay = 5_000; // reset backoff on successful connect
    });

    ws.on('message', data => {
      try {
        const msg = JSON.parse(data);
        if (msg.message_type !== 'certificate_update') return;

        const domains = msg.data?.leaf_cert?.all_domains || [];
        for (const domain of domains) {
          const hostname = domain.replace(/^\*\./, '').trim().toLowerCase();
          if (!hostname || !isValidDeployment(hostname)) continue;
          const entry = queue.push(hostname);
          if (entry) onNew(entry);
        }
      } catch (_) {}
    });

    ws.on('error', err => {
      // Suppress noisy disconnect errors — reconnect handles it
      if (!err.message.includes('ECONNRESET') && !err.message.includes('closed')) {
        console.warn('[certstream]', err.message);
      }
    });

    ws.on('close', () => {
      console.log(`[certstream] disconnected — reconnecting in ${reconnectDelay / 1000}s`);
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 60_000); // exponential backoff, cap 1min
    });
  }

  connect();
}

// ─── Nimbus direct poll ───────────────────────────────────────────────────────
// Kept alongside certstream — lower latency for CF Pages/Workers since Nimbus
// is Cloudflare's own log and responds in ~1s from most networks.

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function extractHostnames(leafInputB64) {
  const buf = Buffer.from(leafInputB64, 'base64');
  const entryType = buf.readUInt16BE(10);
  let certDer;
  if (entryType === 0) {
    const len = (buf[12] << 16) | (buf[13] << 8) | buf[14];
    certDer = buf.slice(15, 15 + len);
  } else {
    const len = (buf[45] << 16) | (buf[46] << 8) | buf[47];
    certDer = buf.slice(48, 48 + len);
  }
  try {
    const cert = new X509Certificate(certDer);
    const san = cert.subjectAltName || '';
    return san
      .split(', ')
      .map(s => s.replace(/^DNS:/, '').trim().replace(/^\*\./, ''))
      .filter(h => h && isValidDeployment(h));
  } catch (_) { return []; }
}

async function pollNimbus(queue, onNew) {
  const key = NIMBUS_URL;
  try {
    const sth = await fetchJson(`${NIMBUS_URL}/ct/v1/get-sth`);
    const treeSize = sth.tree_size;

    if (logState[key] == null) {
      logState[key] = Math.max(0, treeSize - BATCH_SIZE);
      saveState();
      return;
    }
    if (logState[key] >= treeSize) return;

    let cursor = logState[key];
    let totalNew = 0;
    const MAX_PER_POLL = BATCH_SIZE * 8;

    while (cursor < treeSize && (cursor - logState[key]) < MAX_PER_POLL) {
      const end = Math.min(cursor + BATCH_SIZE - 1, treeSize - 1);
      const data = await fetchJson(`${NIMBUS_URL}/ct/v1/get-entries?start=${cursor}&end=${end}`);
      const entries = data.entries || [];
      if (!entries.length) break;

      for (const entry of entries) {
        for (const hostname of extractHostnames(entry.leaf_input)) {
          const qEntry = queue.push(hostname);
          if (qEntry) { onNew(qEntry); totalNew++; }
        }
      }
      cursor += entries.length;
    }

    logState[key] = cursor;
    saveState();
    if (totalNew > 0) console.log(`[nimbus] +${totalNew} new deployments`);
  } catch (err) {
    console.warn(`[nimbus] ${err.message}`);
  }
}

// ─── crt.sh supplement ───────────────────────────────────────────────────────

async function fetchCrtsh(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(25_000) });
    } catch (err) {
      const transient = err.message.includes('fetch failed') ||
                        err.message.includes('timeout') ||
                        err.message.includes('aborted');
      if (!transient || attempt === 1) throw err;
      await new Promise(r => setTimeout(r, 5_000));
    }
  }
}

async function pollCrtsh(platform, queue, onNew) {
  const url = `https://crt.sh/?q=%.${platform.domain}&output=json&exclude=expired`;
  try {
    const res = await fetchCrtsh(url);
    if (res.status === 429) { console.warn(`[crt.sh] rate limited on ${platform.domain}`); return; }
    if (!res.ok) return;
    const certs = await res.json();
    if (!Array.isArray(certs)) return;

    const lastId = crtshCursors[platform.domain] || 0;
    let newMaxId = lastId;
    let found = 0;

    for (const cert of certs) {
      if (cert.id <= lastId) continue;
      if (cert.id > newMaxId) newMaxId = cert.id;
      for (const raw of (cert.name_value || '').split('\n')) {
        const hostname = raw.trim().replace(/^\*\./, '');
        if (hostname && isValidDeployment(hostname)) {
          const entry = queue.push(hostname);
          if (entry) { onNew(entry); found++; }
        }
      }
    }

    if (newMaxId > lastId) { crtshCursors[platform.domain] = newMaxId; saveState(); }
    if (found > 0) console.log(`[crt.sh] ${platform.domain}: +${found} new deployments`);
  } catch (_) {}
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function connect(queue, onNew) {
  // certstream WebSocket — all CT logs via aggregator (bypasses unreachable Google logs)
  connectCertstreamWS(queue, onNew);

  // Nimbus direct poll — low latency supplement for CF Pages/Workers
  console.log(`[nimbus] direct polling every ${POLL_INTERVAL_MS / 1000}s`);
  setTimeout(() => {
    pollNimbus(queue, onNew);
    setInterval(() => pollNimbus(queue, onNew), POLL_INTERVAL_MS);
  }, 2_000);

  // crt.sh — wildcard platform supplement, recovers automatically when service is up
  const cycleMins = Math.round((CRTSH_PLATFORMS.length * CRTSH_POLL_MS) / 60_000);
  console.log(`[crt.sh] polling all ${CRTSH_PLATFORMS.length} platforms (~${cycleMins}min full cycle)`);
  let crtshIdx = 0;
  const crtshTick = () => {
    pollCrtsh(CRTSH_PLATFORMS[crtshIdx++ % CRTSH_PLATFORMS.length], queue, onNew);
  };
  setTimeout(crtshTick, 30_000);
  setInterval(crtshTick, CRTSH_POLL_MS);
}

module.exports = { connect };
