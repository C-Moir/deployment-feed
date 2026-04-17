'use strict';

async function sendWebhook(entry, webhookUrl) {
  if (!webhookUrl) return;
  const urlscanLink = entry.scan?.urlscanId
    ? `https://urlscan.io/result/${entry.scan.urlscanId}/`
    : null;
  const payload = {
    embeds: [{
      title: `${entry.status.toUpperCase()}: ${entry.hostname}`,
      url: urlscanLink || 'https://urlscan.io',
      color: entry.status === 'flagged' ? 0xFF0000 : 0xFF8C00,
      fields: [
        { name: 'URL', value: entry.url, inline: false },
        { name: 'URLScan Score', value: String(entry.scan?.urlscanScore ?? 'n/a'), inline: true },
        { name: 'C2 IPs', value: entry.threatIntel?.c2Ips?.join(', ') || 'none', inline: true }
      ],
      timestamp: entry.timestamp
    }]
  };
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000)
    });
  } catch (_) {}
}

module.exports = { sendWebhook };
