/**
 * council-graph-svg.js — SVG generation + partial-update for COUNCIL graph.
 * Exported: SPEC, H_POS, R_POS, buildHierarchySVG, updateHierarchyNodes,
 *           buildReplaySVG, updateReplayEdges
 *
 * Build once, then call update functions on each poll — animations never restart.
 */

export const SPEC = [
  'ARCHITECT','CODER','TESTER','RESEARCHER','REVIEWER',
  'SECURITY','DEVOPS','DEBUGGER','PLANNER','LIBRARIAN',
  'DATA-ANALYST','DESIGNER','SCRIBE','OPTIMIZER','PROMPTSMITH',
];

// Hierarchy: 3 rows × 5, x=[160..800], y=[228,368,515]
const HX = [160,320,480,640,800];
const HY = [228,368,515];
export const H_POS = SPEC.map((_,i) => ({ x: HX[i%5], y: HY[Math.floor(i/5)] }));

// Replay: 15 specialists in circle, center (480,256), radius 190
const [RCX,RCY,RR] = [480,256,190];
export const R_POS = SPEC.map((_,i) => {
  const θ = -Math.PI/2 + i*(2*Math.PI/15);
  return { x: Math.round(RCX+RR*Math.cos(θ)), y: Math.round(RCY+RR*Math.sin(θ)) };
});

export function _esc(s) {
  const d = document.createElement('div'); d.textContent = String(s||''); return d.innerHTML;
}

function _stroke(st) {
  if (st==='active')     return 'rgba(46,204,113,.50)';
  if (st==='processing') return 'rgba(192,57,43,.75)';
  if (st==='idle')       return 'rgba(230,126,34,.30)';
  return 'rgba(61,72,87,.22)';
}
function _accent(st) {
  if (st==='active')     return 'rgba(46,204,113,.65)';
  if (st==='processing') return 'rgba(192,57,43,.90)';
  if (st==='idle')       return 'rgba(230,126,34,.55)';
  return 'rgba(61,72,87,.38)';
}
function _dot(st) {
  if (st==='active'||st==='processing') return st==='processing' ? 'var(--cc-crimson,#c0392b)' : '#2ecc71';
  if (st==='idle') return '#e67e22';
  return '#3d4857';
}
function _edgeStroke(st, tier) {
  if (st==='processing') return { s:'rgba(192,57,43,.60)', w:1.5, cls:'ccg-edge-active' };
  if (st==='active')     return { s:'rgba(46,204,113,.22)', w:1,   cls:'' };
  if (st==='idle')       return { s:`rgba(255,255,255,${tier===0?.06:tier===1?.05:.03})`, w:.7, cls:'' };
  return { s:`rgba(255,255,255,${tier===0?.05:tier===1?.04:.03})`, w:.5, cls:'' };
}

// ── HIERARCHY SVG ────────────────────────────────────────────────────────────

export function buildHierarchySVG(agents) {
  const byName = {};
  (agents||[]).forEach(a => { byName[a.name.toUpperCase()] = a; });
  const active  = (agents||[]).filter(a=>a.status==='active'||a.status==='processing').length;
  const idle    = (agents||[]).filter(a=>a.status==='idle').length;
  const standby = (agents||[]).length - active - idle;

  const edges = SPEC.map((name,i) => {
    const a = byName[name]; const st = a ? a.status : 'standby';
    const tier = Math.floor(i/5);
    const { s, w, cls } = _edgeStroke(st, tier);
    const { x, y } = H_POS[i];
    return `<line data-edge="${_esc(name)}" x1="480" y1="118" x2="${x}" y2="${y-26}"
      stroke="${s}" stroke-width="${w}" class="${cls}"/>`;
  }).join('');

  const nodes = SPEC.map((name,i) => {
    const a = byName[name]||{}; const st = a.status||'standby';
    const tier = Math.floor(i/5);
    const { x, y } = H_POS[i];
    const hw = tier===0?46:tier===1?43:38; const hh = tier===0?23:tier===1?21:18;
    const fz  = tier===0?7.5:tier===1?7:5.5;
    const fg   = st==='standby'?(tier===0?.45:.30):(st==='idle'?.72:.92);
    const act  = a.current_action ? _esc(String(a.current_action).slice(0,22)) : '';
    return `<g class="ccg-spec" data-spec="${_esc(name)}" data-id="${_esc(a.id||'')}}"
        transform="translate(${x},${y})">
      <circle class="ccg-node-halo" cx="0" cy="0" r="${hw}"
        fill="rgba(46,204,113,.06)" style="opacity:${(st==='active')?1:0}"/>
      <rect class="ccg-nrect" x="${-hw}" y="${-hh}" width="${hw*2}" height="${hh*2}" rx="3"
        fill="rgba(15,18,21,.96)" stroke="${_stroke(st)}" stroke-width="${st==='processing'?1.5:.9}"/>
      <rect class="ccg-nacct" x="${-hw}" y="${-hh}" width="3" height="${hh*2}" rx="1" fill="${_accent(st)}"/>
      <text y="${tier===0?-6:-4}" text-anchor="middle" dominant-baseline="middle"
        style="fill:rgba(197,201,208,${fg});font-family:'JetBrains Mono','Courier New',monospace;font-size:${fz}px;font-weight:600;letter-spacing:.09em">
        ${_esc(name)}</text>
      ${(tier===0&&act)?`<text y="8" text-anchor="middle" dominant-baseline="middle"
        style="fill:rgba(255,255,255,.26);font-family:'JetBrains Mono','Courier New',monospace;font-size:5.5px;letter-spacing:.06em">
        ${act}</text>`:''}
      <circle class="ccg-sdot" cx="${hw-10}" cy="${-hh+6}" r="${tier===0?3:2.5}" fill="${_dot(st)}"/>
    </g>`;
  }).join('');

  return `<svg class="cc-graph-svg" viewBox="0 0 960 572" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="ccg-grid" width="38" height="38" patternUnits="userSpaceOnUse">
      <path d="M38 0L0 0 0 38" fill="none" stroke="rgba(255,255,255,.026)" stroke-width=".5"/></pattern>
    <filter id="ccg-fr" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  <rect width="960" height="572" fill="url(#ccg-grid)"/>
  ${edges}
  <circle id="ccg-orch-ring" class="ccg-orch-ring" cx="480" cy="72" r="50"
    fill="none" stroke="rgba(192,57,43,.28)" stroke-width=".75"/>
  <circle cx="480" cy="72" r="36" fill="rgba(192,57,43,.09)" filter="url(#ccg-fr)"/>
  <polygon points="480,34 513,53 513,91 480,110 447,91 447,53"
    fill="rgba(192,57,43,.07)" stroke="var(--cc-crimson,#c0392b)" stroke-width="1.4"/>
  <text x="480" y="68" text-anchor="middle" dominant-baseline="middle"
    style="fill:var(--cc-crimson,#c0392b);font-family:'JetBrains Mono','Courier New',monospace;font-size:7.5px;font-weight:700;letter-spacing:.15em">ORCHESTRATOR</text>
  <text x="480" y="82" text-anchor="middle" dominant-baseline="middle"
    style="fill:rgba(192,57,43,.48);font-family:'JetBrains Mono','Courier New',monospace;font-size:5.5px;letter-spacing:.12em">CONDUCTOR</text>
  <circle cx="510" cy="45" r="3.5" fill="var(--cc-crimson,#c0392b)" filter="url(#ccg-fr)"/>
  ${nodes}
  <g transform="translate(836,16)">
    <rect width="110" height="64" rx="2" fill="rgba(8,10,12,.92)" stroke="rgba(255,255,255,.055)" stroke-width="1"/>
    <rect width="110" height="13" rx="2" fill="rgba(192,57,43,.07)"/>
    <text x="8" y="9.5" dominant-baseline="middle" style="fill:rgba(192,57,43,.55);font-family:'JetBrains Mono','Courier New',monospace;font-size:5.5px;font-weight:600;letter-spacing:.18em">// STATUS</text>
    <text class="ccg-hud-a" x="8" y="28" dominant-baseline="middle" style="fill:rgba(197,201,208,.85);font-family:'JetBrains Mono','Courier New',monospace;font-size:12px;font-weight:700">${active}</text>
    <text x="26" y="28" dominant-baseline="middle" style="fill:rgba(197,201,208,.32);font-family:'JetBrains Mono','Courier New',monospace;font-size:6px">ACTIVE</text>
    <text class="ccg-hud-i" x="8" y="43" dominant-baseline="middle" style="fill:rgba(197,201,208,.85);font-family:'JetBrains Mono','Courier New',monospace;font-size:12px;font-weight:700">${idle}</text>
    <text x="26" y="43" dominant-baseline="middle" style="fill:rgba(197,201,208,.32);font-family:'JetBrains Mono','Courier New',monospace;font-size:6px">IDLE</text>
    <text class="ccg-hud-s" x="8" y="57" dominant-baseline="middle" style="fill:rgba(197,201,208,.85);font-family:'JetBrains Mono','Courier New',monospace;font-size:12px;font-weight:700">${standby}</text>
    <text x="28" y="57" dominant-baseline="middle" style="fill:rgba(197,201,208,.32);font-family:'JetBrains Mono','Courier New',monospace;font-size:6px">STANDBY</text>
  </g>
  <text x="14" y="228" dominant-baseline="middle" style="fill:rgba(255,255,255,.09);font-family:'JetBrains Mono','Courier New',monospace;font-size:5.5px;letter-spacing:.14em">TIER-1</text>
  <text x="14" y="368" dominant-baseline="middle" style="fill:rgba(255,255,255,.06);font-family:'JetBrains Mono','Courier New',monospace;font-size:5.5px;letter-spacing:.14em">TIER-2</text>
  <text x="14" y="515" dominant-baseline="middle" style="fill:rgba(255,255,255,.04);font-family:'JetBrains Mono','Courier New',monospace;font-size:5.5px;letter-spacing:.14em">TIER-3</text>
</svg>`;
}

// Patch hierarchy node states without rebuilding SVG (animations stay live)
export function updateHierarchyNodes(svgEl, agents) {
  if (!svgEl) return;
  const byName = {};
  (agents||[]).forEach(a => { byName[a.name.toUpperCase()] = a; });

  SPEC.forEach(name => {
    const g = svgEl.querySelector(`[data-spec="${CSS.escape(name)}"]`);
    if (!g) return;
    const a = byName[name]; const st = a ? a.status : 'standby';
    const r = g.querySelectorAll('rect');
    if (r[0]) r[0].style.stroke = _stroke(st);
    if (r[1]) r[1].style.fill   = _accent(st);
    const dot = g.querySelector('.ccg-sdot');
    if (dot) dot.style.fill = _dot(st);
    const halo = g.querySelector('.ccg-node-halo');
    if (halo) halo.style.opacity = (st==='active'||st==='processing') ? '1' : '0';
    const edge = svgEl.querySelector(`[data-edge="${CSS.escape(name)}"]`);
    if (edge) {
      const { s, w, cls } = _edgeStroke(st, Math.floor(SPEC.indexOf(name)/5));
      edge.style.stroke = s; edge.style.strokeWidth = w;
      edge.classList.toggle('ccg-edge-active', cls==='ccg-edge-active');
      edge.style.strokeDasharray = cls==='ccg-edge-active' ? '6 3' : '';
    }
  });

  const active  = (agents||[]).filter(a=>a.status==='active'||a.status==='processing').length;
  const idle    = (agents||[]).filter(a=>a.status==='idle').length;
  const standby = (agents||[]).length - active - idle;
  const ha = svgEl.querySelector('.ccg-hud-a'); if (ha) ha.textContent = active;
  const hi = svgEl.querySelector('.ccg-hud-i'); if (hi) hi.textContent = idle;
  const hs = svgEl.querySelector('.ccg-hud-s'); if (hs) hs.textContent = standby;
}

// ── REPLAY SVG ───────────────────────────────────────────────────────────────

export function buildReplaySVG() {
  const coldEdges = SPEC.map((name,i) => {
    const { x, y } = R_POS[i];
    return `<line data-redge="${_esc(name)}" x1="${RCX}" y1="${RCY}" x2="${x}" y2="${y}"
      stroke="rgba(255,255,255,.038)" stroke-width=".8"/>`;
  }).join('');

  // Glow trail lines (hidden by default; shown when edge is active)
  const glowEdges = SPEC.map((name,i) => {
    const { x, y } = R_POS[i];
    return `<line data-rglow="${_esc(name)}" x1="${RCX}" y1="${RCY}" x2="${x}" y2="${y}"
      stroke="rgba(192,57,43,.12)" stroke-width="8" opacity="0"/>`;
  }).join('');

  const nodes = SPEC.map((name,i) => {
    const { x, y } = R_POS[i];
    return `<g class="ccg-rspec" data-spec="${_esc(name)}" transform="translate(${x},${y})">
      <polygon class="ccg-rhex" points="0,-18 15.6,-9 15.6,9 0,18 -15.6,9 -15.6,-9"
        fill="rgba(15,18,21,.95)" stroke="rgba(61,72,87,.28)" stroke-width=".9"/>
      <text text-anchor="middle" y="1" dominant-baseline="middle"
        style="fill:rgba(197,201,208,.36);font-family:'JetBrains Mono','Courier New',monospace;font-size:5px;font-weight:600;letter-spacing:.07em">
        ${_esc(name.length>10?name.slice(0,9)+'…':name)}</text>
      <circle class="ccg-rdot" cx="13" cy="-12" r="2" fill="#3d4857"/>
    </g>`;
  }).join('');

  return `<svg class="cc-graph-svg" viewBox="0 0 960 530" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="ccg-grid2" width="38" height="38" patternUnits="userSpaceOnUse">
      <path d="M38 0L0 0 0 38" fill="none" stroke="rgba(255,255,255,.022)" stroke-width=".5"/></pattern>
    <radialGradient id="ccg-atmo" cx="50%" cy="50%" r="38%">
      <stop offset="0%" stop-color="rgba(192,57,43,.06)"/>
      <stop offset="100%" stop-color="rgba(192,57,43,0)"/></radialGradient>
    <filter id="ccg-fr2" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="7"/></filter>
  </defs>
  <rect width="960" height="530" fill="url(#ccg-grid2)"/>
  <ellipse cx="${RCX}" cy="${RCY}" rx="225" ry="205" fill="url(#ccg-atmo)"/>
  ${glowEdges}
  ${coldEdges}
  ${nodes}
  <circle id="ccg-rring" class="ccg-orch-ring" cx="${RCX}" cy="${RCY}" r="48"
    fill="none" stroke="rgba(192,57,43,.28)" stroke-width=".75"/>
  <circle cx="${RCX}" cy="${RCY}" r="36" fill="rgba(192,57,43,.09)" filter="url(#ccg-fr2)"/>
  <polygon points="${RCX},${RCY-34} ${RCX+29},${RCY-17} ${RCX+29},${RCY+17} ${RCX},${RCY+34} ${RCX-29},${RCY+17} ${RCX-29},${RCY-17}"
    fill="rgba(192,57,43,.07)" stroke="var(--cc-crimson,#c0392b)" stroke-width="1.4"/>
  <text x="${RCX}" y="${RCY-4}" text-anchor="middle" dominant-baseline="middle"
    style="fill:var(--cc-crimson,#c0392b);font-family:'JetBrains Mono','Courier New',monospace;font-size:6.5px;font-weight:700;letter-spacing:.13em">ORCHESTRATOR</text>
  <text id="ccg-rstatus" x="${RCX}" y="${RCY+10}" text-anchor="middle" dominant-baseline="middle"
    style="fill:rgba(192,57,43,.45);font-family:'JetBrains Mono','Courier New',monospace;font-size:5px;letter-spacing:.10em">idle</text>
</svg>`;
}

// Update replay edge states from agent turn sequence
// turns: [{name: 'CODER', ...}, ...] ordered by timestamp; currentIdx = last item = active
export function updateReplayEdges(svgEl, turns) {
  if (!svgEl) return;
  // Reset all edges to cold
  SPEC.forEach(name => {
    const e = svgEl.querySelector(`[data-redge="${CSS.escape(name)}"]`);
    const g = svgEl.querySelector(`[data-rglow="${CSS.escape(name)}"]`);
    const n = svgEl.querySelector(`.ccg-rspec[data-spec="${CSS.escape(name)}"]`);
    if (e) { e.style.stroke='rgba(255,255,255,.038)'; e.style.strokeWidth='.8'; e.classList.remove('ccg-edge-active'); e.style.strokeDasharray=''; }
    if (g) g.style.opacity='0';
    if (n) {
      const hex = n.querySelector('.ccg-rhex');
      if (hex) { hex.style.stroke='rgba(61,72,87,.28)'; hex.style.strokeWidth='.9'; }
      const dot = n.querySelector('.ccg-rdot');
      if (dot) dot.style.fill='#3d4857';
    }
  });

  if (!turns || !turns.length) {
    const rs = svgEl.querySelector('#ccg-rstatus'); if(rs) rs.textContent='idle';
    return;
  }

  const doneNames = new Set(turns.slice(0,-1).map(t=>t.toUpperCase()));
  const activeName = turns[turns.length-1].toUpperCase();

  doneNames.forEach(name => {
    const e = svgEl.querySelector(`[data-redge="${CSS.escape(name)}"]`);
    if (e) { e.style.stroke='rgba(46,204,113,.35)'; e.style.strokeWidth='1.4'; }
    const n = svgEl.querySelector(`.ccg-rspec[data-spec="${CSS.escape(name)}"]`);
    if (n) {
      const hex = n.querySelector('.ccg-rhex');
      if (hex) hex.style.stroke='rgba(46,204,113,.45)';
      const dot = n.querySelector('.ccg-rdot');
      if (dot) dot.style.fill='#2ecc71';
    }
  });

  const ae = svgEl.querySelector(`[data-redge="${CSS.escape(activeName)}"]`);
  if (ae) { ae.style.stroke='rgba(192,57,43,.70)'; ae.style.strokeWidth='2'; ae.classList.add('ccg-edge-active'); ae.style.strokeDasharray='6 3'; }
  const ag = svgEl.querySelector(`[data-rglow="${CSS.escape(activeName)}"]`);
  if (ag) ag.style.opacity='1';
  const an = svgEl.querySelector(`.ccg-rspec[data-spec="${CSS.escape(activeName)}"]`);
  if (an) {
    const hex = an.querySelector('.ccg-rhex');
    if (hex) { hex.style.stroke='rgba(192,57,43,.80)'; hex.style.strokeWidth='1.8'; }
    const dot = an.querySelector('.ccg-rdot');
    if (dot) dot.style.fill='var(--cc-crimson,#c0392b)';
  }
  const rs = svgEl.querySelector('#ccg-rstatus');
  if (rs) rs.textContent=`→ ${activeName}`;
}
