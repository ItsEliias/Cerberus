/**
 * CredVault — Standalone Password Generator Modal
 * Mirrors PasswordGeneratorModal.tsx.
 * Length slider, char-class toggles, live preview, strength meter, copy/use.
 */
import { generatePassword, scorePassword } from './password.js';

const ACCENT = '#c0392b';

/**
 * @param {HTMLElement} overlay
 * @param {((pw: string) => void)|null} onUse  — called when "Use in new credential" is clicked
 * @param {() => void} onClose
 */
export function renderGenerator(overlay, onUse, onClose) {
  let opts = { length: 20, upper: true, lower: true, digits: true, symbols: true, noAmbiguous: true };
  let pw    = '';
  let copied = false;

  function regen(o = opts) {
    pw = generatePassword(o);
    copied = false;
    updatePreview();
    updateStrength();
    updateCopyBtn();
  }

  function updatePreview() {
    const el = overlay.querySelector('#cv-gen-preview');
    if (el) el.textContent = pw || (noClassSelected() ? 'Select at least one character class.' : '…');
  }

  function updateStrength() {
    const { score, color, label } = scorePassword(pw);
    const bar = overlay.querySelector('#cv-gen-str-bar');
    const lbl = overlay.querySelector('#cv-gen-str-lbl');
    if (bar) { bar.style.width = score + '%'; bar.style.background = color; }
    if (lbl) { lbl.textContent = label; lbl.style.color = color; }
  }

  function updateCopyBtn() {
    const btn = overlay.querySelector('#cv-gen-copy');
    if (!btn) return;
    btn.textContent = copied ? 'Copied!' : 'Copy';
    btn.style.color = copied ? '#3fb950' : '';
  }

  function noClassSelected() {
    return !opts.upper && !opts.lower && !opts.digits && !opts.symbols;
  }

  overlay.innerHTML = `
    <div style="
      position:fixed;inset:0;background:rgba(5,6,12,.65);display:flex;align-items:center;
      justify-content:center;z-index:300;backdrop-filter:blur(4px);
    " id="cv-gen-backdrop">
      <div onclick="event.stopPropagation()" style="
        width:460px;max-width:calc(100vw - 40px);
        background:rgba(13,14,24,.98);border:1px solid rgba(42,51,71,.6);
        border-radius:14px;padding:22px;display:flex;flex-direction:column;gap:16px;
        box-shadow:0 24px 60px rgba(0,0,0,.55);
      ">
        <!-- Header -->
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:30px;height:30px;border-radius:8px;background:rgba(192,57,43,.12);color:${ACCENT};display:flex;align-items:center;justify-content:center;">↻</div>
          <div style="flex:1;min-width:0;">
            <span style="font-size:14px;color:#e6edf3;font-weight:700;display:block;">Password Generator</span>
            <span style="font-size:11px;color:#8b949e;">Strong, random, copy-ready.</span>
          </div>
          <button id="cv-gen-close" style="background:transparent;border:none;color:#6b7280;cursor:pointer;padding:6px;border-radius:6px;font-size:16px;">✕</button>
        </div>

        <!-- Preview -->
        <div style="background:rgba(7,8,15,.85);border:1px solid rgba(42,51,71,.55);border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:10px;min-height:56px;">
          <span id="cv-gen-preview" style="flex:1;font-family:monospace;font-size:14px;color:#e6edf3;word-break:break-all;user-select:all;">…</span>
          <button id="cv-gen-regen" title="Regenerate" style="background:transparent;border:1px solid rgba(42,51,71,.6);color:#8b949e;border-radius:6px;padding:5px 7px;cursor:pointer;">↻</button>
        </div>

        <!-- Strength -->
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="flex:1;height:4px;border-radius:99px;background:rgba(42,51,71,.45);overflow:hidden;">
            <div id="cv-gen-str-bar" style="height:100%;width:0%;background:#4a5568;transition:width .2s,background .2s;"></div>
          </div>
          <span id="cv-gen-str-lbl" style="font-size:11px;font-weight:600;min-width:72px;text-align:right;color:#4a5568;">—</span>
        </div>

        <!-- Length slider -->
        <div style="display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;font-weight:600;">Length</span>
            <span id="cv-gen-len-val" style="font-size:11px;color:#e6edf3;font-family:monospace;font-weight:600;">20</span>
          </div>
          <input type="range" id="cv-gen-len" min="8" max="64" step="1" value="20" style="width:100%;accent-color:${ACCENT};" />
        </div>

        <!-- Character classes -->
        <div style="display:flex;flex-direction:column;gap:8px;">
          <span style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;font-weight:600;">Character classes</span>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
            ${[['upper','A–Z uppercase'],['lower','a–z lowercase'],['digits','0–9 digits'],['symbols','!@#$ symbols']].map(([k,lbl]) => toggleBtn(k, lbl, opts[k])).join('')}
          </div>
          ${toggleBtn('noAmbiguous', 'Skip ambiguous chars (O 0 I l 1)', opts.noAmbiguous)}
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button id="cv-gen-copy" style="
            flex:1;padding:9px 14px;border-radius:8px;
            border:1px solid rgba(42,51,71,.6);background:rgba(13,14,24,.6);
            color:#e6edf3;font-size:12px;font-weight:600;cursor:pointer;
          ">Copy</button>
          ${onUse ? `
          <button id="cv-gen-use" style="
            flex:1;padding:9px 14px;border-radius:8px;
            border:1px solid rgba(192,57,43,.5);background:rgba(192,57,43,.9);
            color:#0a0a0f;font-size:12px;font-weight:700;cursor:pointer;
          ">Use in new credential</button>` : ''}
        </div>
      </div>
    </div>
  `;

  // Wire events
  overlay.querySelector('#cv-gen-backdrop').addEventListener('click', onClose);
  overlay.querySelector('#cv-gen-close').addEventListener('click', onClose);

  overlay.querySelector('#cv-gen-regen').addEventListener('click', () => regen());

  overlay.querySelector('#cv-gen-len').addEventListener('input', e => {
    opts.length = parseInt(e.target.value, 10);
    overlay.querySelector('#cv-gen-len-val').textContent = opts.length;
    regen();
  });

  overlay.querySelectorAll('.cv-gen-toggle').forEach(btn =>
    btn.addEventListener('click', () => {
      opts[btn.dataset.key] = !opts[btn.dataset.key];
      updateToggleStyle(btn, opts[btn.dataset.key]);
      regen();
    })
  );

  overlay.querySelector('#cv-gen-copy')?.addEventListener('click', async () => {
    if (!pw) return;
    try {
      await navigator.clipboard.writeText(pw);
      copied = true;
      updateCopyBtn();
      setTimeout(() => { copied = false; updateCopyBtn(); }, 1500);
    } catch {}
  });

  overlay.querySelector('#cv-gen-use')?.addEventListener('click', () => {
    if (pw && onUse) { onUse(pw); onClose(); }
  });

  regen(opts);
}

function toggleBtn(key, label, active) {
  return `
    <button class="cv-gen-toggle" data-key="${key}" style="
      display:flex;align-items:center;gap:8px;padding:8px 10px;
      background:${active ? 'rgba(192,57,43,.08)' : 'rgba(13,14,24,.55)'};
      border:1px solid ${active ? 'rgba(192,57,43,.35)' : 'rgba(42,51,71,.45)'};
      border-radius:8px;cursor:pointer;color:${active ? '#e6edf3' : '#8b949e'};
      font-size:12px;font-weight:500;text-align:left;min-width:0;flex:1;
      transition:border-color .15s,background .15s,color .15s;
    ">
      <span style="
        width:14px;height:14px;border-radius:4px;flex-shrink:0;
        background:${active ? '#c0392b' : 'transparent'};
        border:1px solid ${active ? '#c0392b' : 'rgba(139,148,158,.4)'};
        display:flex;align-items:center;justify-content:center;font-size:9px;
      ">${active ? '✓' : ''}</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${label}</span>
    </button>
  `;
}

function updateToggleStyle(btn, active) {
  btn.style.background = active ? 'rgba(192,57,43,.08)' : 'rgba(13,14,24,.55)';
  btn.style.border     = active ? '1px solid rgba(192,57,43,.35)' : '1px solid rgba(42,51,71,.45)';
  btn.style.color      = active ? '#e6edf3' : '#8b949e';
  const box = btn.querySelector('span');
  if (box) {
    box.style.background = active ? '#c0392b' : 'transparent';
    box.style.border     = active ? '1px solid #c0392b' : '1px solid rgba(139,148,158,.4)';
    box.textContent      = active ? '✓' : '';
  }
}
