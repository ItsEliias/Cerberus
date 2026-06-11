/**
 * static/js/cyberapps/signalboard/feeds.js
 * SignalBoard — relevance scoring engine + feed refresh orchestration.
 */

import * as State from './state.js';
import * as Api from './api.js';

const SECURITY_KW = [
  'cve','exploit','vulnerability','patch','rce','xss','injection','malware',
  'ransomware','phishing','breach','backdoor','zero-day','0day','payload',
  'privilege escalation','lateral movement','persistence','mimikatz','metasploit',
  'nmap','shodan','burp','nuclei','threat','attack','incident','ioc','ttps',
];

function scoreItem(item, context, alertRules) {
  let score = 0;
  const text = `${item.title} ${item.summary || ''}`.toLowerCase();

  SECURITY_KW.forEach(kw => { if (text.includes(kw)) score += 5; });
  if (context.lab)            { if (text.includes(context.lab.toLowerCase()))    score += 10; }
  if (context.target)         { if (text.includes(context.target.toLowerCase())) score += 10; }
  if (context.ip)             { if (text.includes(context.ip))                   score += 10; }
  if (context.customKeywords) {
    context.customKeywords.forEach(kw => { if (text.includes(kw.toLowerCase())) score += 10; });
  }

  const alertMatches = [];
  (alertRules || []).forEach(rule => {
    try {
      if (new RegExp(rule.regex, 'i').test(text)) {
        alertMatches.push({ ruleId: rule.id, label: rule.label, severity: rule.severity, color: rule.color });
        score += rule.severity === 'critical' ? 40 : rule.severity === 'high' ? 25 : 15;
      }
    } catch { /* invalid regex */ }
  });

  const tier = score >= 60 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';
  return { ...item, relevanceScore: Math.min(score, 100), relevanceTier: tier, alertMatches };
}

function deduplicateItems(items) {
  const seen = new Map();
  const result = [];
  for (const item of items) {
    const key = item.title.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 60);
    if (seen.has(key)) {
      const ex = result.find(i => i.id === seen.get(key));
      if (ex) ex.duplicateCount = (ex.duplicateCount || 0) + 1;
    } else {
      seen.set(key, item.id);
      result.push({ ...item, duplicateCount: 0 });
    }
  }
  return result;
}

export async function refreshFeeds() {
  State.setRefreshing(true);
  try {
    const [itemsData, sourcesData, ctxData, rulesData] = await Promise.all([
      Api.getItems().catch(() => ({ items: [] })),
      Api.getSources().catch(() => ({ sources: [] })),
      Api.getContext().catch(() => ({ context: {} })),
      Api.getAlertRules().catch(() => ({ rules: [] })),
    ]);
    const context    = ctxData.context    || {};
    const alertRules = rulesData.rules || [];
    const rescored   = (itemsData.items || []).map(i => scoreItem(i, context, alertRules));
    const deduped    = deduplicateItems(rescored);
    State.setItems(deduped);
    State.setSources(sourcesData.sources || []);
    State.setContext(context);
    State.setAlertRules(alertRules);
    State.setLastRefreshed(new Date().toISOString());
    await Api.saveItems(deduped).catch(() => {});
  } finally {
    State.setRefreshing(false);
  }
}
