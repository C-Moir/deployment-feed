'use strict';
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

const mockFetch = mock.fn();
global.fetch = mockFetch;

const { buildReportEmail, hashUrl } = require('../lib/upstash.js');

test('hashUrl produces consistent hex string', async () => {
  const h1 = await hashUrl('https://bad.vercel.app');
  const h2 = await hashUrl('https://bad.vercel.app');
  assert.equal(h1, h2);
  assert.match(h1, /^[a-f0-9]+$/);
});

test('hashUrl produces different hashes for different URLs', async () => {
  const h1 = await hashUrl('https://bad.vercel.app');
  const h2 = await hashUrl('https://other.vercel.app');
  assert.notEqual(h1, h2);
});

test('buildReportEmail contains deployment URL and urlscan link', () => {
  const email = buildReportEmail({
    url: 'https://bad.vercel.app',
    scan: { urlscanId: 'abc-123', urlscanScore: 92 },
    threatIntel: { c2Ips: ['1.2.3.4'], redirectDomains: [], scriptSources: [] }
  }, 5);
  assert.ok(email.subject.includes('5'));
  assert.ok(email.body.includes('bad.vercel.app'));
  assert.ok(email.body.includes('abc-123'));
  assert.ok(email.body.includes('1.2.3.4'));
});
