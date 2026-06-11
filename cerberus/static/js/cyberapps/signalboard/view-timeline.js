/**
 * static/js/cyberapps/signalboard/view-timeline.js
 * SignalBoard — Timeline: items grouped by day, sorted descending.
 */

import * as State from './state.js';

const TC = { critical:'#ff6b6b', high:'#f85149', medium:'#d29922', low:'#4a5568' };
const SC = ['#4a9eff','#3fb950','#d29922','#ff6b6b','#a371f7','#39d353','#ffa657','#79c0ff'];

function esc(str) { if(str==null)return''; return String(str).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function dayLabel(iso) {
  const d=new Date(iso), t=new Date(); t.setHours(0,0,0,0); d.setHours(0,0,0,0);
  const diff=(t-d)/(86400000);
  if(diff===0)return'Today'; if(diff===1)return'Yesterday';
  return new Date(iso).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
}

function groupByDay(items) {
  const groups=new Map();
  [...items].sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt)).forEach(item=>{
    const key=new Date(item.publishedAt).toDateString();
    if(!groups.has(key))groups.set(key,{label:dayLabel(item.publishedAt),items:[]});
    groups.get(key).items.push(item);
  });
  return [...groups.values()];
}

function srcColor(name, srcList) {
  const idx=srcList.findIndex(s=>s.name===name);
  return SC[(idx<0?Math.abs(name.split('').reduce((a,c)=>a+c.charCodeAt(0),0)):idx)%SC.length];
}

export function renderTimelineView(container) {
  function redraw() {
    const items=State.get('items')||[], sources=State.get('sources')||[];
    const groups=groupByDay(items);

    const html=groups.map(g=>{
      const cards=g.items.map(item=>{
        const tier=TC[item.relevanceTier]||'#4a5568';
        const sc=srcColor(item.sourceName,sources);
        const alerts=(item.alertMatches||[]).slice(0,2).map(a=>`<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${a.color||'#ff6b6b'}18;color:${a.color||'#ff6b6b'};border:1px solid ${a.color||'#ff6b6b'}33;">${esc(a.label)}</span>`).join('');
        return `<div class="sb-tl-item" data-id="${esc(item.id)}" style="display:flex;gap:12px;padding:8px 0;cursor:pointer;border-bottom:1px solid rgba(42,51,71,0.2);">
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0;padding-top:2px;">
            <div style="width:8px;height:8px;border-radius:50%;background:${tier};flex-shrink:0;"></div>
            <div style="width:1px;flex:1;background:rgba(42,51,71,0.3);min-height:20px;"></div>
          </div>
          <div style="flex:1;min-width:0;padding-bottom:8px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap;">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${sc};flex-shrink:0;"></span>
              <span style="font-size:10px;color:#4a5568;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;">${esc(item.sourceName)}</span>
              <span style="font-size:9px;font-weight:700;text-transform:uppercase;padding:1px 5px;border-radius:3px;color:${tier};background:${tier}18;border:1px solid ${tier}33;">${item.relevanceTier.toUpperCase()}</span>
              ${alerts}
              <span style="margin-left:auto;font-size:10px;color:#3a424f;flex-shrink:0;">${new Date(item.publishedAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</span>
            </div>
            <p style="font-size:12px;font-weight:500;color:rgba(226,232,240,0.85);margin:0;line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${esc(item.title)}</p>
          </div>
        </div>`;
      }).join('');
      return `<div style="margin-bottom:20px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#4a5568;padding:8px 0 6px;border-bottom:1px solid rgba(42,51,71,0.4);margin-bottom:4px;">${esc(g.label)} <span style="color:#3a424f;font-weight:400;">(${g.items.length})</span></div>
        ${cards}
      </div>`;
    }).join('');

    container.innerHTML = `<div style="flex:1;overflow-y:auto;padding:16px 20px;">
      <h2 style="font-size:13px;font-weight:600;color:#c5c9d0;margin:0 0 4px;">Timeline</h2>
      <p style="font-size:11px;color:#4a5568;margin:0 0 16px;">${items.length} items across ${groups.length} day${groups.length!==1?'s':''}</p>
      ${groups.length===0?`<div style="text-align:center;color:#4a5568;font-size:12px;padding:40px 0;">No items yet. Refresh feeds to populate.</div>`:`<div style="max-width:680px;">${html}</div>`}
    </div>`;

    container.querySelectorAll('.sb-tl-item').forEach(el=>el.addEventListener('click',()=>{
      State.setSelectedId(el.dataset.id);
      State.setActiveView('feed');
    }));
  }

  const unsub=State.subscribe('items',redraw);
  redraw();
  return{destroy(){unsub();}};
}
