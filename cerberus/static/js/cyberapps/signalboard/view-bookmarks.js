/**
 * static/js/cyberapps/signalboard/view-bookmarks.js
 * SignalBoard — Bookmarks: saved items with tags, filter, export.
 */

import * as State from './state.js';
import * as Api from './api.js';

const TC = { critical:'#ff6b6b', high:'#f85149', medium:'#d29922', low:'#4a5568' };

function esc(str) { if(str==null)return''; return String(str).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function timeAgo(iso) { const d=Date.now()-new Date(iso).getTime(); if(d<3600000)return`${Math.floor(d/60000)}m ago`; if(d<86400000)return`${Math.floor(d/3600000)}h ago`; return`${Math.floor(d/86400000)}d ago`; }

export function renderBookmarksView(container) {
  let tagFilter = null;

  function getBm() {
    const items=State.get('items')||[], bms=State.get('bookmarks')||[], bmTags=State.get('bookmarkTags')||{};
    const map=new Map(items.map(i=>[i.id,i]));
    let r=bms.map(id=>map.get(id)).filter(Boolean);
    if(tagFilter) r=r.filter(i=>(bmTags[i.id]||[]).includes(tagFilter));
    return r;
  }

  function getTags() {
    const bms=State.get('bookmarks')||[], bmTags=State.get('bookmarkTags')||{}, s=new Set();
    bms.forEach(id=>(bmTags[id]||[]).forEach(t=>s.add(t)));
    return [...s].sort();
  }

  function redraw() {
    const bm=getBm(), allTags=getTags(), bms=State.get('bookmarks')||[], bmTags=State.get('bookmarkTags')||{};
    const tagBar=allTags.length?`<div style="display:flex;align-items:center;gap:6px;padding:8px 16px;border-bottom:1px solid rgba(42,51,71,0.3);flex-wrap:wrap;">
      <button class="sb-tf" data-tag="" style="font-size:10px;padding:2px 8px;border-radius:10px;cursor:pointer;background:${!tagFilter?'rgba(255,107,107,0.2)':'rgba(42,51,71,0.3)'};border:1px solid ${!tagFilter?'rgba(255,107,107,0.4)':'rgba(42,51,71,0.5)'};color:${!tagFilter?'#ff6b6b':'#8b949e'};">All</button>
      ${allTags.map(t=>`<button class="sb-tf" data-tag="${esc(t)}" style="font-size:10px;padding:2px 8px;border-radius:10px;cursor:pointer;background:${tagFilter===t?'rgba(255,107,107,0.2)':'rgba(42,51,71,0.3)'};border:1px solid ${tagFilter===t?'rgba(255,107,107,0.4)':'rgba(42,51,71,0.5)'};color:${tagFilter===t?'#ff6b6b':'#8b949e'};">${esc(t)}</button>`).join('')}
    </div>`:'';

    const cards=bm.map(item=>{
      const tier=TC[item.relevanceTier]||'#4a5568', tags=(bmTags[item.id]||[]);
      return `<div class="sb-bmc" data-id="${esc(item.id)}" style="padding:12px;border:1px solid rgba(42,51,71,0.4);border-radius:6px;background:rgba(22,27,39,0.3);cursor:pointer;margin-bottom:8px;">
        <div style="display:flex;align-items:flex-start;gap:8px;"><div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:3px;color:${tier};background:${tier}18;border:1px solid ${tier}33;">${item.relevanceTier.toUpperCase()}</span>
            <span style="font-size:10px;color:#4a5568;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(item.sourceName)}</span>
            <span style="margin-left:auto;font-size:10px;color:#3a424f;flex-shrink:0;">${timeAgo(item.publishedAt)}</span>
          </div>
          <p style="font-size:12px;font-weight:600;color:rgba(226,232,240,0.9);margin:0 0 4px;line-height:1.4;">${esc(item.title)}</p>
          ${item.summary?`<p style="font-size:11px;color:#4a5568;margin:0 0 6px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(item.summary)}</p>`:''}
          <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px;">
            ${tags.map(t=>`<span style="display:flex;align-items:center;gap:3px;font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(255,107,107,0.1);color:#ff6b6b;border:1px solid rgba(255,107,107,0.25);">${esc(t)}<button class="sb-rmtag" data-item="${esc(item.id)}" data-tag="${esc(t)}" style="background:none;border:none;cursor:pointer;color:inherit;opacity:0.6;padding:0;line-height:1;">×</button></span>`).join('')}
            <input class="sb-taginput" data-id="${esc(item.id)}" placeholder="+ tag" style="font-size:10px;background:transparent;border:none;outline:none;color:rgba(139,148,158,0.6);width:48px;"/>
          </div>
        </div>
        <button class="sb-rmbm" data-id="${esc(item.id)}" style="background:none;border:none;cursor:pointer;color:#d29922;opacity:0.6;font-size:14px;flex-shrink:0;padding:0;" title="Remove">★</button></div>
      </div>`;
    }).join('');

    container.innerHTML = `<div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:16px;border-bottom:1px solid rgba(42,51,71,0.5);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;">
        <div><h2 style="font-size:13px;font-weight:600;color:#c5c9d0;margin:0 0 2px;">Bookmarks</h2><p style="font-size:11px;color:#4a5568;margin:0;">${bms.length} saved · ${bm.length} shown</p></div>
        <div style="display:flex;gap:6px;">
          <button id="sb-exj" style="font-size:11px;padding:4px 12px;border-radius:6px;background:rgba(42,51,71,0.3);border:1px solid rgba(42,51,71,0.5);color:#8b949e;cursor:pointer;" ${bms.length===0?'disabled':''}>Export JSON</button>
          <button id="sb-exc" style="font-size:11px;padding:4px 12px;border-radius:6px;background:rgba(42,51,71,0.3);border:1px solid rgba(42,51,71,0.5);color:#8b949e;cursor:pointer;" ${bms.length===0?'disabled':''}>Export CSV</button>
        </div>
      </div>
      ${tagBar}
      <div style="flex:1;overflow-y:auto;padding:16px;">${bm.length===0?`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;text-align:center;color:#4a5568;font-size:12px;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:0.25;margin-bottom:12px;"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg><p>${tagFilter?'No bookmarks with this tag':'No bookmarks yet'}</p></div>`:`<div style="max-width:640px;">${cards}</div>`}</div>
    </div>`;

    container.querySelectorAll('.sb-tf').forEach(btn=>btn.addEventListener('click',()=>{tagFilter=btn.dataset.tag||null;redraw();}));

    container.querySelectorAll('.sb-rmbm').forEach(btn=>btn.addEventListener('click',async e=>{
      e.stopPropagation();
      const id=btn.dataset.id, bms2=State.get('bookmarks')||[], tags2=State.get('bookmarkTags')||{};
      State.setBookmarks(bms2.filter(b=>b!==id));
      await Api.saveBookmarks(State.get('bookmarks'),tags2).catch(()=>{});
    }));

    container.querySelectorAll('.sb-rmtag').forEach(btn=>btn.addEventListener('click',async e=>{
      e.stopPropagation();
      const itemId=btn.dataset.item, tag=btn.dataset.tag, bt=State.get('bookmarkTags')||{};
      const next={...bt,[itemId]:(bt[itemId]||[]).filter(t=>t!==tag)};
      State.setBookmarkTags(next);
      await Api.saveBookmarks(State.get('bookmarks')||[],next).catch(()=>{});
    }));

    container.querySelectorAll('.sb-taginput').forEach(input=>input.addEventListener('keydown',async e=>{
      if(e.key!=='Enter'&&e.key!==',')return;e.preventDefault();
      const tag=input.value.trim().toLowerCase();if(!tag){return;}
      const itemId=input.dataset.id, bt=State.get('bookmarkTags')||{}, cur=bt[itemId]||[];
      if(cur.includes(tag)){input.value='';return;}
      const next={...bt,[itemId]:[...cur,tag]};
      State.setBookmarkTags(next);
      await Api.saveBookmarks(State.get('bookmarks')||[],next).catch(()=>{});
      input.value='';
    }));

    container.querySelectorAll('.sb-bmc').forEach(card=>card.addEventListener('click',e=>{
      if(e.target.closest('.sb-rmbm,.sb-rmtag,.sb-taginput'))return;
      State.setSelectedId(card.dataset.id);State.setActiveView('feed');
    }));

    function dl(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);}
    container.querySelector('#sb-exj')?.addEventListener('click',()=>dl(new Blob([JSON.stringify(getBm(),null,2)],{type:'application/json'}),'signalboard-bookmarks.json'));
    container.querySelector('#sb-exc')?.addEventListener('click',()=>{
      const rows=[['id','title','sourceName','url','publishedAt','relevanceTier','relevanceScore'],...getBm().map(i=>[i.id,i.title,i.sourceName,i.url,i.publishedAt,i.relevanceTier,i.relevanceScore])];
      dl(new Blob([rows.map(r=>r.map(f=>`"${String(f||'').replace(/"/g,'""')}"`).join(',')).join('\n')],{type:'text/csv'}),'signalboard-bookmarks.csv');
    });
  }

  const unsubs=[State.subscribe('bookmarks',redraw),State.subscribe('bookmarkTags',redraw),State.subscribe('items',redraw)];
  redraw();
  return{destroy(){unsubs.forEach(u=>u());}};
}
