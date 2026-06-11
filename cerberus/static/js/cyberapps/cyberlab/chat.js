/**
 * chat.js — AI Chat panel for CyberLab.
 *
 * Features: Claude API chat, active-lab context injection, markdown rendering,
 * streaming-style display, per-session history, model/max_tokens controls,
 * slash commands /kb and /snip.
 */

const API = '';
let _sessionId = null;
let _history = [];
let _kb = [];
let _snippets = [];

export async function renderChat(container, ctx) {
  _history = [];
  _kb = [];
  _snippets = [];

  // Load KB and snippets for slash commands
  try {
    const [kbRes, snipRes] = await Promise.all([
      fetch(`${API}/api/cyberlab/knowledge`),
      fetch(`${API}/api/cyberlab/snippets`),
    ]);
    _kb = await kbRes.json();
    _snippets = await snipRes.json();
  } catch { /* non-fatal */ }

  let settings = { default_model: 'claude-sonnet-4-6', max_tokens: 2048, system_prompt_override: '' };
  try {
    const res = await fetch(`${API}/api/cyberlab/settings`);
    settings = { ...settings, ...(await res.json()) };
  } catch { /* use defaults */ }

  container.innerHTML = '';

  // Session selector bar
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:8px;';
  bar.innerHTML = `
    <select class="cl-select" id="cl-chat-session" style="flex:1;font-size:12px;">
      <option value="">No session (unsaved)</option>
    </select>
    <button class="cl-btn cl-btn-ghost" id="cl-chat-new-sess" style="font-size:11px;padding:4px 8px">+ Session</button>
  `;
  container.appendChild(bar);

  // Load sessions into select
  _loadSessionSelect(bar.querySelector('#cl-chat-session'));

  bar.querySelector('#cl-chat-session').addEventListener('change', async (e) => {
    _sessionId = e.target.value || null;
    if (_sessionId) {
      const res = await fetch(`${API}/api/cyberlab/sessions`);
      const sessions = await res.json();
      const sess = sessions.find(s => s.id === _sessionId);
      if (sess && sess.messages) {
        _history = sess.messages.filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role, content: m.content }));
        _rerenderMessages(msgList);
      }
    } else {
      _history = [];
      _rerenderMessages(msgList);
    }
  });

  bar.querySelector('#cl-chat-new-sess').addEventListener('click', async () => {
    const name = prompt('Session name:', 'New Session');
    if (!name) return;
    const res = await fetch(`${API}/api/cyberlab/sessions`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name: name.trim(), platform: ctx.activeLab?.platform || 'htb', machine: ctx.activeLab?.name || '' }) });
    const sess = await res.json();
    _sessionId = sess.id;
    _history = [];
    await _loadSessionSelect(bar.querySelector('#cl-chat-session'), _sessionId);
    _rerenderMessages(msgList);
  });

  // Active lab badge
  if (ctx.activeLab && ctx.activeLab.name) {
    const labBadge = document.createElement('div');
    labBadge.style.cssText = 'font-size:11px;opacity:.6;margin-bottom:8px;';
    labBadge.innerHTML = `Context: <strong>${_esc(ctx.activeLab.name)}</strong> (${_esc(ctx.activeLab.platform||'')})`;
    container.appendChild(labBadge);
  }

  // Message list
  const msgList = document.createElement('div');
  msgList.id = 'cl-chat-messages';
  msgList.style.cssText = 'min-height:200px;margin-bottom:10px;display:flex;flex-direction:column;gap:10px;';
  container.appendChild(msgList);

  _rerenderMessages(msgList);

  // Settings row (compact)
  const settingsRow = document.createElement('div');
  settingsRow.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:8px;';
  settingsRow.innerHTML = `
    <select class="cl-select" id="cl-chat-model" style="font-size:11px;" title="Model">
      ${['claude-sonnet-4-6','claude-opus-4-5','claude-haiku-4-5'].map(m=>`<option value="${m}" ${settings.default_model===m?'selected':''}>${m}</option>`).join('')}
    </select>
    <input type="number" class="cl-input" id="cl-chat-tokens" value="${settings.max_tokens}" min="256" max="8192" style="width:75px;font-size:11px;" title="Max tokens">
  `;
  container.appendChild(settingsRow);

  // Input area
  const inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;gap:6px;';
  inputRow.innerHTML = `
    <textarea class="cl-input cl-textarea" id="cl-chat-input" rows="3" placeholder="Ask anything… /kb <query> to search knowledge, /snip to insert snippet" style="flex:1;min-height:60px;font-size:13px;resize:none;"></textarea>
    <button class="cl-btn cl-btn-primary" id="cl-chat-send" style="padding:8px 14px;">Send</button>
  `;
  container.appendChild(inputRow);

  const inputEl = inputRow.querySelector('#cl-chat-input');
  const sendBtn = inputRow.querySelector('#cl-chat-send');

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
  });

  // Slash command hint on input
  inputEl.addEventListener('input', () => {
    const val = inputEl.value;
    _handleSlashPreview(val, container);
  });

  sendBtn.addEventListener('click', async () => {
    const message = inputEl.value.trim();
    if (!message) return;

    // Handle /snip command
    if (message.startsWith('/snip')) {
      _insertSnippet(message, inputEl);
      return;
    }

    // Handle /kb command
    if (message.startsWith('/kb ')) {
      const q = message.slice(4).trim();
      _showKbResults(q, msgList);
      inputEl.value = '';
      return;
    }

    inputEl.value = '';
    sendBtn.disabled = true;

    // Add user message
    _history.push({ role: 'user', content: message });
    _addMessage(msgList, 'user', message);

    // KB auto-surface
    const relevantKb = _autoSurfaceKb(ctx.activeLab);

    const model = document.getElementById('cl-chat-model')?.value || settings.default_model;
    const maxTok = parseInt(document.getElementById('cl-chat-tokens')?.value || settings.max_tokens, 10);

    // Loading indicator
    const loadingEl = _addMessage(msgList, 'assistant', '…', true);

    try {
      const res = await fetch(`${API}/api/cyberlab/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: _history.slice(0, -1),
          session_id: _sessionId,
          active_lab: ctx.activeLab || {},
          kb_entries: relevantKb,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        loadingEl.innerHTML = `<div class="cl-error">${_esc(err.detail || 'Chat error')}</div>`;
        _history.pop();
        sendBtn.disabled = false;
        return;
      }

      const data = await res.json();
      _history.push({ role: 'assistant', content: data.reply });
      loadingEl.innerHTML = _renderMarkdown(data.reply);
      loadingEl.className = 'cl-msg cl-msg-assistant';
    } catch (err) {
      loadingEl.innerHTML = `<div class="cl-error">${_esc(String(err))}</div>`;
      _history.pop();
    }

    sendBtn.disabled = false;
    msgList.scrollTop = msgList.scrollHeight;
  });
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

async function _loadSessionSelect(sel, activeId) {
  try {
    const res = await fetch(`${API}/api/cyberlab/sessions`);
    const sessions = await res.json();
    const current = sel.value;
    sel.innerHTML = '<option value="">No session (unsaved)</option>';
    sessions.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === (activeId || current)) opt.selected = true;
      sel.appendChild(opt);
    });
    if (activeId) sel.value = activeId;
  } catch { /* ignore */ }
}

function _rerenderMessages(msgList) {
  msgList.innerHTML = '';
  if (_history.length === 0) {
    msgList.innerHTML = '<div style="text-align:center;opacity:.35;font-size:12px;padding:20px 0;">No messages yet. Start a conversation.</div>';
    return;
  }
  _history.forEach(m => _addMessage(msgList, m.role, m.content));
  msgList.scrollTop = msgList.scrollHeight;
}

function _addMessage(list, role, content, isLoading = false) {
  const div = document.createElement('div');
  div.className = `cl-msg cl-msg-${role}`;
  div.style.cssText = `padding:8px 10px;border-radius:6px;font-size:13px;line-height:1.5;max-width:90%;${role==='user'?'align-self:flex-end;background:rgba(192,57,43,.15);margin-left:auto;':'align-self:flex-start;background:rgba(255,255,255,.04);'}`;

  if (isLoading) {
    div.textContent = '…';
  } else if (role === 'assistant') {
    div.innerHTML = _renderMarkdown(content);
  } else {
    div.textContent = content;
  }
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
  return div;
}

function _showKbResults(q, msgList) {
  const ql = q.toLowerCase();
  const results = _kb.filter(e => e.title.toLowerCase().includes(ql) || e.content.toLowerCase().includes(ql) || (e.tags||[]).some(t=>t.toLowerCase().includes(ql)));
  const div = document.createElement('div');
  div.style.cssText = 'background:rgba(255,255,255,.04);border:1px solid var(--border,#3a2a2a);border-radius:6px;padding:10px;font-size:12px;';
  if (results.length === 0) {
    div.textContent = `No KB entries found for "${q}".`;
  } else {
    div.innerHTML = `<strong>KB results for "${_esc(q)}":</strong><ul style="margin:6px 0 0;padding-left:16px;">` +
      results.slice(0, 5).map(e => `<li><strong>${_esc(e.title)}</strong> — ${_esc(e.content.slice(0,120))}${e.content.length>120?'…':''}</li>`).join('') +
      '</ul>';
  }
  msgList.appendChild(div);
  msgList.scrollTop = msgList.scrollHeight;
}

function _insertSnippet(cmd, inputEl) {
  const q = cmd.replace('/snip', '').trim().toLowerCase();
  const match = q ? _snippets.find(s => s.title.toLowerCase().includes(q) || s.command.toLowerCase().includes(q)) : null;
  if (match) {
    inputEl.value = match.command;
  } else {
    inputEl.value = '';
    const list = _snippets.slice(0, 5).map(s => `${s.title}: ${s.command.slice(0,60)}`).join('\n');
    alert(list ? `Available snippets:\n${list}` : 'No snippets saved yet.');
  }
}

function _handleSlashPreview(val) {
  // Minimal slash hint — full typeahead handled in palette.js
}

function _autoSurfaceKb(activeLab) {
  if (!activeLab || !activeLab.name) return [];
  const labName = activeLab.name.toLowerCase();
  const labTags = (activeLab.tags || []).map(t => t.toLowerCase());
  return _kb.filter(e => {
    const eTags = (e.tags || []).map(t => t.toLowerCase());
    return eTags.some(t => labTags.includes(t) || labName.includes(t)) || (e.linked_lab_id && e.linked_lab_id === activeLab.id);
  }).slice(0, 3);
}

function _renderMarkdown(text) {
  // Minimal markdown: code blocks, inline code, bold, italics, line breaks
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      return `<div style="position:relative"><pre class="cl-pre"><code>${code}</code></pre><button class="cl-btn cl-btn-ghost cl-copy-btn" onclick="navigator.clipboard.writeText(decodeURIComponent(atob('${btoa(encodeURIComponent(code.trim()))}')))">Copy</button></div>`;
    })
    .replace(/`([^`]+)`/g, '<code class="cl-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
