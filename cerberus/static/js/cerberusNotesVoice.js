// Cerberus OS — voice-guided notes + to-do creation

import { cmdHandled, cmdUnhandled } from './cerberusCommandResult.js';
import cerberusOverlayTools from './cerberusOverlayTools.js';

let _capture = null;

function _norm(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function _stripPrefixes(text) {
  return _norm(text)
    .replace(/^(?:(?:hey\s+)?atlas\s+)?(?:(?:can\s+you|could\s+you|please)\s+)?/i, '')
    .trim();
}

export function clearNotesCapture() {
  _capture = null;
}

async function _openNotesUi() {
  await cerberusOverlayTools.openOverlayTool('notes');
}

async function _fillDraft(text, type) {
  const notes = await import('./notes.js');
  await notes.voicePrepareNote?.(type, text || '');
}

async function _saveDraft() {
  const notes = await import('./notes.js');
  const ok = await notes.voiceSaveNoteDraft?.();
  clearNotesCapture();
  if (ok && window.uiModule?.showToast) window.uiModule.showToast('Note saved.');
  return ok;
}

export async function tryHandleNotesVoice(transcript) {
  const raw = String(transcript || '').trim();
  const norm = _stripPrefixes(raw);
  if (!norm) return cmdUnhandled();

  if (_capture) {
    if (norm === 'cancel') {
      clearNotesCapture();
      return cmdHandled(true, 'Cancelled.');
    }
    if (_capture.step === 'body') {
      _capture.text = raw.trim();
      const notes = await import('./notes.js');
      await notes.voicePrepareNote?.(_capture.type, '');
      notes.voiceUpdateNoteDraft?.(_capture.text);
      _capture.step = 'ready';
      return cmdHandled(true, 'Say save note or save task when ready.', {
        uiAction: { type: 'open_overlay', payload: { tool: 'notes' } },
      });
    }
    if (norm === 'save note' || norm === 'save task' || norm === 'save it') {
      await _openNotesUi();
      const ok = await _saveDraft();
      return cmdHandled(!!ok, ok ? 'Note saved.' : 'Nothing to save.', {
        uiAction: { type: 'open_overlay', payload: { tool: 'notes' } },
        uiActivity: ok ? 'Done: Note saved' : 'Error: Save failed',
      });
    }
  }

  const directNote = norm.match(/^add note:\s*(.+)$/);
  if (directNote) {
    await _openNotesUi();
    await _fillDraft(directNote[1], 'note');
    const ok = await _saveDraft();
    return cmdHandled(!!ok, ok ? 'Note saved.' : 'Failed to save note.', {
      uiAction: { type: 'open_overlay', payload: { tool: 'notes' } },
      uiActivity: ok ? 'Done: Note saved' : 'Error: Note failed',
    });
  }

  const directTodo = norm.match(/^add to-?do:\s*(.+)$/) || norm.match(/^add task:\s*(.+)$/);
  if (directTodo) {
    await _openNotesUi();
    await _fillDraft(directTodo[1], 'todo');
    const ok = await _saveDraft();
    return cmdHandled(!!ok, ok ? 'Task saved.' : 'Failed to save task.', {
      uiAction: { type: 'open_overlay', payload: { tool: 'notes' } },
      uiActivity: ok ? 'Done: Task saved' : 'Error: Task failed',
    });
  }

  if (/^(?:add note|create note|new note)$/.test(norm)) {
    _capture = { step: 'body', type: 'note', text: '' };
    await _openNotesUi();
    return cmdHandled(true, 'What should the note say?', {
      uiAction: { type: 'open_overlay', payload: { tool: 'notes' } },
      uiActivity: 'Executing: Add note',
    });
  }

  if (/^(?:add to-?do|create task|add task|new task|add reminder)$/.test(norm)) {
    _capture = { step: 'body', type: 'todo', text: '' };
    await _openNotesUi();
    return cmdHandled(true, 'What is the task?', {
      uiAction: { type: 'open_overlay', payload: { tool: 'notes' } },
      uiActivity: 'Executing: Add to-do',
    });
  }

  if (norm === 'save note' || norm === 'save task') {
    const ok = await _saveDraft();
    return cmdHandled(!!ok, ok ? 'Saved.' : 'Nothing to save.');
  }

  return cmdUnhandled();
}

export default { tryHandleNotesVoice, clearNotesCapture };
