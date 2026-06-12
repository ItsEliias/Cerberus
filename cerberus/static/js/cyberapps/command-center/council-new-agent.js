/**
 * council-new-agent.js — "New Agent" modal for the Council panel.
 *
 * Exported: openNewAgentModal(root, onCreated)
 */

const AGENTS_API = '/api/agents';

/**
 * Open the new-agent creation modal.
 * @param {Element} root      - Council root element
 * @param {Function} onCreated - Callback fired after successful creation
 */
export function openNewAgentModal(root, onCreated) {
  const overlay = root.querySelector('#cc-new-agent-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="cc-overlay-panel" style="max-width:560px;">
      <div class="cc-overlay-header">
        <span class="cc-overlay-title">NEW AGENT</span>
        <button class="cc-overlay-close" id="cc-na-close">&times;</button>
      </div>
      <div class="cc-overlay-body">
        <label class="cc-na-field"><span>NAME</span>
          <input id="cc-na-name" type="text" placeholder="e.g. devops" autocomplete="off"/></label>
        <label class="cc-na-field"><span>ROLE</span>
          <input id="cc-na-role" type="text" placeholder="e.g. coder / architect / custom"/></label>
        <label class="cc-na-field"><span>AGENT TYPE</span>
          <input id="cc-na-type" type="text" placeholder="e.g. backend-dev"/></label>
        <label class="cc-na-field"><span>MODEL ALIAS</span>
          <select id="cc-na-model">
            <option value="sonnet">sonnet</option>
            <option value="opus">opus</option>
            <option value="haiku">haiku</option>
            <option value="fable">fable</option>
          </select></label>
        <label class="cc-na-field"><span>SYSTEM PROMPT</span>
          <textarea id="cc-na-prompt" rows="5" placeholder="You are an expert ..."></textarea></label>
        <div id="cc-na-err" class="cc-na-err" style="display:none"></div>
      </div>
      <div class="cc-overlay-footer">
        <button class="cc-action-cancel" id="cc-na-cancel">CANCEL</button>
        <button class="cc-action-save"   id="cc-na-create">CREATE</button>
      </div>
    </div>`;

  const close = () => { overlay.style.display = 'none'; overlay.innerHTML = ''; };
  overlay.querySelector('#cc-na-close').addEventListener('click', close);
  overlay.querySelector('#cc-na-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#cc-na-create').addEventListener('click', async () => {
    const name   = overlay.querySelector('#cc-na-name').value.trim();
    const role   = overlay.querySelector('#cc-na-role').value.trim() || 'custom';
    const atype  = overlay.querySelector('#cc-na-type').value.trim() || role;
    const model  = overlay.querySelector('#cc-na-model').value;
    const prompt = overlay.querySelector('#cc-na-prompt').value.trim()
                || `You are ${name || 'an agent'}, a ${role} persona on the Cerberus council.`;
    const err    = overlay.querySelector('#cc-na-err');
    err.style.display = 'none';
    if (!name) { err.textContent = 'Name is required.'; err.style.display = 'block'; return; }
    try {
      const res = await fetch(AGENTS_API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, agent_type: atype, model_alias: model, system_prompt: prompt, status: 'idle' }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => `HTTP ${res.status}`);
        err.textContent = res.status === 409 ? 'Agent name already exists.' : t;
        err.style.display = 'block';
        return;
      }
      close();
      if (typeof onCreated === 'function') onCreated();
    } catch (e) {
      err.textContent = String(e);
      err.style.display = 'block';
    }
  });
}
