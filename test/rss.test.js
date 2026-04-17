'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRss } = require('../lib/rss.js');

test('buildRss returns valid RSS 2.0 XML', () => {
  const entries = [{
    url: 'https://bad.vercel.app',
    hostname: 'bad.vercel.app',
    timestamp: new Date().toISOString(),
    status: 'flagged',
    scan: { urlscanScore: 92, urlscanId: 'abc-123' }
  }];
  const xml = buildRss(entries);
  assert.ok(xml.includes('<?xml'));
  assert.ok(xml.includes('<rss'));
  assert.ok(xml.includes('bad.vercel.app'));
  assert.ok(xml.includes('<item>'));
});

test('buildRss only includes flagged and suspicious entries', () => {
  const entries = [
    { url: 'https://a.vercel.app', hostname: 'a', timestamp: new Date().toISOString(), status: 'clean', scan: null },
    { url: 'https://b.vercel.app', hostname: 'b', timestamp: new Date().toISOString(), status: 'flagged', scan: { urlscanId: 'x', urlscanScore: 90 } }
  ];
  const xml = buildRss(entries);
  assert.ok(!xml.includes('https://a.vercel.app'));
  assert.ok(xml.includes('b.vercel.app'));
});
