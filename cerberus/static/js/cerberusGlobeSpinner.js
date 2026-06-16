// cerberusGlobeSpinner.js — theme-reactive mini canvas globe spinner
// Drop-in replacement for .spinner / .loading-dots.
// Reads --red each frame; re-colours live on theme switch.

function _fibSphere(n) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = golden * i;
    pts.push({ x: Math.cos(t) * r, y, z: Math.sin(t) * r, phase: Math.random() * Math.PI * 2 });
  }
  return pts;
}

function _parseRed() {
  const hex = getComputedStyle(document.documentElement).getPropertyValue('--red').trim();
  if (hex && hex.startsWith('#') && hex.length >= 7) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  return [192, 57, 43];
}

/**
 * createGlobeSpinner(size) — returns { element, start(), stop(), destroy() }
 * element is a <canvas> ready to append.
 * start() begins the RAF loop; stop() cancels it; destroy() removes the element.
 */
export function createGlobeSpinner(size = 32) {
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(size * dpr);
  canvas.height = Math.floor(size * dpr);
  canvas.style.cssText = `width:${size}px;height:${size}px;display:block;`;
  canvas.className = 'cerberus-globe-spinner';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const pts = _fibSphere(prefersReduced ? 0 : 60);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.36;
  let raf = 0;
  let running = false;
  let rotY = 0;

  function frame(now) {
    if (!running) return;
    rotY += 0.022;

    const [tr, tg, tb] = _parseRed();
    ctx.clearRect(0, 0, size, size);

    // Outer halo ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.18, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${tr},${tg},${tb},0.12)`;
    ctx.lineWidth = 0.7;
    ctx.stroke();

    // Inner solid ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.02, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${tr},${tg},${tb},0.22)`;
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // Spinning equatorial arc
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotY * 0.6);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.02, -Math.PI * 0.25, Math.PI * 0.9);
    ctx.strokeStyle = `rgba(${tr},${tg},${tb},0.7)`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // Bright leading dot
    const lx = Math.cos(Math.PI * 0.9) * radius * 1.02;
    const ly = Math.sin(Math.PI * 0.9) * radius * 1.02;
    ctx.beginPath();
    ctx.arc(lx, ly, 1.4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${tr},${tg},${tb},0.95)`;
    ctx.fill();
    ctx.restore();

    // Counter-rotation inner arc
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rotY * 0.4 + 1.2);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.72, 0, Math.PI * 0.65);
    ctx.strokeStyle = `rgba(${tr},${tg},${tb},0.35)`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();

    // Particles
    for (const p of pts) {
      const cy2 = Math.cos(rotY);
      const sy2 = Math.sin(rotY);
      const x1 = p.x * cy2 + p.z * sy2;
      const z1 = -p.x * sy2 + p.z * cy2;
      const tiltX = 0.38;
      const cx1 = Math.cos(tiltX);
      const sx1 = Math.sin(tiltX);
      const y2 = p.y * cx1 - z1 * sx1;
      const z2 = p.y * sx1 + z1 * cx1;
      if (z2 < 0) continue;
      const twinkle = 0.55 + Math.sin(now * 0.003 + p.phase) * 0.45;
      const alpha = (0.15 + (z2 + 1) * 0.38) * twinkle;
      const pr = 0.7 + z2 * 0.9;
      ctx.beginPath();
      ctx.arc(cx + x1 * radius, cy + y2 * radius, pr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${tr},${tg},${tb},${Math.min(1, alpha)})`;
      ctx.fill();
    }

    // Core glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.7);
    glow.addColorStop(0, `rgba(${tr},${tg},${tb},0.14)`);
    glow.addColorStop(1, `rgba(${tr},${tg},${tb},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.7, 0, Math.PI * 2);
    ctx.fill();

    raf = requestAnimationFrame(frame);
  }

  function startReduced() {
    const [tr, tg, tb] = _parseRed();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${tr},${tg},${tb},0.5)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    let op = 0;
    raf = setInterval(() => {
      ctx.clearRect(0, 0, size, size);
      op = (op + 0.06) % (Math.PI * 2);
      const [r, g, b] = _parseRed();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.35 + Math.sin(op) * 0.25})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }, 80);
  }

  return {
    element: canvas,
    start() {
      if (running) return;
      running = true;
      if (prefersReduced) { startReduced(); } else { raf = requestAnimationFrame(frame); }
    },
    stop() {
      running = false;
      if (prefersReduced) { clearInterval(raf); } else { if (raf) cancelAnimationFrame(raf); }
      raf = 0;
    },
    destroy() { this.stop(); canvas.remove(); },
  };
}

/**
 * Convenience: creates and starts a globe spinner, wraps in a div matching .spinner sizing.
 * Returns { element, destroy() }
 */
export function createGlobeSpinnerDiv(size = 24) {
  const sp = createGlobeSpinner(size);
  const wrap = document.createElement('div');
  wrap.className = 'cerberus-globe-spinner-wrap';
  wrap.style.cssText = `width:${size}px;height:${size}px;margin:8px auto;`;
  wrap.appendChild(sp.element);
  sp.start();
  return { element: wrap, destroy: () => sp.destroy() };
}
