/**
 * ReconDesk — Timeline tab.
 * Reverse-chronological event log with filter groups.
 */
import { _esc } from './index.js';

const TYPE_CONFIG = {
  port_added:       { color: '#4a9eff', label: 'Port'       },
  credential_added: { color: '#f85149', label: 'Cred'       },
  card_created:     { color: '#d29922', label: 'Card'       },
  card_moved:       { color: '#3fb950', label: 'Moved'      },
  card_completed:   { color: '#3fb950', label: 'Done'       },
  status_changed:   { color: '#b44fff', label: 'Status'     },
  note_added:       { color: '#8b949e', label: 'Note'       },
  enrichment:       { color: '#4a9eff', label: 'Enrich'     },
  screenshot:       { color: '#d29922', label: 'Screenshot' },
  cve_alert:        { color: '#f85149', label: 'CVE'        },
  import:           { color: '#3fb950', label: 'Import'     },
};

function _relTime(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000)       return 'just now';
    if (diff < 3600000)     return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000)    return `${Math.floor(diff/3600000)}h ago`;
    if (diff < 7*86400000)  return `${Math.floor(diff/86400000)}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return iso; }
}

export function renderTimeline(el, target, handlers) {
  const { onAddEntry } = handlers;
  const entries = (target.timeline || []).slice().sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div class="rd-section-header">
        <span class="rd-section-title">Timeline<span class="rd-section-sub">(${entries.length})</span></span>
        <button class="rd-btn" id="rd-tl-add">+ Note</button>
      </div>

      <div style="flex:1;overflow-y:auto;padding:16px">
        ${entries.length === 0 ? `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:#484f58">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" style="opacity:.3"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 7v5l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <p style="font-size:12px;margin:0">No timeline entries yet</p>
          </div>
        ` : `
          <div style="position:relative">
            <div style="position:absolute;left:5px;top:8px;bottom:8px;width:1px;background:linear-gradient(to bottom,rgba(210,153,34,0.35) 0%,rgba(42,51,71,0.3) 100%)"></div>
            ${entries.map((e, i) => {
              const cfg = TYPE_CONFIG[e.entry_type] || { color: '#4a5568', label: '?' };
              return `
                <div style="padding-left:20px;position:relative;margin-bottom:2px">
                  <span style="position:absolute;left:1px;top:14px;width:8px;height:8px;border-radius:50%;background:${cfg.color};border:2px solid #07080f;box-shadow:0 0 6px ${cfg.color}50"></span>
                  <div style="padding:10px 0;display:flex;flex-direction:column;gap:3px">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                      <span class="rd-badge" style="color:${cfg.color};background:${cfg.color}15;border-color:${cfg.color}28;font-size:9px">${cfg.label}</span>
                      <span style="font-size:10px;font-family:monospace;color:#6b7585" title="${_esc(e.created_at)}">${_relTime(e.created_at)}</span>
                    </div>
                    <p style="font-size:11px;color:#e2e8f0;margin:0;line-height:1.4">${_esc(e.description)}</p>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    </div>
  `;

  el.querySelector('#rd-tl-add')?.addEventListener('click', () => {
    const desc = prompt('Timeline note:');
    if (desc && desc.trim()) {
      onAddEntry(target.id, 'note_added', desc.trim());
    }
  });
}
