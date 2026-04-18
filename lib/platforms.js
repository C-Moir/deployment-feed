'use strict';

// Each platform that gets free subdomain hosting and shows up in CT logs.
// ciPreviewRe - patterns that indicate automated/CI deploys, not real deployments
// internalRe  - platform's own infrastructure subdomains
const PLATFORMS = [
  {
    name: 'Vercel',
    domain: 'vercel.app',
    color: '#e0e0e0',
    ciPreviewRe: /^([a-z0-9]+-)*[a-z0-9]+-[a-z0-9]{6,}-[a-z0-9]+\.vercel\.app$/,
    internalRe: /^(api|www|vercel)\.vercel\.app$/,
  },
  {
    name: 'Netlify',
    domain: 'netlify.app',
    color: '#00ad9f',
    ciPreviewRe: /^deploy-preview-\d+--[^.]+\.netlify\.app$/,
    internalRe: /^(app|www|api|staging|brilliant-).*\.netlify\.app$/,
  },
  {
    name: 'CF Pages',
    domain: 'pages.dev',
    color: '#f6821f',
    // branch previews are <hash>.<project>.pages.dev (two subdomain levels)
    ciPreviewRe: /^[a-f0-9]+\.[^.]+\.pages\.dev$/,
    internalRe: /^(www|dash|workers|api)\.pages\.dev$/,
  },
  {
    name: 'Render',
    domain: 'onrender.com',
    color: '#46e3b7',
    ciPreviewRe: /^pr-\d+-[^.]+\.onrender\.com$/,
    internalRe: /^(www|api|dashboard|app|docs)\.onrender\.com$/,
  },
  {
    name: 'GitHub',
    domain: 'github.io',
    color: '#9b59b6',
    ciPreviewRe: null,
    internalRe: /^(www|pages|api|skills)\.github\.io$/,
  },
  {
    name: 'Glitch',
    domain: 'glitch.me',
    color: '#3333ff',
    ciPreviewRe: null,
    internalRe: /^(www|api|cdn|help|support)\.glitch\.me$/,
  },
  {
    name: 'Replit',
    domain: 'replit.app',
    color: '#f26207',
    ciPreviewRe: null,
    internalRe: /^(www|api|dev)\.replit\.app$/,
  },
  {
    name: 'Surge',
    domain: 'surge.sh',
    color: '#6bbe3f',
    ciPreviewRe: null,
    internalRe: /^(www|surge)\.surge\.sh$/,
  },
  {
    name: 'Deno',
    domain: 'deno.dev',
    color: '#70ffaf',
    ciPreviewRe: null,
    internalRe: /^(www|dash|api|fresh|docs|subhosting|.*\.subhosting|gcp\..*)\.deno\.dev$/,
  },
  {
    name: 'Railway',
    domain: 'railway.app',
    color: '#a855f7',
    ciPreviewRe: null,
    internalRe: /^(www|app|docs|help|blog)\.railway\.app$/,
  },
  {
    name: 'Fly.io',
    domain: 'fly.dev',
    color: '#7b2bf9',
    ciPreviewRe: null,
    internalRe: /^(www|fly|api|dash|registry|community)\.fly\.dev$/,
  },
  {
    name: 'Workers',
    domain: 'workers.dev',
    color: '#f6821f',
    ciPreviewRe: null,
    internalRe: /^(www|dash|api)\.workers\.dev$/,
  },
];

// Build a lookup map for fast hostname → platform resolution
const DOMAIN_MAP = new Map(PLATFORMS.map(p => [p.domain, p]));

function getPlatform(hostname) {
  if (!hostname) return null;
  // Walk from the longest possible suffix match
  for (const p of PLATFORMS) {
    if (hostname === p.domain || hostname.endsWith('.' + p.domain)) return p;
  }
  return null;
}

function isValidDeployment(hostname) {
  if (!hostname) return false;
  const p = getPlatform(hostname);
  if (!p) return false;
  // Root domain itself is never a user deployment
  if (hostname === p.domain) return false;
  if (p.internalRe?.test(hostname)) return false;
  if (p.ciPreviewRe?.test(hostname)) return false;
  return true;
}

module.exports = { PLATFORMS, getPlatform, isValidDeployment };
