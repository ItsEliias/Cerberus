/**
 * reviews.js — Lab Reviews panel for CyberLab.
 *
 * Features: star rating + notes + tags per machine, list, edit/delete, link to lab.
 */

const API = '';

export async function renderReviews(container, ctx) {
  container.innerHTML = '<div class="cl-empty">Loading reviews…</div>';
  let reviews = [];
  let labs = [];
  try {
    const [rRes, lRes] = await Promise.all([
      fetch(`${API}/api/cyberlab/reviews`),
      fetch(`${API}/api/cyberlab/labs`),
    ]);
    reviews = await rRes.json();
    labs = await lRes.json();
  } catch { container.innerHTML = '<div class="cl-error">Failed to load reviews.</div>'; return; }

  let showForm = false;
  let editingId = null;

  function render() {
    container.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'cl-section-header';
    header.innerHTML = `<span class="cl-section-title">Lab Reviews</span><button class="cl-btn cl-btn-primary" id="cl-rev-new">+ New Review</button>`;
    container.appendChild(header);

    header.querySelector('#cl-rev-new').addEventListener('click', () => { showForm = true; editingId = null; render(); });

    if (showForm) container.appendChild(_reviewForm(
      editingId ? reviews.find(r => r.id === editingId) : null,
      labs,
      async (data) => {
        if (editingId) {
          await fetch(`${API}/api/cyberlab/reviews/${editingId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
          const idx = reviews.findIndex(r => r.id === editingId);
          if (idx >= 0) reviews[idx] = { ...reviews[idx], ...data };
        } else {
          const res = await fetch(`${API}/api/cyberlab/reviews`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
          reviews.unshift(await res.json());
        }
        showForm = false; editingId = null; render();
      },
      () => { showForm = false; editingId = null; render(); }
    ));

    if (reviews.length === 0 && !showForm) {
      container.appendChild(Object.assign(document.createElement('div'), { className: 'cl-empty', textContent: 'No reviews yet.' }));
      return;
    }

    reviews.forEach(rev => {
      const stars = '★'.repeat(rev.rating || 0) + '☆'.repeat(5 - (rev.rating || 0));
      const linkedLab = labs.find(l => l.id === rev.lab_id);
      const card = document.createElement('div');
      card.className = 'cl-card';
      const tagsHtml = (rev.tags || []).map(t => `<span class="cl-tag">${_esc(t)}</span>`).join('');
      card.innerHTML = `
        <div class="cl-card-title">${_esc(rev.machine_name)} <span style="color:#f5b300;letter-spacing:1px">${stars}</span></div>
        <div class="cl-card-meta">
          <span>${_esc(rev.platform||'htb').toUpperCase()}</span>
          ${linkedLab ? `<span>Lab: ${_esc(linkedLab.name)}</span>` : ''}
          <span>${_dateStr(rev.created_at)}</span>
        </div>
        ${rev.notes ? `<div style="font-size:12px;margin-top:6px;opacity:.75">${_esc(rev.notes)}</div>` : ''}
        <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${tagsHtml}</div>
        <div style="margin-top:8px;display:flex;gap:6px;">
          <button class="cl-btn cl-btn-ghost" data-action="edit" style="font-size:11px;padding:3px 8px">Edit</button>
          <button class="cl-btn cl-btn-danger" data-action="delete" style="font-size:11px;padding:3px 8px">Delete</button>
        </div>
      `;

      card.querySelector('[data-action="edit"]').addEventListener('click', () => { editingId = rev.id; showForm = true; render(); });
      card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (!confirm(`Delete review for "${rev.machine_name}"?`)) return;
        await fetch(`${API}/api/cyberlab/reviews/${rev.id}`, { method:'DELETE' });
        reviews = reviews.filter(r => r.id !== rev.id);
        render();
      });

      container.appendChild(card);
    });
  }

  render();
}

function _reviewForm(rev, labs, onSave, onCancel) {
  const div = document.createElement('div');
  div.className = 'cl-card';
  div.style.marginBottom = '12px';
  const ratingVal = rev?.rating || 3;
  div.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:10px;">${rev ? 'Edit Review' : 'New Review'}</div>
    <div class="cl-field"><label class="cl-label">Machine Name *</label><input class="cl-input" id="clf-mname" value="${_esc(rev?.machine_name||'')}"></div>
    <div class="cl-row">
      <div class="cl-field" style="flex:1"><label class="cl-label">Platform</label>
        <select class="cl-select" id="clf-rplatform" style="width:100%">
          ${['htb','thm','ctf','other'].map(p=>`<option value="${p}" ${(rev?.platform||'htb')===p?'selected':''}>${p.toUpperCase()}</option>`).join('')}
        </select>
      </div>
      <div class="cl-field" style="flex:1"><label class="cl-label">Rating</label>
        <select class="cl-select" id="clf-rating" style="width:100%">
          ${[5,4,3,2,1].map(n=>`<option value="${n}" ${ratingVal===n?'selected':''}>★ ${n}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="cl-field"><label class="cl-label">Link to Lab</label>
      <select class="cl-select" id="clf-lab-link" style="width:100%">
        <option value="">— None —</option>
        ${labs.map(l=>`<option value="${l.id}" ${rev?.lab_id===l.id?'selected':''}>${_esc(l.name)}</option>`).join('')}
      </select>
    </div>
    <div class="cl-field"><label class="cl-label">Tags (comma-separated)</label><input class="cl-input" id="clf-rtags" value="${_esc((rev?.tags||[]).join(', '))}"></div>
    <div class="cl-field"><label class="cl-label">Notes</label><textarea class="cl-input cl-textarea" id="clf-rnotes">${_esc(rev?.notes||'')}</textarea></div>
    <div class="cl-row" style="justify-content:flex-end;margin-top:4px">
      <button class="cl-btn cl-btn-ghost" id="clf-rcancel">Cancel</button>
      <button class="cl-btn cl-btn-primary" id="clf-rsave">Save</button>
    </div>
  `;

  div.querySelector('#clf-rcancel').addEventListener('click', onCancel);
  div.querySelector('#clf-rsave').addEventListener('click', () => {
    const name = div.querySelector('#clf-mname').value.trim();
    if (!name) { alert('Machine name is required.'); return; }
    onSave({
      machine_name: name,
      platform: div.querySelector('#clf-rplatform').value,
      rating: parseInt(div.querySelector('#clf-rating').value, 10),
      lab_id: div.querySelector('#clf-lab-link').value || null,
      tags: div.querySelector('#clf-rtags').value.split(',').map(t=>t.trim()).filter(Boolean),
      notes: div.querySelector('#clf-rnotes').value,
    });
  });
  return div;
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
