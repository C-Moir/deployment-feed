'use strict';
const fs = require('node:fs');
const path = require('node:path');

const HISTORY_FILE = path.join(__dirname, '..', 'history.ndjson');

function appendHistory(entry) {
  const record = {
    hostname: entry.hostname,
    url: entry.url,
    timestamp: entry.timestamp,
    title: entry.meta?.title || null,
    status: entry.status,
    urlscanId: entry.scan?.urlscanId || null,
  };
  try {
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(record) + '\n');
  } catch (_) {}
}

function readHistory(limit = 1000) {
  try {
    const content = fs.readFileSync(HISTORY_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map(l => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

module.exports = { appendHistory, readHistory };
