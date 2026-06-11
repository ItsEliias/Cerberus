/**
 * static/js/cyberapps/playbookstudio/api.js
 * Thin fetch wrappers for the PlaybookStudio backend routes.
 */

const BASE = '/api/cyberapps/playbookstudio';

async function _json(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Playbooks ─────────────────────────────────────────────────────────────────

export async function fetchPlaybooks() {
  const data = await _json(await fetch(`${BASE}/playbooks`));
  return data.playbooks || [];
}

export async function savePlaybook(pb) {
  const data = await _json(await fetch(`${BASE}/playbooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pb),
  }));
  return data;
}

export async function deletePlaybook(id) {
  return _json(await fetch(`${BASE}/playbooks/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

export async function clonePlaybook(id) {
  return _json(await fetch(`${BASE}/playbooks/${encodeURIComponent(id)}/clone`, { method: 'POST' }));
}

export async function restoreVersion(playbookId, versionIdx) {
  return _json(await fetch(
    `${BASE}/playbooks/${encodeURIComponent(playbookId)}/restore/${versionIdx}`,
    { method: 'POST' }
  ));
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export async function fetchRuns() {
  const data = await _json(await fetch(`${BASE}/runs`));
  return data.runs || [];
}

export async function startRun(run) {
  return _json(await fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(run),
  }));
}

export async function patchRunStep(runId, stepId, patch) {
  return _json(await fetch(
    `${BASE}/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  ));
}

export async function completeRun(runId, status, completedAt) {
  return _json(await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/complete`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, completedAt }),
  }));
}

export async function deleteRun(runId) {
  return _json(await fetch(`${BASE}/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' }));
}

export async function exportRun(runId) {
  return _json(await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/export`));
}
