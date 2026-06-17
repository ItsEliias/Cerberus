// Cerberus OS — UE5 Blueprint-style curved power lines from globe nodes to open modals



import { getOpenModals } from './cerberusModalRegistry.js';

import { getNodeAnchorForAction, getGlobeScreenBounds } from './cerberusGraph.js';



const MODAL_DOM_IDS = {

  assistant: 'cerberus-shell-modal-assistant',

  offices: 'cerberus-shell-modal-offices',

  tools: 'cerberus-shell-modal-tools',

  brain: 'cerberus-shell-modal-brain',

  voice: 'cerberus-shell-modal-voice',

  monitor: 'cerberus-shell-modal-monitor',

  projects: 'cerberus-projects-panel',

  finance: 'cerberus-finance-panel',

  tasks: 'tasks-modal',

  calendar: 'calendar-modal',

  notes: 'notes-pane',

  library: 'doclib-modal',

  cookbook: 'cookbook-modal',

  settings: 'settings-modal',

};



const ACTION_PREFIX = {

  'finance:': 'finance',

  'project:': 'projects',

  'office:': 'offices',

  'dept:': 'offices',

  'agent:': 'offices',

  'task:': 'tasks',

};



let _canvas = null;

let _ctx = null;

let _raf = 0;

let _phase = 0;



function _resolveAction(modalId) {

  const key = String(modalId || '').toLowerCase();

  if (ACTION_PREFIX[key]) return ACTION_PREFIX[key];

  for (const [prefix, action] of Object.entries(ACTION_PREFIX)) {

    if (key.startsWith(prefix)) return action;

  }

  if (key === 'tool-voice' || key === 'voice') return 'voice';

  if (key === 'tool-monitor' || key === 'monitor') return 'monitor';

  return key;

}



function _modalElement(modalId) {

  const key = String(modalId || '').toLowerCase();

  const domId = MODAL_DOM_IDS[key];

  if (domId) {

    const el = document.getElementById(domId);

    if (el && !el.classList.contains('hidden')) {

      if (key === 'settings') {

        return el.querySelector('.settings-modal-content') || el;

      }

      return el;

    }

  }

  const portal = document.getElementById('cerberus-modal-portal');

  if (!portal) return null;

  for (const child of portal.children) {

    if (child.classList.contains('hidden')) continue;

    const attr = child.dataset?.cerberusModalId || child.id || '';

    if (String(attr).toLowerCase() === key) return child;

    if (key === 'settings' && child.id === 'settings-modal') {

      return child.querySelector('.settings-modal-content') || child;

    }

  }

  return null;

}



function _modalAnchor(rect, fromX, fromY) {

  const cx = rect.left + rect.width / 2;

  const cy = rect.top + rect.height / 2;

  const dx = cx - fromX;

  const dy = cy - fromY;

  if (Math.abs(dx) > Math.abs(dy)) {

    return {

      x: dx > 0 ? rect.left : rect.right,

      y: cy,

    };

  }

  return {

    x: cx,

    y: dy > 0 ? rect.top : rect.bottom,

  };

}



/** UE Blueprint-style noodle: stub → cubic curve → stub. */

function _blueprintNoodle(from, to, globe, idx) {

  const gc = { x: globe.cx, y: globe.cy };

  const dx = to.x - from.x;

  const dy = to.y - from.y;



  let pinOut;

  if (Math.abs(dx) >= Math.abs(dy)) {

    pinOut = { x: from.x + (dx >= 0 ? 44 : -44), y: from.y };

  } else {

    pinOut = { x: from.x, y: from.y + (dy >= 0 ? 44 : -44) };

  }



  let pinIn;

  const tdx = to.x - pinOut.x;

  const tdy = to.y - pinOut.y;

  if (Math.abs(tdx) >= Math.abs(tdy)) {

    pinIn = { x: to.x + (tdx >= 0 ? -40 : 40), y: to.y };

  } else {

    pinIn = { x: to.x, y: to.y + (tdy >= 0 ? -40 : 40) };

  }



  const midX = (pinOut.x + pinIn.x) * 0.5;

  const midY = (pinOut.y + pinIn.y) * 0.5;

  const vx = midX - gc.x;

  const vy = midY - gc.y;

  const len = Math.hypot(vx, vy) || 1;

  const nx = vx / len;

  const ny = vy / len;

  const cross = (from.x - gc.x) * (to.y - gc.y) - (from.y - gc.y) * (to.x - gc.x);

  const side = cross >= 0 ? 1 : -1;

  const bulge = globe.r * 0.38 + 36 + (idx % 3) * 14;

  const perpX = -ny * side;

  const perpY = nx * side;



  const cp1 = {

    x: pinOut.x + nx * bulge * 0.35 + perpX * bulge * 0.55,

    y: pinOut.y + ny * bulge * 0.35 + perpY * bulge * 0.55,

  };

  const cp2 = {

    x: pinIn.x + nx * bulge * 0.2 + perpX * bulge * 0.35,

    y: pinIn.y + ny * bulge * 0.2 + perpY * bulge * 0.35,

  };



  return { from, pinOut, cp1, cp2, pinIn, to, pins: [pinOut, pinIn] };

}



function _drawPin(x, y, alpha) {

  _ctx.save();

  _ctx.fillStyle = `rgba(200, 235, 255, ${alpha * 0.9})`;

  _ctx.strokeStyle = `rgba(120, 200, 255, ${alpha * 0.55})`;

  _ctx.lineWidth = 0.75;

  _ctx.beginPath();

  _ctx.arc(x, y, 3.2, 0, Math.PI * 2);

  _ctx.fill();

  _ctx.stroke();

  _ctx.restore();

}



function _drawBlueprintNoodle(path, alpha, dashOffset) {

  if (!_ctx) return;

  const { from, pinOut, cp1, cp2, pinIn, to, pins } = path;



  _ctx.save();

  _ctx.lineCap = 'round';

  _ctx.lineJoin = 'round';

  _ctx.setLineDash([8, 6]);

  _ctx.lineDashOffset = -dashOffset;



  _ctx.beginPath();

  _ctx.moveTo(from.x, from.y);

  _ctx.lineTo(pinOut.x, pinOut.y);

  _ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, pinIn.x, pinIn.y);

  _ctx.lineTo(to.x, to.y);

  _ctx.strokeStyle = `rgba(220, 240, 255, ${alpha})`;

  _ctx.lineWidth = 1.35;

  _ctx.stroke();



  _ctx.setLineDash([]);

  _ctx.lineWidth = 0.65;

  _ctx.strokeStyle = `rgba(140, 210, 255, ${alpha * 0.4})`;

  _ctx.stroke();

  _ctx.restore();



  _drawPin(from.x, from.y, alpha * 0.7);

  for (const pin of pins) _drawPin(pin.x, pin.y, alpha);

  _drawPin(to.x, to.y, alpha * 0.75);

}



function _resize() {

  if (!_canvas) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const w = window.innerWidth;

  const h = window.innerHeight;

  _canvas.width = Math.floor(w * dpr);

  _canvas.height = Math.floor(h * dpr);

  _canvas.style.width = `${w}px`;

  _canvas.style.height = `${h}px`;

  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

}



function _draw(now) {

  if (!_ctx || !_canvas) return;

  _resize();

  _ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);



  if (!document.body.classList.contains('cerberus-hub-active')) return;



  const open = getOpenModals();

  if (!open.length) return;



  const globe = getGlobeScreenBounds();

  if (!globe) return;



  _phase = (now / 40) % 24;



  open.forEach((modalId, i) => {

    const action = _resolveAction(modalId);

    const anchor = getNodeAnchorForAction(action);

    const modal = _modalElement(modalId);

    if (!anchor || !modal) return;



    const mRect = modal.getBoundingClientRect();

    if (mRect.width < 20 || mRect.height < 20) return;



    const target = _modalAnchor(mRect, anchor.x, anchor.y);

    const noodle = _blueprintNoodle(anchor, target, globe, i);

    const pulse = 0.55 + Math.sin(now * 0.004 + i * 1.2) * 0.2;

    _drawBlueprintNoodle(noodle, pulse, _phase + i * 4);

  });

}



function _loop(now) {

  _draw(now);

  _raf = requestAnimationFrame(_loop);

}



export function initAtlasPowerLinks() {

  if (_canvas) return;

  _canvas = document.getElementById('cerberus-power-links');

  if (!_canvas) return;

  _ctx = _canvas.getContext('2d');

  window.addEventListener('resize', _resize);

  _raf = requestAnimationFrame(_loop);

}



export function destroyAtlasPowerLinks() {

  if (_raf) cancelAnimationFrame(_raf);

  _raf = 0;

  window.removeEventListener('resize', _resize);

}

