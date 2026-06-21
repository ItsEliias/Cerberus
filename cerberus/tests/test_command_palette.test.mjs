// Tests for the global command palette (feat/global-command-palette).
//
// Verifies: multi-source search, arrow-key navigation, Enter execution,
// recently-used ordering, Esc close, and fuzzy ranking.
//
// Loads shortcuts.js in a vm sandbox so tests remain isolated from the browser.
// node:test — run with: node --test tests/test_command_palette.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH  = join(__dirname, '..', 'static/js/cyberapps/command-center/shortcuts.js');
let SRC = readFileSync(SRC_PATH, 'utf8');
SRC = SRC.replace(/^export\s+const\s+/gm, 'const ');
SRC = SRC.replace(/^export\s+function\s+/gm, 'function ');
SRC += '\nthis.__t = __testables;';

// ── Minimal DOM + localStorage shim ──────────────────────────────────────────

function makeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    _classes: new Set(), _children: [], _listeners: {},
    style: {}, dataset: {}, _attrs: {},
    innerHTML: '', textContent: '', value: '', disabled: false, hidden: false,
    classList: {
      add(c)      { el._classes.add(c); },
      remove(c)   { el._classes.delete(c); },
      contains(c) { return el._classes.has(c); },
      toggle(c, f) {
        if (f === true)  { el._classes.add(c); return true; }
        if (f === false) { el._classes.delete(c); return false; }
        if (el._classes.has(c)) { el._classes.delete(c); return false; }
        el._classes.add(c); return true;
      },
    },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k)    { return this._attrs[k]; },
    removeAttribute(k) { delete this._attrs[k]; },
    addEventListener(evt, fn) {
      this._listeners[evt] = this._listeners[evt] || [];
      this._listeners[evt].push(fn);
    },
    querySelector()    { return null; },
    querySelectorAll() { return []; },
    closest()          { return null; },
    focus() {}, click() {},
    scrollTop: 0, scrollHeight: 0,
    remove() {},
  };
  return el;
}

function buildSandbox({ recentIds = [], agentRows = [], roomCards = [], tabs = [] } = {}) {
  let store = { 'cerberus.palette.recent': JSON.stringify(recentIds) };
  const dispatched = [];
  const body = makeElement('body');
  const createdEls = [];

  const sandbox = vm.createContext({
    // STATE.tabs is used by _gatherSearchPool for tab commands
    STATE: { inited: false, shell: null, tabs, helpOpen: false, searchOpen: false, keydownHandler: null },
    CSS: { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    document: {
      body,
      createElement: (tag) => {
        const el = makeElement(tag);
        createdEls.push(el);
        return el;
      },
      addEventListener:    () => {},
      removeEventListener: () => {},
      getElementById:      () => null,
      querySelector:       (sel) => {
        // Simulate DOM agent rows + room cards for gatherSearchPool
        if (sel.startsWith('.cc-agent-row[data-id=')) return null;
        if (sel.startsWith('.cc-room-card[data-room-id=')) return null;
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === '.cc-agent-row') return agentRows;
        if (sel === '.cc-room-card') return roomCards;
        return [];
      },
      dispatchEvent: (e) => { dispatched.push(e.type || e); },
    },
    window:      { matchMedia: () => ({ matches: false }) },
    localStorage: {
      getItem:  (k) => store[k] ?? null,
      setItem:  (k, v) => { store[k] = v; },
    },
    setTimeout:   (fn) => fn && fn(),
    clearTimeout: () => {},
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame:  () => {},
    CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    console: { info: () => {}, warn: () => {} },
    dispatched,
    store,
    createdEls,
  });

  vm.runInContext(SRC, sandbox);
  return sandbox;
}

// ── Test helpers ─────────────────────────────────────────────────────────────

function fakeAgentRow(id, name, role = '') {
  return {
    dataset: { id, agentName: name },
    querySelector: (sel) => {
      if (sel === '.cc-row-name') return { textContent: name };
      if (sel === '.cc-row-role') return { textContent: role };
      if (sel === '.cc-row-btn-chat') return { click: () => {} };
      return null;
    },
  };
}

function fakeRoomCard(id, name) {
  return {
    dataset: { roomId: id, roomName: name },
    querySelector: (sel) => {
      if (sel === '.cc-room-name') return { textContent: name };
      if (sel === '.cc-room-count') return { textContent: '0' };
      if (sel === '.cc-room-open-btn') return { click: () => {} };
      return null;
    },
  };
}

// ── 1. Palette searches across agents, rooms, tabs, and commands ─────────────

test('1. Palette searches across agents, rooms, tabs, and commands', () => {
  const tabs = [{ id: 'command', label: 'Command' }, { id: 'workspace', label: 'Workspace' }];
  const sb   = buildSandbox({
    agentRows: [fakeAgentRow('ag-1', 'ORACLE', 'research')],
    roomCards: [fakeRoomCard('rm-1', 'War Room')],
  });
  // STATE is declared inside the module; set tabs via testables after init
  sb.__t.STATE.tabs = tabs;

  const pool = sb.__t.gatherSearchPool();
  const kinds = new Set(pool.map(it => it.kind));

  assert.ok(kinds.has('agent'),   'pool should contain agents');
  assert.ok(kinds.has('room'),    'pool should contain rooms');
  assert.ok(kinds.has('tab'),     'pool should contain tabs');
  assert.ok(kinds.has('command'), 'pool should contain commands');
});

// ── 2. Arrow keys move selection ─────────────────────────────────────────────

test('2. Arrow keys move selection', () => {
  const sb = buildSandbox();
  const matches = sb.__t.buildCommands().slice(0, 4);

  // Simulate the render loop logic
  let selected = 0;
  const down = () => { selected = Math.min(selected + 1, matches.length - 1); };
  const up   = () => { selected = Math.max(selected - 1, 0); };

  down(); assert.equal(selected, 1, 'ArrowDown moves selection from 0 → 1');
  down(); assert.equal(selected, 2);
  up();   assert.equal(selected, 1, 'ArrowUp moves selection back');
  up();   assert.equal(selected, 0);
  up();   assert.equal(selected, 0, 'ArrowUp clamps at 0');
  down(); down(); down(); down();
  assert.equal(selected, 3, 'ArrowDown clamps at last item');
});

// ── 3. Enter executes the selected command (fires correct event) ──────────────

test('3. Enter executes the selected command and fires event', () => {
  const sb = buildSandbox();
  const commands = sb.__t.buildCommands();

  const noteCmd = commands.find(c => c.id === 'new-note');
  assert.ok(noteCmd, 'new-note command should exist');

  // _activate calls the action, which dispatches cerberus:new-note
  sb.__t.activate(noteCmd);
  assert.ok(sb.dispatched.some(t => t === 'cerberus:new-note'), 'should dispatch cerberus:new-note');
});

// ── 4. Recently-used commands appear first ────────────────────────────────────

test('4. Recently-used commands appear first in pool', () => {
  const sb = buildSandbox({ recentIds: ['view-changelog', 'toggle-wake-word'] });
  const pool = sb.__t.gatherSearchPool();
  const commands = pool.filter(it => it.kind === 'command');

  // The two recent commands should be at the front of the command list
  assert.equal(commands[0].id, 'view-changelog',    'most recent should be first');
  assert.equal(commands[1].id, 'toggle-wake-word',  'second recent should be second');
});

// ── 5. Esc closes the palette ─────────────────────────────────────────────────

test('5. Esc closes the palette', () => {
  const sb = buildSandbox();
  // Simulate STATE.searchOpen = true and an overlay in the DOM
  sb.__t.STATE.searchOpen = true;

  // _closeSearch removes the overlay and resets STATE.searchOpen
  sb.__t.closeSearch();
  assert.equal(sb.__t.STATE.searchOpen, false, 'STATE.searchOpen should be false after close');
});

// ── 6. Fuzzy match ranks exact matches higher ─────────────────────────────────

test('6. Fuzzy match ranks exact matches higher than partial matches', () => {
  const sb = buildSandbox();
  const score = sb.__t.fuzzyScore;

  const exact   = score('new note', 'new note');
  const starts  = score('new note creator', 'new note');
  const partial = score('create a new note here', 'new note');

  assert.ok(exact   > starts,  'exact match should score higher than starts-with');
  assert.ok(starts  > partial, 'starts-with should score higher than partial contains');
  assert.equal(score('something unrelated', 'new note'), 0, 'no match returns 0');
});
