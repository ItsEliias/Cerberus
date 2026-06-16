/**
 * CerberusOS static consistency checks — no server needed.
 *
 * Verifies that:
 *  1. index.html contains all DOM element IDs that JS files reference via getElementById
 *  2. CSS classes created in JS templates exist in CSS (for critical node/modal classes)
 *  3. No `data-atlas-*-close` attributes remain in the JS (close button mismatches)
 *  4. Named ES module imports resolve to actual exports
 *
 * Run: node tests/cerberus-static-check.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT  = new URL('..', import.meta.url).pathname;
const JS    = join(ROOT, 'static/js');
const CSS   = join(ROOT, 'static/css');
const HTML  = join(ROOT, 'static/index.html');

// ── helpers ──────────────────────────────────────────────────────────────────
const red   = s => `\x1b[31m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const bold  = s => `\x1b[1m${s}\x1b[0m`;

let pass = 0, fail = 0;
function ok(label)  { console.log(green('  ✓'), label); pass++; }
function bad(label) { console.log(red('  ✗'), label);   fail++; }

// ── load files ───────────────────────────────────────────────────────────────
const html   = readFileSync(HTML, 'utf8');
const jsFiles = readdirSync(JS).filter(f => f.endsWith('.js'));

const allJs  = jsFiles.map(f => ({ name: f, src: readFileSync(join(JS, f), 'utf8') }));
const cssText = readdirSync(CSS)
  .filter(f => f.endsWith('.css'))
  .map(f => readFileSync(join(CSS, f), 'utf8'))
  .join('\n');

// ── 1. DOM IDs referenced in JS must exist in index.html ─────────────────────
console.log(bold('\n1. DOM ID coverage (getElementById calls in JS)'));
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

const SKIP_IDS = new Set([
  // Overlay tools manage their own element injection
  'tasks-modal', 'notes-pane', 'library-modal', 'calendar-modal',
  'cookbook-modal', 'settings-modal',
  // Voice modal — full-screen voice settings overlay (separate from cheat sheet)
  'cerberus-voice-modal',
  // Voice settings inside home — populated dynamically
  'cerberus-home-stt-mode', 'cerberus-home-tts-voice',
  // Project context bar — optional UI strip, absent = no-op
  'cerberus-project-context-bar', 'cerberus-project-context-label', 'cerberus-project-context-clear',
  // Desktop apps elements managed by companion bridge
  'cerberus-cursor-fx', 'cerberus-desktop-apps-modal', 'cerberus-desktop-apps-body', 'cerberus-desktop-apps-summary',
  // Launcher settings — injected dynamically by cerberusLauncherSettings
  'cerberus-launcher-settings-panel', 'cerberus-launcher-add-btn', 'cerberus-launcher-apps-list',
  'cerberus-launcher-bridge-status', 'cerberus-launcher-cancel-btn', 'cerberus-launcher-form-aliases',
  'cerberus-launcher-form-args', 'cerberus-launcher-form-enabled', 'cerberus-launcher-form-id',
  'cerberus-launcher-form-name', 'cerberus-launcher-form-path', 'cerberus-launcher-form-title',
  'cerberus-launcher-form-workdir', 'cerberus-launcher-save-btn',
  // Brain sections injected by _buildBrainSections()
  'cerberus-brain-memory-preview', 'cerberus-brain-open-memory', 'cerberus-brain-reports-content',
  // Project context modal — injected by cerberusProjectContext
  'cerberus-project-context-modal', 'cerberus-pctx-title', 'cerberus-pctx-path',
  'cerberus-pctx-stack', 'cerberus-pctx-indexed', 'cerberus-pctx-potential',
  'cerberus-pctx-direction', 'cerberus-pctx-finance', 'cerberus-pctx-changes',
  'cerberus-pctx-files', 'cerberus-pctx-reports', 'cerberus-pctx-pin',
  // Offices create form — injected by officesModal
  'cerberus-offices-create-inline', 'cerberus-offices-create-list',
  // atlasActiveProject.js is the OLD unused file (cerberusActiveProject.js is the live one)
  'atlas-project-context-bar', 'atlas-project-context-label', 'atlas-project-context-clear',
  // cerberus-hq-desktop-open-settings — optional desktop control from home.js
  'cerberus-hq-desktop-open-settings', 'cerberus-hq-desktop-view-apps',
  // Voice modal children — all live inside cerberus-voice-modal which is injected dynamically
  'cerberus-voice-auto-submit', 'cerberus-voice-conversation-note', 'cerberus-voice-debug',
  'cerberus-voice-debug-force-cmd', 'cerberus-voice-debug-msg', 'cerberus-voice-debug-simulate-wake',
  'cerberus-voice-debug-test', 'cerberus-voice-desktop-status', 'cerberus-voice-fallback-whisper',
  'cerberus-voice-mic-indicator', 'cerberus-voice-privacy-browser', 'cerberus-voice-privacy-whisper',
  'cerberus-voice-ptt-btn', 'cerberus-voice-settings-interrupt', 'cerberus-voice-settings-style',
  'cerberus-voice-speak-replies', 'cerberus-voice-start-btn', 'cerberus-voice-status',
  'cerberus-voice-stop-btn', 'cerberus-voice-stt-mode', 'cerberus-voice-submit-btn',
  'cerberus-voice-switch-whisper', 'cerberus-voice-transcript', 'cerberus-voice-tts-hint',
  'cerberus-voice-tts-pitch', 'cerberus-voice-tts-rate', 'cerberus-voice-tts-test',
  'cerberus-voice-tts-voice', 'cerberus-voice-wake-indicator', 'cerberus-voice-wake-mode',
  'cerberus-voice-wake-phrases', 'cerberus-voice-wake-whisper-note', 'cerberus-voice-whisper-setup',
  // Storage settings — inside the settings modal tab, rendered dynamically by cerberusStorageSettings.js
  'cerberus-settings-storage-backup', 'cerberus-settings-storage-bootstrap',
  'cerberus-settings-storage-browse', 'cerberus-settings-storage-default-mode',
  'cerberus-settings-storage-export', 'cerberus-settings-storage-import',
  'cerberus-settings-storage-mounted', 'cerberus-settings-storage-open-folder',
  'cerberus-settings-storage-path', 'cerberus-settings-storage-path-input',
  'cerberus-settings-storage-save-path',
  // Projects empty-state buttons — created in JS template by cerberusProjects.js
  'cerberus-projects-empty-create', 'cerberus-projects-empty-import',
  // Optional sidebar nav buttons — null-guarded in home.js (_setNavActive)
  'sidebar-home-btn', 'sidebar-assistant-btn',
  // Optional overflow toolbar button — null-guarded in chat.js
  'overflow-research-btn',
  // Reasoning audit trigger buttons — optional, wired via ?. in cerberusReasoningAudit.js
  'cerberus-run-reasoning-audit', 'cerberus-run-reasoning-audit-settings',
]);

const missingIds = new Map(); // id → [files that reference it]
for (const { name, src } of allJs) {
  for (const m of src.matchAll(/_el\(['"]([^'"]+)['"]\)/g)) {
    const id = m[1];
    if (SKIP_IDS.has(id)) continue;
    if (!htmlIds.has(id)) {
      if (!missingIds.has(id)) missingIds.set(id, []);
      missingIds.get(id).push(name);
    }
  }
}

if (missingIds.size === 0) {
  ok('All getElementById references found in index.html');
} else {
  // Deduplicate and sort
  for (const [id, files] of [...missingIds.entries()].sort()) {
    const uniq = [...new Set(files)].join(', ');
    bad(`#${id}  ← missing in HTML  (${uniq})`);
  }
}

// ── 2. No data-atlas-*-close attributes left in JS ────────────────────────────
console.log(bold('\n2. data-atlas-*-close mismatch check'));
let foundAtlasClose = false;
for (const { name, src } of allJs) {
  const hits = [...src.matchAll(/\[data-atlas-[a-z-]+-close\]/g)];
  if (hits.length) {
    hits.forEach(h => bad(`${name}: ${h[0]}`));
    foundAtlasClose = true;
  }
}
if (!foundAtlasClose) ok('No data-atlas-*-close selectors in JS');

// ── 3. cerberus-os-node-wrap (NOT atlas-os-node-wrap) created in templates ──
console.log(bold('\n3. Node element class name check'));
const graphSrc = allJs.find(f => f.name === 'cerberusGraph.js')?.src || '';
const nodeWraps = [...graphSrc.matchAll(/className\s*=\s*['"][^'"]*node-wrap[^'"]*['"]/g)].map(m => m[0]);
for (const n of nodeWraps) {
  if (n.includes('atlas-os-node')) bad(`cerberusGraph.js still creates: ${n}`);
  else ok(`cerberusGraph.js creates: ${n.slice(0, 60)}`);
}
if (!nodeWraps.length) ok('cerberusGraph.js: no className node-wrap assignments found (may be inline)');

// Also check for createElement + classList
const addClassHits = [...graphSrc.matchAll(/classList\.add\(['"][^'"]*atlas-os-node[^'"]*['"]\)/g)];
if (addClassHits.length) {
  addClassHits.forEach(h => bad(`cerberusGraph.js: ${h[0]}`));
} else {
  ok('cerberusGraph.js: no classList.add with atlas-os-node');
}

// ── 4. Critical CSS classes used in globe rendering exist in CSS ─────────────
console.log(bold('\n4. Critical CSS class existence'));
const criticalCss = [
  'cerberus-os-node-wrap',
  'cerberus-os-node',
  'cerberus-os-node-label',
  'cerberus-os-node-wrap--clickable',
  '#cerberus-home.hidden',
  'cerberus-home-active',
  'cerberus-agent-pod',
  'cerberus-shell-modal',
  'cerberus-hq-modal',
];
for (const cls of criticalCss) {
  const rx = new RegExp(cls.replace(/[[\]()]/g, '\\$&').replace(/\./g, '\\.').replace(/#/g, '#'));
  if (rx.test(cssText)) ok(`CSS: .${cls} or #${cls} defined`);
  else bad(`CSS: ${cls} — NOT found in cerberus-os-home.css`);
}

// ── 5. Named import / export consistency ──────────────────────────────────────
console.log(bold('\n5. Named ES import resolution'));

function getExports(src) {
  const ex = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) ex.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+(\w+)/g)) ex.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) ex.add(name);
    }
  }
  return ex;
}

const srcMap = Object.fromEntries(allJs.map(f => [f.name, f.src]));

for (const { name, src } of allJs) {
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const imports = m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const rawSrc  = m[2];
    const target  = rawSrc.replace(/^\.\//, '') + (rawSrc.endsWith('.js') ? '' : '.js');
    if (!srcMap[target]) continue; // external or non-JS
    const exports = getExports(srcMap[target]);
    for (const imp of imports) {
      // Filter out comment-like garbage from multiline imports
      if (imp.startsWith('//') || imp.includes(' ')) continue;
      if (exports.has(imp)) ok(`${name} → ${imp} from ${target}`);
      else bad(`${name} imports ${imp} from ${target} — NOT exported`);
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`${bold('Results:')} ${green(pass + ' passed')}, ${fail > 0 ? red(fail + ' failed') : green('0 failed')}`);
if (fail > 0) process.exit(1);
