/**
 * snippets.js — Snippets Manager panel for CyberLab.
 *
 * Features: CRUD snippets (title, command, language, tags),
 *           click-to-copy, slash command /snip integration.
 */

const API = '';

export async function renderSnippets(container, ctx) {
  container.innerHTML = '<div class="cl-empty">Loading snippets…</div>';
  let snippets = [];
  try {
    const res = await fetch(`${API}/api/cyberlab/snippets`);
    snippets = await res.json();
  } catch { container.innerHTML = '<div class="cl-error">Failed to load snippets.</div>'; return; }

  let showForm = false;
  let editingId = null;
  let searchQ = '';

  function render() {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'cl-section-header';
    header.innerHTML = `<span class="cl-section-title">Snippets</span><button class="cl-btn cl-btn-primary" id="cl-snip-new">+ New Snippet</button>`;
    container.appendChild(header);

    const searchRow = document.createElement('div');
    searchRow.style.marginBottom = '10px';
    searchRow.innerHTML = `<input class="cl-input" id="cl-snip-search" placeholder="Search snippets…" value="${_esc(searchQ)}">`;
    container.appendChild(searchRow);
    searchRow.querySelector('#cl-snip-search').addEventListener('input', e => { searchQ = e.target.value; render(); });

    header.querySelector('#cl-snip-new').addEventListener('click', () => { showForm = true; editingId = null; render(); });

    if (showForm) container.appendChild(_snippetForm(
      editingId ? snippets.find(s => s.id === editingId) : null,
      async (data) => {
        if (editingId) {
          await fetch(`${API}/api/cyberlab/snippets/${editingId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
          const idx = snippets.findIndex(s => s.id === editingId);
          if (idx >= 0) snippets[idx] = { ...snippets[idx], ...data };
        } else {
          const res = await fetch(`${API}/api/cyberlab/snippets`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
          snippets.unshift(await res.json());
        }
        showForm = false; editingId = null; render();
      },
      () => { showForm = false; editingId = null; render(); }
    ));

    let filtered = snippets;
    if (searchQ) {
      const ql = searchQ.toLowerCase();
      filtered = snippets.filter(s => s.title.toLowerCase().includes(ql) || s.command.toLowerCase().includes(ql) || (s.tags||[]).some(t=>t.toLowerCase().includes(ql)));
    }

    if (filtered.length === 0 && !showForm) {
      container.appendChild(Object.assign(document.createElement('div'), { className: 'cl-empty', textContent: snippets.length===0?'No snippets yet.':'No snippets match your search.' }));
      return;
    }

    filtered.forEach(snippet => {
      const tagsHtml = (snippet.tags||[]).map(t=>`<span class="cl-tag">${_esc(t)}</span>`).join('');
      const card = document.createElement('div');
      card.className = 'cl-card';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div class="cl-card-title" style="flex:1">${_esc(snippet.title)}</div>
          <span style="font-size:10px;opacity:.5;background:rgba(255,255,255,.06);padding:2px 6px;border-radius:3px;white-space:nowrap">${_esc(snippet.language||'bash')}</span>
        </div>
        <pre class="cl-pre" style="margin:6px 0 4px;font-size:11px;position:relative">${_esc(snippet.command)}<button class="cl-btn cl-btn-ghost cl-copy-btn" data-action="copy" style="position:absolute;top:4px;right:4px;font-size:10px;padding:2px 6px">Copy</button></pre>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">${tagsHtml}</div>
        <div style="display:flex;gap:6px;">
          <button class="cl-btn cl-btn-ghost" data-action="edit" style="font-size:11px;padding:3px 8px">Edit</button>
          <button class="cl-btn cl-btn-danger" data-action="delete" style="font-size:11px;padding:3px 8px">Delete</button>
        </div>
      `;

      card.querySelector('[data-action="copy"]').addEventListener('click', () => {
        navigator.clipboard.writeText(snippet.command).then(() => {
          const btn = card.querySelector('[data-action="copy"]');
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        });
      });

      card.querySelector('[data-action="edit"]').addEventListener('click', () => { editingId = snippet.id; showForm = true; render(); });
      card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (!confirm(`Delete snippet "${snippet.title}"?`)) return;
        await fetch(`${API}/api/cyberlab/snippets/${snippet.id}`, { method:'DELETE' });
        snippets = snippets.filter(s => s.id !== snippet.id);
        render();
      });

      container.appendChild(card);
    });
  }

  render();
}

function _snippetForm(snippet, onSave, onCancel) {
  const div = document.createElement('div');
  div.className = 'cl-card';
  div.style.marginBottom = '12px';
  div.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:10px;">${snippet ? 'Edit Snippet' : 'New Snippet'}</div>
    <div class="cl-field"><label class="cl-label">Title *</label><input class="cl-input" id="clf-stitle" value="${_esc(snippet?.title||'')}"></div>
    <div class="cl-field"><label class="cl-label">Command</label><textarea class="cl-input cl-textarea" id="clf-scmd" style="font-family:monospace;min-height:80px">${_esc(snippet?.command||'')}</textarea></div>
    <div class="cl-row">
      <div class="cl-field" style="flex:1"><label class="cl-label">Language</label>
        <select class="cl-select" id="clf-slang" style="width:100%">
          ${['bash','python','powershell','ruby','php','sql','other'].map(l=>`<option value="${l}" ${(snippet?.language||'bash')===l?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="cl-field" style="flex:2"><label class="cl-label">Tags (comma-separated)</label><input class="cl-input" id="clf-stags" value="${_esc((snippet?.tags||[]).join(', '))}"></div>
    </div>
    <div class="cl-row" style="justify-content:flex-end;margin-top:4px">
      <button class="cl-btn cl-btn-ghost" id="clf-scancel">Cancel</button>
      <button class="cl-btn cl-btn-primary" id="clf-ssave">Save</button>
    </div>
  `;
  div.querySelector('#clf-scancel').addEventListener('click', onCancel);
  div.querySelector('#clf-ssave').addEventListener('click', () => {
    const title = div.querySelector('#clf-stitle').value.trim();
    if (!title) { alert('Title is required.'); return; }
    onSave({
      title,
      command: div.querySelector('#clf-scmd').value,
      language: div.querySelector('#clf-slang').value,
      tags: div.querySelector('#clf-stags').value.split(',').map(t=>t.trim()).filter(Boolean),
    });
  });
  return div;
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
