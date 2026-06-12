/**
 * council-round-table.js — Phase E4 Round-Table multi-agent meeting modal.
 *
 * Exports:
 *   openRoundTableModal(root)             — setup modal → convene → live view
 *   openMeetingView(root, meetingId)      — replay a persisted meeting (read-only)
 */

import { getGlyph } from './council-glyphs.js';

const COUNCIL_API   = '/api/council';
const AGENTS_API    = '/api/agents';

const _reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

// -- Setup modal (Stage 1) --

export async function openRoundTableModal(root) {
  // Load agents first
  let agents = [];
  try {
    const res = await fetch(AGENTS_API, { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      agents = data.agents || [];
    }
  } catch (_) { /* proceed with empty list */ }

  const overlay = _createOverlay();
  overlay.innerHTML = _setupModalHtml(agents);
  document.body.appendChild(overlay);

  _wireSetupModal(overlay, agents, root);
}

function _setupModalHtml(agents) {
  const chipHtml = agents.map(a => `
    <button class="cc-rt-chip" data-agent-id="${_esc(a.id)}" data-agent-name="${_esc(a.name)}">
      <span class="cc-rt-chip-check">&#10003;</span>
      ${_esc(a.name)}
      <span style="opacity:0.4;font-size:8px">${_esc(a.role)}</span>
    </button>`).join('');

  const roundBtns = [1, 2, 3, 4].map(n =>
    `<button class="cc-rt-round-btn${n === 2 ? ' selected' : ''}" data-rounds="${n}">${n}</button>`
  ).join('');

  return `
    <div class="cc-rt-modal-panel" role="dialog" aria-modal="true" aria-label="Round Table Setup">
      <div class="cc-rt-header">
        <span class="cc-rt-title">ROUND TABLE</span>
        <button class="cc-rt-close-btn" id="cc-rt-close">[ X ]</button>
      </div>
      <div class="cc-rt-body">
        <div>
          <div class="cc-rt-section-label">ATTENDEES <span id="cc-rt-sel-count" style="opacity:0.6">(0 selected)</span></div>
          <div class="cc-rt-attendees" id="cc-rt-chips">${chipHtml || '<span style="opacity:0.3;font-size:10px">No agents found.</span>'}</div>
        </div>
        <div>
          <div class="cc-rt-section-label">ROUNDS</div>
          <div class="cc-rt-rounds" id="cc-rt-rounds">${roundBtns}</div>
        </div>
        <div>
          <div class="cc-rt-section-label">TOPIC</div>
          <textarea class="cc-rt-topic" id="cc-rt-topic" rows="3" placeholder="Enter the topic or question for the council to discuss..."></textarea>
        </div>
      </div>
      <div class="cc-rt-footer">
        <div style="position:relative">
          <button class="cc-rt-past-btn" id="cc-rt-past-btn">PAST MEETINGS &#9660;</button>
          <div class="cc-rt-past-list" id="cc-rt-past-list" style="display:none"></div>
        </div>
        <div class="cc-rt-footer-spacer"></div>
        <button class="cc-rt-cancel-btn" id="cc-rt-cancel">[ CANCEL ]</button>
        <button class="cc-rt-convene-btn" id="cc-rt-convene" disabled>[ CONVENE ]</button>
      </div>
    </div>`;
}

function _wireSetupModal(overlay, agents, root) {
  const panel = overlay.querySelector('.cc-rt-modal-panel');
  const close = () => overlay.remove();

  overlay.querySelector('#cc-rt-close').addEventListener('click', close);
  overlay.querySelector('#cc-rt-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Attendee chips
  let selected = new Set();
  const countEl = overlay.querySelector('#cc-rt-sel-count');
  const conveneBtn = overlay.querySelector('#cc-rt-convene');

  function _updateCount() {
    countEl.textContent = `(${selected.size} selected)`;
    conveneBtn.disabled = selected.size === 0;
  }

  overlay.querySelector('#cc-rt-chips').addEventListener('click', e => {
    const chip = e.target.closest('.cc-rt-chip');
    if (!chip) return;
    const id = chip.dataset.agentId;
    if (selected.has(id)) { selected.delete(id); chip.classList.remove('selected'); }
    else { selected.add(id); chip.classList.add('selected'); }
    _updateCount();
  });

  // Rounds selection
  let chosenRounds = 2;
  overlay.querySelector('#cc-rt-rounds').addEventListener('click', e => {
    const btn = e.target.closest('.cc-rt-round-btn');
    if (!btn) return;
    chosenRounds = parseInt(btn.dataset.rounds, 10);
    overlay.querySelectorAll('.cc-rt-round-btn').forEach(b =>
      b.classList.toggle('selected', b === btn));
  });

  // Past meetings dropdown
  const pastBtn  = overlay.querySelector('#cc-rt-past-btn');
  const pastList = overlay.querySelector('#cc-rt-past-list');
  pastBtn.addEventListener('click', async () => {
    if (pastList.style.display !== 'none') { pastList.style.display = 'none'; return; }
    pastList.innerHTML = '<div class="cc-rt-past-empty">Loading...</div>';
    pastList.style.display = 'block';
    try {
      const res = await fetch(`${COUNCIL_API}/meetings?limit=20`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const meetings = data.meetings || [];
      if (meetings.length === 0) {
        pastList.innerHTML = '<div class="cc-rt-past-empty">No past meetings.</div>';
      } else {
        pastList.innerHTML = meetings.map(m => {
          const d = m.created_at ? new Date(m.created_at).toLocaleDateString() : '';
          let agentCount = 0;
          try { agentCount = JSON.parse(m.agent_ids || '[]').length; } catch (_) {}
          return `<div class="cc-rt-past-item" data-meeting-id="${_esc(m.id)}">
            <span class="cc-rt-past-item-title">${_esc(m.title || m.prompt || '(untitled)')}</span>
            <span class="cc-rt-past-item-meta">${_esc(d)} &middot; ${agentCount} agents &middot; ${m.rounds} rounds</span>
          </div>`;
        }).join('');
        pastList.querySelectorAll('.cc-rt-past-item').forEach(item => {
          item.addEventListener('click', () => {
            overlay.remove();
            openMeetingView(root, item.dataset.meetingId);
          });
        });
      }
    } catch (err) {
      pastList.innerHTML = `<div class="cc-rt-past-empty">Error: ${_esc(err.message)}</div>`;
    }
  });

  // Close past list on outside click
  document.addEventListener('click', function onDoc(e) {
    if (!pastBtn.contains(e.target) && !pastList.contains(e.target)) {
      pastList.style.display = 'none';
      document.removeEventListener('click', onDoc);
    }
  });

  // Convene
  conveneBtn.addEventListener('click', async () => {
    const topic = (overlay.querySelector('#cc-rt-topic').value || '').trim();
    if (!topic) {
      overlay.querySelector('#cc-rt-topic').focus();
      return;
    }
    const agentIds = [...selected];
    const orderedAgents = agentIds
      .map(id => agents.find(a => a.id === id))
      .filter(Boolean);
    overlay.remove();
    _openLiveView(root, null, orderedAgents, topic, chosenRounds, null);
  });
}

// -- Live transcript view (Stage 2) --

function _openLiveView(root, existingMeetingId, orderedAgents, prompt, rounds, followUpTo) {
  const overlay = _createOverlay();
  const agentIds = orderedAgents.map(a => a.id);
  const attendingStr = orderedAgents.map(a => a.name).join(' · ');

  overlay.innerHTML = `
    <div class="cc-rt-modal-panel" role="dialog" aria-modal="true" aria-label="Round Table — Live">
      <div class="cc-rt-header">
        <span class="cc-rt-title">ROUND TABLE &mdash; ${_esc(prompt.slice(0, 48))}</span>
        <button class="cc-rt-close-btn" id="cc-rt-close">[ X ]</button>
      </div>
      <div class="cc-rt-attending-bar" style="padding:8px 16px 0">
        ATTENDING: ${_esc(attendingStr)}
      </div>
      <div class="cc-rt-body" id="cc-rt-live-body">
        <div class="cc-rt-transcript" id="cc-rt-transcript"></div>
      </div>
      <div class="cc-rt-status-bar" id="cc-rt-status-bar" style="display:none">
        <span class="cc-rt-status-dot"></span>
        <span id="cc-rt-status-text">Convening...</span>
      </div>
      <div class="cc-rt-footer" id="cc-rt-live-footer">
        <div class="cc-rt-footer-spacer"></div>
        <button class="cc-rt-ask-followup-btn" id="cc-rt-ask-followup" disabled>[ ASK FOLLOW-UP ]</button>
        <button class="cc-rt-cancel-btn" id="cc-rt-close-live">[ CLOSE ]</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const transcript = overlay.querySelector('#cc-rt-transcript');
  const statusBar  = overlay.querySelector('#cc-rt-status-bar');
  const statusText = overlay.querySelector('#cc-rt-status-text');
  const followBtn  = overlay.querySelector('#cc-rt-ask-followup');

  overlay.querySelector('#cc-rt-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cc-rt-close-live').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  let completedMeetingId = existingMeetingId;

  followBtn.addEventListener('click', () => {
    if (!completedMeetingId) return;
    _openFollowUpInput(overlay, orderedAgents, rounds, completedMeetingId, root);
  });

  // State: track current streaming turn element
  let currentTurnEl = null;
  let currentRoundEl = null;
  let currentRound = 0;

  function _ensureRound(r) {
    if (r === currentRound) return;
    currentRound = r;
    currentTurnEl = null;
    const div = document.createElement('div');
    div.className = 'cc-rt-round';
    div.dataset.round = r;
    div.innerHTML = `<div class="cc-rt-round-label">ROUND ${r}</div>`;
    transcript.appendChild(div);
    currentRoundEl = div;
  }

  function _startTurn(round, agentId, agentName) {
    _ensureRound(round);
    const agent = orderedAgents.find(a => a.id === agentId) || { name: agentName, role: '' };
    const glyph = getGlyph(agent.name);
    const turn = document.createElement('div');
    turn.className = 'cc-rt-turn streaming';
    turn.dataset.agentId = agentId;
    turn.innerHTML = `
      <div class="cc-rt-turn-glyph">${glyph}</div>
      <div class="cc-rt-turn-body">
        <div class="cc-rt-turn-header">
          <span class="cc-rt-turn-name">${_esc(agent.name)}</span>
          <span class="cc-rt-turn-role">${_esc(agent.role)}</span>
        </div>
        <div class="cc-rt-turn-content" id="cc-rt-content-${_esc(agentId)}"></div>
      </div>`;
    currentRoundEl.appendChild(turn);
    currentTurnEl = turn;
    if (!_reduced()) {
      const cursor = document.createElement('span');
      cursor.className = 'cc-rt-cursor';
      turn.querySelector('.cc-rt-turn-content').appendChild(cursor);
    }
    _scrollToBottom();
  }

  function _appendToken(agentId, delta) {
    const contentEl = overlay.querySelector(`#cc-rt-content-${agentId}`);
    if (!contentEl) return;
    const cursor = contentEl.querySelector('.cc-rt-cursor');
    if (cursor) {
      cursor.before(document.createTextNode(delta));
    } else {
      contentEl.appendChild(document.createTextNode(delta));
    }
    _scrollToBottom();
  }

  function _endTurn(agentId, fullContent) {
    const contentEl = overlay.querySelector(`#cc-rt-content-${agentId}`);
    if (contentEl) {
      const cursor = contentEl.querySelector('.cc-rt-cursor');
      if (cursor) cursor.remove();
      // Ensure full content is set in case streaming missed tokens
      if (contentEl.textContent.trim() === '' && fullContent) {
        contentEl.textContent = fullContent;
      }
    }
    if (currentTurnEl) currentTurnEl.classList.remove('streaming');
  }

  function _scrollToBottom() {
    const body = overlay.querySelector('#cc-rt-live-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  // Start SSE stream
  statusBar.style.display = 'flex';
  statusText.textContent = 'Connecting...';

  fetch(`${COUNCIL_API}/meeting`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, agent_ids: agentIds, rounds, follow_up_to: followUpTo }),
  }).then(async res => {
    if (!res.ok) {
      const txt = await res.text();
      statusText.textContent = `Error ${res.status}: ${txt}`;
      return;
    }
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
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === 'meeting_start') {
            completedMeetingId = evt.meeting_id;
            statusText.textContent = 'Meeting in progress...';
          } else if (evt.type === 'agent_start') {
            statusText.textContent = `Round ${evt.round} — ${evt.agent_name} speaking...`;
            _startTurn(evt.round, evt.agent_id, evt.agent_name);
          } else if (evt.type === 'token') {
            _appendToken(evt.agent_id, evt.delta);
          } else if (evt.type === 'agent_end') {
            _endTurn(evt.agent_id, evt.full_content);
          } else if (evt.type === 'meeting_end') {
            statusBar.style.display = 'none';
            followBtn.disabled = false;
          } else if (evt.type === 'error') {
            statusText.textContent = `Error: ${evt.message || 'Unknown error'}`;
          }
        } catch (_) { /* non-JSON lines */ }
      }
    }
    statusBar.style.display = 'none';
    followBtn.disabled = !completedMeetingId;
  }).catch(err => {
    statusText.textContent = `Stream error: ${err.message}`;
  });
}

// -- Follow-up input --

function _openFollowUpInput(overlay, orderedAgents, rounds, meetingId, root) {
  const footer = overlay.querySelector('#cc-rt-live-footer');
  footer.innerHTML = `
    <div class="cc-rt-followup-row" style="width:100%;padding:0">
      <textarea class="cc-rt-followup-input" id="cc-rt-followup-text" rows="2"
        placeholder="Ask a follow-up question..."></textarea>
      <button class="cc-rt-followup-send-btn" id="cc-rt-followup-send">[ SEND ]</button>
      <button class="cc-rt-cancel-btn" id="cc-rt-followup-cancel">[ CANCEL ]</button>
    </div>`;

  footer.querySelector('#cc-rt-followup-cancel').addEventListener('click', () => {
    footer.innerHTML = `
      <div class="cc-rt-footer-spacer"></div>
      <button class="cc-rt-ask-followup-btn" id="cc-rt-ask-followup">[ ASK FOLLOW-UP ]</button>
      <button class="cc-rt-cancel-btn" id="cc-rt-close-live">[ CLOSE ]</button>`;
    footer.querySelector('#cc-rt-ask-followup').addEventListener('click', () =>
      _openFollowUpInput(overlay, orderedAgents, rounds, meetingId, root));
    footer.querySelector('#cc-rt-close-live').addEventListener('click', () => overlay.remove());
  });

  footer.querySelector('#cc-rt-followup-send').addEventListener('click', () => {
    const topic = (footer.querySelector('#cc-rt-followup-text').value || '').trim();
    if (!topic) return;
    overlay.remove();
    _openLiveView(root, null, orderedAgents, topic, rounds, meetingId);
  });

  const ta = footer.querySelector('#cc-rt-followup-text');
  ta.focus();
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      footer.querySelector('#cc-rt-followup-send').click();
    }
  });
}

// -- openMeetingView: replay a persisted meeting (read-only) --

export async function openMeetingView(root, meetingId) {
  const overlay = _createOverlay();
  overlay.innerHTML = `
    <div class="cc-rt-modal-panel" role="dialog" aria-modal="true" aria-label="Past Meeting">
      <div class="cc-rt-header">
        <span class="cc-rt-title">PAST MEETING</span>
        <button class="cc-rt-close-btn" id="cc-rt-close">[ X ]</button>
      </div>
      <div class="cc-rt-body" id="cc-rt-replay-body">
        <div style="opacity:0.4;font-size:11px">Loading...</div>
      </div>
      <div class="cc-rt-footer">
        <div class="cc-rt-footer-spacer"></div>
        <button class="cc-rt-cancel-btn" id="cc-rt-close-replay">[ CLOSE ]</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#cc-rt-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cc-rt-close-replay').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  try {
    const res = await fetch(`${COUNCIL_API}/meetings/${encodeURIComponent(meetingId)}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const meeting = await res.json();

    let transcript = [];
    try { transcript = JSON.parse(meeting.transcript || '[]'); } catch (_) {}
    let agentIds = [];
    try { agentIds = JSON.parse(meeting.agent_ids || '[]'); } catch (_) {}

    // Load agents to get names/roles
    let agentMap = {};
    try {
      const ar = await fetch(AGENTS_API, { credentials: 'same-origin' });
      if (ar.ok) {
        const ad = await ar.json();
        (ad.agents || []).forEach(a => { agentMap[a.id] = a; });
      }
    } catch (_) {}

    const titleEl = overlay.querySelector('.cc-rt-title');
    titleEl.textContent = `PAST MEETING — ${(meeting.title || meeting.prompt || '').slice(0, 48)}`;

    const body = overlay.querySelector('#cc-rt-replay-body');

    const d = meeting.created_at ? new Date(meeting.created_at).toLocaleDateString() : '';
    body.innerHTML = `
      <div class="cc-rt-attending-bar" style="margin-bottom:8px">
        ${_esc(d ? `${d} &middot; ` : '')}${agentIds.length} agents &middot; ${meeting.rounds} rounds
      </div>
      <div class="cc-rt-transcript" id="cc-rt-replay-transcript"></div>`;

    // Group turns by round
    const byRound = {};
    transcript.forEach(turn => {
      const r = turn.round || 1;
      if (!byRound[r]) byRound[r] = [];
      byRound[r].push(turn);
    });

    const transcriptEl = body.querySelector('#cc-rt-replay-transcript');
    Object.keys(byRound).sort((a, b) => a - b).forEach(r => {
      const roundDiv = document.createElement('div');
      roundDiv.className = 'cc-rt-round';
      roundDiv.innerHTML = `<div class="cc-rt-round-label">ROUND ${_esc(r)}</div>`;
      byRound[r].forEach(turn => {
        const agent = agentMap[turn.agent_id] || { name: turn.agent_name || '?', role: '' };
        const glyph = getGlyph(agent.name);
        const turnDiv = document.createElement('div');
        turnDiv.className = 'cc-rt-turn';
        turnDiv.innerHTML = `
          <div class="cc-rt-turn-glyph">${glyph}</div>
          <div class="cc-rt-turn-body">
            <div class="cc-rt-turn-header">
              <span class="cc-rt-turn-name">${_esc(agent.name)}</span>
              <span class="cc-rt-turn-role">${_esc(agent.role)}</span>
            </div>
            <div class="cc-rt-turn-content">${_esc(turn.content || '')}</div>
          </div>`;
        roundDiv.appendChild(turnDiv);
      });
      transcriptEl.appendChild(roundDiv);
    });
  } catch (err) {
    const body = overlay.querySelector('#cc-rt-replay-body');
    body.innerHTML = `<div style="color:#e74c3c;font-size:11px">Failed to load meeting: ${_esc(err.message)}</div>`;
  }
}

// -- Shared helpers --

function _createOverlay() {
  const el = document.createElement('div');
  el.className = 'cc-rt-modal-overlay';
  return el;
}
