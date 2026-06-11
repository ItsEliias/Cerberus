/**
 * static/js/cyberapps/signalboard/view-settings.js
 * SignalBoard — Settings: feed, notifications, AI, alert rules, context.
 */

import * as State from './state.js';
import * as Api from './api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function toggle(checked, id) {
  return `<button class="sb-toggle" data-target="${id}" data-checked="${checked}" style="
    width:36px;height:20px;border-radius:10px;border:1px solid ${checked?'rgba(255,107,107,0.5)':'rgba(42,51,71,0.6)'};
    background:${checked?'rgba(255,107,107,0.3)':'rgba(42,51,71,0.3)'};cursor:pointer;position:relative;flex-shrink:0;">
    <span style="position:absolute;top:2px;${checked?'right:2px':'left:2px'};width:14px;height:14px;border-radius:50%;background:${checked?'#ff6b6b':'rgba(139,148,158,0.6)'};transition:all 0.15s;"></span>
  </button>`;
}

function select(id, value, options) {
  return `<select id="${id}" style="padding:4px 8px;border-radius:6px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;">
    ${options.map(o=>`<option value="${escHtml(String(o.value))}" ${String(value)===String(o.value)?'selected':''}>${escHtml(o.label)}</option>`).join('')}
  </select>`;
}

function row(label, desc, control) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:6px 0;">
    <div style="flex:1;min-width:0;">
      <p style="font-size:12px;color:#c5c9d0;margin:0;">${escHtml(label)}</p>
      ${desc?`<p style="font-size:10px;color:#4a5568;margin:2px 0 0;">${escHtml(desc)}</p>`:''}
    </div>
    <div style="flex-shrink:0;">${control}</div>
  </div>`;
}

function section(title, content) {
  return `<div style="margin-bottom:24px;">
    <h3 style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#4a5568;margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid rgba(42,51,71,0.4);">${escHtml(title)}</h3>
    <div>${content}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Alert rules editor
// ---------------------------------------------------------------------------

function renderAlertRulesEditor() {
  const rules = State.get('alertRules') || [];
  const rowsHtml = rules.map(r => `
    <div class="sb-rule-row" data-id="${escHtml(r.id)}" style="display:flex;align-items:center;gap:8px;padding:6px;border:1px solid rgba(42,51,71,0.4);border-radius:4px;margin-bottom:4px;background:rgba(22,27,39,0.3);">
      <span style="font-size:10px;font-family:monospace;color:#c5c9d0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(r.regex)}</span>
      <span style="font-size:10px;color:${r.color||'#ff6b6b'};flex-shrink:0;">${escHtml(r.label)}</span>
      <span style="font-size:9px;text-transform:uppercase;color:#8b949e;flex-shrink:0;">${escHtml(r.severity)}</span>
      <button class="sb-del-rule" data-id="${escHtml(r.id)}" style="background:none;border:none;cursor:pointer;color:#f85149;padding:0;font-size:12px;">✕</button>
    </div>`).join('');

  return `
    <div>
      ${rules.length>0?rowsHtml:'<p style="font-size:11px;color:#4a5568;margin:0 0 8px;">No rules yet.</p>'}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
        <input id="sb-rule-regex" placeholder="Regex pattern" style="flex:2;min-width:120px;padding:4px 8px;border-radius:4px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;font-family:monospace;"/>
        <input id="sb-rule-label" placeholder="Label" style="flex:1;min-width:80px;padding:4px 8px;border-radius:4px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;"/>
        <select id="sb-rule-sev" style="padding:4px 8px;border-radius:4px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;">
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium" selected>Medium</option>
          <option value="low">Low</option>
        </select>
        <button id="sb-add-rule" style="padding:4px 12px;border-radius:4px;background:rgba(255,107,107,0.15);border:1px solid rgba(255,107,107,0.3);color:#ff6b6b;font-size:11px;cursor:pointer;">Add</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export function renderSettingsView(container) {
  async function redraw() {
    const settings = State.get('settings') || {};
    const context  = State.get('context')  || {};

    container.innerHTML = `
      <div style="flex:1;overflow-y:auto;">
        <div style="max-width:520px;margin:0 auto;padding:24px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
            <div>
              <h2 style="font-size:13px;font-weight:600;color:#c5c9d0;margin:0 0 2px;">Settings</h2>
              <p style="font-size:11px;color:#4a5568;margin:0;">Configure SignalBoard behaviour.</p>
            </div>
            <span id="sb-saved-badge" style="display:none;font-size:10px;color:#3fb950;background:rgba(63,185,80,0.1);border:1px solid rgba(63,185,80,0.3);padding:2px 8px;border-radius:10px;">Saved</span>
          </div>

          ${section('Feed', `
            ${row('Refresh interval','How often to fetch new items.',
              select('sb-s-refresh', settings.refreshInterval||15, [
                {label:'15 minutes',value:15},{label:'30 minutes',value:30},
                {label:'1 hour',value:60},{label:'Manual only',value:0},
              ]))}
            ${row('Max items per source','',
              select('sb-s-max', settings.maxItemsPerSource||30, [
                {label:'10',value:10},{label:'20',value:20},{label:'30',value:30},
                {label:'50',value:50},{label:'100',value:100},
              ]))}
            ${row('Auto-clear items older than','',
              select('sb-s-clear', settings.autoClearDays||30, [
                {label:'7 days',value:7},{label:'14 days',value:14},{label:'30 days',value:30},
                {label:'60 days',value:60},{label:'Never',value:0},
              ]))}
          `)}

          ${section('Notifications', `
            ${row('Enable notifications','Show alerts for high-relevance items.',
              toggle(settings.notificationsEnabled!==false,'notificationsEnabled'))}
            ${row('Notification threshold','Items scoring at or above this value trigger an alert.',
              select('sb-s-threshold', settings.notificationThreshold||40, [
                {label:'Score ≥ 20',value:20},{label:'Score ≥ 30',value:30},
                {label:'Score ≥ 40',value:40},{label:'Score ≥ 50',value:50},
                {label:'Score ≥ 60',value:60},{label:'Score ≥ 80',value:80},
              ]))}
          `)}

          ${section('Active Context', `
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${row('Lab / Target','Active HTB/CTF lab or target hostname.',
                `<input id="sb-ctx-lab" value="${escHtml(context.lab||context.target||'')}" placeholder="e.g. Photon" style="padding:4px 8px;border-radius:4px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;width:160px;"/>`)}
              ${row('IP Address','',
                `<input id="sb-ctx-ip" value="${escHtml(context.ip||'')}" placeholder="e.g. 10.10.11.x" style="padding:4px 8px;border-radius:4px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;width:160px;font-family:monospace;"/>`)}
              ${row('Custom keywords','Comma-separated; boost matching items.',
                `<input id="sb-ctx-kw" value="${escHtml((context.customKeywords||[]).join(', '))}" placeholder="e.g. docker, kernel" style="padding:4px 8px;border-radius:4px;background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);color:#c5c9d0;font-size:11px;outline:none;width:200px;"/>`)}
              <button id="sb-ctx-save" style="align-self:flex-start;padding:4px 12px;border-radius:6px;background:rgba(74,158,255,0.15);border:1px solid rgba(74,158,255,0.3);color:#4a9eff;font-size:11px;cursor:pointer;">Save Context</button>
            </div>
          `)}

          ${section('Alert Rules', renderAlertRulesEditor())}

          ${section('About', `
            <div style="padding:12px;background:rgba(22,27,39,0.2);border:1px solid rgba(42,51,71,0.3);border-radius:6px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="font-size:11px;color:#4a5568;">SignalBoard</span>
                <span style="font-size:11px;font-family:monospace;color:rgba(197,201,208,0.7);">v2.1.0</span>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="font-size:11px;color:#4a5568;">Part of CyberOS</span>
                <span style="font-size:11px;color:#3a424f;">by ItsEliias</span>
              </div>
            </div>
          `)}
        </div>
      </div>`;

    const savedBadge = container.querySelector('#sb-saved-badge');

    function showSaved() {
      savedBadge.style.display = '';
      setTimeout(() => { savedBadge.style.display = 'none'; }, 1500);
    }

    async function patchSettings(patch) {
      const updated = { ...(State.get('settings')||{}), ...patch };
      State.setSettings(updated);
      await Api.patchSettings(patch).catch(() => {});
      showSaved();
    }

    // Select changes
    ['sb-s-refresh','sb-s-max','sb-s-clear','sb-s-threshold'].forEach(id => {
      container.querySelector(`#${id}`)?.addEventListener('change', e => {
        const map = {
          'sb-s-refresh':    'refreshInterval',
          'sb-s-max':        'maxItemsPerSource',
          'sb-s-clear':      'autoClearDays',
          'sb-s-threshold':  'notificationThreshold',
        };
        patchSettings({ [map[id]]: Number(e.target.value) });
      });
    });

    // Toggle changes
    container.querySelectorAll('.sb-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const checked = btn.dataset.checked === 'true';
        patchSettings({ [btn.dataset.target]: !checked });
      });
    });

    // Context save
    container.querySelector('#sb-ctx-save')?.addEventListener('click', async () => {
      const lab = container.querySelector('#sb-ctx-lab')?.value?.trim() || '';
      const ip  = container.querySelector('#sb-ctx-ip')?.value?.trim()  || '';
      const kwRaw = container.querySelector('#sb-ctx-kw')?.value || '';
      const kws = kwRaw.split(',').map(k=>k.trim()).filter(Boolean);
      const ctx = { lab, target: lab, ip, customKeywords: kws };
      State.setContext(ctx);
      await Api.saveContext(ctx).catch(() => {});
      showSaved();
    });

    // Alert rule add
    container.querySelector('#sb-add-rule')?.addEventListener('click', async () => {
      const regex = container.querySelector('#sb-rule-regex')?.value?.trim();
      const label = container.querySelector('#sb-rule-label')?.value?.trim();
      const sev   = container.querySelector('#sb-rule-sev')?.value || 'medium';
      if (!regex || !label) return;
      try { new RegExp(regex); } catch { alert('Invalid regex'); return; }
      const colors = { critical:'#ff6b6b', high:'#f85149', medium:'#d29922', low:'#4a9eff' };
      const newRule = { id:`rule-${Date.now()}`, regex, label, severity: sev, color: colors[sev]||'#ff6b6b' };
      const rules = [...(State.get('alertRules')||[]), newRule];
      State.setAlertRules(rules);
      await Api.saveAlertRules(rules).catch(() => {});
      await redraw();
    });

    // Alert rule delete
    container.querySelectorAll('.sb-del-rule').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const rules = (State.get('alertRules')||[]).filter(r=>r.id!==id);
        State.setAlertRules(rules);
        await Api.saveAlertRules(rules).catch(() => {});
        await redraw();
      });
    });
  }

  const unsubs = [
    State.subscribe('settings',   redraw),
    State.subscribe('alertRules', redraw),
  ];

  redraw();

  return { destroy() { unsubs.forEach(u=>u()); } };
}
