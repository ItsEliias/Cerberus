/**
 * glow-wiring.js — applies the shared orbit-glow to major feature modals.
 *
 * Listens for 'cerberus:modal-opened' (dispatched by modalManager on every
 * open/restore).  If the modal id is in GLOW_IDS, adds .cerberus-orbit-glow
 * and starts the rAF loop.  A MutationObserver on each element stops the loop
 * the moment 'hidden' is added (minimize OR close path).
 *
 * research-overlay is intentionally excluded — it manages its own glow.
 */

import { startOrbitGlow, stopOrbitGlow } from './orbit-glow.js';

export const GLOW_IDS = new Set([
  'doclib-modal',
  'calendar-modal',
  'gallery-modal',
  'cookbook-modal',
  'notes-panel',
  'memory-modal',
  'settings-modal',
]);

const _observers = new Map(); // modal-id -> MutationObserver

window.addEventListener('cerberus:modal-opened', (e) => {
  const { id, modal } = e.detail ?? {};
  if (!GLOW_IDS.has(id) || !modal) return;

  modal.classList.add('cerberus-orbit-glow');
  startOrbitGlow(modal);

  const prev = _observers.get(id);
  if (prev) prev.disconnect();

  const obs = new MutationObserver(() => {
    if (modal.classList.contains('hidden')) {
      stopOrbitGlow(modal);
      modal.classList.remove('cerberus-orbit-glow');
    }
  });
  obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
  _observers.set(id, obs);
});

