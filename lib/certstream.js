// lib/certstream.js — direct CT log polling via Google/Cloudflare REST APIs
// Replaces the broken certstream.calidog.io WebSocket + flaky crt.sh
'use strict';

const { X509Certificate } = require('crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PLATFORMS, isValidDeployment } = require('./platforms.js');

const STATE_FILE = path.join(__dirname, '..', '.crtsh-state.json');
const POLL_INTERVAL_MS = 10_000;  // check for new CT entries every 10s
const BATCH_SIZE = 256;           // entries per fetch request

// CT logs to poll — multiple for better coverage
const CT_LOGS = [
  'https://ct.googleapis.com/logs/us1/argon2026h1',
  'https://ct.googleapis.com/logs/eu1/xenon2026h1',
];

// Per-log cursor: last tree index we've processed
let logState = {};
try {
  logState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
} catch (_) {}
console.log(`[ct] resuming state for ${Object.keys(logState).length} log(s)`);

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(logState)); } catch (_) {}
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function extractHostnames(leafInputB64) {
  const buf = Buffer.from(leafInputB64, 'base64');
  // MerkleTreeLeaf: 1 version + 1 leaf_type + 8 timestamp + 2 entry_type = 12 bytes
  const entryType = buf.readUInt16BE(10);

  let certDer;
  if (entryType === 0) {
    // x509_entry: 3-byte length then DER cert
    const len = (buf[12] << 16) | (buf[13] << 8) | buf[14];
    certDer = buf.slice(15, 15 + len);
  } else {
    // precert_entry: skip 32-byte issuer_key_hash + 3-byte len
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
  } catch (_) {
    return [];
  }
}

async function pollLog(logUrl, queue, onNew) {
  const key = logUrl;
  try {
    const sth = await fetchJson(`${logUrl}/ct/v1/get-sth`);
    const treeSize = sth.tree_size;

    if (logState[key] == null) {
      // First run - start near the tip, not from the beginning
      logState[key] = Math.max(0, treeSize - BATCH_SIZE);
      saveState();
      return;
    }

    if (logState[key] >= treeSize) return; // nothing new

    let cursor = logState[key];
    let totalNew = 0;
    const MAX_PER_POLL = BATCH_SIZE * 8; // scan up to ~2000 entries per poll

    while (cursor < treeSize && (cursor - logState[key]) < MAX_PER_POLL) {
      const end = Math.min(cursor + BATCH_SIZE - 1, treeSize - 1);
      const data = await fetchJson(`${logUrl}/ct/v1/get-entries?start=${cursor}&end=${end}`);
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

    if (totalNew > 0) console.log(`[ct] ${new URL(logUrl).pathname.split('/').pop()}: +${totalNew} new deployments`);
  } catch (err) {
    console.warn(`[ct] ${logUrl}: ${err.message}`);
  }
}

function connect(queue, onNew) {
  console.log(`[ct] polling ${CT_LOGS.length} CT logs every ${POLL_INTERVAL_MS / 1000}s`);

  // Stagger initial polls so they don't all fire at once
  CT_LOGS.forEach((log, i) => {
    setTimeout(() => {
      pollLog(log, queue, onNew);
      setInterval(() => pollLog(log, queue, onNew), POLL_INTERVAL_MS);
    }, i * 3_000);
  });
}

module.exports = { connect };
