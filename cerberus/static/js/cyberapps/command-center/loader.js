/**
 * loader.js — CC Shield-and-Code Loading Animation
 *
 * Draws a shield outline that "writes itself" stroke by stroke using canvas,
 * with cascading code-rain characters behind it using CSS custom property
 * tokens for all colours — no hardcoded hex.
 *
 * Usage:
 *   import { showLoader, hideLoader } from './loader.js';
 *   showLoader(containerEl);
 *   // ... later ...
 *   hideLoader();
 */

// Shield path segments — normalized to a 200x200 viewBox
// Each segment is [x, y] relative to the path "M 100 8 L 20 40 ..."
const SHIELD_COMMANDS = [
  // M 100,8 → start at top
  { cmd: 'M', x: 100, y: 8 },
  // L 20,38 → left shoulder
  { cmd: 'L', x: 20, y: 38 },
  // L 20,110 → left side down
  { cmd: 'L', x: 20, y: 110 },
  // C curve to bottom point
  { cmd: 'C', x1: 20, y1: 158, x2: 60, y2: 178, x: 100, y: 192 },
  // C curve back up right
  { cmd: 'C', x1: 140, y1: 178, x2: 180, y2: 158, x: 180, y: 110 },
  // L → right side up
  { cmd: 'L', x: 180, y: 38 },
  // Close → back to start
  { cmd: 'L', x: 100, y: 8 },
];

// Code rain characters
const CODE_CHARS = '01アイウエオカキクケコサシスセソタチツテトナニヌネノABCDEFGH{}[]<>/\\|=+-_';

let _loaderEl = null;
let _canvas   = null;
let _raf      = null;
let _rainCtx  = null;
let _rainCanvas = null;
let _rainDrops  = [];
let _shieldProgress = 0;  // 0..1
let _startTime = 0;
const DRAW_DURATION = 1200; // ms to draw the shield
const RAIN_COLS = 20;

/**
 * Get a CSS custom property from documentElement.
 * Falls back to `fallback` if not set.
 */
function _cssVar(name, fallback) {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

function _getAccent()  { return _cssVar('--cc-crimson', '#c0392b'); }
function _getFg()      { return _cssVar('--cc-fg',      '#c5c9d0'); }
function _getBg()      { return _cssVar('--bg',         '#060708'); }
function _getGlow()    { return _cssVar('--glow',       'rgba(192,57,43,0.25)'); }

function _isReducedMotion() {
  return document.documentElement.classList.contains('reduced-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Compute the total length of our shield polygon segments
// so we can animate stroke-dashoffset style progress.
function _shieldPoints(W, H) {
  // Scale from 200x200 viewbox to canvas size
  const sx = W / 200;
  const sy = H / 200;
  return [
    { x: 100 * sx, y: 8  * sy },
    { x: 20  * sx, y: 38 * sy },
    { x: 20  * sx, y: 110* sy },
    // cubic approx as straight line to bottom
    { x: 100 * sx, y: 192* sy },
    { x: 180 * sx, y: 110* sy },
    { x: 180 * sx, y: 38 * sy },
    { x: 100 * sx, y: 8  * sy },
  ];
}

function _totalShieldLen(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i-1].x;
    const dy = pts[i].y - pts[i-1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

// Draw shield up to `progress` (0..1)
function _drawShield(ctx, W, H, progress) {
  const pts = _shieldPoints(W, H);
  const totalLen = _totalShieldLen(pts);
  const targetLen = totalLen * progress;

  const accent = _getAccent();
  const glow   = _getGlow();

  ctx.clearRect(0, 0, W, H);

  // Draw glow behind shield
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur  = 18;
  ctx.strokeStyle = glow;
  ctx.lineWidth   = 3;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  ctx.lineTo(pts[1].x, pts[1].y);
  ctx.stroke();
  ctx.restore();

  // Trace shield path up to progress
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.shadowColor = accent;
  ctx.shadowBlur  = 12;

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);

  let drawnLen = 0;
  let done = false;
  for (let i = 1; i < pts.length && !done; i++) {
    const dx = pts[i].x - pts[i-1].x;
    const dy = pts[i].y - pts[i-1].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    const remaining = targetLen - drawnLen;

    if (remaining >= segLen) {
      ctx.lineTo(pts[i].x, pts[i].y);
      drawnLen += segLen;
    } else {
      const t = remaining / segLen;
      ctx.lineTo(
        pts[i-1].x + dx * t,
        pts[i-1].y + dy * t
      );
      done = true;
    }
  }
  ctx.stroke();
  ctx.restore();

  // Shield center glyph (Cerberus tri-head mark) — appears after 80% progress
  if (progress > 0.8) {
    const alpha = Math.min(1, (progress - 0.8) / 0.2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = accent;
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = accent;
    ctx.shadowBlur  = 8;
    const cx = W / 2;
    const cy = H * 0.52;
    const r  = W * 0.08;
    // Three circles — Cerberus three heads
    const offsets = [
      { dx: 0,    dy: -r * 1.2 },
      { dx: -r,   dy: r * 0.4  },
      { dx:  r,   dy: r * 0.4  },
    ];
    offsets.forEach(o => {
      ctx.beginPath();
      ctx.arc(cx + o.dx, cy + o.dy, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }
}

// Code rain — vertical columns of falling characters
function _initRain(canvas) {
  const ctx  = canvas.getContext('2d');
  const W    = canvas.width;
  const H    = canvas.height;
  const cols = RAIN_COLS;
  const colW = W / cols;

  const drops = Array.from({ length: cols }, (_, i) => ({
    x: i * colW + colW / 2,
    y: -(Math.random() * H),
    speed: 12 + Math.random() * 20,
    chars: Array.from({ length: 12 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]),
    alpha: 0.08 + Math.random() * 0.12,
  }));

  return { ctx, W, H, drops };
}

function _drawRain(state) {
  const { ctx, W, H, drops } = state;
  const fg = _getFg();

  ctx.clearRect(0, 0, W, H);
  ctx.font = '11px "Fira Code", monospace';
  ctx.fillStyle = fg;

  drops.forEach(d => {
    d.y += d.speed * 0.5;
    if (d.y > H + 100) {
      d.y = -(80 + Math.random() * 60);
      d.speed = 12 + Math.random() * 20;
    }
    // Mutate lead character occasionally
    if (Math.random() < 0.05) {
      d.chars[0] = CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }

    d.chars.forEach((ch, i) => {
      const yPos = d.y - i * 14;
      if (yPos < 0 || yPos > H) return;
      // Lead character is brighter
      ctx.globalAlpha = i === 0 ? d.alpha * 2.5 : d.alpha * (1 - i / d.chars.length);
      ctx.fillText(ch, d.x - 5, yPos);
    });
  });

  ctx.globalAlpha = 1;
}

/**
 * Show the loader inside `container`.
 * Creates overlay, canvas, and starts animation loop.
 */
export function showLoader(container) {
  if (_loaderEl) return; // already shown

  const W = container.offsetWidth  || 400;
  const H = container.offsetHeight || 400;

  const el = document.createElement('div');
  el.className = 'cc-loader';
  el.setAttribute('aria-label', 'Loading Cerberus Command Center');
  el.setAttribute('role', 'status');
  el.style.cssText = [
    'position:absolute',
    'inset:0',
    'z-index:100',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'pointer-events:none',
    `background:var(--bg,#060708)`,
    'transition:opacity 0.5s ease',
  ].join(';');

  // Rain canvas (behind)
  const rainCanvas = document.createElement('canvas');
  rainCanvas.width  = W;
  rainCanvas.height = H;
  rainCanvas.setAttribute('aria-hidden', 'true');
  rainCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.35;';

  // Shield canvas (on top)
  const shieldCanvas = document.createElement('canvas');
  const CS = Math.min(W, H) * 0.45;
  shieldCanvas.width  = CS;
  shieldCanvas.height = CS;
  shieldCanvas.className = 'cc-loader-shield';
  shieldCanvas.setAttribute('aria-hidden', 'true');
  shieldCanvas.style.cssText = 'position:relative;z-index:2;';

  // Status text
  const statusEl = document.createElement('div');
  statusEl.className = 'cc-loader-status';
  statusEl.textContent = 'INITIALIZING';
  statusEl.style.cssText = [
    'font-family:"Orbitron","Fira Code",monospace',
    'font-size:10px',
    'letter-spacing:0.22em',
    'text-transform:uppercase',
    `color:var(--cc-crimson,#c0392b)`,
    'margin-top:12px',
    'opacity:0.7',
    'position:relative',
    'z-index:2',
  ].join(';');

  el.appendChild(rainCanvas);
  el.appendChild(shieldCanvas);
  el.appendChild(statusEl);

  // Make container relative if not already
  const pos = getComputedStyle(container).position;
  if (pos === 'static') container.style.position = 'relative';

  container.appendChild(el);
  _loaderEl = el;
  _canvas   = shieldCanvas;
  _rainCanvas = rainCanvas;
  _startTime  = performance.now();

  // Reduced motion: skip to end, fade out quickly
  if (_isReducedMotion()) {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.15s ease';
    setTimeout(() => hideLoader(), 150);
    return;
  }

  const rainState = _initRain(rainCanvas);

  const STATUS_MSGS = [
    'INITIALIZING', 'LOADING MODULES', 'CONNECTING', 'SECURING CHANNEL', 'ONLINE',
  ];
  let lastStatus = -1;

  function frame(now) {
    const elapsed = now - _startTime;
    const rawProg = Math.min(1, elapsed / DRAW_DURATION);
    // ease out
    const progress = 1 - Math.pow(1 - rawProg, 3);

    _drawShield(shieldCanvas.getContext('2d'), CS, CS, progress);
    _drawRain(rainState);

    // Update status text
    const msgIdx = Math.min(STATUS_MSGS.length - 1, Math.floor(progress * STATUS_MSGS.length));
    if (msgIdx !== lastStatus) {
      statusEl.textContent = STATUS_MSGS[msgIdx];
      lastStatus = msgIdx;
    }

    if (rawProg < 1 && _loaderEl) {
      _raf = requestAnimationFrame(frame);
    }
    // Note: hideLoader() is called externally by init() after content is ready
  }

  _raf = requestAnimationFrame(frame);
}

/**
 * Hide and remove the loader.
 * Fades out over 400ms then removes from DOM.
 */
export function hideLoader() {
  if (!_loaderEl) return;
  const el = _loaderEl;
  _loaderEl = null;

  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }

  el.style.transition = 'opacity 0.4s ease';
  el.style.opacity    = '0';

  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
    _canvas     = null;
    _rainCanvas = null;
    _rainDrops  = [];
  }, 420);
}
