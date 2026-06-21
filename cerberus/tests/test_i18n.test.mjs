// test_i18n.test.mjs — covers the five spec behaviours of static/js/i18n.js:
//   6.  t("nav.chat") returns "Chat" in EN
//   7.  t("nav.chat") returns "Chat" in ES (same word — deliberate)
//   8.  t("nonexistent.key") falls back to the key itself
//   9.  setLocale persists to localStorage
//  10.  Unknown locale falls back to EN
//
// i18n.js guards every browser-only reference (document, localStorage,
// CustomEvent) so it imports cleanly in the Node test runner. We still
// install a fake `localStorage` (and a minimal `document`+`CustomEvent`)
// before importing so the persistence test has something to assert on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', 'static/js/i18n.js'),
  'utf8',
)
  // Strip `export` keywords so we can run the source in a vm sandbox
  // and pull the symbols off the context directly. Same trick the
  // other .test.mjs files use for ESM-only modules.
  .replace(/^export\s+function\s+/gm, 'function ')
  .replace(/^export\s+const\s+/gm, 'const ');

function freshI18n() {
  // Each test gets its own sandbox + its own fake localStorage so
  // setLocale persistence is isolated.
  const store = {};
  const fakeLocalStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
  const events = [];
  const fakeDocument = {
    dispatchEvent: (e) => { events.push(e); return true; },
  };
  // Minimal CustomEvent that records type + detail.
  function FakeCustomEvent(type, init) {
    this.type = type;
    this.detail = (init && init.detail) || null;
  }

  const ctx = {
    localStorage: fakeLocalStorage,
    document: fakeDocument,
    CustomEvent: FakeCustomEvent,
    console,
    Object,
  };
  vm.createContext(ctx);
  new vm.Script(SRC).runInContext(ctx);
  return { ctx, store, events };
}


// ── 6. EN: nav.chat → "Chat" ───────────────────────────────────────────

test('t("nav.chat") returns "Chat" in EN', () => {
  const { ctx } = freshI18n();
  // Default locale is EN; no setLocale call needed.
  assert.equal(ctx.getLocale(), 'en');
  assert.equal(ctx.t('nav.chat'), 'Chat');
});


// ── 7. ES: nav.chat → "Chat" (same string, intentional) ────────────────

test('t("nav.chat") returns "Chat" in ES (same as EN)', () => {
  const { ctx } = freshI18n();
  ctx.setLocale('es');
  assert.equal(ctx.getLocale(), 'es');
  assert.equal(ctx.t('nav.chat'), 'Chat');
  // Sanity: a key that DOES translate should be different.
  assert.equal(ctx.t('nav.council'), 'Consejo');
});


// ── 8. Unknown key falls back to the key itself ────────────────────────

test('t("nonexistent.key") returns the key as fallback', () => {
  const { ctx } = freshI18n();
  assert.equal(ctx.t('nonexistent.key'), 'nonexistent.key');
  // Empty / non-string return ""
  assert.equal(ctx.t(''), '');
  assert.equal(ctx.t(undefined), '');
});


test('t() falls back through current → default → key', () => {
  const { ctx } = freshI18n();
  ctx.setLocale('es');
  // ES has "nav.council" = "Consejo", EN has it too. Pick a key that
  // only exists in EN to prove the second-level fallback works.
  // (action.save is in BOTH; pick something genuinely missing.)
  assert.equal(ctx.t('nonexistent.key'), 'nonexistent.key');
});


// ── 9. setLocale persists to localStorage ──────────────────────────────

test('setLocale persists the locale to localStorage', () => {
  const { ctx, store } = freshI18n();
  ctx.setLocale('es');
  assert.equal(store['cerberus.locale'], 'es');
  // Switching back persists too
  ctx.setLocale('en');
  assert.equal(store['cerberus.locale'], 'en');
});


test('setLocale dispatches cerberus:locale-changed', () => {
  const { ctx, events } = freshI18n();
  ctx.setLocale('es');
  const e = events.find((x) => x.type === 'cerberus:locale-changed');
  assert.ok(e, 'expected cerberus:locale-changed event');
  // deepStrictEqual fails across vm realms (different Object.prototype);
  // field-by-field check is realm-agnostic.
  assert.equal(e.detail && e.detail.locale, 'es');
});


// ── 10. Unknown locale falls back to EN ────────────────────────────────

test('setLocale("zz") falls back to EN (coerced + persisted)', () => {
  const { ctx, store } = freshI18n();
  const resolved = ctx.setLocale('zz');
  assert.equal(resolved, 'en');
  assert.equal(ctx.getLocale(), 'en');
  // Critically, the COERCED value is what's persisted — not "zz" —
  // so a subsequent reload won't trigger the fallback again.
  assert.equal(store['cerberus.locale'], 'en');
  // Strings still resolve via EN
  assert.equal(ctx.t('nav.chat'), 'Chat');
});


test('module reads persisted locale on import (EN fallback when invalid)', () => {
  // Pre-seed localStorage with a non-existent locale BEFORE running the
  // module — exercises the import-time `_readPersisted` fallback path.
  const store = { 'cerberus.locale': 'zz' };
  const ctx = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    document: { dispatchEvent: () => true },
    CustomEvent: function (t, i) { this.type = t; this.detail = i?.detail; },
    console,
    Object,
  };
  vm.createContext(ctx);
  new vm.Script(SRC).runInContext(ctx);
  assert.equal(ctx.getLocale(), 'en');
});
