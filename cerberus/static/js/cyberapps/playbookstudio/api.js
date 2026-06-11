/**
 * static/js/cyberapps/playbookstudio/api.js
 * Fetch wrappers for the PlaybookStudio backend API.
 */

const BASE = '/api/cyberapps/playbookstudio';

async function _json(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

export async function fetchPlaybooks() {
  return _json(await fetch(`${BASE}/playbooks`));
}

export async function savePlaybook(pb) {
  return _json(await fetch(`${BASE}/playbooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pb),
  }));
}

export async function deletePlaybook(id) {
  return _json(await fetch(`${BASE}/playbooks/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

export async function clonePlaybook(id) {
  return _json(await fetch(`${BASE}/playbooks/${encodeURIComponent(id)}/clone`, { method: 'POST' }));
}

export async function restoreVersion(id, versionIdx) {
  return _json(await fetch(`${BASE}/playbooks/${encodeURIComponent(id)}/restore/${versionIdx}`, { method: 'POST' }));
}

export async function fetchRuns() {
  return _json(await fetch(`${BASE}/runs`));
}

export async function startRun(payload) {
  return _json(await fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export async function patchRunStep(runId, stepId, patch) {
  return _json(await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }));
}

export async function completeRun(runId, patch) {
  return _json(await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/complete`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }));
}

export async function deleteRun(runId) {
  return _json(await fetch(`${BASE}/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' }));
}

export async function exportRun(runId) {
  return _json(await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/export`));
}
