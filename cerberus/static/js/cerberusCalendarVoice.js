// Cerberus OS — voice-guided calendar event creation + date selection

import { cmdHandled, cmdUnhandled } from './cerberusCommandResult.js';
import cerberusOverlayTools from './cerberusOverlayTools.js';

let _capture = null;

const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

function _norm(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function _stripPrefixes(text) {
  return _norm(text)
    .replace(/^(?:(?:hey\s+)?atlas\s+)?(?:(?:can\s+you|could\s+you|please)\s+)?/i, '')
    .trim();
}

export function getCalendarCaptureState() {
  return _capture ? { ..._capture } : null;
}

export function clearCalendarCapture() {
  _capture = null;
}

function _parseVoiceDate(text) {
  const q = _norm(text).replace(/^select\s+/, '').replace(/^the\s+/, '');
  const iso = q.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const m = q.match(/(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([a-z]+)(?:\s+(\d{4}))?/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = MONTHS[m[2].toLowerCase()];
    const year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
    if (mon && day >= 1 && day <= 31) {
      return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

function _parseVoiceTime(text) {
  const t = _norm(text);
  if (!t || t === 'skip' || t === 'no description') return null;
  if (t === 'all day' || t === 'all-day' || t === 'all day event') return { allDay: true };

  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3];
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return { hour: h, minute: min };
}

function _fmtTime(t) {
  if (!t || t.allDay) return null;
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

async function _syncForm() {
  const cal = await import('./calendar.js');
  cal.voiceFillEventFields?.({
    title: _capture?.title,
    date: _capture?.date,
    endDate: _capture?.date,
    startTime: _fmtTime(_capture?.startTime),
    endTime: _fmtTime(_capture?.endTime),
    description: _capture?.description,
    allDay: _capture?.allDay,
  });
}

async function _selectDate(iso) {
  await cerberusOverlayTools.openOverlayTool('calendar');
  const cal = await import('./calendar.js');
  cal.selectCalendarDay?.(iso);
  return cmdHandled(true, `Selected ${iso}.`, {
    uiAction: { type: 'open_overlay', payload: { tool: 'calendar' } },
    uiActivity: `Done: Selected ${iso}`,
  });
}

async function _createEvent() {
  const c = _capture;
  if (!c?.title) return cmdHandled(false, 'Missing event title.');
  const date = c.date || new Date().toISOString().slice(0, 10);

  await cerberusOverlayTools.openOverlayTool('calendar');
  const cal = await import('./calendar.js');
  await cal.voiceCreateEvent?.({
    title: c.title,
    date,
    startTime: _fmtTime(c.startTime) || '09:00',
    endTime: _fmtTime(c.endTime) || '10:00',
    description: c.description || '',
    allDay: !!c.allDay,
  });
  clearCalendarCapture();

  return cmdHandled(true, 'Calendar event created.', {
    uiAction: { type: 'open_overlay', payload: { tool: 'calendar' } },
    uiActivity: 'Done: Calendar event created',
  });
}

export async function tryHandleCalendarVoice(transcript) {
  const raw = String(transcript || '').trim();
  const norm = _stripPrefixes(raw);
  if (!norm) return cmdUnhandled();

  if (_capture) {
    if (norm === 'cancel' || norm === 'cancel event') {
      clearCalendarCapture();
      return cmdHandled(true, 'Event cancelled.');
    }
    if (_capture.step === 'title') {
      _capture.title = raw.trim();
      _capture.step = 'start';
      await _syncForm();
      return cmdHandled(true, 'What time does it start?', {
        uiAction: { type: 'open_overlay', payload: { tool: 'calendar' } },
      });
    }
    if (_capture.step === 'start') {
      if (norm === 'all day') {
        _capture.allDay = true;
        _capture.step = 'desc';
        await _syncForm();
        return cmdHandled(true, 'Any description?');
      }
      const st = _parseVoiceTime(norm);
      if (!st) return cmdHandled(false, 'Say a time like 9 AM, or say all day.');
      _capture.startTime = st;
      _capture.step = 'end';
      await _syncForm();
      return cmdHandled(true, 'What time does it end?');
    }
    if (_capture.step === 'end') {
      if (norm === 'skip') {
        _capture.step = 'desc';
        return cmdHandled(true, 'Any description?');
      }
      const et = _parseVoiceTime(norm);
      if (!et) return cmdHandled(false, 'Say an end time or skip.');
      _capture.endTime = et;
      _capture.step = 'desc';
      await _syncForm();
      return cmdHandled(true, 'Any description?');
    }
    if (_capture.step === 'desc') {
      if (norm !== 'skip' && norm !== 'no description') _capture.description = raw.trim();
      await _syncForm();
      return _createEvent();
    }
  }

  const selectMatch = norm.match(/^select\s+(.+)$/);
  if (selectMatch) {
    const iso = _parseVoiceDate(selectMatch[1]);
    if (iso) return _selectDate(iso);
  }

  if (/^(?:add to calendar|create calendar event|new calendar event|create event)$/.test(norm)) {
    const today = new Date().toISOString().slice(0, 10);
    _capture = { step: 'title', date: today, title: '', description: '' };
    await cerberusOverlayTools.openOverlayTool('calendar');
    const cal = await import('./calendar.js');
    cal.voiceEnsureEventForm?.(today);
    return cmdHandled(true, 'What is happening?', {
      uiAction: { type: 'open_overlay', payload: { tool: 'calendar' } },
      uiActivity: 'Executing: New calendar event',
    });
  }

  return cmdUnhandled();
}

export default { tryHandleCalendarVoice, getCalendarCaptureState, clearCalendarCapture };
