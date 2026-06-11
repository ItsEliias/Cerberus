/**
 * static/js/cyberapps/signalboard/view-trends.js
 * SignalBoard — Trends: 24h histogram, keyword freq, source activity, score dist.
 */

import * as State from './state.js';

const STOP = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','is','was','are','were','be','been','have','has','had','do','does','did','will','would','could','should','may','might','this','that','these','those','it','its','by','as','from','into','not','no','new','via','after','before','over','under','about','up','out','can']);

function esc(str) { if(str==null)return''; return String(str).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function words(text) { return text.toLowerCase().replace(/[^a-z0-9\s-]/g,' ').split(/\s+/).filter(w=>w.length>3&&!STOP.has(w)); }
function topN(map,n) { return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n); }
function within7d(items) { const c=Date.now()-7*86400000; return items.filter(i=>new Date(i.publishedAt).getTime()>c); }

function histogram24h(items) {
  const now=Date.now(), b=new Array(24).fill(0);
  items.forEach(i=>{const h=Math.floor((now-new Date(i.publishedAt).getTime())/3600000); if(h>=0&&h<24)b[23-h]++;});
  const max=Math.max(...b,1);
  const bars=b.map((c,i)=>`<div title="${c} items" style="flex:1;height:${Math.max((c/max)*100,c>0?4:0)}%;min-height:${c>0?2:0}px;background:${i>=20?'linear-gradient(180deg,#ff6b6b,rgba(255,107,107,0.5))':'linear-gradient(180deg,rgba(74,158,255,0.7),rgba(74,158,255,0.3))'};border-radius:2px;align-self:flex-end;"></div>`).join('');
  return `<div style="padding:16px;border:1px solid rgba(42,51,71,0.4);border-radius:6px;background:rgba(22,27,39,0.3);grid-column:1/-1;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"><span style="font-size:11px;font-weight:600;color:#c5c9d0;">24h Article Volume</span><span style="font-size:9px;font-family:monospace;color:#4a5568;">${items.length} items</span></div><div style="display:flex;align-items:flex-end;gap:2px;height:56px;">${bars}</div></div>`;
}

function kwFreq(items) {
  const m=new Map(); within7d(items).forEach(i=>words(`${i.title} ${i.summary||''}`).forEach(w=>m.set(w,(m.get(w)||0)+1)));
  const top=topN(m,10); const max=top[0]?.[1]||1;
  if(!top.length) return `<div style="padding:16px;border:1px solid rgba(42,51,71,0.4);border-radius:6px;background:rgba(22,27,39,0.3);grid-column:1/-1;"><span style="font-size:11px;font-weight:600;color:#c5c9d0;">Keyword Frequency</span><p style="font-size:11px;color:#4a5568;margin-top:8px;">Not enough data yet.</p></div>`;
  const rows=top.map(([w,c])=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="font-size:10px;font-family:monospace;color:#8b949e;width:96px;text-align:right;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;">${esc(w.length>14?w.slice(0,13)+'…':w)}</span><div style="flex:1;height:14px;background:rgba(42,51,71,0.35);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${(c/max)*100}%;background:linear-gradient(90deg,#ff6b6b,#ff9b9b);border-radius:3px;"></div></div><span style="font-size:10px;font-family:monospace;color:#4a5568;width:24px;flex-shrink:0;">${c}</span></div>`).join('');
  const tw=top[0];
  return `<div style="padding:16px;border:1px solid rgba(42,51,71,0.4);border-radius:6px;background:rgba(22,27,39,0.3);grid-column:1/-1;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"><span style="font-size:11px;font-weight:600;color:#c5c9d0;">Keyword Frequency — Last 7 Days</span><span style="font-size:9px;font-family:monospace;color:#4a5568;">${top.length} terms</span></div><div style="padding:8px 12px;border-radius:6px;background:rgba(210,153,34,0.07);border:1px solid rgba(210,153,34,0.3);margin-bottom:12px;display:flex;align-items:center;gap:8px;"><span style="font-size:11px;font-weight:600;color:#d29922;">Trending</span><span style="font-family:monospace;font-size:12px;font-weight:700;color:#e6c46a;">${esc(tw[0])}</span><span style="margin-left:auto;font-size:10px;font-family:monospace;color:rgba(210,153,34,0.6);">${tw[1]}× this week</span></div>${rows}</div>`;
}

function srcActivity(items) {
  const m=new Map(); within7d(items).forEach(i=>m.set(i.sourceName,(m.get(i.sourceName)||0)+1));
  const data=topN(m,8); const max=data[0]?.[1]||1;
  const rows=data.map(([n,c],idx)=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="font-size:11px;color:rgba(139,148,158,0.7);width:112px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;">${esc(n)}</span><div style="flex:1;height:10px;background:rgba(42,51,71,0.3);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${(c/max)*100}%;background:linear-gradient(90deg,rgba(74,158,255,0.5),rgba(74,158,255,0.8));border-radius:3px;transition:width ${0.5+idx*0.06}s;"></div></div><span style="font-size:10px;font-family:monospace;color:#4a5568;width:20px;text-align:right;flex-shrink:0;">${c}</span></div>`).join('');
  return `<div style="padding:16px;border:1px solid rgba(42,51,71,0.4);border-radius:6px;background:rgba(22,27,39,0.3);"><div style="font-size:11px;font-weight:600;color:#c5c9d0;margin-bottom:12px;">Source Activity — Last 7 Days</div>${data.length?rows:'<p style="font-size:11px;color:#4a5568;">No data.</p>'}</div>`;
}

function scoreDist(items) {
  const total=items.length||1;
  const slices=[{l:'Critical',c:items.filter(i=>i.relevanceTier==='critical').length,col:'#ff6b6b'},{l:'High',c:items.filter(i=>i.relevanceTier==='high').length,col:'#f85149'},{l:'Medium',c:items.filter(i=>i.relevanceTier==='medium').length,col:'#d29922'},{l:'Low',c:items.filter(i=>i.relevanceTier==='low').length,col:'#4a5568'}];
  let cum=0; const segs=slices.map(s=>{const p=(s.c/total)*100;const st=cum;cum+=p;return `${s.col} ${st.toFixed(1)}% ${cum.toFixed(1)}%`;});
  const legend=slices.map(s=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="width:10px;height:10px;border-radius:2px;background:${s.col};flex-shrink:0;"></span><span style="font-size:11px;color:rgba(139,148,158,0.7);width:56px;">${s.l}</span><span style="font-size:11px;font-family:monospace;color:#c5c9d0;">${s.c}</span><span style="font-size:10px;color:#4a5568;">(${((s.c/total)*100).toFixed(0)}%)</span></div>`).join('');
  return `<div style="padding:16px;border:1px solid rgba(42,51,71,0.4);border-radius:6px;background:rgba(22,27,39,0.3);"><div style="font-size:11px;font-weight:600;color:#c5c9d0;margin-bottom:12px;">Relevance Score Distribution</div><div style="display:flex;align-items:center;gap:24px;"><div style="width:80px;height:80px;border-radius:50%;background:${total===1?'#1e2030':`conic-gradient(${segs.join(', ')})`};flex-shrink:0;"></div><div>${legend}</div></div></div>`;
}

export function renderTrendsView(container) {
  function redraw() {
    const items = State.get('items') || [];
    container.innerHTML = `<div style="flex:1;overflow-y:auto;padding:24px;"><h2 style="font-size:13px;font-weight:600;color:#c5c9d0;margin:0 0 4px;">Trends</h2><p style="font-size:11px;color:#4a5568;margin:0 0 20px;">Intelligence patterns across your feed.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">${histogram24h(items)}${kwFreq(items)}${srcActivity(items)}${scoreDist(items)}</div></div>`;
  }
  const unsub = State.subscribe('items', redraw);
  redraw();
  return { destroy() { unsub(); } };
}
