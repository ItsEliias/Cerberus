// Atlas Core — backdrop particles + wireframe neural globe (mouse-driven rotation)

let _globeRaf = 0;
let _globeRunning = false;
let _backdropRaf = 0;
let _backdropRunning = false;

let _globeRotX = 0.28;
let _globeRotY = 0;
const _rotListeners = new Set();

export function getGlobeRotation() {
  return { rotX: _globeRotX, rotY: _globeRotY };
}

export function setGlobeRotation(rotX, rotY) {
  _globeRotX = Math.max(-1.35, Math.min(1.35, rotX));
  _globeRotY = rotY;
  _rotListeners.forEach((fn) => fn(_globeRotX, _globeRotY));
}

export function addGlobeRotation(dRotX, dRotY) {
  setGlobeRotation(_globeRotX + dRotX, _globeRotY + dRotY);
}

export function subscribeGlobeRotation(fn) {
  _rotListeners.add(fn);
  return () => _rotListeners.delete(fn);
}

function _initParticles(w, h, count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    pts.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      r: Math.random() * 1.2 + 0.3,
      a: Math.random() * 0.35 + 0.08,
    });
  }
  return pts;
}

function _spherePoints(nLat, nLon) {
  const pts = [];
  for (let lat = 0; lat <= nLat; lat++) {
    const phi = (lat / nLat) * Math.PI;
    for (let lon = 0; lon < nLon; lon++) {
      const theta = (lon / nLon) * Math.PI * 2;
      pts.push({
        x: Math.sin(phi) * Math.cos(theta),
        y: Math.cos(phi),
        z: Math.sin(phi) * Math.sin(theta),
        ox: Math.sin(phi) * Math.cos(theta),
        oy: Math.cos(phi),
        oz: Math.sin(phi) * Math.sin(theta),
        phase: Math.random() * Math.PI * 2,
      });
    }
  }
  return pts;
}

function _fibonacciSphere(count) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    pts.push({ x, y, z, ox: x, oy: y, oz: z, phase: Math.random() * Math.PI * 2 });
  }
  return pts;
}

/** Persistent full-screen particle field for the Cerberus OS shell. */
export function startCerberusBackdrop() {
  const pCanvas = document.getElementById('cerberus-mc-particles');
  if (!pCanvas || _backdropRunning) return;

  const pCtx = pCanvas.getContext('2d');
  _backdropRunning = true;
  let particles = [];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = window.innerWidth;
    const ph = window.innerHeight;
    pCanvas.width = Math.floor(pw * dpr);
    pCanvas.height = Math.floor(ph * dpr);
    pCanvas.style.width = pw + 'px';
    pCanvas.style.height = ph + 'px';
    pCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    particles = _initParticles(pw, ph, 80);
  }

  function frame() {
    if (!_backdropRunning) return;
    const pw = window.innerWidth;
    const ph = window.innerHeight;
    pCtx.clearRect(0, 0, pw, ph);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = pw;
      if (p.x > pw) p.x = 0;
      if (p.y < 0) p.y = ph;
      if (p.y > ph) p.y = 0;
      pCtx.beginPath();
      pCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      pCtx.fillStyle = `rgba(100, 220, 255, ${p.a})`;
      pCtx.fill();
    }
    _backdropRaf = requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  pCanvas._atlasBackdropResize = resize;
  _backdropRaf = requestAnimationFrame(frame);
}

export function stopAtlasBackdrop() {
  _backdropRunning = false;
  if (_backdropRaf) cancelAnimationFrame(_backdropRaf);
  _backdropRaf = 0;
  const pCanvas = document.getElementById('cerberus-mc-particles');
  if (pCanvas && pCanvas._atlasBackdropResize) {
    window.removeEventListener('resize', pCanvas._atlasBackdropResize);
    delete pCanvas._atlasBackdropResize;
  }
}

export function startCerberusCore() {
  const canvas = document.getElementById('cerberus-core-canvas');
  if (!canvas) return;

  if (_globeRunning) {
    if (canvas._cerberusCoreResize) canvas._cerberusCoreResize();
    return;
  }

  const ctx = canvas.getContext('2d');
  _globeRunning = true;

  let w = 0;
  let h = 0;
  let sphere = _fibonacciSphere(2000).concat(_spherePoints(16, 32));
  let _retryTimer = 0;
  let mouseX = -9999;
  let mouseY = -9999;
  let mouseEnergy = 0; // 0..1 — rises with cursor speed, decays per frame
  let lastMouseX = -9999;
  let lastMouseY = -9999;
  let lastMouseAt = 0;
  const viewport = document.getElementById('cerberus-graph-viewport');

  const onMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const layoutW = w || canvas.offsetWidth || rect.width || 1;
    const layoutH = h || canvas.offsetHeight || rect.height || 1;
    const scaleX = rect.width / layoutW;
    const scaleY = rect.height / layoutH;
    mouseX = (e.clientX - rect.left) / (scaleX || 1);
    mouseY = (e.clientY - rect.top) / (scaleY || 1);
    const now = performance.now();
    if (lastMouseAt && lastMouseX > -1000) {
      const dt = Math.max(8, now - lastMouseAt);
      const speed = Math.hypot(mouseX - lastMouseX, mouseY - lastMouseY) / dt; // px per ms
      mouseEnergy = Math.min(1, mouseEnergy + speed * 0.18);
    }
    lastMouseX = mouseX;
    lastMouseY = mouseY;
    lastMouseAt = now;
  };
  const onLeave = () => {
    mouseX = -9999;
    mouseY = -9999;
    lastMouseX = -9999;
    lastMouseAt = 0;
  };
  (viewport || canvas.parentElement || document).addEventListener('mousemove', onMove);
  (viewport || canvas.parentElement || document).addEventListener('mouseleave', onLeave);
  canvas._cerberusCoreMouseCleanup = () => {
    (viewport || canvas.parentElement || document).removeEventListener('mousemove', onMove);
    (viewport || canvas.parentElement || document).removeEventListener('mouseleave', onLeave);
  };

  function resize() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nw = Math.floor(parent.offsetWidth || parent.clientWidth)
      || Math.floor(parseInt(getComputedStyle(parent).width, 10)) || 420;
    const nh = Math.floor(parent.offsetHeight || parent.clientHeight)
      || Math.floor(parseInt(getComputedStyle(parent).height, 10)) || 420;
    if (nw < 8 || nh < 8) {
      if (!_retryTimer) {
        _retryTimer = window.setTimeout(() => {
          _retryTimer = 0;
          resize();
        }, 120);
      }
      return;
    }
    // Re-allocating the canvas resets the context — only do it when the
    // size truly changed (this used to run every frame and burned CPU).
    const pw = Math.floor(nw * dpr);
    const ph = Math.floor(nh * dpr);
    w = nw;
    h = nh;
    if (canvas.width === pw && canvas.height === ph) return;
    canvas.width = pw;
    canvas.height = ph;
    canvas.style.width = nw + 'px';
    canvas.style.height = nh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function _themeRgb() {
    const raw = getComputedStyle(document.body).getPropertyValue('--atlas-rgb').trim() || '80, 200, 255';
    const parts = raw.split(',').map((n) => parseInt(n.trim(), 10));
    return [parts[0] || 80, parts[1] || 200, parts[2] || 255];
  }

  function _graphZoom() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--atlas-graph-zoom').trim();
    const z = parseFloat(raw);
    return Number.isFinite(z) && z > 0 ? z : 1;
  }

  function _rotateProject(x, y, z, rotX, rotY, cx, cy, r) {
    const cy2 = Math.cos(rotY);
    const sy2 = Math.sin(rotY);
    const x1 = x * cy2 + z * sy2;
    const z1 = -x * sy2 + z * cy2;
    const cx1 = Math.cos(rotX);
    const sx1 = Math.sin(rotX);
    const y2 = y * cx1 - z1 * sx1;
    const z2 = y * sx1 + z1 * cx1;
    return { sx: cx + x1 * r, sy: cy + y2 * r, z: z2 };
  }

  function _drawTechWireframe(cx, cy, radius, rotX, rotY, tr, tg, tb, alpha) {
    const nLat = 10;
    const nLon = 20;
    ctx.lineWidth = 0.55;
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(${tr}, ${tg}, ${tb}, ${alpha * 0.55})`;

    for (let lat = 1; lat < nLat; lat++) {
      const phi = (lat / nLat) * Math.PI;
      ctx.beginPath();
      let started = false;
      for (let lon = 0; lon <= nLon; lon++) {
        const theta = (lon / nLon) * Math.PI * 2;
        const x = Math.sin(phi) * Math.cos(theta);
        const y = Math.cos(phi);
        const z = Math.sin(phi) * Math.sin(theta);
        const p = _rotateProject(x, y, z, rotX, rotY, cx, cy, radius);
        if (p.z < -0.08) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(p.sx, p.sy);
          started = true;
        } else {
          ctx.lineTo(p.sx, p.sy);
        }
      }
      ctx.stroke();
    }

    for (let lon = 0; lon < nLon; lon++) {
      const theta = (lon / nLon) * Math.PI * 2;
      ctx.beginPath();
      let started = false;
      for (let lat = 0; lat <= nLat; lat++) {
        const phi = (lat / nLat) * Math.PI;
        const x = Math.sin(phi) * Math.cos(theta);
        const y = Math.cos(phi);
        const z = Math.sin(phi) * Math.sin(theta);
        const p = _rotateProject(x, y, z, rotX, rotY, cx, cy, radius);
        if (p.z < -0.08) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(p.sx, p.sy);
          started = true;
        } else {
          ctx.lineTo(p.sx, p.sy);
        }
      }
      ctx.stroke();
    }
  }

  function _drawOrbitalRings(cx, cy, radius, rotX, rotY, tr, tg, tb, alpha, now) {
    ctx.lineWidth = 0.85;
    for (let i = 0; i < 5; i++) {
      const tilt = rotX + (i - 2) * 0.32 + Math.sin(now * 0.0004 + i) * 0.04;
      const ry = radius * Math.cos(tilt);
      const rx = radius * (1.02 + i * 0.02);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, Math.max(8, ry), 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${tr}, ${tg}, ${tb}, ${alpha * (0.45 + i * 0.12)})`;
      ctx.stroke();
    }
  }

  function _drawOuterTechShell(cx, cy, radius, rotX, rotY, tr, tg, tb, alpha, now) {
    const outerR = radius * 1.14;
    const webR = radius * 1.08;
    const tickCount = 48;

    ctx.lineWidth = 0.65;
    ctx.strokeStyle = `rgba(${tr}, ${tg}, ${tb}, ${alpha * 0.7})`;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 0.45;
    ctx.strokeStyle = `rgba(${tr}, ${tg}, ${tb}, ${alpha * 0.35})`;
    ctx.beginPath();
    ctx.arc(cx, cy, webR, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < tickCount; i++) {
      const a = (i / tickCount) * Math.PI * 2 + rotY * 0.15;
      const major = i % 6 === 0;
      const inner = outerR - (major ? 10 : 5);
      const x0 = cx + Math.cos(a) * inner;
      const y0 = cy + Math.sin(a) * inner;
      const x1 = cx + Math.cos(a) * (outerR + (major ? 4 : 2));
      const y1 = cy + Math.sin(a) * (outerR + (major ? 4 : 2));
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = `rgba(${tr}, ${tg}, ${tb}, ${alpha * (major ? 0.55 : 0.28)})`;
      ctx.lineWidth = major ? 0.9 : 0.45;
      ctx.stroke();
    }

    const spokes = 12;
    ctx.strokeStyle = `rgba(${tr}, ${tg}, ${tb}, ${alpha * 0.22})`;
    ctx.lineWidth = 0.4;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + rotX * 0.2;
      const x0 = cx + Math.cos(a) * webR;
      const y0 = cy + Math.sin(a) * webR;
      const x1 = cx + Math.cos(a + 0.35) * outerR;
      const y1 = cy + Math.sin(a + 0.35) * outerR;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    const segCount = 6;
    ctx.setLineDash([6, 10]);
    ctx.lineDashOffset = -(now * 0.02) % 16;
    for (let i = 0; i < segCount; i++) {
      const a0 = (i / segCount) * Math.PI * 2 + rotY * 0.08;
      const a1 = a0 + (Math.PI * 2 / segCount) * 0.55;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR + 6, a0, a1);
      ctx.strokeStyle = `rgba(${tr}, ${tg}, ${tb}, ${alpha * 0.4})`;
      ctx.lineWidth = 0.55;
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawGlobe(now) {
    if (w < 8 || h < 8) return;
    const isBgGlobe = canvas.parentElement?.classList.contains('cerberus-mc-globe-bg');
    const [tr, tg, tb] = _themeRgb();
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * (isBgGlobe ? 0.46 : 0.4);
    const graphZoom = isBgGlobe ? _graphZoom() : 1;
    const zoomBoost = graphZoom < 1 ? Math.min(3, 1 / Math.max(0.25, graphZoom)) : 1;
    const visMul = 1 + (zoomBoost - 1) * 0.65;
    const rotY = _globeRotY;
    const rotX = _globeRotX;
    // Cursor energy: faster mouse movement → wider, stronger particle response.
    mouseEnergy *= 0.94;
    if (mouseEnergy < 0.005) mouseEnergy = 0;
    const energyBoost = 1 + mouseEnergy * 0.9;
    const repulseR = radius * 0.55 * (1 + mouseEnergy * 0.35);

    ctx.clearRect(0, 0, w, h);

    const shellAlpha = isBgGlobe ? Math.min(0.42, 0.14 + zoomBoost * 0.08) : 0.18;
    const coreGlow = ctx.createRadialGradient(cx, cy, radius * 0.02, cx, cy, radius * 0.95);
    coreGlow.addColorStop(0, `rgba(${Math.min(255, tr + 80)}, ${Math.min(255, tg + 60)}, 255, ${0.28 * visMul})`);
    coreGlow.addColorStop(0.35, `rgba(${tr}, ${tg}, ${tb}, ${0.12 * visMul})`);
    coreGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.95, 0, Math.PI * 2);
    ctx.fill();

    if (isBgGlobe) {
      _drawTechWireframe(cx, cy, radius, rotX, rotY, tr, tg, tb, shellAlpha);
      _drawOrbitalRings(cx, cy, radius, rotX, rotY, tr, tg, tb, shellAlpha, now);
    }

    const projected = [];
    for (const p of sphere) {
      let x = p.ox + (p.x - p.ox) * 0.08;
      let y = p.oy + (p.y - p.oy) * 0.08;
      let z = p.oz + (p.z - p.oz) * 0.08;
      p.x += (x - p.x) * 0.12;
      p.y += (y - p.y) * 0.12;
      p.z += (z - p.z) * 0.12;

      const cy2 = Math.cos(rotY);
      const sy2 = Math.sin(rotY);
      const x1 = p.x * cy2 + p.z * sy2;
      const z1 = -p.x * sy2 + p.z * cy2;
      const cx1 = Math.cos(rotX);
      const sx1 = Math.sin(rotX);
      const y2 = p.y * cx1 - z1 * sx1;
      const z2 = p.y * sx1 + z1 * cx1;
      let sx = cx + x1 * radius;
      let sy = cy + y2 * radius;

      if (mouseX > -1000 && z2 > 0.18) {
        const dx = sx - mouseX;
        const dy = sy - mouseY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < repulseR && dist > 0.001) {
          const force = (1 - dist / repulseR) * 0.35 * energyBoost;
          p.x += (dx / dist) * force * 0.04;
          p.y += (dy / dist) * force * 0.04;
          p.z += force * 0.02;
          sx += (dx / dist) * force * (18 + mouseEnergy * 14);
          sy += (dy / dist) * force * (18 + mouseEnergy * 14);
        }
      }

      projected.push({ sx, sy, z: z2, phase: p.phase });
    }

    projected.sort((a, b) => a.z - b.z);

    for (const n of projected) {
      const twinkle = 0.55 + Math.sin(now * 0.003 + n.phase) * 0.45;
      const alpha = (0.18 + (n.z + 1) * 0.5) * twinkle * visMul;
      const r = (0.75 + (n.z + 1) * 1.05) * (isBgGlobe ? 1 + (zoomBoost - 1) * 0.35 : 1);
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${Math.min(255, tr + 50)}, ${Math.min(255, tg + 40)}, ${Math.min(255, tb + 20)}, ${Math.min(1, alpha)})`;
      ctx.fill();
      if (n.z > 0.1) {
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, r * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${tr}, ${tg}, ${tb}, ${Math.min(0.35, alpha * 0.12 * visMul)})`;
        ctx.fill();
      }
    }

    if (isBgGlobe) {
      _drawOuterTechShell(cx, cy, radius, rotX, rotY, tr, tg, tb, shellAlpha, now);
    }

    const glowInner = 0.28 + (zoomBoost - 1) * 0.14;
    const glowMid = 0.08 + (zoomBoost - 1) * 0.06;
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.05, cx, cy, radius * 1.25);
    glow.addColorStop(0, `rgba(${tr}, ${tg}, ${tb}, ${glowInner})`);
    glow.addColorStop(0.45, `rgba(${Math.floor(tr * 0.5)}, ${Math.floor(tg * 0.6)}, ${Math.floor(tb * 0.78)}, ${glowMid})`);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.25, 0, Math.PI * 2);
    ctx.fill();
  }

  function frame(now) {
    if (!_globeRunning) return;
    resize();
    drawGlobe(now);
    _globeRaf = requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  canvas._cerberusCoreResize = resize;
  _globeRaf = requestAnimationFrame(frame);
}

export function stopAtlasCore() {
  _globeRunning = false;
  if (_globeRaf) cancelAnimationFrame(_globeRaf);
  _globeRaf = 0;
  const canvas = document.getElementById('cerberus-core-canvas');
  if (canvas) {
    if (canvas._cerberusCoreResize) {
      window.removeEventListener('resize', canvas._cerberusCoreResize);
      delete canvas._cerberusCoreResize;
    }
    canvas._cerberusCoreMouseCleanup?.();
    delete canvas._cerberusCoreMouseCleanup;
  }
}
