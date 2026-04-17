// lib/fingerprint.js
'use strict';
const { AI_TOOLS, FRAMEWORKS } = require('../fingerprints.js');

function detectAiTool(html) {
  if (!html) return null;
  for (const { name, pattern } of AI_TOOLS) {
    if (pattern.test(html)) return name;
  }
  return null;
}

function detectFramework(html, headers = {}) {
  for (const f of FRAMEWORKS) {
    if (f.headerKey && f.headerVal) {
      if (f.headerVal.test(headers[f.headerKey] || '')) return f.name;
    }
    if (f.htmlPattern && html && f.htmlPattern.test(html)) return f.name;
  }
  return 'Static';
}

module.exports = { detectAiTool, detectFramework };
