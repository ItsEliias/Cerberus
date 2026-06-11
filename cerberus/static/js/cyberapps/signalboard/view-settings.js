/**
 * static/js/cyberapps/signalboard/view-settings.js
 * SignalBoard — Settings: refresh, display, context, alert rules.
 */

import * as State from './state.js';
import * as Api from './api.js';

function esc(str) { if(str==null)return''; return String(str).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

const S = (label,desc,children) => `<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:500;color:#c5c9d0;margin-bottom:3px;">${label}</div>${desc?`<p style="font-size:10px;color:#4a5568;margin:0 0 6px;">${desc}</p>`:''}${children}</div>`;

function Toggle(id,checked,label) {
  return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="${id}" ${checked?'checked':''} style="accent-color:#ff6b6b;width:14px;height:14px;"/><span style="font-size:11px;color:#8b949e;">${esc(label)}</span></label>`;
}

function Select(id,value,opts) {
  return `<select id="${id}" style="padding:4px 8px;border-radius:6px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;">${opts.map(([v,l])=>`<option value="${v}" ${value==v?'selected':''}>${esc(l)}</option>`).join('')}</select>`;
}

function Section(title,children) {
  return `<div style="margin-bottom:24px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#4a5568;padding-bottom:8px;border-bottom:1px solid rgba(42,51,71,0.4);margin-bottom:12px;">${title}</div>${children}</div>`;
}

function sev(s) { return s==='critical'?'#ff6b6b':s==='high'?'#f85149':s==='medium'?'#d29922':'#3fb950'; }

export function renderSettingsView(container) {
  function redraw() {
    const cfg=State.get('settings')||{}, ctx=State.get('context')||{}, rules=State.get('alertRules')||[];

    const ruleRows=rules.map((r,i)=>`<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;background:rgba(22,27,39,0.4);margin-bottom:4px;">
      <span style="width:8px;height:8px;border-radius:50%;background:${r.color||sev(r.severity)};flex-shrink:0;"></span>
      <span style="flex:1;font-size:10px;font-family:monospace;color:#8b949e;overflow:hidden;text-overflow:ellipsis;">${esc(r.regex)}</span>
      <span style="font-size:10px;color:#4a5568;">${esc(r.label)}</span>
      <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${sev(r.severity)}18;color:${sev(r.severity)};border:1px solid ${sev(r.severity)}33;">${esc(r.severity)}</span>
      <button class="sb-del-rule" data-i="${i}" style="background:none;border:none;cursor:pointer;color:#f85149;font-size:12px;padding:0;opacity:0.7;">✕</button>
    </div>`).join('');

    container.innerHTML = `<div style="flex:1;overflow-y:auto;padding:20px 24px;">
      <h2 style="font-size:13px;font-weight:600;color:#c5c9d0;margin:0 0 4px;">Settings</h2>
      <p style="font-size:11px;color:#4a5568;margin:0 0 24px;">Configure feed refresh, display, and alert rules.</p>
      <div style="max-width:560px;">
        ${Section('Feed',`
          ${S('Refresh Interval','How often feeds are fetched.',Select('sb-ri',cfg.refreshInterval||30,[[5,'5 min'],[15,'15 min'],[30,'30 min'],[60,'1 hour'],[180,'3 hours'],[360,'6 hours']]))}
          ${S('Max Items per Source','',Select('sb-mx',cfg.maxItemsPerSource||50,[[20,'20'],[50,'50'],[100,'100'],[200,'200']]))}
          ${S('Auto-Clear After','Remove items older than:',Select('sb-ac',cfg.autoClearDays||7,[[1,'1 day'],[3,'3 days'],[7,'7 days'],[14,'14 days'],[30,'30 days'],[0,'Never']]))}
        `)}
        ${Section('Notifications',`
          ${S('','',Toggle('sb-nt',cfg.notificationsEnabled,'Enable desktop notifications'))}
          ${S('Notify Threshold','Minimum tier to notify:',Select('sb-nts',cfg.notifyThreshold||'high',[ ['critical','Critical only'],['high','High+'],['medium','Medium+'],['low','All'] ]))}
        `)}
        ${Section('Active Context',`
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
            <div><div style="font-size:10px;color:#4a5568;margin-bottom:3px;">Lab / Organization</div><input id="sb-ctxlab" value="${esc(ctx.lab||'')}" placeholder="e.g. HackTheBox" style="width:100%;padding:5px 8px;border-radius:6px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;box-sizing:border-box;"/></div>
            <div><div style="font-size:10px;color:#4a5568;margin-bottom:3px;">Target</div><input id="sb-ctxtgt" value="${esc(ctx.target||'')}" placeholder="e.g. machine-name" style="width:100%;padding:5px 8px;border-radius:6px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;box-sizing:border-box;"/></div>
          </div>
          <div style="margin-bottom:8px;"><div style="font-size:10px;color:#4a5568;margin-bottom:3px;">IP / CIDR</div><input id="sb-ctxip" value="${esc(ctx.ip||'')}" placeholder="e.g. 10.10.11.0/24" style="width:100%;padding:5px 8px;border-radius:6px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;box-sizing:border-box;"/></div>
          <div style="margin-bottom:10px;"><div style="font-size:10px;color:#4a5568;margin-bottom:3px;">Custom Keywords (comma-separated)</div><input id="sb-ctxkw" value="${esc((ctx.customKeywords||[]).join(', '))}" placeholder="e.g. apache, log4j, CVE-2024" style="width:100%;padding:5px 8px;border-radius:6px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;box-sizing:border-box;"/></div>
          <button id="sb-savectx" style="padding:5px 16px;border-radius:6px;background:rgba(255,107,107,0.15);border:1px solid rgba(255,107,107,0.3);color:#ff6b6b;font-size:11px;cursor:pointer;">Save Context</button>
          <span id="sb-ctxok" style="font-size:10px;color:#3fb950;margin-left:8px;display:none;">Saved</span>
        `)}
        ${Section('Alert Rules',`
          <div style="margin-bottom:8px;">${ruleRows||'<p style="font-size:11px;color:#4a5568;">No rules defined.</p>'}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
            <div><div style="font-size:10px;color:#4a5568;margin-bottom:3px;">Regex Pattern</div><input id="sb-rrx" placeholder="e.g. CVE-2024" style="padding:5px 8px;border-radius:6px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;width:160px;"/></div>
            <div><div style="font-size:10px;color:#4a5568;margin-bottom:3px;">Label</div><input id="sb-rlb" placeholder="e.g. CVE Alert" style="padding:5px 8px;border-radius:6px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;width:120px;"/></div>
            <div><div style="font-size:10px;color:#4a5568;margin-bottom:3px;">Severity</div>${Select('sb-rsv','high',[['critical','Critical'],['high','High'],['medium','Medium'],['low','Low']])}</div>
            <button id="sb-addrule" style="padding:5px 14px;border-radius:6px;background:rgba(255,107,107,0.15);border:1px solid rgba(255,107,107,0.3);color:#ff6b6b;font-size:11px;cursor:pointer;">Add Rule</button>
          </div>
          <div id="sb-rerr" style="font-size:10px;color:#f85149;margin-top:6px;display:none;"></div>
        `)}
        ${Section('About',`<p style="font-size:11px;color:#4a5568;margin:0;">SignalBoard v1.0 · Security Intelligence Aggregator · Cerberus CyberOS</p>`)}
      </div>
    </div>`;

    // Feed settings
    ['sb-ri','sb-mx','sb-ac'].forEach(id=>container.querySelector('#'+id)?.addEventListener('change',async e=>{
      const key={sri:'refreshInterval',sbmx:'maxItemsPerSource',sbac:'autoClearDays'}[id.replace('-','')];
      const map={'sb-ri':'refreshInterval','sb-mx':'maxItemsPerSource','sb-ac':'autoClearDays'};
      const s=await Api.patchSettings({[map[id]]:Number(e.target.value)}).catch(()=>null);
      if(s?.settings)State.setSettings(s.settings);
    }));
    ['sb-nt'].forEach(id=>container.querySelector('#'+id)?.addEventListener('change',async e=>{
      const s=await Api.patchSettings({notificationsEnabled:e.target.checked}).catch(()=>null);
      if(s?.settings)State.setSettings(s.settings);
    }));
    container.querySelector('#sb-nts')?.addEventListener('change',async e=>{
      const s=await Api.patchSettings({notifyThreshold:e.target.value}).catch(()=>null);
      if(s?.settings)State.setSettings(s.settings);
    });

    // Context save
    container.querySelector('#sb-savectx')?.addEventListener('click',async()=>{
      const lab=container.querySelector('#sb-ctxlab')?.value?.trim()||'';
      const target=container.querySelector('#sb-ctxtgt')?.value?.trim()||'';
      const ip=container.querySelector('#sb-ctxip')?.value?.trim()||'';
      const kw=container.querySelector('#sb-ctxkw')?.value?.split(',').map(k=>k.trim()).filter(Boolean);
      const newCtx={lab,target,ip,customKeywords:kw};
      const r=await Api.saveContext(newCtx).catch(()=>null);
      if(r?.context)State.setContext(r.context);
      const ok=container.querySelector('#sb-ctxok');
      if(ok){ok.style.display='';setTimeout(()=>ok.style.display='none',2000);}
    });

    // Alert rule add
    container.querySelector('#sb-addrule')?.addEventListener('click',async()=>{
      const rx=container.querySelector('#sb-rrx')?.value?.trim();
      const lb=container.querySelector('#sb-rlb')?.value?.trim();
      const sv=container.querySelector('#sb-rsv')?.value||'high';
      const err=container.querySelector('#sb-rerr');
      err.style.display='none';
      if(!rx||!lb){err.textContent='Regex and label required.';err.style.display='';return;}
      try{new RegExp(rx);}catch{err.textContent='Invalid regex.';err.style.display='';return;}
      const id=`rule_${Date.now()}`;
      const newRules=[...(State.get('alertRules')||[]),{id,regex:rx,label:lb,severity:sv,color:sev(sv)}];
      const r=await Api.saveAlertRules(newRules).catch(()=>null);
      if(r?.rules)State.setAlertRules(r.rules);
    });

    // Alert rule delete
    container.querySelectorAll('.sb-del-rule').forEach(btn=>btn.addEventListener('click',async()=>{
      const idx=Number(btn.dataset.i), cur=State.get('alertRules')||[];
      const newRules=cur.filter((_,i)=>i!==idx);
      const r=await Api.saveAlertRules(newRules).catch(()=>null);
      if(r?.rules)State.setAlertRules(r.rules);
    }));
  }

  const unsubs=[State.subscribe('settings',redraw),State.subscribe('context',redraw),State.subscribe('alertRules',redraw)];
  redraw();
  return{destroy(){unsubs.forEach(u=>u());}};
}
