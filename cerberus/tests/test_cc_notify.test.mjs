// cc-notify — covers the 5 behavioural cases the spec calls out:
//   1. notifyCCComplete is silent when document.hidden === false
//   2. notifyCCComplete is silent when Notification.permission !== 'granted'
//   3. notifyCCComplete fires `new Notification` when hidden + granted
//   4. notification.onclick calls the supplied onClick and closes itself
//   5. requestNotifyPermission does nothing if permission !== 'default'
//
// Loads the module source in a vm sandbox with a stubbed Notification
// constructor + minimal document/window globals (matches the pattern used
// by tests/test_cc_shortcuts.test.mjs and tests/test_dashboard_fallback.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', 'static/js/cyberapps/command-center/cc-notify.js'),
  'utf8',
)
  .replace(/^export\s+function\s+/gm, 'function ')
  .replace(/^export\s+const\s+/gm, 'const ')
  + '\nthis.notifyCCComplete       = notifyCCComplete;'
  + '\nthis.requestNotifyPermission = requestNotifyPermission;';

function makeNotificationStub(initialPermission = 'granted') {
  const instances = [];
  let requestCalls = 0;
  function Notification(title, opts = {}) {
    this.title = title;
    this.body  = opts.body;
    this.tag   = opts.tag;
    this.icon  = opts.icon;
    this.closed = false;
    this.onclick = null;
    instances.push(this);
  }
  Notification.prototype.close = function() { this.closed = true; };
  Notification.permission = initialPermission;
  Notification.requestPermission = () => {
    requestCalls++;
    return Promise.resolve('granted');
  };
  return {
    Notification,
    instances,
    getRequestCalls: () => requestCalls,
    setPermission: (v) => { Notification.permission = v; },
  };
}

function makeSandbox({ hidden = true, permission = 'granted' } = {}) {
  const stub = makeNotificationStub(permission);
  let focusCalls = 0;
  let timerFn = null;
  let timerDelay = null;
  const sandbox = {
    document: { hidden },
    window: { Notification: stub.Notification, focus: () => { focusCalls++; } },
    setTimeout: (fn, ms) => { timerFn = fn; timerDelay = ms; return 0; },
    clearTimeout: () => {},
    Math, Date, String, Number, Array, Object, Set, Map, JSON, Promise, console,
  };
  // The cc-notify body uses bare `Notification` (the IIFE pattern from
  // chatStream.js) — expose it at sandbox scope so `'Notification' in window`
  // and `Notification.permission` both resolve.
  sandbox.Notification = stub.Notification;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, stub, getFocusCalls: () => focusCalls,
           runPendingTimeout: () => { if (timerFn) timerFn(); },
           getTimerDelay: () => timerDelay };
}

// ── Tests ──────────────────────────────────────────────────────────────

test('notifyCCComplete is silent when the page is visible', () => {
  const { sandbox, stub } = makeSandbox({ hidden: false, permission: 'granted' });
  const result = sandbox.notifyCCComplete({ title: 'hi', body: 'there' });
  assert.equal(result, undefined, 'returns nothing');
  assert.equal(stub.instances.length, 0, 'no Notification constructed');
});

test('notifyCCComplete is silent when permission is not granted', () => {
  for (const perm of ['default', 'denied']) {
    const { sandbox, stub } = makeSandbox({ hidden: true, permission: perm });
    const result = sandbox.notifyCCComplete({ title: 'hi', body: 'there' });
    assert.equal(result, undefined, `returns nothing when permission=${perm}`);
    assert.equal(stub.instances.length, 0, `no Notification constructed (perm=${perm})`);
  }
});

test('notifyCCComplete constructs a Notification when hidden + granted', () => {
  const { sandbox, stub, getTimerDelay } = makeSandbox({ hidden: true, permission: 'granted' });
  const n = sandbox.notifyCCComplete({
    title: '[C]ERBERUS', body: 'Foo replied', tag: 'cc-agent-1',
  });
  assert.equal(stub.instances.length, 1, 'one Notification constructed');
  const inst = stub.instances[0];
  assert.equal(inst.title, '[C]ERBERUS');
  assert.equal(inst.body,  'Foo replied');
  assert.equal(inst.tag,   'cc-agent-1');
  assert.equal(inst.icon,  '/static/favicon.ico');
  assert.equal(n, inst, 'returns the instance');
  assert.equal(getTimerDelay(), 8000, 'auto-close scheduled at 8s');
});

test('notification.onclick focuses the window, calls onClick, and closes', () => {
  const { sandbox, stub, getFocusCalls } = makeSandbox({ hidden: true, permission: 'granted' });
  let clicked = 0;
  const n = sandbox.notifyCCComplete({
    title: 't', body: 'b', tag: 'x', onClick: () => { clicked++; },
  });
  assert.ok(n, 'instance returned');
  n.onclick();
  assert.equal(getFocusCalls(), 1, 'window.focus() called');
  assert.equal(clicked, 1, 'onClick callback invoked');
  assert.equal(n.closed, true, 'notification closed');
});

test('the auto-close timer closes the notification after firing', () => {
  const { sandbox, stub, runPendingTimeout } = makeSandbox({ hidden: true, permission: 'granted' });
  const n = sandbox.notifyCCComplete({ title: 't', body: 'b' });
  assert.equal(n.closed, false, 'open immediately after construction');
  runPendingTimeout();
  assert.equal(n.closed, true, 'closed once the 8s timer fires');
});

test('requestNotifyPermission is a no-op when permission !== "default"', () => {
  for (const perm of ['granted', 'denied']) {
    const { sandbox, stub } = makeSandbox({ permission: perm });
    sandbox.requestNotifyPermission();
    assert.equal(stub.getRequestCalls(), 0, `no prompt when permission=${perm}`);
  }
});

test('requestNotifyPermission prompts exactly once when permission === "default"', () => {
  const { sandbox, stub } = makeSandbox({ permission: 'default' });
  sandbox.requestNotifyPermission();
  assert.equal(stub.getRequestCalls(), 1, 'prompt fired');
});
