'use strict';
const fs = require('node:fs');
const path = require('node:path');

const HISTORY_FILE = path.join(__dirname, '..', 'history.ndjson');

function appendHistory(entry) {
  const record = {
    id: entry.id,
    hostname: entry.hostname,
    url: entry.url,
    platform: entry.platform || 'Unknown',
    timestamp: entry.timestamp,
    title: entry.meta?.title || null,
    status: entry.status,
    screenshot: entry.screenshot || null,
    screenshotSource: entry.screenshotSource || null,
    scan: entry.scan || null,
    meta: entry.meta || null,
    framework: entry.framework || null,
    aiTool: entry.aiTool || null,
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
