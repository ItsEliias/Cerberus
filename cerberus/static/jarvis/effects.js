/**
 * Cerberus JARVIS Effects Kit — Phase A
 * Opt-in visual effects for JARVIS surfaces.
 * All heavy effects are PER-SURFACE — nothing runs globally by default.
 * Respects prefers-reduced-motion.
 *
 * API surface (all exported on window.JX):
 *   JX.initScanlines(rootEl, opts)
 *   JX.initHudSweep(rootEl, opts)
 *   JX.initPanelGlow(panelEl)
 *   JX.initParticleField(canvasEl, opts)
 *   JX.reducedMotion  — boolean, true if user prefers reduced motion
 */

const JX = (() => {
  'use strict';

  /** @type {boolean} */
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * @param {Element} rootEl
   * @param {{ opacity?: number, speed?: number }} [opts]
   */
  function initScanlines(rootEl, opts = {}) {
    if (!rootEl) return;
    const opacity = opts.opacity ?? 0.025;
    const size    = 4; /* px per scanline row */

    const overlay = document.createElement('div');
    overlay.className = 'jx-scanline-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = [
      'position:absolute',
      'inset:0',
      'pointer-events:none',
      'z-index:1',
      `background-image:linear-gradient(0deg,transparent 0%,transparent ${size - 1}px,rgba(255,255,255,${opacity}) ${size - 1}px,rgba(255,255,255,${opacity}) ${size}px)`,
      `background-size:100% ${size}px`,
      'border-radius:inherit',
    ].join(';');

    if (getComputedStyle(rootEl).position === 'static') {
      rootEl.style.position = 'relative';
    }
    rootEl.appendChild(overlay);
  }

  /**
   * @param {Element} rootEl
   * @param {{ duration?: number, color?: string }} [opts]
   */
  function initHudSweep(rootEl, opts = {}) {
    if (!rootEl || reducedMotion) return;
    const duration = opts.duration ?? 8000;
    const color    = opts.color    ?? 'rgba(192,57,43,0.012)';

    const sweep = document.createElement('div');
    sweep.setAttribute('aria-hidden', 'true');
    sweep.style.cssText = [
      'position:absolute',
      'left:0',
      'right:0',
      'height:120px',
      'top:-120px',
      `background:linear-gradient(to bottom,transparent 0%,${color} 50%,transparent 100%)`,
      'pointer-events:none',
      'z-index:2',
    ].join(';');

    if (getComputedStyle(rootEl).position === 'static') {
      rootEl.style.position = 'relative';
    }
    rootEl.style.overflow = 'hidden';
    rootEl.appendChild(sweep);

    if (reducedMotion) return;

    let start = null;
    const totalH = () => rootEl.offsetHeight;

    function animate(ts) {
      if (!start) start = ts;
      const elapsed = (ts - start) % duration;
      const progress = elapsed / duration;
      const top = -120 + (totalH() + 240) * progress;
      sweep.style.top = `${top}px`;
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }

  /**
   * @param {Element} panelEl
   */
  function initPanelGlow(panelEl) {
    if (!panelEl) return;

    const base = panelEl.style.transition || '';
    panelEl.style.transition = [base, 'box-shadow 240ms cubic-bezier(0,0,.2,1)']
      .filter(Boolean).join(',');

    const onEnter = () => {
      panelEl.style.boxShadow = [
        '0 0 0 1px rgba(192,57,43,0.40)',
        'inset 0 1px rgba(192,57,43,0.10)',
        '0 4px 32px rgba(0,0,0,0.75)',
        '0 0 24px rgba(192,57,43,0.08)',
      ].join(',');
    };

    const onLeave = () => {
      panelEl.style.boxShadow = '';
    };

    if (!reducedMotion) {
      panelEl.addEventListener('mouseenter', onEnter, { passive: true });
      panelEl.addEventListener('mouseleave', onLeave, { passive: true });
    }
  }

  /**
   * Opt-in particle background — hero surfaces only.
   * @param {HTMLCanvasElement} canvasEl
   * @param {{ density?: number, color?: string }} [opts]
   */
  function initParticleField(canvasEl, opts = {}) {
    if (!canvasEl || reducedMotion) return;
    const density = opts.density ?? 40;
    const color   = opts.color   ?? '192,57,43';

    const ctx    = canvasEl.getContext('2d');
    const resize = () => {
      canvasEl.width  = canvasEl.offsetWidth;
      canvasEl.height = canvasEl.offsetHeight;
    };
    resize();

    const particles = Array.from({ length: density }, () => ({
      x:  Math.random() * canvasEl.width,
      y:  Math.random() * canvasEl.height,
      r:  Math.random() * 1.2 + 0.3,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      o:  Math.random() * 0.4 + 0.1,
    }));

    let raf;
    function frame() {
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      for (const p of particles) {
        p.x = (p.x + p.vx + canvasEl.width)  % canvasEl.width;
        p.y = (p.y + p.vy + canvasEl.height) % canvasEl.height;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color},${p.o})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    const ro = new ResizeObserver(resize);
    ro.observe(canvasEl);

    canvasEl._jxDestroy = () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }

  return { initScanlines, initHudSweep, initPanelGlow, initParticleField, reducedMotion };
})();

window.JX = JX;
