/**
 * ReconDesk API client — thin wrapper around fetch.
 * All paths are relative to /api/cyberapps/recondesk.
 */

const BASE = '/api/cyberapps/recondesk';

async function _req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.detail || j.message || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const rdApi = {
  // Targets
  listTargets:   ()           => _req('GET',    ''),
  createTarget:  (b)          => _req('POST',   '/targets', b),
  getTarget:     (id)         => _req('GET',    `/targets/${id}`),
  updateTarget:  (id, b)      => _req('PUT',    `/targets/${id}`, b),
  deleteTarget:  (id)         => _req('DELETE', `/targets/${id}`),

  // Ports
  addPort:    (tid, b)        => _req('POST',   `/targets/${tid}/ports`, b),
  updatePort: (tid, pid, b)   => _req('PUT',    `/targets/${tid}/ports/${pid}`, b),
  deletePort: (tid, pid)      => _req('DELETE', `/targets/${tid}/ports/${pid}`),
  importNmap: (tid, xml)      => _req('POST',   `/targets/${tid}/ports/import-nmap`, { xml }),

  // Credentials
  addCredential:    (tid, b)       => _req('POST',   `/targets/${tid}/credentials`, b),
  updateCredential: (tid, cid, b)  => _req('PUT',    `/targets/${tid}/credentials/${cid}`, b),
  deleteCredential: (tid, cid)     => _req('DELETE', `/targets/${tid}/credentials/${cid}`),

  // Attack cards
  addCard:    (tid, b)        => _req('POST',   `/targets/${tid}/cards`, b),
  updateCard: (tid, cid, b)   => _req('PUT',    `/targets/${tid}/cards/${cid}`, b),
  deleteCard: (tid, cid)      => _req('DELETE', `/targets/${tid}/cards/${cid}`),

  // Timeline
  addTimelineEntry: (tid, type, desc) => _req('POST', `/targets/${tid}/timeline`, { entry_type: type, description: desc }),

  // Engagements
  createEngagement: (b)       => _req('POST',   '/engagements', b),
  updateEngagement: (id, b)   => _req('PUT',    `/engagements/${id}`, b),
  deleteEngagement: (id)      => _req('DELETE', `/engagements/${id}`),
};
