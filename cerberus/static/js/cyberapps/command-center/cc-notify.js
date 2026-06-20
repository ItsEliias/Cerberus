/**
 * cc-notify.js — browser notifications for CC agent + room completions.
 *
 * Mirrors the chatStream.notifyStreamComplete contract from
 * static/js/chatStream.js: only fires when the page is hidden + permission
 * is granted, includes a tag for de-duplication, auto-closes after 8 s,
 * and routes the click back to the originating panel via `onClick`.
 *
 *   requestNotifyPermission()                — idempotent permission prompt
 *   notifyCCComplete({ title, body, tag, onClick })
 *
 * No DOM/CSS — the browser owns the notification UI.
 */

const NOTIFICATION_TTL_MS = 8000;

export function requestNotifyPermission() {
  if (typeof window === 'undefined') return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  try { Notification.requestPermission(); } catch (_) { /* legacy denial */ }
}

export function notifyCCComplete({ title, body, tag, onClick } = {}) {
  // Silent when the user is still looking at the page.
  if (typeof document !== 'undefined' && !document.hidden) return;
  if (typeof window === 'undefined') return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const n = new Notification(String(title || ''), {
      body: String(body || ''),
      tag:  tag ? String(tag) : undefined,
      icon: '/static/favicon.ico',
    });
    n.onclick = () => {
      try { window.focus(); } catch (_) {}
      try { onClick && onClick(); } catch (_) {}
      try { n.close(); } catch (_) {}
    };
    setTimeout(() => { try { n.close(); } catch (_) {} }, NOTIFICATION_TTL_MS);
    return n;
  } catch (_) {
    // Some browsers throw on Notification construction (eg. iOS without
    // a user gesture). Stay silent so callers don't need a try/catch.
    return undefined;
  }
}

// Exposed for tests/test_cc_notify.test.mjs — kept as a plain object so it
// can be stripped from production bundles if/when tree-shaking is added.
export const __testables = { NOTIFICATION_TTL_MS };
