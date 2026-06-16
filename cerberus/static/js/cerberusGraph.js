// Cerberus OS — 3D globe graph: nodes on sphere surface, mouse rotation, focus zoom

import officesModal from './officesModal.js';
import { getTasks, loadTasks } from './cerberusGraphStore.js';
import {
  getGlobeRotation,
  setGlobeRotation,
  addGlobeRotation,
  subscribeGlobeRotation,
} from './cerberusCore.js';
import { clearWindowResizeLock } from './windowResize.js';

const VIEW_KEY = 'cerberus_graph_viewport_v2';
const ROT_KEY = 'cerberus_graph_globe_rotation_v1';
const GLOBE_DRAG_SENS = 0.0045;
const GLOBE_SURFACE_FRAC = 0.46;

const MAIN_ICONS = {
  assistant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  offices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="8" height="10" rx="1"/><rect x="13" y="7" width="8" height="14" rx="1"/><circle cx="7" cy="16" r="1"/><circle cx="17" cy="14" r="1"/></svg>',
  projects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  finance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M9 16l2 2 4-4"/></svg>',
  tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5"/></svg>',
  library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  cookbook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  goals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  reminders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  income: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>',
  expenses: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/></svg>',
  reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  forecasts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 16l4-6 4 3 5-7"/></svg>',
  office: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
  department: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  agent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  project: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
  monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polyline points="6 11 9 11 11 8 13 13 15 10 18 10"/></svg>',
};

/** When true, hide dynamic office/project/task branches (tools + finance subs still show). */
const CE_GRAPH_MAIN_ONLY = false;

const MAIN_DEFS = [
  { id: 'assistant', color: 'assistant', angle: -90, action: 'assistant', label: 'Assistant' },
  { id: 'offices', color: 'offices', angle: -30, action: 'offices', label: 'Offices' },
  { id: 'projects', color: 'projects', angle: 30, action: 'projects', label: 'Projects' },
  { id: 'finance', color: 'finance', angle: 90, action: 'finance', label: 'Finance' },
  { id: 'tasks', color: 'tasks', angle: 150, action: 'tasks', label: 'Tasks' },
  { id: 'tools', color: 'tools', angle: 210, action: 'tools', label: 'Tools' },
];

const TOOL_SUBS = ['calendar', 'notes', 'library', 'cookbook', 'settings', 'voice', 'monitor'];
const FINANCE_SUBS = ['goals', 'reminders', 'income', 'expenses', 'reports', 'forecasts'];

const DISPLAY_LABELS = {
  assistant: 'Assistant',
  offices: 'Offices',
  projects: 'Projects',
  finance: 'Finance',
  tasks: 'Tasks',
  tools: 'Tools',
  calendar: 'Calendar',
  notes: 'Notes',
  library: 'Library',
  cookbook: 'Cookbook',
  settings: 'Settings',
  voice: 'Voice Commands',
  monitor: 'System Monitor',
  goals: 'Goals',
  reminders: 'Reminders',
  income: 'Income',
  expenses: 'Expenses',
  reports: 'Reports',
  forecasts: 'Forecasts',
};

const NODE_HINTS = {
  assistant: { title: 'Assistant', desc: 'Chat with Cerberus, run commands, and use voice control.' },
  offices: { title: 'Offices', desc: 'Organize departments, employees, and agent workspaces.' },
  projects: { title: 'Projects', desc: 'Browse indexed projects and open Project HQ.' },
  finance: { title: 'Finance', desc: 'Track income, expenses, goals, and financial reports.' },
  tasks: { title: 'Tasks', desc: 'Manage tasks linked to projects and agents.' },
  tools: { title: 'Tools', desc: 'Calendar, notes, library, cookbook, and system utilities.' },
  'tool-calendar': { title: 'Calendar', desc: 'Schedule events and view your timeline.' },
  'tool-notes': { title: 'Notes', desc: 'Capture ideas and workspace knowledge.' },
  'tool-library': { title: 'Library', desc: 'Browse documents and indexed files.' },
  'tool-cookbook': { title: 'Cookbook', desc: 'Run automation recipes and workflows.' },
  'tool-settings': { title: 'Settings', desc: 'Configure Cerberus OS, storage, and preferences.' },
  'tool-voice': { title: 'Voice Commands', desc: 'Voice navigation and command cheat sheet.' },
  'tool-monitor': { title: 'System Monitor', desc: 'Live system status, FPS, and resource metrics.' },
};

const NODE_COLORS = {
  assistant: 'rgba(80, 180, 255, 0.65)',
  offices: 'rgba(180, 100, 255, 0.65)',
  projects: 'rgba(80, 220, 140, 0.65)',
  finance: 'rgba(255, 160, 60, 0.65)',
  tasks: 'rgba(100, 220, 220, 0.65)',
  tools: 'rgba(255, 120, 180, 0.65)',
  sub: 'rgba(140, 180, 255, 0.45)',
  cross: 'rgba(180, 140, 255, 0.25)',
};

let _viewport = null;
let _world = null;
let _canvas = null;
let _ctx = null;
let _ring = null;
let _nodes = [];
let _links = [];
let _hoveredId = null;
let _onNodeClick = null;
let _projects = [];
let _stageSize = 860;
let _zoom = 1;
let _raf = 0;
let _initialized = false;
let _globeDragging = false;
let _globeDragStart = null;
let _globeDragMoved = false;
const GLOBE_DRAG_THRESHOLD = 5;
let _focusAnim = 0;
let _unsubGlobe = null;

// Render scheduling — node DOM writes happen at most once per frame and only
// when something actually changed (rotation/zoom/hover/model). The canvas
// (links + brain pulses) redraws each visible frame; it is cheap.
let _nodesDirty = true;
let _domSignature = '';
let _reducedMotion = false;

// Brain-core pulse waves (drawn on the connections canvas).
const PULSE_PERIOD_MS = 2600;
const PULSE_DUR_MS = 1900;
let _pulses = [];
let _lastPulseAt = 0;

// Subtle stage parallax (mouse-driven, lerped).
const PARALLAX_MAX = 9;
let _parX = 0;
let _parY = 0;
let _parTX = 0;
let _parTY = 0;
let _hudEl = null;

function _markNodesDirty() {
  _nodesDirty = true;
}

function _spherePoint(theta, phi) {
  const cosPhi = Math.cos(phi);
  return {
    theta,
    phi,
    ux: cosPhi * Math.sin(theta),
    uy: Math.sin(phi),
    uz: cosPhi * Math.cos(theta),
  };
}

function _stageCenter() {
  return _stageSize / 2;
}

function _globeRadius() {
  return _stageSize * GLOBE_SURFACE_FRAC;
}

function _layoutSize(el) {
  if (!el) return { w: 0, h: 0 };
  return {
    w: el.offsetWidth || el.clientWidth || 0,
    h: el.offsetHeight || el.clientHeight || 0,
  };
}

function _measureStage() {
  if (!_world) return;
  const { w } = _layoutSize(_world);
  if (w > 32) _stageSize = w;
}

function _projectSphere(ux, uy, uz, rotX, rotY) {
  const cy = Math.cos(rotY);
  const sy = Math.sin(rotY);
  const x1 = ux * cy + uz * sy;
  const z1 = -ux * sy + uz * cy;
  const cx = Math.cos(rotX);
  const sx = Math.sin(rotX);
  const y2 = uy * cx - z1 * sx;
  const z2 = uy * sx + z1 * cx;
  const c = _stageCenter();
  const r = _globeRadius();
  return { x: c + x1 * r, y: c + y2 * r, z: z2 };
}

function _slerpUnit(a, b, t) {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z;
  dot = Math.max(-1, Math.min(1, dot));
  const omega = Math.acos(dot);
  if (omega < 0.0001) return { x: a.x, y: a.y, z: a.z };
  const s = Math.sin(omega);
  const w1 = Math.sin((1 - t) * omega) / s;
  const w2 = Math.sin(t * omega) / s;
  return { x: w1 * a.x + w2 * b.x, y: w1 * a.y + w2 * b.y, z: w1 * a.z + w2 * b.z };
}

function _rotationToFace(ux, uy, uz) {
  const rotY = Math.atan2(ux, uz);
  const cy = Math.cos(rotY);
  const sy = Math.sin(rotY);
  const z1 = -ux * sy + uz * cy;
  const rotX = Math.atan2(uy, z1);
  return {
    rotX: Math.max(-1.25, Math.min(1.25, rotX)),
    rotY,
  };
}

function _sphereCluster(parent, items, spreadRad = 0.42) {
  const n = items.length;
  if (!n || parent.theta == null) return;
  items.forEach((item, i) => {
    const ring = spreadRad * 0.9;
    const angle = (i / n) * Math.PI * 2;
    const tOff = Math.cos(angle) * ring;
    const pOff = Math.sin(angle) * ring * 0.55;
    const lat = Math.max(-1.15, Math.min(1.15, parent.phi + pOff));
    Object.assign(item, _spherePoint(parent.theta + tOff, lat));
  });
}

function _loadGlobeRotation() {
  try {
    const raw = localStorage.getItem(ROT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function _saveGlobeRotation() {
  const { rotX, rotY } = getGlobeRotation();
  try {
    localStorage.setItem(ROT_KEY, JSON.stringify({ rotX, rotY }));
  } catch (_) {}
}

function _loadViewport() {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function _saveViewport() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ zoom: _zoom }));
  } catch (_) {}
}

function _assignSphereLayout(nodes, nodeMap) {
  MAIN_DEFS.forEach((def) => {
    const n = nodeMap.get(def.id);
    if (!n) return;
    const theta = ((def.angle + 90) * Math.PI) / 180;
    const phi = 0;
    Object.assign(n, _spherePoint(theta, phi));
  });

  const byParent = new Map();
  nodes.forEach((n) => {
    if (!n.parentId) return;
    if (!byParent.has(n.parentId)) byParent.set(n.parentId, []);
    byParent.get(n.parentId).push(n);
  });

  const spreadFor = (kind) => {
    if (kind === 'main') return 0.42;
    if (kind === 'sub') return 0.22;
    if (kind === 'office' || kind === 'project') return 0.2;
    return 0.16;
  };

  const walk = (parentId, depth = 0) => {
    const kids = byParent.get(parentId) || [];
    const parent = nodeMap.get(parentId);
    if (parent && kids.length) {
      _sphereCluster(parent, kids, spreadFor(parent.kind) * Math.max(0.55, 1 - depth * 0.12));
    }
    kids.forEach((k) => walk(k.id, depth + 1));
  };

  MAIN_DEFS.forEach((d) => walk(d.id, 0));
}

function _makeNode(opts) {
  return {
    id: opts.id,
    kind: opts.kind || 'main',
    color: opts.color || 'sub',
    icon: opts.icon || MAIN_ICONS.agent,
    action: opts.action || opts.id,
    label: opts.label || opts.id,
    x: opts.x ?? _stageCenter(),
    y: opts.y ?? _stageCenter(),
    parentId: opts.parentId || null,
    meta: opts.meta || {},
  };
}

function _buildGraphModel(mainOnly = CE_GRAPH_MAIN_ONLY) {
  const nodes = [];
  const links = [];
  const nodeMap = new Map();

  MAIN_DEFS.forEach((def) => {
    const n = _makeNode({
      id: def.id,
      kind: 'main',
      color: def.color,
      icon: MAIN_ICONS[def.id],
      action: def.action,
      label: def.label || DISPLAY_LABELS[def.id] || def.id,
    });
    nodes.push(n);
    nodeMap.set(n.id, n);
    links.push({ from: 'core', to: n.id, strength: 1 });
  });

  const toolsMain = nodeMap.get('tools');
  const toolChildren = TOOL_SUBS.map((id) => _makeNode({
    id: `tool-${id}`,
    kind: 'sub',
    color: 'tools',
    icon: MAIN_ICONS[id],
    action: id,
    label: id,
    parentId: 'tools',
  }));
  toolChildren.forEach((c) => {
    nodes.push(c);
    nodeMap.set(c.id, c);
    links.push({ from: 'tools', to: c.id, strength: 0.8 });
  });

  const financeMain = nodeMap.get('finance');
  const finChildren = FINANCE_SUBS.map((id) => _makeNode({
    id: `finance-${id}`,
    kind: 'sub',
    color: 'finance',
    icon: MAIN_ICONS[id],
    action: `finance:${id}`,
    label: id,
    parentId: 'finance',
  }));
  finChildren.forEach((c) => {
    nodes.push(c);
    nodeMap.set(c.id, c);
    links.push({ from: 'finance', to: c.id, strength: 0.8 });
  });

  if (mainOnly) {
    _assignSphereLayout(nodes, nodeMap);
    return { nodes, links };
  }

  const officesMain = nodeMap.get('offices');
  const offices = officesModal.getOffices();
  const officeNodes = offices.map((o, i) => _makeNode({
    id: `office-${o.id}`,
    kind: 'office',
    color: 'offices',
    icon: MAIN_ICONS.office,
    action: `office:${o.id}`,
    label: o.name,
    parentId: 'offices',
    meta: { officeId: o.id },
  }));
  officeNodes.forEach((on) => {
    nodes.push(on);
    nodeMap.set(on.id, on);
    links.push({ from: 'offices', to: on.id, strength: 0.85 });

    const office = offices.find((o) => o.id === on.meta.officeId);
    const depts = office?.departments || [];
    const deptNodes = depts.map((d) => _makeNode({
      id: `dept-${d.id}`,
      kind: 'department',
      color: 'offices',
      icon: MAIN_ICONS.department,
      action: `dept:${d.id}`,
      label: d.name,
      parentId: on.id,
      meta: { officeId: office.id, departmentId: d.id },
    }));
    deptNodes.forEach((dn) => {
      nodes.push(dn);
      nodeMap.set(dn.id, dn);
      links.push({ from: on.id, to: dn.id, strength: 0.75 });

      const dept = depts.find((d) => d.id === dn.meta.departmentId);
      const agents = dept?.agents || [];
      const agentNodes = agents.map((a) => _makeNode({
        id: `agent-${a.id}`,
        kind: 'agent',
        color: 'offices',
        icon: MAIN_ICONS.agent,
        action: `agent:${a.id}`,
        label: a.name,
        parentId: dn.id,
        meta: {
          officeId: office.id,
          departmentId: dept.id,
          agentId: a.id,
          projectIds: a.assignedProjectIds || [],
        },
      }));
      agentNodes.forEach((an) => {
        nodes.push(an);
        nodeMap.set(an.id, an);
        links.push({ from: dn.id, to: an.id, strength: 0.7 });

        const agent = agents.find((a) => a.id === an.meta.agentId);
        const subs = agent?.subAgents || [];
        const subNodes = subs.map((s) => _makeNode({
          id: `subagent-${s.id}`,
          kind: 'subagent',
          color: 'offices',
          icon: MAIN_ICONS.agent,
          action: `subagent:${s.id}`,
          label: s.name,
          parentId: an.id,
          meta: { officeId: office.id, departmentId: dept.id, agentId: agent.id, subAgentId: s.id },
        }));
        subNodes.forEach((sn) => {
          nodes.push(sn);
          nodeMap.set(sn.id, sn);
          links.push({ from: an.id, to: sn.id, strength: 0.6 });
        });

        (an.meta.projectIds || []).forEach((pid) => {
          const projNodeId = `project-${pid}`;
          if (nodeMap.has(projNodeId)) {
            links.push({ from: an.id, to: projNodeId, strength: 0.3, cross: true });
          }
        });
      });
    });
  });

  const projectsMain = nodeMap.get('projects');
  const projectNodes = (_projects || []).map((p) => _makeNode({
    id: `project-${p.id}`,
    kind: 'project',
    color: 'projects',
    icon: MAIN_ICONS.project,
    action: `project:${p.id}`,
    label: p.name,
    parentId: 'projects',
    meta: { projectId: p.id },
  }));
  projectNodes.forEach((pn) => {
    nodes.push(pn);
    nodeMap.set(pn.id, pn);
    links.push({ from: 'projects', to: pn.id, strength: 0.85 });
  });

  const tasksMain = nodeMap.get('tasks');
  const taskItems = getTasks();
  const taskNodes = taskItems.map((t) => _makeNode({
    id: `task-${t.id}`,
    kind: 'task',
    color: 'tasks',
    icon: MAIN_ICONS.task,
    action: `task:${t.id}`,
    label: t.title,
    parentId: 'tasks',
    meta: t,
  }));
  taskNodes.forEach((tn) => {
    nodes.push(tn);
    nodeMap.set(tn.id, tn);
    links.push({ from: 'tasks', to: tn.id, strength: 0.8 });
    if (tn.meta.projectId) {
      const pid = `project-${tn.meta.projectId}`;
      if (nodeMap.has(pid)) links.push({ from: tn.id, to: pid, strength: 0.35, cross: true });
    }
    if (tn.meta.agentId) {
      const aid = `agent-${tn.meta.agentId}`;
      if (nodeMap.has(aid)) links.push({ from: tn.id, to: aid, strength: 0.35, cross: true });
    }
    if (tn.meta.subAgentId) {
      const sid = `subagent-${tn.meta.subAgentId}`;
      if (nodeMap.has(sid)) links.push({ from: tn.id, to: sid, strength: 0.4, cross: true });
    }
  });

  _assignSphereLayout(nodes, nodeMap);
  return { nodes, links, nodeMap };
}

const _MODAL_CHROME_SEL = [
  '.cerberus-shell-modal-header',
  '.cerberus-shell-modal-body',
  '.cerberus-os-panel-header',
  '.cerberus-os-panel > :not(.cerberus-os-panel-header)',
  '.modal-content',
  '.settings-modal-content',
  '.tasks-modal-content',
  '.memory-modal-content',
  '.notes-pane',
  '.cerberus-project-hq',
  '.cerberus-hq-header',
  '.cerberus-project-hq-header',
  '.cerberus-agents-header',
].join(', ');

const _GLOBE_SURFACE_SEL = [
  '#cerberus-graph-viewport',
  '#cerberus-globe-stage',
  '.cerberus-mc-globe-bg',
  '#cerberus-core',
  '#cerberus-core-canvas',
  '#cerberus-node-connections',
  '#cerberus-globe-hit-layer',
  '#cerberus-power-links',
].join(', ');

function _clearStuckInteractionLocks() {
  if (!document.querySelector('.cerberus-modal-dragging')) {
    document.body.classList.remove('cerberus-modal-dragging');
  }
  if (!document.querySelector('.window-resizing')) {
    clearWindowResizeLock();
  }
}

function _modalInteractionActive() {
  return document.body.classList.contains('cerberus-modal-dragging')
    || document.body.classList.contains('window-resizing-active')
    || !!document.querySelector('.cerberus-modal-dragging')
    || !!document.querySelector('.window-resizing');
}

function _stackAt(clientX, clientY) {
  if (typeof document.elementsFromPoint === 'function') {
    return document.elementsFromPoint(clientX, clientY);
  }
  const top = document.elementFromPoint(clientX, clientY);
  return top ? [top] : [];
}

function _isPointerInteractive(el) {
  if (!el || !(el instanceof Element)) return false;
  const pe = getComputedStyle(el).pointerEvents;
  return pe !== 'none';
}

function _canGlobeDragAt(clientX, clientY) {
  if (!_viewport || !document.body.classList.contains('cerberus-hub-active')) return false;
  if (!_isInGlobeViewport(clientX, clientY)) return false;
  if (_modalInteractionActive()) return false;

  const stack = _stackAt(clientX, clientY);
  if (!stack.length) return false;

  let globeReachable = false;
  for (const el of stack) {
    if (!el) continue;

    if (el.closest?.('.cerberus-os-node-wrap--clickable, .cerberus-brain-core')) return false;
    if (el.closest?.('button, input, select, textarea, a, label, [contenteditable="true"]')) return false;
    if (el.closest?.('#cerberus-os-status-bar, #sidebar, #icon-rail, .cerberus-top-bar')) return false;

    const chrome = el.closest?.(_MODAL_CHROME_SEL);
    if (chrome && _isPointerInteractive(chrome)) return false;

    if (el.closest?.('#cerberus-modal-portal')) continue;

    if (el.closest?.(_GLOBE_SURFACE_SEL) || el.closest?.('#cerberus-home')) {
      globeReachable = true;
      break;
    }
  }
  return globeReachable;
}

function _applyTransform() {
  if (!_world) return;
  const parallaxOff = _reducedMotion || _modalInteractionActive()
    || document.body.classList.contains('cerberus-modal-open');
  const px = parallaxOff ? 0 : _parX;
  const py = parallaxOff ? 0 : _parY;
  _world.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0) scale(${_zoom})`;
  _updateGlobeScale();
}

function _formatNodeLabel(node) {
  if (!node) return '';
  if (node.kind === 'main') {
    return DISPLAY_LABELS[node.id] || node.label;
  }
  if (node.id.startsWith('tool-') || node.id.startsWith('finance-')) {
    const key = node.id.replace(/^(tool|finance)-/, '');
    return DISPLAY_LABELS[key] || node.label;
  }
  return node.label;
}

function _updateGlobeScale() {
  document.documentElement.style.setProperty('--cerberus-graph-zoom', String(_zoom));
}

function _zoomForKind(kind) {
  if (kind === 'main') return 1.55;
  if (kind === 'sub') return 1.75;
  if (kind === 'office' || kind === 'project') return 1.9;
  return 2.05;
}

function _screenLift(px, py, lift) {
  const c = _stageCenter();
  const dx = px - c;
  const dy = py - c;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: px + (dx / dist) * lift, y: py + (dy / dist) * lift };
}

/** Public entry point: request a node-position update on the next frame. */
function _updateNodePositions() {
  _markNodesDirty();
}

/**
 * Apply projected sphere positions to the node DOM.
 *
 * IMPORTANT: never re-append/move node elements inside the ring here. Stacking
 * is handled purely via z-index (the wraps are absolutely positioned siblings).
 * Re-parenting elements between mousedown and mouseup retargets/loses click
 * events — that was the bug that made navigation icons stop opening modals.
 */
function _applyNodePositions() {
  const { rotX, rotY } = getGlobeRotation();

  for (const n of _nodes) {
    if (n.ux == null) continue;
    const p = _projectSphere(n.ux, n.uy, n.uz, rotX, rotY);
    n._z = p.z;
    n.x = p.x;
    n.y = p.y;
    if (!n.el) continue;

    const isMain = n.kind === 'main';
    const lift = isMain ? 12 : 8;
    const lifted = _screenLift(p.x, p.y, lift);
    const clickable = isMain || p.z > -0.12;
    const depthScale = 0.82 + (p.z + 1) * 0.12;
    const alpha = Math.min(1, 0.5 + (p.z + 1) * 0.32);

    n.el.style.left = `${lifted.x}px`;
    n.el.style.top = `${lifted.y}px`;
    n.el.style.opacity = String(alpha);
    n.el.style.transform = `translate(-50%, -50%) scale(${depthScale})`;
    n.el.style.zIndex = String(10 + Math.round((p.z + 1) * 50));
    n.el.style.pointerEvents = clickable ? 'auto' : 'none';
    n.el.classList.toggle('cerberus-os-node-wrap--behind', p.z < 0.15);
    n.el.classList.toggle('cerberus-os-node-wrap--front', clickable);
    n.el.classList.toggle('cerberus-os-node-wrap--clickable', clickable);
  }
}

function _setBrainFocusState(node) {
  if (!_world) return;
  const isBrain = node?.action === 'brain' || node?.id === 'brain';
  _world.classList.toggle('cerberus-globe-stage--node-focused', !!node && !isBrain);
  _world.classList.toggle('cerberus-globe-stage--brain-focused', !!isBrain);
}

function _animateGlobeFocus(node, onDone) {
  if (!node || node.ux == null) {
    onDone?.();
    return;
  }
  if (_focusAnim) cancelAnimationFrame(_focusAnim);
  _setBrainFocusState(node);

  const target = _rotationToFace(node.ux, node.uy, node.uz);
  const startRot = getGlobeRotation();
  const startZoom = _zoom;
  const targetZoom = _zoomForKind(node.kind);
  const t0 = performance.now();
  const dur = 680;

  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    const ease = 1 - Math.pow(1 - t, 3);
    setGlobeRotation(
      startRot.rotX + (target.rotX - startRot.rotX) * ease,
      startRot.rotY + (target.rotY - startRot.rotY) * ease,
    );
    _zoom = startZoom + (targetZoom - startZoom) * ease;
    _applyTransform();
    _markNodesDirty();
    if (t < 1) {
      _focusAnim = requestAnimationFrame(step);
    } else {
      _focusAnim = 0;
      _saveViewport();
      _saveGlobeRotation();
      onDone?.();
    }
  };
  _focusAnim = requestAnimationFrame(step);
}

export function focusGraphNode(nodeId) {
  const node = _nodes.find((n) => n.id === nodeId);
  if (node) _animateGlobeFocus(node);
}

export function getGraphZoom() {
  return _zoom;
}

function _centerView() {
  _measureStage();
  _applyTransform();
}

function _playActivation(el) {
  if (!el || _reducedMotion) return;
  el.classList.remove('cerberus-os-node-wrap--activated');
  // Force restart of the keyframe animation.
  void el.offsetWidth; // eslint-disable-line no-unused-expressions
  el.classList.add('cerberus-os-node-wrap--activated');
  el.addEventListener('animationend', () => {
    el.classList.remove('cerberus-os-node-wrap--activated');
  }, { once: true });
}

/** Ripple the children of a hub node (Tools/Finance) when the hub activates. */
function _rippleChildren(parentId) {
  if (_reducedMotion) return;
  const kids = _nodes.filter((n) => n.parentId === parentId);
  kids.forEach((k, i) => {
    if (!k.el) return;
    window.setTimeout(() => _playActivation(k.el), 70 + i * 55);
  });
}

function _activateNode(node) {
  if (!node) return;
  _hideNodeHud();
  _hoveredId = null;
  _noteInteraction();
  _playActivation(node.el);
  if (node.id === 'tools' || node.id === 'finance') _rippleChildren(node.id);
  // Skip focus animation — modal DOM insertion conflicts with simultaneous RAF rotation
  try {
    const result = _onNodeClick?.(node.action, node);
    if (result && typeof result.catch === 'function') {
      result.catch((err) => console.error('[atlas] node action failed:', err));
    }
  } catch (err) {
    console.error('[atlas] node click failed:', err);
  }
}

function _nodeFromEvent(e) {
  const wrap = e.target?.closest?.('.cerberus-os-node-wrap');
  if (!wrap || !_ring?.contains(wrap)) return null;
  return _nodes.find((n) => n.id === wrap.dataset.nodeId) || null;
}

/**
 * Delegated pointer handling, bound ONCE on the ring container.
 *
 * Per-node listeners proved fragile: any background data refresh that rebuilt
 * the node DOM between mousedown and mouseup silently dropped the listener and
 * the icon stopped opening its modal. Delegation on the stable ring element
 * survives every rebuild, so navigation can never lose its click wiring again.
 */
function _bindRingEvents() {
  if (!_ring || _ring.dataset.atlasRingBound) return;
  _ring.dataset.atlasRingBound = '1';

  _ring.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (_nodeFromEvent(e)) e.stopPropagation();
  });
  _ring.addEventListener('touchstart', (e) => {
    if (_nodeFromEvent(e)) e.stopPropagation();
  }, { passive: true });

  _ring.addEventListener('click', (e) => {
    const node = _nodeFromEvent(e);
    if (!node) return;
    e.stopPropagation();
    e.preventDefault();
    _activateNode(node);
  });

  _ring.addEventListener('mouseover', (e) => {
    const node = _nodeFromEvent(e);
    if (node) {
      _hoveredId = node.id;
      _updateNodeHud(node);
    }
  });
  _ring.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget?.closest?.('.cerberus-os-node-wrap')) {
      _hoveredId = null;
      _hideNodeHud();
    }
  });

  _ring.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const node = _nodeFromEvent(e);
    if (!node) return;
    e.preventDefault();
    _activateNode(node);
  });
}

function _renderDomNodes() {
  if (!_ring) return;

  // Skip full DOM rebuilds when the node set is unchanged — a rebuild between
  // mousedown and mouseup (e.g. a background data refresh) destroys the
  // element mid-click and the tap is silently lost.
  const signature = _nodes.map((n) => `${n.id}${n.label}`).join('');
  if (signature === _domSignature && _ring.childElementCount === _nodes.length) {
    const byId = new Map(_nodes.map((n) => [n.id, n]));
    _ring.querySelectorAll('.cerberus-os-node-wrap').forEach((wrap) => {
      const n = byId.get(wrap.dataset.nodeId);
      if (n) {
        n.el = wrap;
        n.btn = wrap.querySelector('.cerberus-os-node');
      }
    });
    _markNodesDirty();
    return;
  }
  _domSignature = signature;

  _ring.innerHTML = '';
  _nodes.forEach((n) => {
    const isSub = n.kind !== 'main';
    const wrap = document.createElement('div');
    wrap.className = `cerberus-os-node-wrap${isSub ? ' cerberus-os-node-wrap--sub' : ''}`;
    wrap.dataset.nodeId = n.id;
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('aria-label', _formatNodeLabel(n));

    const label = document.createElement('span');
    label.className = 'cerberus-os-node-label';
    label.textContent = _formatNodeLabel(n);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cerberus-os-node cerberus-os-node--${n.color}${isSub ? ' cerberus-os-node--sub' : ''}`;
    btn.setAttribute('aria-hidden', 'true');
    btn.tabIndex = -1;
    btn.innerHTML = n.icon;

    wrap.appendChild(label);
    wrap.appendChild(btn);
    _ring.appendChild(wrap);
    n.el = wrap;
    n.btn = btn;
  });
  _applyNodePositions();
  _markNodesDirty();
}

function _ensureHud() {
  if (_hudEl) return _hudEl;
  _hudEl = document.createElement('div');
  _hudEl.id = 'cerberus-node-hud';
  _hudEl.className = 'cerberus-node-hud hidden';
  _hudEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(_hudEl);
  return _hudEl;
}

function _hideNodeHud() {
  _hudEl?.classList.add('hidden');
}

function _updateNodeHud(node) {
  const hint = NODE_HINTS[node?.id] || NODE_HINTS[node?.action];
  if (!node?.el || !hint) {
    _hideNodeHud();
    return;
  }
  const hud = _ensureHud();
  const rect = node.el.getBoundingClientRect();
  const globe = getGlobeScreenBounds();
  const cx = globe?.cx ?? rect.left;
  const cy = globe?.cy ?? rect.top;
  const nx = rect.left + rect.width / 2;
  const ny = rect.top + rect.height / 2;
  const dx = nx - cx;
  const dy = ny - cy;
  const dist = Math.hypot(dx, dy) || 1;
  const lift = 52;
  const hx = nx + (dx / dist) * lift;
  const hy = ny + (dy / dist) * lift;
  hud.innerHTML = `<span class="cerberus-node-hud-title">${hint.title}</span><span class="cerberus-node-hud-desc">${hint.desc}</span>`;
  hud.style.left = `${hx}px`;
  hud.style.top = `${hy}px`;
  hud.classList.remove('hidden');
}

function _drawHoverHudLine(ctx, node) {
  if (!node || node.x == null) return;
  const hint = NODE_HINTS[node.id] || NODE_HINTS[node.action];
  if (!hint) return;
  const c = _stageCenter();
  const lift = 36;
  const lifted = _screenLift(node.x, node.y, lift);
  const dx = lifted.x - c;
  const dy = lifted.y - c;
  const dist = Math.hypot(dx, dy) || 1;
  const tip = {
    x: lifted.x + (dx / dist) * 28,
    y: lifted.y + (dy / dist) * 28,
  };
  ctx.save();
  ctx.strokeStyle = 'rgba(235, 245, 255, 0.72)';
  ctx.lineWidth = 0.75;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(lifted.x, lifted.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(235, 245, 255, 0.9)';
  ctx.fill();
  ctx.restore();
}

function _drawBrainSpoke(ctx, toX, toY, color, alpha, lineWidth) {
  const c = _stageCenter();
  const brainR = 36;
  const nodeR = 14;
  const dx = toX - c;
  const dy = toY - c;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const fx = c + ux * brainR;
  const fy = c + uy * brainR;
  const tx = toX - ux * nodeR;
  const ty = toY - uy * nodeR;
  const mx = (fx + tx) / 2;
  const my = (fy + ty) / 2;
  const cpX = mx - uy * dist * 0.08;
  const cpY = my + ux * dist * 0.08;

  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.quadraticCurveTo(cpX, cpY, tx, ty);
  ctx.strokeStyle = color.replace(/,\s*[\d.]+\)$/, `, ${alpha})`);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function _drawSphereArc(ctx, fromU, toU, rotX, rotY, color, alpha, lineWidth) {
  const steps = 28;
  const segments = [];
  let current = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = _slerpUnit(fromU, toU, t);
    const p = _projectSphere(s.x, s.y, s.z, rotX, rotY);
    if (p.z < -0.06) {
      if (current.length > 1) segments.push(current);
      current = [];
      continue;
    }
    current.push(p);
  }
  if (current.length > 1) segments.push(current);
  if (!segments.length) return;

  ctx.strokeStyle = color.replace(/,\s*[\d.]+\)$/, `, ${alpha})`);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const seg of segments) {
    ctx.beginPath();
    ctx.moveTo(seg[0].x, seg[0].y);
    for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i].x, seg[i].y);
    ctx.stroke();
  }
}

function _projectedDepth(ux, uy, uz, rotX, rotY) {
  return _projectSphere(ux, uy, uz, rotX, rotY).z;
}

function _shouldDrawLink(link, to, fromNode, rotX, rotY) {
  if (link.cross) return _zoom >= 1.55;
  if (link.from === 'core') return to.kind === 'main';
  if (!fromNode) return false;
  if (to.kind === 'sub') return _zoom >= 1.3;
  if (to.kind !== 'main' && fromNode.kind === 'main') return _zoom >= 1.45;
  const toZ = _projectedDepth(to.ux, to.uy, to.uz, rotX, rotY);
  const fromZ = _projectedDepth(fromNode.ux, fromNode.uy, fromNode.uz, rotX, rotY);
  return toZ > -0.35 || fromZ > -0.35;
}

/** Expanding rings emitted from the Brain core toward the globe edge. */
function _drawPulses(now) {
  if (!_ctx || _reducedMotion) return;
  if (now - _lastPulseAt > PULSE_PERIOD_MS) {
    if (_pulses.length < 4) _pulses.push(now);
    _lastPulseAt = now;
  }
  if (!_pulses.length) return;
  _pulses = _pulses.filter((t0) => now - t0 < PULSE_DUR_MS);

  const c = _stageCenter();
  const brainR = 40;
  const maxR = _globeRadius() * 1.02;
  for (const t0 of _pulses) {
    const t = Math.min(1, (now - t0) / PULSE_DUR_MS);
    const ease = 1 - Math.pow(1 - t, 2);
    const r = brainR + ease * (maxR - brainR);
    const alpha = 0.26 * (1 - t);
    if (alpha <= 0.004) continue;
    _ctx.beginPath();
    _ctx.arc(c, c, r, 0, Math.PI * 2);
    _ctx.strokeStyle = `rgba(150, 130, 255, ${alpha.toFixed(3)})`;
    _ctx.lineWidth = 1.6 * (1 - t * 0.6);
    _ctx.stroke();
  }
}

function _drawLinks(now = performance.now()) {
  if (!_ctx || !_canvas) return;
  _measureStage();
  const size = _stageSize;
  _ctx.clearRect(0, 0, size, size);
  _drawPulses(now);

  const { rotX, rotY } = getGlobeRotation();
  const coreU = { x: 0, y: 0, z: 1 };
  const nodeById = new Map(_nodes.map((n) => [n.id, n]));

  for (const link of _links) {
    const to = nodeById.get(link.to);
    if (!to || to.ux == null) continue;

    let fromU;
    let fromNode = null;
    if (link.from === 'core') {
      fromU = coreU;
    } else {
      fromNode = nodeById.get(link.from);
      if (!fromNode || fromNode.ux == null) continue;
      fromU = { x: fromNode.ux, y: fromNode.uy, z: fromNode.uz };
    }

    if (!_shouldDrawLink(link, to, fromNode, rotX, rotY)) continue;

    const active = _hoveredId === link.to || _hoveredId === link.from;
    const color = link.cross ? NODE_COLORS.cross : (NODE_COLORS[to.color] || NODE_COLORS.sub);
    const alpha = link.cross ? 0.18 : (active ? 0.72 : 0.2 + link.strength * 0.14);
    const lw = link.cross ? 0.5 : (active ? 1.6 : 1);

    if (link.from === 'core' && to.kind === 'main') {
      _drawBrainSpoke(_ctx, to.x, to.y, color, alpha, lw);
      continue;
    }

    const toU = { x: to.ux, y: to.uy, z: to.uz };
    _drawSphereArc(_ctx, fromU, toU, rotX, rotY, color, alpha, lw);
  }

  if (_hoveredId) {
    const hovered = _nodes.find((n) => n.id === _hoveredId);
    if (hovered) _drawHoverHudLine(_ctx, hovered);
  }
}

function _resizeCanvas() {
  if (!_canvas || !_world) return;
  _measureStage();
  const size = _stageSize;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  _canvas.width = Math.floor(size * dpr);
  _canvas.height = Math.floor(size * dpr);
  _canvas.style.width = `${size}px`;
  _canvas.style.height = `${size}px`;
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _drawLinks();
}

// Idle drift — the globe slowly rotates when the user hasn't interacted for a
// while, so Atlas always feels alive. Paused under reduced-motion, while
// dragging/focusing, and while the tab is hidden.
const IDLE_DRIFT_DELAY_MS = 6000;
const IDLE_DRIFT_SPEED = 0.000028; // rad per ms
let _lastInteractionAt = (typeof performance !== 'undefined' ? performance.now() : 0);
let _lastFrameAt = 0;

function _noteInteraction() {
  _lastInteractionAt = performance.now();
}

/**
 * Single performance-aware loop:
 *  - pauses entirely while the tab is hidden
 *  - node DOM writes only when marked dirty (rotation/zoom/model changes)
 *  - canvas (links + pulses) redraws per visible frame, parallax lerps
 *  - idle drift rotates the globe gently after a few seconds of no input
 */
function _animate(now) {
  _raf = requestAnimationFrame(_animate);
  if (document.hidden) {
    _lastFrameAt = 0;
    return;
  }
  const dt = _lastFrameAt ? Math.min(64, now - _lastFrameAt) : 16;
  _lastFrameAt = now;

  if (!_reducedMotion) {
    if (!_hoveredId) {
      const nx = _parX + (_parTX - _parX) * 0.055;
      const ny = _parY + (_parTY - _parY) * 0.055;
      if (Math.abs(nx - _parX) > 0.02 || Math.abs(ny - _parY) > 0.02) {
        _parX = nx;
        _parY = ny;
        _applyTransform();
      }
    }

    if (!_globeDragging && !_focusAnim && !_modalInteractionActive()
      && !document.body.classList.contains('cerberus-modal-open')
      && now - _lastInteractionAt > IDLE_DRIFT_DELAY_MS) {
      addGlobeRotation(0, IDLE_DRIFT_SPEED * dt);
    }
  }

  if (_nodesDirty) {
    _nodesDirty = false;
    _applyNodePositions();
  }
  _drawLinks(now);
}

export function refreshAtlasGraph(projects = _projects) {
  _projects = projects || [];
  loadTasks();
  const model = _buildGraphModel();
  _nodes = model.nodes;
  _links = model.links;
  _renderDomNodes();
}

export function setGraphProjects(projects) {
  _projects = projects || [];
  refreshAtlasGraph(_projects);
}

function _isInGlobeViewport(clientX, clientY) {
  const vr = _viewport?.getBoundingClientRect();
  if (!vr) return false;
  return clientX >= vr.left && clientX <= vr.right
    && clientY >= vr.top && clientY <= vr.bottom;
}

function _bindPanZoom() {
  if (!_viewport || _viewport.dataset.bound) return;
  _viewport.dataset.bound = '1';

  const _hitLayer = document.getElementById('cerberus-globe-hit-layer');

  const _onWheel = (e) => {
    if (_modalInteractionActive()) return;
    if (!_isInGlobeViewport(e.clientX, e.clientY)) return;
    if (!_canGlobeDragAt(e.clientX, e.clientY)) return;
    e.preventDefault();
    _zoom = Math.max(0.85, Math.min(2.5, _zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
    _applyTransform();
    _updateNodePositions();
    _saveViewport();
    _noteInteraction();
  };

  if (!window.__atlasGlobeWheelBound) {
    window.__atlasGlobeWheelBound = true;
    window.addEventListener('wheel', _onWheel, { passive: false, capture: true });
  }

  const _setGlobeDragCursor = (on) => {
    _viewport?.classList.toggle('cerberus-graph-viewport--globe-drag', on);
    _hitLayer?.classList.toggle('cerberus-globe-hit-layer--dragging', on);
  };

  const _onGlobeDragMove = (clientX, clientY) => {
    if (_modalInteractionActive()) return;
    if (!_globeDragStart) return;
    const dx = clientX - _globeDragStart.x;
    const dy = clientY - _globeDragStart.y;
    if (!_globeDragging) {
      if (Math.hypot(dx, dy) < GLOBE_DRAG_THRESHOLD) return;
      _globeDragging = true;
      _globeDragMoved = true;
      _setGlobeDragCursor(true);
    }
    setGlobeRotation(
      _globeDragStart.rotX + dy * GLOBE_DRAG_SENS,
      _globeDragStart.rotY + dx * GLOBE_DRAG_SENS,
    );
    _updateNodePositions();
  };

  const _endGlobeDrag = () => {
    if (_globeDragging) _saveGlobeRotation();
    _globeDragging = false;
    _globeDragMoved = false;
    _globeDragStart = null;
    _setGlobeDragCursor(false);
    _clearStuckInteractionLocks();
  };

  const _startGlobeDrag = (clientX, clientY) => {
    if (!_canGlobeDragAt(clientX, clientY)) return;
    _globeDragStart = {
      x: clientX,
      y: clientY,
      rotX: getGlobeRotation().rotX,
      rotY: getGlobeRotation().rotY,
    };
    _globeDragMoved = false;
    _noteInteraction();
  };

  const _onMouseDown = (e) => {
    if (e.button !== 0) return;
    _startGlobeDrag(e.clientX, e.clientY);
  };

  const _onTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    _startGlobeDrag(t.clientX, t.clientY);
  };

  const _onTouchMove = (e) => {
    if (!_globeDragging || !e.touches[0]) return;
    _onGlobeDragMove(e.touches[0].clientX, e.touches[0].clientY);
  };

  if (!window.__atlasGlobePointerBound) {
    window.__atlasGlobePointerBound = true;
    window.addEventListener('mousedown', _onMouseDown, true);
    window.addEventListener('touchstart', _onTouchStart, { capture: true, passive: true });
    window.addEventListener('mousemove', (e) => _onGlobeDragMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', _endGlobeDrag);
    window.addEventListener('blur', _clearStuckInteractionLocks);
    window.addEventListener('touchmove', _onTouchMove, { passive: true });
    window.addEventListener('touchend', _endGlobeDrag);
    window.addEventListener('touchcancel', _endGlobeDrag);
  }
}

export function initAtlasGraph({ onNodeClick, projects = [] } = {}) {
  if (_initialized) {
    _onNodeClick = onNodeClick;
    refreshAtlasGraph(projects);
    return;
  }
  _initialized = true;
  _onNodeClick = onNodeClick;
  _projects = projects;

  try {
    _reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch (_) {
    _reducedMotion = false;
  }

  _viewport = document.getElementById('cerberus-graph-viewport');
  _world = document.getElementById('cerberus-globe-stage') || document.getElementById('cerberus-graph-world');
  _canvas = document.getElementById('cerberus-node-connections');
  _ring = document.getElementById('cerberus-node-ring');
  if (!_viewport || !_world || !_canvas || !_ring) return;

  _clearStuckInteractionLocks();

  // Subtle parallax target — applied lerped in the animation loop.
  _viewport.addEventListener('mousemove', (e) => {
    if (_modalInteractionActive() || document.body.classList.contains('cerberus-modal-open')) {
      _parTX = 0;
      _parTY = 0;
      return;
    }
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    _parTX = (e.clientX / vw - 0.5) * -2 * PARALLAX_MAX;
    _parTY = (e.clientY / vh - 0.5) * -2 * PARALLAX_MAX;
    _noteInteraction();
  }, { passive: true });
  _viewport.addEventListener('mousedown', _noteInteraction);
  _viewport.addEventListener('wheel', _noteInteraction, { passive: true });
  _viewport.addEventListener('touchstart', _noteInteraction, { passive: true });
  _viewport.addEventListener('mouseleave', () => {
    _parTX = 0;
    _parTY = 0;
  });

  try {
    localStorage.removeItem('cerberus_graph_viewport_v1');
  } catch (_) {}

  _ctx = _canvas.getContext('2d');

  const brainBtn = document.getElementById('cerberus-brain-core');
  if (brainBtn && !brainBtn.dataset.bound) {
    brainBtn.dataset.bound = '1';
    brainBtn.addEventListener('mousedown', (e) => {
      if (e.button === 0) e.stopPropagation();
    });
    brainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        const result = _onNodeClick?.('brain');
        if (result && typeof result.then === 'function') void result;
      } catch (err) {
        console.error('[atlas] brain click failed:', err);
      }
    });
  }

  const savedRot = _loadGlobeRotation();
  if (savedRot && typeof savedRot.rotX === 'number') {
    setGlobeRotation(savedRot.rotX, savedRot.rotY || 0);
  }

  _bindRingEvents();
  _bindPanZoom();
  _measureStage();
  _resizeCanvas();
  const savedView = _loadViewport();
  _zoom = savedView?.zoom || 1;
  _applyTransform();

  _unsubGlobe = subscribeGlobeRotation(() => _updateNodePositions());
  refreshAtlasGraph(_projects);

  window.addEventListener('resize', () => {
    _measureStage();
    _resizeCanvas();
    _updateNodePositions();
  });

  window.addEventListener('cerberus-graph-changed', () => refreshAtlasGraph(_projects));

  // When a modal closes, reset interaction timer so globe drift resumes immediately
  // and clear any stuck HUD overlay.
  let _wasModalOpen = false;
  new MutationObserver(() => {
    const isOpen = document.body.classList.contains('cerberus-modal-open');
    if (_wasModalOpen && !isOpen) {
      _lastInteractionAt = 0;
      _hideNodeHud();
      _hoveredId = null;
    }
    _wasModalOpen = isOpen;
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  if (!_raf) _raf = requestAnimationFrame(_animate);

  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

export function highlightNode(id) {
  _hoveredId = id;
}

function _findNodeForAction(action) {
  const key = String(action || '').toLowerCase();
  let node = _nodes.find((n) => n.action === key || n.id === key);
  if (!node && key.startsWith('finance:')) {
    node = _nodes.find((n) => n.id === `finance-${key.slice(8)}`);
  }
  if (!node && key.startsWith('tool-')) {
    node = _nodes.find((n) => n.id === key);
  }
  if (!node && ['calendar', 'notes', 'library', 'cookbook', 'settings', 'voice', 'monitor'].includes(key)) {
    node = _nodes.find((n) => n.id === `tool-${key}`);
  }
  if (!node && ['assistant', 'offices', 'projects', 'finance', 'tasks', 'tools'].includes(key)) {
    node = _nodes.find((n) => n.id === key);
  }
  return node || null;
}

/** Viewport anchor for power lines and modal routing. */
export function getNodeAnchorForAction(action) {
  if (String(action).toLowerCase() === 'brain') {
    const brain = document.getElementById('cerberus-brain-core');
    if (brain) {
      const r = brain.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
  const node = _findNodeForAction(action);
  if (!node?.el) return null;
  const r = node.el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Screen-space globe bounds for routing lines around the sphere. */
export function getGlobeScreenBounds() {
  if (!_world) return null;
  const rect = _world.getBoundingClientRect();
  return {
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
    r: Math.min(rect.width, rect.height) * GLOBE_SURFACE_FRAC * 0.5,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export { initAtlasGraph as initAtlasNodes };
