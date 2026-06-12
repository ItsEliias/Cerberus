/**
 * CERBERUS — jarvis-v2/effects.js
 * Opt-in effects kit. window.JX2 API.
 * Source:
 *   - frontend-design: bracket corner signature interaction
 *   - frontend-design-pro: motion patterns (scanline, glitch, glow)
 *   - ui-ux-pro-max: prefers-reduced-motion respected throughout
 *
 * Usage:
 *   JX2.init()              — activate body.jx2-active + wire bracket corners
 *   JX2.bracketCorners(el)  — add bracket corner elements to a .jx2-hud-frame
 *   JX2.glitchTitle(el)     — one-shot glitch effect on a heading
 *   JX2.gaugeInit(el, pct)  — set SVG arc gauge to a percentage (0–100)
 *   JX2.destroy()           — remove all jx2 effects
 */

(function (global) {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Internal helpers ──────────────────────────────────────────────*/

  function _prefersReduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Inject bracket corner <span> elements into a .jx2-hud-frame.
   * The CSS handles the animation via :hover. This just ensures
   * the elements exist so the CSS can target them.
   * @param {Element} el
   */
  function _addBrackets(el) {
    if (!el || el.querySelector('.jx2-bracket-tl')) return;
    const tl = document.createElement('span');
    tl.className = 'jx2-bracket-tl';
    tl.setAttribute('aria-hidden', 'true');
    const br = document.createElement('span');
    br.className = 'jx2-bracket-br';
    br.setAttribute('aria-hidden', 'true');
    el.appendChild(tl);
    el.appendChild(br);
  }

  /**
   * Build an SVG arc gauge and mount it into el.
   * @param {Element} el       — .jx2-gauge wrapper
   * @param {number}  pct      — 0–100
   */
  function _buildGauge(el, pct) {
    if (!el) return;
    const R = 34;
    const CX = 40;
    const CY = 40;
    const CIRCUMFERENCE = 2 * Math.PI * R;
    // Arc starts at top (-90deg), goes clockwise
    const startAngle = -90;
    const clampedPct = Math.max(0, Math.min(100, pct));
    const dashArray  = CIRCUMFERENCE;
    const dashOffset = CIRCUMFERENCE * (1 - clampedPct / 100);

    // Avoid rebuilding if already initialised
    let svg = el.querySelector('svg.jx2-gauge__arc');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 80 80');
      svg.classList.add('jx2-gauge__arc');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `Gauge: ${clampedPct}%`);

      const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      track.setAttribute('cx', CX);
      track.setAttribute('cy', CY);
      track.setAttribute('r', R);
      track.classList.add('jx2-gauge__track');

      const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      fill.setAttribute('cx', CX);
      fill.setAttribute('cy', CY);
      fill.setAttribute('r', R);
      fill.classList.add('jx2-gauge__fill');
      fill.style.transformOrigin = `${CX}px ${CY}px`;
      fill.style.transform = `rotate(${startAngle}deg)`;
      fill.style.strokeDasharray  = dashArray;
      fill.style.strokeDashoffset = dashOffset;

      const valueEl = document.createElement('div');
      valueEl.className = 'jx2-gauge__value';
      valueEl.textContent = `${clampedPct}%`;

      svg.appendChild(track);
      svg.appendChild(fill);
      el.insertBefore(svg, el.querySelector('.jx2-gauge__label'));
      el.insertBefore(valueEl, el.querySelector('.jx2-gauge__label'));
    } else {
      const fill = svg.querySelector('.jx2-gauge__fill');
      if (fill) {
        fill.style.strokeDashoffset = dashOffset;
        fill.setAttribute('aria-label', `${clampedPct}%`);
      }
      const valueEl = el.querySelector('.jx2-gauge__value');
      if (valueEl) valueEl.textContent = `${clampedPct}%`;
    }
  }

  /* ── Public API ────────────────────────────────────────────────────*/

  const JX2 = {

    /**
     * Activate jx2 mode: add body.jx2-active, wire bracket corners
     * on all .jx2-hud-frame elements, and observe future ones.
     */
    init() {
      document.body.classList.add('jx2-active');
      document.querySelectorAll('.jx2-hud-frame').forEach(_addBrackets);

      // MutationObserver for dynamically added .jx2-hud-frame elements
      if (this._observer) return;
      this._observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (node.classList.contains('jx2-hud-frame')) _addBrackets(node);
            node.querySelectorAll('.jx2-hud-frame').forEach(_addBrackets);
          }
        }
      });
      this._observer.observe(document.body, { childList: true, subtree: true });
    },

    /**
     * Manually add bracket corners to a specific element.
     * @param {Element} el
     */
    bracketCorners(el) {
      if (!el) return;
      _addBrackets(el);
    },

    /**
     * One-shot glitch effect on a heading element.
     * frontend-design-pro: "glitch transitions, kept subtle."
     * Skipped if prefers-reduced-motion.
     * @param {Element} el
     */
    glitchTitle(el) {
      if (!el || _prefersReduced()) return;
      el.style.animation = 'jx2-glitch 0.4s ease-out';
      el.addEventListener('animationend', () => {
        el.style.animation = '';
      }, { once: true });
    },

    /**
     * Initialise or update an SVG arc gauge.
     * @param {Element} el   — .jx2-gauge wrapper
     * @param {number}  pct  — 0–100
     */
    gaugeInit(el, pct) {
      _buildGauge(el, pct);
    },

    /**
     * Update gauge fill without rebuilding.
     * @param {Element} el
     * @param {number}  pct
     */
    gaugeUpdate(el, pct) {
      if (!el) return;
      const R = 34;
      const CIRCUMFERENCE = 2 * Math.PI * R;
      const clampedPct = Math.max(0, Math.min(100, pct));
      const fill = el.querySelector('.jx2-gauge__fill');
      if (fill) fill.style.strokeDashoffset = CIRCUMFERENCE * (1 - clampedPct / 100);
      const valueEl = el.querySelector('.jx2-gauge__value');
      if (valueEl) valueEl.textContent = `${clampedPct}%`;
    },

    /**
     * Animate a stat counter from 0 to target value.
     * Skipped if prefers-reduced-motion (jumps to final value).
     * @param {Element} el
     * @param {number}  target
     * @param {string}  [suffix='']
     * @param {number}  [duration=800]
     */
    countUp(el, target, suffix = '', duration = 800) {
      if (!el) return;
      if (_prefersReduced()) {
        el.textContent = target + suffix;
        return;
      }
      const start = performance.now();
      const tick = (now) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(eased * target) + suffix;
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },

    /**
     * Stagger-reveal a NodeList of elements (fade-up).
     * ui-ux-pro-max rule: "stagger list/grid item entrance by 30–50ms per item."
     * @param {NodeList|Element[]} els
     * @param {number} [staggerMs=40]
     */
    staggerReveal(els, staggerMs = 40) {
      if (_prefersReduced()) {
        Array.from(els).forEach((el) => {
          el.style.opacity = '1';
          el.style.transform = 'none';
        });
        return;
      }
      Array.from(els).forEach((el, i) => {
        el.style.opacity    = '0';
        el.style.transform  = 'translateY(8px)';
        el.style.transition = 'none';
        setTimeout(() => {
          el.style.transition  = `opacity 240ms ease-out, transform 240ms ease-out`;
          el.style.opacity     = '1';
          el.style.transform   = 'translateY(0)';
        }, i * staggerMs);
      });
    },

    /**
     * Remove all jx2 effects and disconnect observer.
     */
    destroy() {
      document.body.classList.remove('jx2-active');
      document.querySelectorAll('.jx2-bracket-tl, .jx2-bracket-br').forEach(el => el.remove());
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
    },

    /**
     * Version identifier.
     */
    version: '2.0.0',
  };

  global.JX2 = JX2;

})(window);
