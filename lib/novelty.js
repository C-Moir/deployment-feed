// lib/novelty.js
// Classify a hostname as 'new' or 'renewal' by asking crt.sh how many certs it has ever issued for it.
//   1 cert  -> new deployment (the one we just saw)
//   2+ certs -> renewal / reissue — the site was already there, we're seeing a 90-day LE refresh
//
// crt.sh is rate-limited and flaky, so this runs on a global throttle and degrades gracefully to
// 'unknown' on error/timeout. Results are cached in-process so repeat hits are free.
'use strict';

const EventEmitter = require('node:events');
const emitter = new EventEmitter();

const cache = new Map();          // hostname -> 'new' | 'renewal' | 'unknown'
const pending = new Map();        // hostname -> queued-at timestamp (dedupe while queued)
const queue = [];
let running = false;

// 3s between crt.sh queries = ~20/min = 1200/hr. Generous enough not to trip rate limits,
// aggressive enough to keep up with typical CT log volume on the hosting platforms we track.
const INTERVAL_MS = 3_000;
const CACHE_LIMIT = 20_000;       // LRU cap — hostnames are small, so room for plenty

// Backoff on transient crt.sh failures (same pattern as certstream.js)
const BACKOFF_MS = [5_000, 15_000, 45_000];

function lruSet(key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

async function fetchCrtshCount(hostname) {
  const url = `https://crt.sh/?q=${encodeURIComponent(hostname)}&output=json`;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if ((res.status === 502 || res.status === 504 || res.status === 429) && attempt < BACKOFF_MS.length) {
        await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]));
        continue;
      }
      if (res.status === 404) return 0;            // crt.sh doesn't know this host — treat as new
      if (!res.ok) return null;
      const certs = await res.json();
      return Array.isArray(certs) ? certs.length : null;
    } catch (err) {
      const transient = /fetch failed|timeout|aborted/i.test(err.message);
      if (!transient || attempt === BACKOFF_MS.length) return null;
      await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]));
    }
  }
  return null;
}

async function runWorker() {
  if (running) return;
  running = true;
  while (queue.length) {
    const hostname = queue.shift();
    pending.delete(hostname);

    const count = await fetchCrtshCount(hostname);
    let verdict;
    if (count === null)      verdict = 'unknown';
    else if (count <= 1)     verdict = 'new';
    else                     verdict = 'renewal';

    lruSet(hostname, verdict);
    emitter.emit('classified', { hostname, verdict, count });

    if (queue.length) await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
  running = false;
}

// Public API ───────────────────────────────────────────────────────────────

// Returns the cached verdict or null. Does NOT enqueue — caller chooses via classify().
function get(hostname) {
  return cache.get(hostname) || null;
}

// Enqueue a hostname for classification. Returns the cached verdict immediately if known,
// otherwise returns null and the result arrives later via the 'classified' event.
function classify(hostname) {
  if (!hostname) return null;
  if (cache.has(hostname)) return cache.get(hostname);
  if (!pending.has(hostname)) {
    pending.set(hostname, Date.now());
    queue.push(hostname);
  }
  runWorker();
  return null;
}

function onClassified(fn) { emitter.on('classified', fn); }

function queueLength() { return queue.length; }

module.exports = { classify, get, onClassified, queueLength };
