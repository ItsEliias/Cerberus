/**
 * sessions.js — Session management panel for CyberLab.
 *
 * Features: list past sessions, create/delete/rename, timer integration.
 */

const API = '';

export async function renderSessions(container, ctx) {
  container.innerHTML = '<div class="cl-empty">Loading sessions…</div>';
  let sessions = [];
  try {
    const res = await fetch(`${API}/api/cyberlab/sessions`);
    sessions = await res.json();
  } catch { container.innerHTML = '<div class="cl-error">Failed to load sessions.</div>'; return; }

  let showForm = false;

  function render() {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'cl-section-header';
    header.innerHTML = `<span class="cl-section-title">Sessions</span><button class="cl-btn cl-btn-primary" id="cl-sess-new">+ New Session</button>`;
    container.appendChild(header);

    if (showForm) container.appendChild(_sessionForm(async (data) => {
      const res = await fetch(`${API}/api/cyberlab/sessions`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
      const s = await res.json();
      sessions.unshift(s);
      showForm = false;
      render();
    }, () => { showForm = false; render(); }));

    container.querySelector('#cl-sess-new').addEventListener('click', () => { showForm = true; render(); });

    if (sessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cl-empty';
      empty.textContent = 'No sessions yet.';
      container.appendChild(empty);
      return;
    }

    sessions.forEach(sess => {
      const timerState = ctx.timerState();
      const isTimerActive = timerState.labId === sess.id && timerState.running;
      const totalSec = sess.total_seconds || 0;
      const card = document.createElement('div');
      card.className = 'cl-card';
      card.innerHTML = `
        <div class="cl-card-title">${_esc(sess.name)}</div>
        <div class="cl-card-meta">
          <span>${_esc(sess.platform||'htb').toUpperCase()}</span>
          ${sess.machine ? `<span>${_esc(sess.machine)}</span>` : ''}
          <span>${_formatTime(totalSec)}</span>
          <span>${sess.messages ? sess.messages.length + ' msgs' : ''}</span>
          <span>${_dateStr(sess.created_at)}</span>
        </div>
        <div style="margin-top:8px;display:flex;gap:6px;">
          <button class="cl-btn cl-btn-ghost" data-action="timer-toggle" style="font-size:11px;padding:3px 8px">
            ${isTimerActive ? 'Pause Timer' : totalSec > 0 ? 'Resume Timer' : 'Start Timer'}
          </button>
          <button class="cl-btn cl-btn-ghost" data-action="rename" style="font-size:11px;padding:3px 8px">Rename</button>
          <button class="cl-btn cl-btn-danger" data-action="delete" style="font-size:11px;padding:3px 8px">Delete</button>
        </div>
      `;

      card.querySelector('[data-action="timer-toggle"]').addEventListener('click', () => {
        if (isTimerActive) {
          ctx.onTimerChange('pause', sess.id);
        } else {
          ctx.onTimerChange(totalSec > 0 ? 'resume' : 'start', sess.id);
        }
        render();
      });

      card.querySelector('[data-action="rename"]').addEventListener('click', async () => {
        const newName = prompt('Rename session:', sess.name);
        if (!newName || newName.trim() === sess.name) return;
        await fetch(`${API}/api/cyberlab/sessions/${sess.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name: newName.trim() }) });
        sess.name = newName.trim();
        render();
      });

      card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (!confirm(`Delete session "${sess.name}"?`)) return;
        await fetch(`${API}/api/cyberlab/sessions/${sess.id}`, { method:'DELETE' });
        sessions = sessions.filter(s => s.id !== sess.id);
        render();
      });

      container.appendChild(card);
    });
  }

  render();
}

function _sessionForm(onSave, onCancel) {
  const div = document.createElement('div');
  div.className = 'cl-card';
  div.style.marginBottom = '12px';
  div.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:10px;">New Session</div>
    <div class="cl-field"><label class="cl-label">Name</label><input class="cl-input" id="clsf-name" value="New Session"></div>
    <div class="cl-row">
      <div class="cl-field" style="flex:1"><label class="cl-label">Platform</label>
        <select class="cl-select" id="clsf-platform" style="width:100%">
          ${['htb','thm','ctf','other'].map(p=>`<option value="${p}">${p.toUpperCase()}</option>`).join('')}
        </select>
      </div>
      <div class="cl-field" style="flex:1"><label class="cl-label">Machine</label><input class="cl-input" id="clsf-machine" placeholder="Machine name"></div>
    </div>
    <div class="cl-row" style="justify-content:flex-end;margin-top:4px">
      <button class="cl-btn cl-btn-ghost" id="clsf-cancel">Cancel</button>
      <button class="cl-btn cl-btn-primary" id="clsf-save">Create</button>
    </div>
  `;
  div.querySelector('#clsf-cancel').addEventListener('click', onCancel);
  div.querySelector('#clsf-save').addEventListener('click', () => {
    onSave({
      name: div.querySelector('#clsf-name').value.trim() || 'New Session',
      platform: div.querySelector('#clsf-platform').value,
      machine: div.querySelector('#clsf-machine').value.trim(),
    });
  });
  return div;
}

function _formatTime(seconds) {
  if (!seconds) return '0:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function _dateStr(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
