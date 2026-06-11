/**
 * static/js/cyberapps/signalboard/api.js
 * SignalBoard — backend API helpers for /api/cyberapps/signalboard/*
 */

const BASE = '/api/cyberapps/signalboard';

async function _json(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

const _get   = p      => _json('GET',    p);
const _post  = (p, b) => _json('POST',   p, b);
const _put   = (p, b) => _json('PUT',    p, b);
const _patch = (p, b) => _json('PATCH',  p, b);
const _del   = p      => _json('DELETE', p);

export const getSources        = ()         => _get('/sources');
export const createSource      = body       => _post('/sources', body);
export const updateSource      = (id, body) => _patch(`/sources/${id}`, body);
export const deleteSource      = id         => _del(`/sources/${id}`);
export const updateSourceStats = (id, body) => _patch(`/sources/${id}/stats`, body);

export const getItems   = ()     => _get('/items');
export const saveItems  = items  => _put('/items', { items });
export const patchItem  = (id, b) => _patch(`/items/${id}`, b);
export const clearItems = ()     => _del('/items');

export const getBookmarks  = ()          => _get('/bookmarks');
export const saveBookmarks = (ids, tags) => _put('/bookmarks', { ids, tags });

export const getSettings   = ()   => _get('/settings');
export const patchSettings = body => _patch('/settings', body);

export const getAlertRules  = ()    => _get('/alert-rules');
export const saveAlertRules = rules => _put('/alert-rules', rules);

export const getContext  = ()  => _get('/context');
export const saveContext = ctx => _put('/context', ctx);
