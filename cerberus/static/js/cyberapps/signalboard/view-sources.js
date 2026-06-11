/**
 * static/js/cyberapps/signalboard/view-sources.js
 * SignalBoard — Sources view: list, add, toggle, delete.
 */

import * as State from './state.js';
import * as Api from './api.js';

function esc(str) { if(str==null)return''; return String(str).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function timeAgo(iso) {
  if(!iso) return '—';
  const d=Date.now()-new Date(iso).getTime();
  if(d<10000)return'just now'; if(d<60000)return`${Math.floor(d/1000)}s ago`;
  if(d<3600000)return`${Math.floor(d/60000)}m ago`; if(d<86400000)return`${Math.floor(d/3600000)}h ago`;
  return`${Math.floor(d/86400000)}d ago`;
}

function healthColor(src) {
  if(!src.enabled) return '#4a5568';
  const a=src.attemptCount||((src.successCount||0)+(src.errorCount||0));
  if(!a) return '#4a9eff';
  const r=(src.successCount||0)/a;
  if((src.consecutiveFailures||0)>=3) return '#f85149';
  return r>=0.8?'#3fb950':r>=0.5?'#d29922':'#f85149';
}

export function renderSourcesView(container) {
  function redraw() {
    const sources = State.get('sources') || [];
    const rows = sources.map(src => {
      const h=healthColor(src); const a=src.attemptCount||((src.successCount||0)+(src.errorCount||0));
      const rate=a>0?Math.round(((src.successCount||0)/a)*100):null;
      let host=''; try{host=new URL(src.url).hostname;}catch{host=src.url.slice(0,30);}
      return `<div class="sb-src-row" style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid rgba(42,51,71,0.3);">
        <span style="width:8px;height:8px;border-radius:50%;background:${h};flex-shrink:0;" title="${rate!==null?rate+'%':'unknown'}"></span>
        <div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;"><span style="font-size:11px;font-weight:500;color:#c5c9d0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(src.name)}</span><span style="font-size:9px;padding:1px 4px;background:rgba(42,51,71,0.5);color:rgba(139,148,158,0.6);border-radius:3px;font-family:monospace;text-transform:uppercase;">${esc(src.type||'rss')}</span>${src.category?`<span style="font-size:9px;padding:1px 4px;background:rgba(42,51,71,0.4);color:rgba(139,148,158,0.5);border-radius:3px;">${esc(src.category)}</span>`:''}</div><p style="font-size:10px;color:#4a5568;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(host)}</p></div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
          ${rate!==null?`<span style="font-size:10px;font-family:monospace;color:${h};">${rate}%</span>`:''}
          <span style="font-size:10px;font-family:monospace;color:#4a5568;">${timeAgo(src.lastFetchAt)}</span>
          <button class="sb-toggle" data-id="${esc(src.id)}" data-en="${src.enabled}" style="font-size:10px;padding:3px 10px;border-radius:10px;cursor:pointer;background:${src.enabled?'rgba(63,185,80,0.12)':'rgba(42,51,71,0.3)'};border:1px solid ${src.enabled?'rgba(63,185,80,0.3)':'rgba(42,51,71,0.5)'};color:${src.enabled?'#3fb950':'#6b7a90'};white-space:nowrap;">${src.enabled?'Enabled':'Disabled'}</button>
          <button class="sb-del" data-id="${esc(src.id)}" data-name="${esc(src.name)}" style="font-size:10px;padding:3px 6px;border-radius:6px;cursor:pointer;background:rgba(248,81,73,0.08);border:1px solid rgba(248,81,73,0.2);color:#f85149;">✕</button>
        </div>
      </div>`;
    }).join('');

    container.innerHTML = `<div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:16px;border-bottom:1px solid rgba(42,51,71,0.5);flex-shrink:0;"><h2 style="font-size:13px;font-weight:600;color:#c5c9d0;margin:0 0 2px;">Sources</h2><p style="font-size:11px;color:#4a5568;margin:0;">${sources.length} source${sources.length!==1?'s':''} configured</p></div>
      <div style="padding:12px 16px;border-bottom:1px solid rgba(42,51,71,0.4);flex-shrink:0;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#4a5568;margin-bottom:8px;">Add Source</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <input id="sb-sn" placeholder="Name" style="flex:1;min-width:120px;padding:6px 10px;border-radius:6px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;"/>
          <input id="sb-su" placeholder="URL (RSS/Atom)" style="flex:2;min-width:200px;padding:6px 10px;border-radius:6px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;"/>
          <select id="sb-sc" style="padding:6px 10px;border-radius:6px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;"><option>Custom</option><option>CVE</option><option>Threat Intel</option><option>Security News</option><option>Malware</option><option>Research</option><option>GitHub</option></select>
          <button id="sb-sadd" style="padding:6px 16px;border-radius:6px;background:rgba(255,107,107,0.15);border:1px solid rgba(255,107,107,0.3);color:#ff6b6b;font-size:11px;cursor:pointer;">Add</button>
        </div>
        <div id="sb-serr" style="font-size:10px;color:#f85149;margin-top:6px;display:none;"></div>
      </div>
      <div style="flex:1;overflow-y:auto;">${sources.length===0?`<div style="padding:32px;text-align:center;color:#4a5568;font-size:12px;">No sources — add one above.</div>`:rows}</div>
    </div>`;

    container.querySelector('#sb-sadd')?.addEventListener('click', async () => {
      const name=container.querySelector('#sb-sn')?.value?.trim();
      const url=container.querySelector('#sb-su')?.value?.trim();
      const cat=container.querySelector('#sb-sc')?.value||'Custom';
      const err=container.querySelector('#sb-serr');
      err.style.display='none';
      if(!name||!url){err.textContent='Name and URL required.';err.style.display='';return;}
      try{new URL(url);}catch{err.textContent='Invalid URL.';err.style.display='';return;}
      try{
        const{source}=await Api.createSource({name,url,category:cat});
        State.setSources([...(State.get('sources')||[]),source]);
      }catch{err.textContent='Failed to add source.';err.style.display='';}
    });

    container.querySelectorAll('.sb-toggle').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        const id=btn.dataset.id;const en=btn.dataset.en==='true';
        try{const{source}=await Api.updateSource(id,{enabled:!en});State.setSources((State.get('sources')||[]).map(s=>s.id===id?source:s));}catch{}
      });
    });

    container.querySelectorAll('.sb-del').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        if(!confirm(`Delete "${btn.dataset.name}"?`))return;
        try{await Api.deleteSource(btn.dataset.id);State.setSources((State.get('sources')||[]).filter(s=>s.id!==btn.dataset.id));}catch{}
      });
    });
  }

  const unsub=State.subscribe('sources',redraw);
  redraw();
  return{destroy(){unsub();}};
}
