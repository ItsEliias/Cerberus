/**
 * ReconDesk — stylesheet injection.
 * Called once on init; idempotent via id check.
 */

export function injectStyles() {
  if (document.getElementById('rd-styles')) return;
  const style = document.createElement('style');
  style.id = 'rd-styles';
  style.textContent = `
    .rd-sidebar {
      width: 220px; min-width: 220px; border-right: 1px solid var(--border);
      background: var(--panel); display: flex; flex-direction: column; overflow: hidden;
    }
    .rd-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .rd-tab-bar { border-bottom: 1px solid rgba(255,255,255,0.04); background: rgba(7,8,15,0.4); flex-shrink: 0; }
    .rd-tabs { display: flex; align-items: center; gap: 2px; padding: 0 12px; height: 40px; }
    .rd-tab { background: none; border: none; padding: 6px 12px; font-size: 11px; font-weight: 500;
              color: var(--fg); opacity: 0.45; cursor: pointer; border-radius: 6px; transition: all 120ms; }
    .rd-tab:hover { opacity: 0.75; }
    .rd-tab--active { opacity: 1; background: rgba(210,153,34,0.10); border: 1px solid rgba(210,153,34,0.22); }
    .rd-ip-badge { margin-left: auto; font-family: monospace; font-size: 10px; padding: 2px 8px;
                   border-radius: 4px; border: 1px solid rgba(210,153,34,0.20);
                   color: rgba(210,153,34,0.75); background: rgba(210,153,34,0.06); }
    .rd-content { flex: 1; overflow: auto; }
    .rd-empty { display: flex; flex-direction: column; align-items: center; justify-content: center;
                height: 100%; padding: 40px; text-align: center; }
    .rd-input { background: rgba(7,8,15,0.8); border: 1px solid rgba(42,51,71,0.8);
                border-radius: 6px; padding: 6px 10px; font-size: 12px;
                color: #e6edf3; width: 100%; box-sizing: border-box;
                outline: none; transition: border-color 120ms; }
    .rd-input:focus { border-color: #d29922; }
    .rd-btn { padding: 6px 14px; border-radius: 6px; font-size: 12px; cursor: pointer;
              border: 1px solid rgba(42,51,71,0.6); background: rgba(42,51,71,0.4); color: #e6edf3; transition: all 120ms; }
    .rd-btn:hover { background: rgba(42,51,71,0.7); }
    .rd-btn--primary { background: rgba(210,153,34,0.12); border-color: rgba(210,153,34,0.3); color: #d29922; }
    .rd-btn--primary:hover { background: rgba(210,153,34,0.22); }
    .rd-btn--danger { background: rgba(248,81,73,0.10); border-color: rgba(248,81,73,0.25); color: #f85149; }
    .rd-form-row { display: flex; gap: 8px; }
    .rd-form-row label { flex: 1; font-size: 10px; color: #484f58; text-transform: uppercase;
                         letter-spacing: 0.07em; display: flex; flex-direction: column; gap: 4px; }
    .rd-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7);
                         display: flex; align-items: center; justify-content: center; z-index: 9998; }
    .rd-modal { background: #12131a; border: 1px solid rgba(42,51,71,0.8);
                border-radius: 12px; width: 480px; max-width: 96vw; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.6); }
    .rd-modal-header { display: flex; align-items: center; justify-content: space-between;
                       padding: 14px 18px; border-bottom: 1px solid rgba(42,51,71,0.5);
                       font-size: 13px; font-weight: 600; color: #e6edf3; }
    .rd-modal-close { background: none; border: none; color: #484f58; cursor: pointer; font-size: 14px; }
    .rd-modal-close:hover { color: #f85149; }
    .rd-modal-body { padding: 18px; }
    .rd-section-header { display: flex; align-items: center; justify-content: space-between;
                         padding: 10px 16px; border-bottom: 1px solid rgba(42,51,71,0.5);
                         background: rgba(7,8,15,0.3); flex-shrink: 0; }
    .rd-section-title { font-size: 12px; font-weight: 600; color: #e6edf3; }
    .rd-section-sub { font-size: 10px; color: #484f58; margin-left: 6px; }
    .rd-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .rd-table th { padding: 8px 14px; text-align: left; font-size: 10px; font-weight: 600;
                   text-transform: uppercase; letter-spacing: 0.07em; color: #484f58;
                   border-bottom: 1px solid rgba(42,51,71,0.6); background: rgba(7,8,15,0.5); }
    .rd-table td { padding: 8px 14px; border-bottom: 1px solid rgba(42,51,71,0.2); }
    .rd-table tr:hover td { background: rgba(255,255,255,0.02); }
    .rd-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; border: 1px solid; font-weight: 500; }
    .rd-panel { background: rgba(18,19,26,0.8); border: 1px solid rgba(42,51,71,0.5); border-radius: 8px; padding: 14px; }
    .rd-label-caps { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: #484f58; display: block; margin-bottom: 10px; }
  `;
  document.head.appendChild(style);
}
