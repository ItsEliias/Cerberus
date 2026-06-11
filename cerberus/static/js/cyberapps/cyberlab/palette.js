/**
 * palette.js — Command Palette (Cmd+K) for CyberLab.
 *
 * 11+ actions, slash command type-ahead.
 */

let _paletteEl = null;
let _destroyFn = null;

export function initPalette(opts) {
  destroyPalette();

  const { vaultToken, activeLab, onSwitchTab, onLabChange, onTimerChange, onLockVault } = opts;

  const overlay = document.createElement('div');
  overlay.id = 'cl-palette-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding-top:80px;';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--bg,#1a1d23);border:1px solid var(--border,#3a2a2a);border-radius:8px;width:520px;max-width:95vw;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.5);';

  box.innerHTML = `
    <div style="padding:10px 12px;border-bottom:1px solid var(--border,#3a2a2a);">
      <input id="cl-palette-input" type="text" placeholder="Type a command or search… (Esc to close)"
        style="width:100%;background:none;border:none;color:var(--fg,#c5c9d0);font-size:14px;outline:none;box-sizing:border-box;">
    </div>
    <div id="cl-palette-results" style="max-height:360px;overflow-y:auto;"></div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  _paletteEl = overlay;

  const input = box.querySelector('#cl-palette-input');
  const results = box.querySelector('#cl-palette-results');

  const actions = _buildActions(activeLab, onSwitchTab, onLabChange, onTimerChange, onLockVault, overlay);

  function renderResults(query) {
    const q = (query || '').toLowerCase().trim();
    const filtered = q ? actions.filter(a => a.label.toLowerCase().includes(q) || (a.keywords||[]).some(k=>k.includes(q))) : actions;
    results.innerHTML = '';
    if (filtered.length === 0) {
      results.innerHTML = '<div style="padding:16px;text-align:center;opacity:.45;font-size:13px;">No matching commands</div>';
      return;
    }
    filtered.forEach((action, idx) => {
      const row = document.createElement('button');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;padding:9px 14px;background:none;border:none;color:var(--fg,#c5c9d0);cursor:pointer;font-size:13px;text-align:left;';
      row.innerHTML = `
        <span style="flex:0 0 20px;opacity:.6;font-size:14px">${_esc(action.icon||'•')}</span>
        <span style="flex:1">${_esc(action.label)}</span>
        ${action.hint ? `<span style="font-size:11px;opacity:.4">${_esc(action.hint)}</span>` : ''}
      `;
      row.addEventListener('mouseenter', () => {
        results.querySelectorAll('button').forEach(b => b.style.background = 'none');
        row.style.background = 'rgba(255,255,255,.06)';
      });
      row.addEventListener('click', () => {
        overlay.remove();
        _paletteEl = null;
        action.run();
      });
      results.appendChild(row);
    });
    // Highlight first
    if (results.firstChild) results.firstChild.style.background = 'rgba(255,255,255,.06)';
  }

  input.addEventListener('input', e => renderResults(e.target.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { overlay.remove(); _paletteEl = null; return; }
    const btns = [...results.querySelectorAll('button')];
    const activeIdx = btns.findIndex(b => b.style.background !== 'none' && b.style.background !== '');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = btns[(activeIdx + 1) % btns.length];
      btns.forEach(b => b.style.background = 'none');
      if (next) { next.style.background = 'rgba(255,255,255,.06)'; next.scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = btns[(activeIdx - 1 + btns.length) % btns.length];
      btns.forEach(b => b.style.background = 'none');
      if (prev) { prev.style.background = 'rgba(255,255,255,.06)'; prev.scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'Enter') {
      const active = btns.find(b => b.style.background !== 'none' && b.style.background !== '');
      if (active) active.click();
    }
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) { overlay.remove(); _paletteEl = null; }
  });

  renderResults('');
  setTimeout(() => input.focus(), 50);

  _destroyFn = () => {
    if (overlay.parentNode) overlay.remove();
    _paletteEl = null;
  };
}

export function destroyPalette() {
  if (_destroyFn) { _destroyFn(); _destroyFn = null; }
  if (_paletteEl && _paletteEl.parentNode) { _paletteEl.remove(); _paletteEl = null; }
  document.removeEventListener('keydown', _paletteKeyHandler);
}

function _paletteKeyHandler(e) {
  if (e.key === 'Escape' && _paletteEl) {
    _paletteEl.remove();
    _paletteEl = null;
  }
}

function _buildActions(activeLab, onSwitchTab, onLabChange, onTimerChange, onLockVault, overlay) {
  return [
    { icon: '💬', label: 'Go to Chat', keywords: ['chat','ai','message'], run: () => onSwitchTab('chat') },
    { icon: '🧪', label: 'Go to Labs', keywords: ['labs','tracker','machines'], run: () => onSwitchTab('labs') },
    { icon: '⏱', label: 'Go to Sessions', keywords: ['sessions','timer','time'], run: () => onSwitchTab('sessions') },
    { icon: '⭐', label: 'Go to Reviews', keywords: ['reviews','rating','stars'], run: () => onSwitchTab('reviews') },
    { icon: '📚', label: 'Go to Knowledge Base', keywords: ['kb','knowledge','notes'], run: () => onSwitchTab('knowledge') },
    { icon: '📋', label: 'Go to Snippets', keywords: ['snippets','commands','code'], run: () => onSwitchTab('snippets') },
    { icon: '📖', label: 'Go to Cheatsheets', keywords: ['cheatsheets','nmap','privesc'], run: () => onSwitchTab('cheatsheets') },
    { icon: '⚙', label: 'Go to Settings', keywords: ['settings','config','model'], run: () => onSwitchTab('settings') },
    {
      icon: '▶', label: activeLab?.name ? `Start Timer (${activeLab.name})` : 'Start Timer',
      keywords: ['timer','start','time'],
      hint: activeLab?.name || '',
      run: () => { if (activeLab?.id) onTimerChange('start', activeLab.id); else alert('Set an active lab first.'); }
    },
    { icon: '⏸', label: 'Pause Timer', keywords: ['timer','pause','stop'], run: () => onTimerChange('pause', null) },
    { icon: '🔄', label: 'Reset Timer', keywords: ['timer','reset','clear'], run: () => { if (confirm('Reset timer?')) onTimerChange('reset', null); } },
    { icon: '🔒', label: 'Lock Vault', keywords: ['vault','lock','password'], run: () => { if (confirm('Lock vault now?')) onLockVault(); } },
    {
      icon: '❌', label: activeLab?.name ? `Clear Active Lab (${activeLab.name})` : 'Clear Active Lab',
      keywords: ['lab','clear','active'],
      run: async () => {
        await fetch('/api/cyberlab/active-lab', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({}) });
        onLabChange({});
      }
    },
  ];
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
