/**
 * graph-algorithms.js — Port of graphAlgorithms.ts and layouts.ts.
 * BFS path tracing, subnet grouping, health scoring, layout engines.
 * Pure JS — no external dependencies.
 */

// ─── Force simulation (port of simulation.ts) ─────────────────────────────────
// Minimal spring-repulsion simulation without D3 — runs tickCount iterations.

export function runSimulation(nodes, edges, width, height, tickCount = 200) {
  if (nodes.length === 0) return [];

  // Deep-clone with initial positions
  const sim = nodes.map(n => ({
    ...n,
    x: n.fx != null ? n.fx : (n.x !== 0 ? n.x : width / 2 + (Math.random() - 0.5) * 200),
    y: n.fy != null ? n.fy : (n.y !== 0 ? n.y : height / 2 + (Math.random() - 0.5) * 200),
    vx: 0, vy: 0,
    fx: n.fx ?? null, fy: n.fy ?? null,
  }));

  const byId = new Map(sim.map(n => [n.id, n]));
  const linkDist = 100;
  const repulsion = 300;
  const alpha = 0.3;

  for (let tick = 0; tick < tickCount; tick++) {
    // Repulsion (charge)
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i], b = sim[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repulsion / (dist * dist);
        const fx = force * dx / dist, fy = force * dy / dist;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // Attraction (links)
    for (const e of edges) {
      const src = byId.get(typeof e.source === 'string' ? e.source : e.source.id);
      const tgt = byId.get(typeof e.target === 'string' ? e.target : e.target.id);
      if (!src || !tgt) continue;
      const dx = tgt.x - src.x, dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const diff = (dist - linkDist) / dist * 0.5;
      src.vx += dx * diff; src.vy += dy * diff;
      tgt.vx -= dx * diff; tgt.vy -= dy * diff;
    }

    // Center gravity
    for (const n of sim) {
      n.vx += (width / 2 - n.x) * 0.005;
      n.vy += (height / 2 - n.y) * 0.005;
    }

    // Integrate
    for (const n of sim) {
      if (n.fx != null) { n.x = n.fx; n.vx = 0; continue; }
      if (n.fy != null) { n.y = n.fy; n.vy = 0; continue; }
      n.vx *= (1 - alpha);
      n.vy *= (1 - alpha);
      n.x += n.vx;
      n.y += n.vy;
    }

    // Collision avoidance radius 40
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i], b = sim[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 40) {
          const overlap = (40 - dist) / 2;
          a.x -= overlap * dx / dist; a.y -= overlap * dy / dist;
          b.x += overlap * dx / dist; b.y += overlap * dy / dist;
        }
      }
    }
  }

  return sim.map(n => ({
    ...n,
    x: Math.max(60, Math.min(width - 60, n.x)),
    y: Math.max(60, Math.min(height - 60, n.y)),
  }));
}

// ─── Layout engine (port of layouts.ts) ──────────────────────────────────────

export function applyLayout(nodes, edges, mode, width, height) {
  if (nodes.length === 0) return nodes;
  switch (mode) {
    case 'force':       return runSimulation(nodes, edges, width, height);
    case 'hierarchical': return hierarchicalLayout(nodes, edges, width, height);
    case 'circular':    return circularLayout(nodes, width, height);
    case 'grid':        return gridLayout(nodes, width, height);
    default:            return nodes;
  }
}

function hierarchicalLayout(nodes, edges, width, height) {
  const adj = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    const src = typeof e.source === 'string' ? e.source : '';
    const tgt = typeof e.target === 'string' ? e.target : '';
    adj.get(src)?.push(tgt);
    adj.get(tgt)?.push(src);
  }
  const levels = new Map();
  const queue = [nodes[0].id];
  levels.set(nodes[0].id, 0);
  while (queue.length > 0) {
    const cur = queue.shift();
    const curLevel = levels.get(cur);
    for (const nb of (adj.get(cur) ?? [])) {
      if (!levels.has(nb)) { levels.set(nb, curLevel + 1); queue.push(nb); }
    }
  }
  const byLevel = new Map();
  for (const n of nodes) {
    const lv = levels.get(n.id) ?? 0;
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv).push(n);
  }
  const maxLevel = Math.max(...byLevel.keys());
  const levelHeight = height / (maxLevel + 2);
  return nodes.map(n => {
    const lv = levels.get(n.id) ?? 0;
    const group = byLevel.get(lv);
    const idx = group.indexOf(n);
    const colWidth = width / (group.length + 1);
    return { ...n, x: colWidth * (idx + 1), y: levelHeight * (lv + 1), fx: null, fy: null };
  });
}

function circularLayout(nodes, width, height) {
  const cx = width / 2, cy = height / 2;
  const r = Math.min(width, height) / 2 - 80;
  return nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    return { ...n, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), fx: null, fy: null };
  });
}

function gridLayout(nodes, width, height) {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const rows = Math.ceil(nodes.length / cols);
  const cellW = (width - 120) / cols, cellH = (height - 120) / rows;
  return nodes.map((n, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    return { ...n, x: 60 + cellW * col + cellW / 2, y: 60 + cellH * row + cellH / 2, fx: null, fy: null };
  });
}

// ─── Graph algorithms (port of graphAlgorithms.ts) ────────────────────────────

export function findShortestPath(nodes, edges, fromId, toId) {
  if (fromId === toId) return [fromId];
  const adj = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    const src = typeof e.source === 'string' ? e.source : e.source.id;
    const tgt = typeof e.target === 'string' ? e.target : e.target.id;
    adj.get(src)?.push(tgt);
    adj.get(tgt)?.push(src);
  }
  const visited = new Set([fromId]);
  const queue = [{ id: fromId, path: [fromId] }];
  while (queue.length > 0) {
    const { id, path } = queue.shift();
    for (const nb of (adj.get(id) ?? [])) {
      if (nb === toId) return [...path, nb];
      if (!visited.has(nb)) { visited.add(nb); queue.push({ id: nb, path: [...path, nb] }); }
    }
  }
  return null;
}

export function pathEdgeIds(path, edges) {
  const result = new Set();
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    for (const e of edges) {
      const src = typeof e.source === 'string' ? e.source : e.source.id;
      const tgt = typeof e.target === 'string' ? e.target : e.target.id;
      if ((src === a && tgt === b) || (src === b && tgt === a)) result.add(e.id);
    }
  }
  return result;
}

const RISKY_PORTS = [22, 23, 3389, 445, 21];

export function calcHealthScore(nodes, vulns) {
  const deductions = [];
  let total = 0;
  for (const node of nodes) {
    for (const rp of RISKY_PORTS) {
      if (node.ports.some(p => p.state === 'open' && p.port === rp)) {
        deductions.push({ reason: `${node.ip}: port ${rp} open`, points: 5 });
        total += 5;
      }
    }
    if (!node.os) { deductions.push({ reason: `${node.ip}: OS unknown`, points: 2 }); total += 2; }
  }
  for (const v of (vulns ?? [])) {
    if (v.severity === 'critical') { deductions.push({ reason: `${v.ip}: critical CVE`, points: 10 }); total += 10; }
    else if (v.severity === 'high') { deductions.push({ reason: `${v.ip}: high CVE`, points: 5 }); total += 5; }
  }
  return { score: Math.max(0, 100 - total), maxScore: 100, deductions };
}

export function groupBySubnet(nodes) {
  const groups = new Map();
  for (const n of nodes) {
    const parts = n.ip.split('.');
    const sub = parts.length >= 3 ? parts.slice(0, 3).join('.') + '.0/24' : n.ip;
    if (!groups.has(sub)) groups.set(sub, []);
    groups.get(sub).push(n);
  }
  return groups;
}

export function computeDiff(baseNodes, latestNodes) {
  const baseIds   = new Set(baseNodes.map(n => n.id));
  const latestIds = new Set(latestNodes.map(n => n.id));
  const added = new Set(), removed = new Set(), changed = new Set();
  for (const n of latestNodes) {
    if (!baseIds.has(n.id)) { added.add(n.id); continue; }
    const bn = baseNodes.find(b => b.id === n.id);
    const bp = new Set(bn.ports.filter(p => p.state === 'open').map(p => p.port));
    const np = new Set(n.ports.filter(p => p.state === 'open').map(p => p.port));
    if (bp.size !== np.size || [...bp].some(p => !np.has(p)) || [...np].some(p => !bp.has(p))) changed.add(n.id);
  }
  for (const n of baseNodes) { if (!latestIds.has(n.id)) removed.add(n.id); }
  return { added, removed, changed };
}
