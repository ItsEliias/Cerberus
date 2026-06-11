/**
 * static/js/cyberapps/signalboard/api.js
 * SignalBoard — backend API helpers.
 * All calls go to /api/cyberapps/signalboard/*
 */

const BASE = '/api/cyberapps/signalboard';

async function _json(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

const get   = path => _json('GET',    path);
const post  = (path, b) => _json('POST',  path, b);
const put   = (path, b) => _json('PUT',   path, b);
const patch = (path, b) => _json('PATCH', path, b);
const del   = path => _json('DELETE', path);

// --- Sources -----------------------------------------------------------------
export const getSources       = ()         => get('/sources');
export const createSource     = body       => post('/sources', body);
export const updateSource     = (id, body) => patch(`/sources/${id}`, body);
export const deleteSource     = id         => del(`/sources/${id}`);
export const updateSourceStats = (id, body) => patch(`/sources/${id}/stats`, body);

// --- Items -------------------------------------------------------------------
export const getItems   = ()     => get('/items');
export const saveItems  = items  => put('/items', { items });
export const patchItem  = (id, body) => patch(`/items/${id}`, body);
export const clearItems = ()     => del('/items');

// --- Bookmarks ---------------------------------------------------------------
export const getBookmarks  = ()          => get('/bookmarks');
export const saveBookmarks = (ids, tags) => put('/bookmarks', { ids, tags });

// --- Settings ----------------------------------------------------------------
export const getSettings   = ()     => get('/settings');
export const patchSettings = body   => patch('/settings', body);

// --- Alert Rules -------------------------------------------------------------
export const getAlertRules  = ()    => get('/alert-rules');
export const saveAlertRules = rules => put('/alert-rules', rules);

// --- Context -----------------------------------------------------------------
export const getContext  = ()  => get('/context');
export const saveContext = ctx => put('/context', ctx);
