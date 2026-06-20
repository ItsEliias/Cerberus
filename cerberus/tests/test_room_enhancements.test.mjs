// Tests for the rooms.js enhancements: pin/sort, participant-name rendering,
// and the client-side filter. Pure JS behavior tests — no backend involvement.
//
// Uses dynamic import of rooms.js with __testables exported at the bottom of
// the module. localStorage is stubbed at globalThis scope before import so the
// pin helpers see the test sandbox instead of the real browser store.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOMS_URL = join(
  __dirname,
  '..',
  'static/js/cyberapps/command-center/rooms.js',
);

// In-memory localStorage stub that lives for the whole test process. rooms.js
// reads it once per call, so we can mutate the store directly between cases.
const _localStorageStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (_localStorageStore.has(k) ? _localStorageStore.get(k) : null),
  setItem: (k, v) => { _localStorageStore.set(k, String(v)); },
  removeItem: (k) => _localStorageStore.delete(k),
  clear: () => _localStorageStore.clear(),
};

// rooms.js calls `document.createElement('div')` inside `_esc`. Stub the
// minimum surface so module load + every helper that touches _esc works.
globalThis.document = {
  createElement: () => {
    let text = '';
    return {
      set textContent(v) { text = String(v ?? ''); },
      get textContent() { return text; },
      get innerHTML() {
        return text
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      },
    };
  },
};

// Import once; reuse the helper surface across tests.
const mod = await import(ROOMS_URL + '?cachebust=' + Date.now());
const T = mod.__testables;

beforeEach(() => {
  _localStorageStore.clear();
});

// ---------------------------------------------------------------------------
// TASK 1 — pinned rooms sort to the top
// ---------------------------------------------------------------------------

test('pinned rooms sort to the top, others by last_message_at desc', () => {
  const rooms = [
    { id: 'a', name: 'Alpha',   last_message_at: '2026-06-19T10:00:00' },
    { id: 'b', name: 'Bravo',   last_message_at: '2026-06-20T14:00:00' },
    { id: 'c', name: 'Charlie', last_message_at: '2026-06-18T08:00:00' },
    { id: 'd', name: 'Delta',   last_message_at: '2026-06-20T09:00:00' },
  ];
  // Pin Alpha + Charlie — older messages but should top the list.
  const pinned = new Set(['a', 'c']);
  const sorted = T._sortRoomsForDisplay(rooms, pinned);
  assert.deepEqual(sorted.map(r => r.id), ['a', 'c', 'b', 'd']);
});

test('toggling a pin persists to localStorage and survives a re-read', () => {
  assert.equal(T._isPinned('room-1'), false);
  const after = T._togglePinned('room-1');
  assert.equal(after, true);
  assert.equal(T._isPinned('room-1'), true);
  // Stored as a JSON array under the expected key.
  const raw = _localStorageStore.get(T.PINNED_KEY);
  assert.deepEqual(JSON.parse(raw), ['room-1']);
  // Toggling again removes it.
  assert.equal(T._togglePinned('room-1'), false);
  assert.equal(T._isPinned('room-1'), false);
});

test('_readPinned tolerates garbage / missing data', () => {
  _localStorageStore.set(T.PINNED_KEY, 'not-json');
  assert.deepEqual([...T._readPinned()], []);
  _localStorageStore.set(T.PINNED_KEY, JSON.stringify({ not: 'array' }));
  assert.deepEqual([...T._readPinned()], []);
  _localStorageStore.set(T.PINNED_KEY, JSON.stringify(['x', 42, 'y']));
  assert.deepEqual([...T._readPinned()].sort(), ['x', 'y']);
});

// ---------------------------------------------------------------------------
// TASK 2 — participant names resolved from the agent cache
// ---------------------------------------------------------------------------

test('_participantNames resolves ids via the agent cache', () => {
  T._setAgentCache([
    { id: 'a1', name: 'CODER' },
    { id: 'a2', name: 'TESTER' },
    { id: 'a3', name: 'REVIEWER' },
  ]);
  const names = T._participantNames({ participant_ids: ['a1', 'a2', 'a3'] });
  assert.deepEqual(names, ['CODER', 'TESTER', 'REVIEWER']);
});

test('_participantNames falls back to the id when an agent is unknown', () => {
  T._setAgentCache([{ id: 'a1', name: 'CODER' }]);
  const names = T._participantNames({ participant_ids: ['a1', 'missing-id'] });
  assert.deepEqual(names, ['CODER', 'missing-id']);
});

test('_roomCard renders participant names inline', () => {
  T._setAgentCache([
    { id: 'a1', name: 'CODER' },
    { id: 'a2', name: 'TESTER' },
  ]);
  const html = T._roomCard({
    id: 'r1', name: 'Room One', participant_ids: ['a1', 'a2'],
    last_message_at: null, mode: 'routed',
  }, new Set());
  assert.match(html, /class="cc-room-participants"/);
  assert.match(html, /CODER · TESTER/);
});

test('_roomCard marks pinned rooms with the pinned class + active button', () => {
  T._setAgentCache([]);
  const html = T._roomCard(
    { id: 'r1', name: 'Pinned room', participant_ids: [], last_message_at: null },
    new Set(['r1']),
  );
  assert.match(html, /cc-room-card--pinned/);
  assert.match(html, /cc-room-pin-btn--active/);
  assert.match(html, /aria-pressed="true"/);
});

// ---------------------------------------------------------------------------
// TASK 3 — room filter hides non-matching cards and restores on clear
// ---------------------------------------------------------------------------

function makeFakeContainer(rooms) {
  const input = { value: '' };
  const cards = rooms.map(r => ({
    dataset: { roomName: r.name },
    style: { display: '' },
  }));
  return {
    input,
    cards,
    querySelector: (sel) => {
      if (sel === '#cc-rooms-filter') return input;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '#cc-rooms-grid .cc-room-card') return cards;
      return [];
    },
  };
}

test('_applyRoomFilter hides non-matching cards (case-insensitive)', () => {
  const c = makeFakeContainer([
    { name: 'Ship a Feature' },
    { name: 'Security Audit' },
    { name: 'Debug & Fix' },
  ]);
  c.input.value = 'security';
  T._applyRoomFilter(c);
  assert.equal(c.cards[0].style.display, 'none');
  assert.equal(c.cards[1].style.display, '');
  assert.equal(c.cards[2].style.display, 'none');
});

test('_applyRoomFilter restores every card when the input is cleared', () => {
  const c = makeFakeContainer([
    { name: 'Alpha' },
    { name: 'Bravo' },
  ]);
  c.input.value = 'alpha';
  T._applyRoomFilter(c);
  assert.equal(c.cards[1].style.display, 'none');
  c.input.value = '';
  T._applyRoomFilter(c);
  assert.equal(c.cards[0].style.display, '');
  assert.equal(c.cards[1].style.display, '');
});

test('_applyRoomFilter ignores leading/trailing whitespace', () => {
  const c = makeFakeContainer([{ name: 'Alpha' }, { name: 'Bravo' }]);
  c.input.value = '   alpha   ';
  T._applyRoomFilter(c);
  assert.equal(c.cards[0].style.display, '');
  assert.equal(c.cards[1].style.display, 'none');
});
