/**
 * assistant.js — ASSISTANT sub-tab.
 *
 * Slim chat box that posts to /api/chat_stream (Cerberus native SSE endpoint).
 * System prompt scoped to "Cerberus operations assistant".
 * Maintains message history in module-level state (cleared on destroy).
 */

const SYSTEM_PROMPT = 'You are the Cerberus operations assistant. Answer concisely about the Cerberus system state, tasks, agents, and operations. Be direct and informative.';
const API = '/api/chat_stream';

let _messages = [];  // {role, content}[]
let _streaming = false;
let _abortCtrl = null;

export function buildAssistantTab() {
  return `<div class="cc-assistant-tab">
    <div class="cc-chat-history" id="cc-chat-history">
      <div class="cc-empty" style="margin-top:32px;">
        Cerberus Operations Assistant ready. Ask about tasks, agents, or system state.
      </div>
    </div>
    <div id="cc-chat-typing" class="cc-chat-typing" style="display:none;padding:0 16px 4px;">Thinking...</div>
    <div class="cc-chat-input-row">
      <textarea class="cc-chat-input" id="cc-chat-input"
        placeholder="Ask the operations assistant..." rows="1"></textarea>
      <button class="cc-chat-send-btn" id="cc-chat-send">SEND</button>
    </div>
  </div>`;
}

export function initAssistant(root) {
  const input = root.querySelector('#cc-chat-input');
  const btn   = root.querySelector('#cc-chat-send');
  if (!input || !btn) return;

  const send = () => {
    const text = (input.value || '').trim();
    if (!text || _streaming) return;
    input.value = '';
    _sendMessage(root, text);
  };

  btn.addEventListener('click', send);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
}

export function destroyAssistant() {
  if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
  _messages = [];
  _streaming = false;
}

async function _sendMessage(root, text) {
  _messages.push({ role: 'user', content: text });
  _renderMessages(root);
  _setStreaming(root, true);

  const history = root.querySelector('#cc-chat-history');
  // Append assistant bubble placeholder
  const bubble = document.createElement('div');
  bubble.className = 'cc-chat-msg assistant';
  bubble.innerHTML = '<div class="cc-chat-role">Assistant</div><div class="cc-chat-bubble"></div>';
  if (history) history.appendChild(bubble);
  const bText = bubble.querySelector('.cc-chat-bubble');

  let assembled = '';
  _abortCtrl = new AbortController();

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: _messages,
        system: SYSTEM_PROMPT,
        stream: true,
      }),
      signal: _abortCtrl.signal,
    });

    if (!res.ok) {
      // Fallback to non-streaming
      const err = await res.text();
      assembled = `Error: ${err}`;
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') break;
            try {
              const j = JSON.parse(raw);
              const token = j.choices?.[0]?.delta?.content || j.text || j.token || '';
              assembled += token;
              if (bText) bText.textContent = assembled;
              if (history) history.scrollTop = history.scrollHeight;
            } catch (_) {}
          }
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      assembled = assembled || '(cancelled)';
    } else {
      assembled = `Error: ${String(e)}`;
    }
  }

  if (bText) bText.textContent = assembled || '(no response)';
  _messages.push({ role: 'assistant', content: assembled || '' });
  _setStreaming(root, false);
  if (history) history.scrollTop = history.scrollHeight;
}

function _renderMessages(root) {
  const h = root.querySelector('#cc-chat-history');
  if (!h) return;
  h.innerHTML = _messages.map(m => `
    <div class="cc-chat-msg ${m.role}">
      <div class="cc-chat-role">${m.role === 'user' ? 'You' : 'Assistant'}</div>
      <div class="cc-chat-bubble">${_esc(m.content)}</div>
    </div>`).join('');
  h.scrollTop = h.scrollHeight;
}

function _setStreaming(root, val) {
  _streaming = val;
  const btn     = root.querySelector('#cc-chat-send');
  const typing  = root.querySelector('#cc-chat-typing');
  if (btn)    btn.disabled = val;
  if (typing) typing.style.display = val ? 'block' : 'none';
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s || '');
  return d.innerHTML;
}
