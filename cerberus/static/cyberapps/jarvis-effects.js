/**
 * jarvis-effects.js — JARVIS aesthetic JS helpers for the Cyber Apps suite.
 *
 * Exposes window.JX = { animateNumber, staggerIn, observeAndTickNumbers,
 *                        injectCSS, reducedMotion }
 *
 * No external dependencies. Vanilla ES5-compatible with one rAF loop each.
 * All animations gate on reducedMotion() so keyboard/screen-reader users
 * are unaffected.
 */

(function () {
  'use strict';

  // ── Reduced-motion guard ───────────────────────────────────────────────────
  function reducedMotion() {
    if (document.documentElement.classList.contains('jx-reduced-motion')) return true;
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    return mq && mq.matches;
  }

  // ── Easing ─────────────────────────────────────────────────────────────────
  function easeOutQuad(t) { return t * (2 - t); }

  // ── Format number with thousand separators ─────────────────────────────────
  function _fmt(n, decimals) {
    if (!isFinite(n)) return String(n);
    var d = decimals != null ? decimals : 0;
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }

  /**
   * jxAnimateNumber(el, fromVal, toVal, ms, suffix)
   * Tween-in a numeric counter on `el`. Respects reduced-motion.
   * @param {HTMLElement} el
   * @param {number}      fromVal  Start value (default 0)
   * @param {number}      toVal    End value
   * @param {number}      ms       Duration in ms (default 800)
   * @param {string}      suffix   Optional suffix, e.g. '%' or 'ms'
   */
  function jxAnimateNumber(el, fromVal, toVal, ms, suffix) {
    if (!el) return;
    var from  = fromVal != null ? fromVal : 0;
    var to    = toVal   != null ? toVal   : 0;
    var dur   = ms      != null ? ms      : 800;
    var sfx   = suffix  || '';
    var decimals = Number.isInteger(to) && Number.isInteger(from) ? 0 : 1;

    if (reducedMotion()) {
      el.textContent = _fmt(to, decimals) + sfx;
      return;
    }

    var start = null;
    function step(ts) {
      if (!start) start = ts;
      var elapsed = ts - start;
      var progress = Math.min(elapsed / dur, 1);
      var current = from + (to - from) * easeOutQuad(progress);
      el.textContent = _fmt(current, decimals) + sfx;
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = _fmt(to, decimals) + sfx;
        el.classList.add('ticking');
        setTimeout(function () { el.classList.remove('ticking'); }, 420);
      }
    }
    requestAnimationFrame(step);
  }

  /**
   * jxStaggerIn(containerEl, selector, baseDelayMs)
   * Assigns --stagger-index CSS vars to matched children so .jx-tile-in
   * animates them in sequence. Also adds the class.
   * @param {HTMLElement} containerEl
   * @param {string}      selector    CSS selector for items (default ':scope > *')
   * @param {number}      baseDelayMs Extra offset before first item (default 0)
   */
  function jxStaggerIn(containerEl, selector, baseDelayMs) {
    if (!containerEl) return;
    var sel   = selector    || ':scope > *';
    var base  = baseDelayMs || 0;
    var items = containerEl.querySelectorAll(sel);

    if (reducedMotion()) {
      items.forEach(function (el) { el.classList.remove('jx-tile-in'); });
      return;
    }

    items.forEach(function (el, i) {
      el.style.setProperty('--stagger-index', i);
      el.style.animationDelay = (base + i * 55) + 'ms';
      // Force reflow so re-triggering on tab switch replays the animation
      el.classList.remove('jx-tile-in');
      // eslint-disable-next-line no-unused-expressions
      void el.offsetWidth;
      el.classList.add('jx-tile-in');
    });
  }

  /**
   * jxObserveAndTickNumbers(rootEl)
   * MutationObserver that watches for data-jx-tick attribute changes.
   * When data-jx-tick changes value, animates from the previous displayed
   * number to the new value.
   *
   * Usage in HTML:  <span class="jx-number-tick" data-jx-tick="42"></span>
   * Update via JS:  el.dataset.jxTick = newVal;
   *
   * @param {HTMLElement} rootEl
   * @returns {MutationObserver}
   */
  function jxObserveAndTickNumbers(rootEl) {
    if (!rootEl) return null;

    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.type !== 'attributes' || m.attributeName !== 'data-jx-tick') return;
        var el     = m.target;
        var newVal = parseFloat(el.dataset.jxTick);
        var oldVal = parseFloat(el.dataset.jxTickPrev || el.textContent.replace(/[^0-9.-]/g, '') || 0);
        var suffix = el.dataset.jxSuffix || '';
        el.dataset.jxTickPrev = newVal;
        jxAnimateNumber(el, oldVal, newVal, 700, suffix);
      });
    });

    observer.observe(rootEl, { attributeFilter: ['data-jx-tick'], subtree: true });

    // Seed initial values for any pre-existing tick elements
    rootEl.querySelectorAll('[data-jx-tick]').forEach(function (el) {
      var val = parseFloat(el.dataset.jxTick || 0);
      var sfx = el.dataset.jxSuffix || '';
      el.dataset.jxTickPrev = val;
      jxAnimateNumber(el, 0, val, 900, sfx);
    });

    return observer;
  }

  /**
   * jxInjectCSS()
   * Lazily inject the effects stylesheet into <head> (idempotent).
   */
  function jxInjectCSS() {
    var id = 'jx-effects-link';
    if (document.getElementById(id)) return;
    var link  = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = '/static/cyberapps/jarvis-effects.css';
    document.head.appendChild(link);
  }

  /**
   * jxPanelEnter(el)
   * Triggers the panel slide-in animation (replays on re-open).
   * @param {HTMLElement} el
   */
  function jxPanelEnter(el) {
    if (!el || reducedMotion()) return;
    el.classList.remove('jx-panel-enter');
    void el.offsetWidth; // reflow
    el.classList.add('jx-panel-enter');
  }

  /**
   * jxAddSparkCursor(svgEl, color)
   * Appends an animated leading-edge dot to a sparkline <svg>.
   * The dot tracks the last point of the first <polyline> in the SVG.
   * @param {SVGElement} svgEl
   * @param {string}     color
   */
  function jxAddSparkCursor(svgEl, color) {
    if (!svgEl || reducedMotion()) return;
    var existing = svgEl.querySelector('.jx-sparkline-cursor');
    if (!existing) {
      var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', '3');
      circle.setAttribute('class', 'jx-sparkline-cursor');
      if (color) circle.style.fill = color;
      svgEl.appendChild(circle);
      existing = circle;
    }
    _positionSparkCursor(svgEl, existing);
  }

  function _positionSparkCursor(svgEl, circleEl) {
    var poly = svgEl.querySelector('polyline');
    if (!poly) return;
    var pts = poly.getAttribute('points') || '';
    var pairs = pts.trim().split(/\s+/);
    if (!pairs.length) return;
    var last = pairs[pairs.length - 1].split(',');
    if (last.length < 2) return;
    circleEl.setAttribute('cx', last[0]);
    circleEl.setAttribute('cy', last[1]);
  }

  /**
   * jxUpdateSparkCursor(svgEl)
   * Re-positions the cursor after sparkline data changes.
   * @param {SVGElement} svgEl
   */
  function jxUpdateSparkCursor(svgEl) {
    if (!svgEl) return;
    var circle = svgEl.querySelector('.jx-sparkline-cursor');
    if (circle) _positionSparkCursor(svgEl, circle);
  }

  // ── Expose public API ──────────────────────────────────────────────────────
  window.JX = {
    animateNumber:         jxAnimateNumber,
    staggerIn:             jxStaggerIn,
    observeAndTickNumbers: jxObserveAndTickNumbers,
    injectCSS:             jxInjectCSS,
    panelEnter:            jxPanelEnter,
    addSparkCursor:        jxAddSparkCursor,
    updateSparkCursor:     jxUpdateSparkCursor,
    reducedMotion:         reducedMotion,
  };

  // Auto-inject CSS when this script loads
  jxInjectCSS();

})();
