/**
 * static/js/cyberapps/signalboard/feeds.js
 * SignalBoard — feed fetch + relevance scoring engine.
 *
 * Fetches RSS/Atom sources via the Cerberus /api/cyberapps/signalboard/proxy
 * endpoint (or CORS-allowing direct fetch), parses them, scores items for
 * relevance, deduplicates, and applies alert rules.
 *
 * NOTE: Direct browser cross-origin RSS fetch is blocked by CORS on most
 * feeds, so we use the backend proxy. If the backend proxy is unavailable,
 * we fall back to the stored items only.
 */

import * as State from './state.js';
import * as Api from './api.js';

// ---------------------------------------------------------------------------
// Relevance scoring
// ---------------------------------------------------------------------------

const SECURITY_KEYWORDS = [
  'cve','exploit','vulnerability','patch','rce','xss','injection','malware',
  'ransomware','phishing','breach','backdoor','zero-day','0day','payload',
  'privilege escalation','lateral movement','persistence','mimikatz','metasploit',
  'nmap','shodan','burp','nuclei','threat','attack','incident','ioc','ttps',
];

function scoreItem(item, context, alertRules) {
  let score = 0;
  const text = `${item.title} ${item.summary || ''}`.toLowerCase();

  // Security keyword match
  SECURITY_KEYWORDS.forEach(kw => { if (text.includes(kw)) score += 5; });

  // Context keyword match
  if (context.lab)            { const kw = context.lab.toLowerCase();    if (text.includes(kw)) score += 10; }
  if (context.target)         { const kw = context.target.toLowerCase(); if (text.includes(kw)) score += 10; }
  if (context.ip)             { if (text.includes(context.ip))           score += 10; }
  if (context.customKeywords) {
    context.customKeywords.forEach(kw => { if (text.includes(kw.toLowerCase())) score += 10; });
  }

  // Alert rule matches
  const alertMatches = [];
  (alertRules || []).forEach(rule => {
    try {
      const re = new RegExp(rule.regex, 'i');
      if (re.test(text)) {
        alertMatches.push({ ruleId: rule.id, label: rule.label, severity: rule.severity, color: rule.color });
        score += rule.severity === 'critical' ? 40 : rule.severity === 'high' ? 25 : 15;
      }
    } catch { /* invalid regex */ }
  });

  const tier = score >= 60 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';

  return { ...item, relevanceScore: Math.min(score, 100), relevanceTier: tier, alertMatches };
}

// ---------------------------------------------------------------------------
// CVE extraction
// ---------------------------------------------------------------------------

const CVE_RE = /CVE-\d{4}-\d+/gi;

function extractCveIds(text) {
  const m = text.match(CVE_RE);
  return m ? [...new Set(m.map(s => s.toUpperCase()))] : [];
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateItems(items) {
  const seen = new Map();
  const result = [];
  for (const item of items) {
    const key = item.title.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 60);
    if (seen.has(key)) {
      const existing = result.find(i => i.id === seen.get(key));
      if (existing) existing.duplicateCount = (existing.duplicateCount || 0) + 1;
    } else {
      seen.set(key, item.id);
      result.push({ ...item, duplicateCount: 0 });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// In-memory refresh (merge stored items with any new ones from backend)
// ---------------------------------------------------------------------------

/**
 * Refresh feed: re-score stored items with current context + alert rules,
 * then persist updated scores. Full RSS fetch is triggered by backend.
 */
export async function refreshFeeds() {
  State.setRefreshing(true);
  try {
    const [itemsData, sourcesData, ctxData, rulesData] = await Promise.all([
      Api.getItems().catch(() => ({ items: [] })),
      Api.getSources().catch(() => ({ sources: [] })),
      Api.getContext().catch(() => ({ context: {} })),
      Api.getAlertRules().catch(() => ({ rules: [] })),
    ]);

    const context   = ctxData.context || {};
    const alertRules = rulesData.rules || [];

    // Re-score existing items with latest context
    const rescored = (itemsData.items || []).map(item => scoreItem(item, context, alertRules));
    const deduped  = deduplicateItems(rescored);

    State.setItems(deduped);
    State.setSources(sourcesData.sources || []);
    State.setContext(context);
    State.setAlertRules(alertRules);
    State.setLastRefreshed(new Date().toISOString());

    // Persist rescored items
    await Api.saveItems(deduped).catch(() => {});
  } finally {
    State.setRefreshing(false);
  }
}

/**
 * Add a new item (from a manual source add simulation or test).
 * @param {Object} rawItem - partial FeedItem
 */
export function ingestItem(rawItem) {
  const context    = State.get('context') || {};
  const alertRules = State.get('alertRules') || [];
  const cveIds     = extractCveIds(`${rawItem.title} ${rawItem.summary || ''}`);
  const scored     = scoreItem({ ...rawItem, cveIds }, context, alertRules);
  const items      = State.get('items') || [];
  const merged     = deduplicateItems([scored, ...items]);
  State.setItems(merged);
  return scored;
}
