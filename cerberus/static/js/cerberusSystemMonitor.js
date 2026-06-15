// Cerberus OS — System Monitor tool modal.
//
// Frontend-safe by design: FPS, browser memory, uptime, modal/voice/bridge
// state all come from the page itself. CPU / RAM rows are structured so a
// backend can light them up later by serving GET /api/cerberus/system/metrics:
//   { ok: true, cpu_percent: 12.5, ram_used_mb: 4096, ram_total_mb: 16384 }
// Until that endpoint exists the rows show an honest "n/a (backend)" state.

import * as modalRegistry from './cerberusModalRegistry.js';

const METRICS_ENDPOINT = '/api/cerberus/system/metrics';
const REFRESH_MS = 1000;
const BACKEND_RETRY_MS = 30000;

const _bootAt = performance.now();

let _running = false;
let _raf = 0;
let _timer = 0;
let _frames = 0;
let _fpsWindowStart = 0;
let _fps = 0;
let _backendState = 'unknown'; // unknown | available | unavailable
let _backendMetrics = null;
let _lastBackendTry = 0;

function _el(id) {
  return document.getElementById(id);
}

function _fmtUptime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function _fmtMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

/** Count frames on our own tiny rAF — only runs while the monitor is open. */
function _fpsLoop(now) {
  if (!_running) return;
  _frames += 1;
  if (!_fpsWindowStart) _fpsWindowStart = now;
  const elapsed = now - _fpsWindowStart;
  if (elapsed >= 1000) {
    _fps = Math.round((_frames * 1000) / elapsed);
    _frames = 0;
    _fpsWindowStart = now;
  }
  _raf = requestAnimationFrame(_fpsLoop);
}

async function _pollBackend() {
  const now = Date.now();
  if (_backendState === 'unavailable' && now - _lastBackendTry < BACKEND_RETRY_MS) return;
  _lastBackendTry = now;
  try {
    const res = await fetch(METRICS_ENDPOINT, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    _backendMetrics = data && data.ok !== false ? data : null;
    _backendState = _backendMetrics ? 'available' : 'unavailable';
  } catch (_) {
    _backendMetrics = null;
    _backendState = 'unavailable';
  }
}

function _voiceStatus() {
  const chip = document.getElementById('cerberus-voice-status-chip');
  const status = chip?.dataset?.status || 'idle';
  const text = chip?.querySelector('.atlas-voice-status-chip-text')?.textContent?.trim();
  return text || (status.charAt(0).toUpperCase() + status.slice(1));
}

function _bridgeStatus() {
  return document.getElementById('cerberus-status-bridge')?.textContent?.replace(/^Desktop:?\s*/i, '').trim() || '—';
}

function _activeModals() {
  try {
    return modalRegistry.getOpenModals() || [];
  } catch (_) {
    return [];
  }
}

function _setRow(id, value, state = '') {
  const row = _el(id);
  if (!row) return;
  const valEl = row.querySelector('.atlas-sysmon-value');
  if (valEl && valEl.textContent !== value) valEl.textContent = value;
  if (state) row.dataset.state = state;
  else delete row.dataset.state;
}

function _render() {
  if (!_running) return;

  _setRow('cerberus-sysmon-fps', `${_fps || '—'} fps`, _fps >= 50 ? 'good' : (_fps >= 30 ? 'warn' : (_fps ? 'bad' : '')));
  _setRow('cerberus-sysmon-uptime', _fmtUptime(performance.now() - _bootAt));

  const mem = performance.memory;
  if (mem && mem.usedJSHeapSize) {
    _setRow(
      'cerberus-sysmon-heap',
      `${_fmtMb(mem.usedJSHeapSize)} / ${_fmtMb(mem.jsHeapSizeLimit)}`,
      mem.usedJSHeapSize / mem.jsHeapSizeLimit > 0.8 ? 'warn' : 'good',
    );
  } else {
    _setRow('cerberus-sysmon-heap', 'n/a (browser)', 'na');
  }

  if (_backendState === 'available' && _backendMetrics) {
    const cpu = _backendMetrics.cpu_percent;
    const used = _backendMetrics.ram_used_mb;
    const total = _backendMetrics.ram_total_mb;
    _setRow('cerberus-sysmon-cpu', cpu != null ? `${Number(cpu).toFixed(1)}%` : 'n/a', cpu > 85 ? 'warn' : 'good');
    _setRow(
      'cerberus-sysmon-ram',
      used != null && total != null ? `${used} / ${total} MB` : 'n/a',
      total && used / total > 0.85 ? 'warn' : 'good',
    );
    _setRow('cerberus-sysmon-backend', 'Connected', 'good');
  } else {
    _setRow('cerberus-sysmon-cpu', 'n/a (backend)', 'na');
    _setRow('cerberus-sysmon-ram', 'n/a (backend)', 'na');
    _setRow('cerberus-sysmon-backend', _backendState === 'unknown' ? 'Checking…' : 'Not connected', _backendState === 'unknown' ? '' : 'na');
  }

  const modals = _activeModals();
  _setRow('cerberus-sysmon-modals', modals.length ? `${modals.length} open — ${modals.join(', ')}` : 'None');
  _setRow('cerberus-sysmon-voice', _voiceStatus());
  _setRow('cerberus-sysmon-bridge', _bridgeStatus());
}

export function startSystemMonitor() {
  _render(); // paint immediately with whatever we have
  if (_running) return;
  _running = true;
  _frames = 0;
  _fpsWindowStart = 0;
  _raf = requestAnimationFrame(_fpsLoop);
  void _pollBackend();
  _timer = window.setInterval(() => {
    if (document.hidden) return;
    void _pollBackend();
    _render();
  }, REFRESH_MS);
}

export function stopSystemMonitor() {
  _running = false;
  if (_raf) cancelAnimationFrame(_raf);
  _raf = 0;
  if (_timer) window.clearInterval(_timer);
  _timer = 0;
  _fps = 0;
}

export function isSystemMonitorRunning() {
  return _running;
}

const cerberusSystemMonitor = { startSystemMonitor, stopSystemMonitor, isSystemMonitorRunning };
export default cerberusSystemMonitor;
