'use strict';

const PRIORITY_KEYWORDS = [
  'login', 'wallet', 'verify', 'secure', 'bank',
  'confirm', 'account', 'recover', 'update-payment'
];
const MAX_DEDUP_SIZE = 10_000;
const MAX_QUEUE_SIZE = 100;

class LRUSet {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.map = new Map();
  }
  has(key) { return this.map.has(key); }
  add(key) {
    if (this.map.has(key)) return;
    if (this.map.size >= this.maxSize) {
      this.map.delete(this.map.keys().next().value);
    }
    this.map.set(key, true);
  }
  get size() { return this.map.size; }
}

class JobQueue {
  constructor() {
    this.seen = new LRUSet(MAX_DEDUP_SIZE);
    this.pending = [];
    this.all = new Map();
  }

  isPriority(hostname) {
    return PRIORITY_KEYWORDS.some(kw => hostname.includes(kw));
  }

  push(hostname) {
    if (this.seen.has(hostname)) return null;
    this.seen.add(hostname);
    const priority = this.isPriority(hostname);
    if (!priority && this.pending.length >= MAX_QUEUE_SIZE) return null;

    const entry = {
      id: crypto.randomUUID(),
      url: `https://${hostname}`,
      hostname,
      timestamp: new Date().toISOString(),
      status: 'pending',
      priority,
      scan: null,
      screenshot: null,
      screenshotSource: null,
      meta: null,
      framework: null,
      aiTool: null,
      threatIntel: null
    };

    if (priority) this.pending.unshift(entry);
    else this.pending.push(entry);
    this.all.set(entry.id, entry);
    return entry;
  }

  shift() { return this.pending.shift() || null; }

  update(id, patch) {
    const entry = this.all.get(id);
    if (!entry) return null;
    Object.assign(entry, patch);
    return entry;
  }

  getAll() { return Array.from(this.all.values()); }
}

module.exports = { LRUSet, JobQueue, PRIORITY_KEYWORDS, MAX_QUEUE_SIZE };
