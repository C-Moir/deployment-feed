'use strict';
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

const mockFetch = mock.fn();
global.fetch = mockFetch;

const { makePlaceholderSvg, tryMicrolink } = require('../lib/screenshot.js');

test('makePlaceholderSvg returns valid SVG string containing hostname', () => {
  const svg = makePlaceholderSvg('my-app.vercel.app');
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('my-app.vercel.app'));
});

test('tryMicrolink returns image URL on success', async () => {
  mockFetch.mock.mockImplementationOnce(async () => ({
    ok: true,
    json: async () => ({ data: { screenshot: { url: 'https://cdn.microlink.io/img.png' } } })
  }));
  const url = await tryMicrolink('https://foo.vercel.app');
  assert.equal(url, 'https://cdn.microlink.io/img.png');
});

test('tryMicrolink returns null on failure', async () => {
  mockFetch.mock.mockImplementationOnce(async () => ({ ok: false, status: 429 }));
  const url = await tryMicrolink('https://foo.vercel.app');
  assert.equal(url, null);
});
