'use strict';

// Atomic: check-reported -> increment -> mark-reported if threshold reached
// Returns count when threshold hit (caller sends the report), else 0
const LUA_SCRIPT = `
local reported = redis.call('EXISTS', KEYS[1])
if reported == 1 then return 0 end
local count = redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], 604800)
if count >= 3 then
  redis.call('SET', KEYS[1], '1', 'EX', 2592000)
  return count
end
return 0
`.trim();

async function hashUrl(url) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function recordAndCheck(url, env = process.env) {
  const { UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN } = env;
  if (!UPSTASH_REDIS_URL || !UPSTASH_REDIS_TOKEN) return null;
  try {
    const hash = await hashUrl(url);
    const res = await fetch(`${UPSTASH_REDIS_URL}/eval`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        script: LUA_SCRIPT,
        keys: [`reported:${hash}`, `counter:${hash}`],
        args: []
      }),
      signal: AbortSignal.timeout(5_000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result > 0 ? data.result : null;
  } catch (_) {
    return null;
  }
}

function buildReportEmail(entry, confirmedBy) {
  const urlscanLink = `https://urlscan.io/result/${entry.scan?.urlscanId}/`;
  const c2List = entry.threatIntel?.c2Ips?.join(', ') || 'none identified';
  return {
    to: 'abuse@vercel.com',
    subject: `Malicious Vercel deployment confirmed by ${confirmedBy} independent instances`,
    body: [
      `Deployment: ${entry.url}`,
      `URLScan result: ${urlscanLink}`,
      `URLhaus confirmation: yes`,
      `URLScan score: ${entry.scan?.urlscanScore ?? '?'}/100`,
      `Independent reports: ${confirmedBy}`,
      `Extracted C2 IPs: ${c2List}`,
      ``,
      `Reported by vercel-feed (https://github.com/C-Moir/vercel-feed)`
    ].join('\n')
  };
}

function buildMailtoLink(entry, confirmedBy) {
  const { to, subject, body } = buildReportEmail(entry, confirmedBy);
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

module.exports = { recordAndCheck, buildReportEmail, buildMailtoLink, hashUrl };
