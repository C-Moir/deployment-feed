'use strict';

// Flagged rate above this % on a platform triggers an alert
const ALERT_THRESHOLD_PCT = 15;

function computeStats(entries) {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const deploysPerHour = entries.filter(e => new Date(e.timestamp).getTime() > oneHourAgo).length;
  const flaggedCount = entries.filter(e => e.status === 'flagged' || e.status === 'suspicious').length;
  const frameworkBreakdown = {};
  const aiToolLeaderboard = {};

  // Per-platform breakdown
  const platformStats = {};
  for (const e of entries) {
    if (e.framework) frameworkBreakdown[e.framework] = (frameworkBreakdown[e.framework] || 0) + 1;
    if (e.aiTool) aiToolLeaderboard[e.aiTool] = (aiToolLeaderboard[e.aiTool] || 0) + 1;

    if (!e.platform) continue;
    const p = platformStats[e.platform] = platformStats[e.platform] || { total: 0, flagged: 0, suspicious: 0, recentFlagged: 0 };
    p.total++;
    if (e.status === 'flagged') p.flagged++;
    if (e.status === 'suspicious') p.suspicious++;
    if ((e.status === 'flagged' || e.status === 'suspicious') && new Date(e.timestamp).getTime() > oneHourAgo) {
      p.recentFlagged++;
    }
  }

  // Compute flagged % per platform and flag any elevated ones
  const platformAlerts = [];
  for (const [name, p] of Object.entries(platformStats)) {
    p.flaggedPct = p.total >= 5 ? Math.round(((p.flagged + p.suspicious) / p.total) * 100) : 0;
    if (p.flaggedPct >= ALERT_THRESHOLD_PCT && (p.flagged + p.suspicious) >= 3) {
      platformAlerts.push({ platform: name, flaggedPct: p.flaggedPct, flagged: p.flagged, suspicious: p.suspicious, total: p.total });
    }
  }
  platformAlerts.sort((a, b) => b.flaggedPct - a.flaggedPct);

  return {
    totalSeen: entries.length,
    deploysPerHour,
    flaggedCount,
    flaggedPercent: entries.length ? Math.round((flaggedCount / entries.length) * 100) : 0,
    frameworkBreakdown,
    aiToolLeaderboard,
    platformStats,
    platformAlerts,
  };
}

function detectTrending(entries) {
  const now = Date.now();
  const thirtyMinAgo = now - 30 * 60 * 1000;
  const ninetyMinAgo = now - 90 * 60 * 1000;
  const recent = entries.filter(e => new Date(e.timestamp).getTime() > thirtyMinAgo).length;
  const prior = entries.filter(e => {
    const t = new Date(e.timestamp).getTime();
    return t > ninetyMinAgo && t <= thirtyMinAgo;
  }).length;
  if (prior > 0 && recent >= prior * 2 && recent >= 5) {
    return `Deploy rate spike: ${recent} in last 30min vs ${prior} in prior 30min`;
  }
  return null;
}

module.exports = { computeStats, detectTrending, ALERT_THRESHOLD_PCT };
