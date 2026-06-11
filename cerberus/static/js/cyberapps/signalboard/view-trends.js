/**
 * static/js/cyberapps/signalboard/view-trends.js
 * SignalBoard — Trends: 24h histogram, keyword freq, source activity, score dist.
 */

import * as State from './state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','is','was',
  'are','were','be','been','have','has','had','do','does','did','will','would','could',
  'should','may','might','this','that','these','those','it','its','by','as','from',
  'into','not','no','new','via','after','before','over','under','about','up','out','can',
]);

function extractWords(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
}

function topN(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function within7Days(items) {
  const cutoff = Date.now() - 7 * 86400000;
  return items.filter(i => new Date(i.publishedAt).getTime() > cutoff);
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------------------------------------------------------------------------
// 24h Histogram
// ---------------------------------------------------------------------------

function render24hHistogram(items) {
  const now = Date.now();
  const buckets = new Array(24).fill(0);
  items.forEach(item => {
    const h = Math.floor((now - new Date(item.publishedAt).getTime()) / 3600000);
    if (h >= 0 && h < 24) buckets[23 - h]++;
  });
  const max = Math.max(...buckets, 1);

  const bars = buckets.map((count, i) => {
    const pct = (count / max) * 100;
    const isRecent = i >= 20;
    const color = isRecent
      ? 'linear-gradient(180deg,#ff6b6b,rgba(255,107,107,0.5))'
      : 'linear-gradient(180deg,rgba(74,158,255,0.7),rgba(74,158,255,0.3))';
    return `<div title="${count} items" style="flex:1;height:${Math.max(pct,count>0?4:0)}%;min-height:${count>0?2:0}px;background:${color};border-radius:2px;align-self:flex-end;"></div>`;
  }).join('');

  return `
    <div style="padding:16px;border:1px solid rgba(42,51,71,0.4);border-radius:6px;background:rgba(22,27,39,0.3);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:11px;font-weight:600;color:#c5c9d0;">24h Article Volume</span>
        <span style="font-size:9px;font-family:monospace;color:#4a5568;">${items.length} items</span>
      </div>
      <div style="display:flex;align-items:flex-end;gap:2px;height:56px;">${bars}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Keyword frequency
// ---------------------------------------------------------------------------

function renderKeywordFreq(items) {
  const freqMap = new Map();
  within7Days(items).forEach(item => {
    extractWords(`${item.title} ${item.summary||''}`).forEach(w => {
      freqMap.set(w, (freqMap.get(w)||0) + 1);
    });
  });
  const top = topN(freqMap, 10);
  const max = top[0]?.[1] || 1;

  if (top.length === 0) {
    return `<div style="padding:16px;border:1px solid rgba(42,51,71,0.4);border-radius:6px;background:rgba(22,27,39,0.3);">
      <span style="font-size:11px;font-weight:600;color:#c5c9d0;">Keyword Frequency — Last 7 Days</span>
      <p style="font-size:11px;color:#4a5568;margin-top:8px;">Not enough data yet.</p>
    </div>`;
  }

  const rows = top.map(([word, count]) => {
    const pct = (count / max) * 100;
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="font-size:10px;font-family:monospace;color:#8b949e;width:96px;text-align:right;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;">${escHtml(word.length>14?word.slice(0,13)+'…':word)}</span>
        <div style="flex:1;height:14px;background:rgba(42,51,71,0.35);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#ff6b6b,#ff9b9b);border-radius:3px;transition:width 0.5s;"></div>
        </div>
        <span style="font-size:10px;font-family:monospace;color:#4a5568;width:24px;flex-shrink:0;">${count}</span>
      </div>`;
  }).join('');

  const topWord = top[0];
  return `
    <div style="padding:16px;border:1px solid rgba(42,51,71,0.4);border-radius:6px;background:rgba(22,27,39,0.3);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:11px;font-weight:600;color:#c5c9d0;">Keyword Frequency — Last 7 Days</span>
        <span style="font-size:9px;font-family:monospace;color:#4a5568;">${top.length} terms</span>
      </div>
      <div style="padding:8px 12px;border-radius:6px;background:rgba(210,153,34,0.07);border:1px solid rgba(210,153,34,0.3);margin-bottom:12px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;font-weight:600;color:#d29922;">Trending</span>
        <span style="font-family:monospace;font-size:12px;font-weight:700;color:#e6c46a;">${escHtml(topWord[0])}</span>
        <span style="margin-left:auto;font-size:10px;font-family:monospace;color:rgba(210,153,34,0.6);">${topWord[1]}× this week</span>
      </div>
      ${rows}
    </div>`;
}

// ---------------------------------------------------------------------------
// Source activity
// ---------------------------------------------------------------------------

function renderSourceActivity(items) {
  const srcMap = new Map();
  within7Days(items).forEach(i => srcMap.set(i.sourceName, (srcMap.get(i.sourceName)||0)+1));
  const data = topN(srcMap, 8);
  const max = data[0]?.[1] || 1;

  const rows = data.map(([name, count], idx) => {
    const pct = (count / max) * 100;
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:11px;color:rgba(139,148,158,0.7);width:112px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;">${escHtml(name)}</span>
        <div style="flex:1;height:10px;background:rgba(42,51,71,0.3);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,rgba(74,158,255,0.5),rgba(74,158,255,0.8));border-radius:3px;transition:width ${0.5+idx*0.06}s;"></div>
        </div>
        <span style="font-size:10px;font-family:monospace;color:#4a5568;width:20px;text-align:right;flex-shrink:0;">${count}</span>
      </div>`;
  }).join('');

  return `
    <div style="padding:16px;border:1px solid rgba(42,51,71,0.4);border-radius:6px;background:rgba(22,27,39,0.3);">
      <div style="font-size:11px;font-weight:600;color:#c5c9d0;margin-bottom:12px;">Source Activity — Last 7 Days</div>
      ${data.length === 0 ? '<p style="font-size:11px;color:#4a5568;">No activity data.</p>' : rows}
    </div>`;
}

// ---------------------------------------------------------------------------
// Score distribution
// ---------------------------------------------------------------------------

function renderScoreDist(items) {
  const counts = {
    critical: items.filter(i => i.relevanceTier === 'critical').length,
    high:     items.filter(i => i.relevanceTier === 'high').length,
    medium:   items.filter(i => i.relevanceTier === 'medium').length,
    low:      items.filter(i => i.relevanceTier === 'low').length,
  };
  const total = items.length || 1;
  const slices = [
    { label:'Critical', count:counts.critical, color:'#ff6b6b' },
    { label:'High',     count:counts.high,     color:'#f85149' },
    { label:'Medium',   count:counts.medium,   color:'#d29922' },
    { label:'Low',      count:counts.low,       color:'#4a5568' },
  ];

  let cum = 0;
  const segs = slices.map(s => {
    const pct = (s.count / total) * 100;
    const start = cum; cum += pct;
    return `${s.color} ${start.toFixed(1)}% ${cum.toFixed(1)}%`;
  });
  const conic = total === 1 ? '#1e2030' : `conic-gradient(${segs.join(', ')})`;

  const legend = slices.map(s => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="width:10px;height:10px;border-radius:2px;background:${s.color};flex-shrink:0;"></span>
      <span style="font-size:11px;color:rgba(139,148,158,0.7);width:56px;">${s.label}</span>
      <span style="font-size:11px;font-family:monospace;color:#c5c9d0;">${s.count}</span>
      <span style="font-size:10px;color:#4a5568;">(${((s.count/total)*100).toFixed(0)}%)</span>
    </div>`).join('');

  return `
    <div style="padding:16px;border:1px solid rgba(42,51,71,0.4);border-radius:6px;background:rgba(22,27,39,0.3);">
      <div style="font-size:11px;font-weight:600;color:#c5c9d0;margin-bottom:12px;">Relevance Score Distribution</div>
      <div style="display:flex;align-items:center;gap:24px;">
        <div style="width:80px;height:80px;border-radius:50%;background:${conic};flex-shrink:0;"></div>
        <div>${legend}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export function renderTrendsView(container) {
  function redraw() {
    const items = State.get('items') || [];
    container.innerHTML = `
      <div style="flex:1;overflow-y:auto;padding:24px;">
        <h2 style="font-size:13px;font-weight:600;color:#c5c9d0;margin:0 0 4px;">Trends</h2>
        <p style="font-size:11px;color:#4a5568;margin:0 0 20px;">Intelligence patterns across your feed.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div style="grid-column:1/-1;">${render24hHistogram(items)}</div>
          <div style="grid-column:1/-1;">${renderKeywordFreq(items)}</div>
          ${renderSourceActivity(items)}
          ${renderScoreDist(items)}
        </div>
      </div>`;
  }

  const unsub = State.subscribe('items', redraw);
  redraw();

  return { destroy() { unsub(); } };
}
