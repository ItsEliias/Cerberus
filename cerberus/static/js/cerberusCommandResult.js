// Cerberus OS — standardized voice/command handler results

export function cmdUnhandled() {
  return { handled: false };
}

export function cmdHandled(ok, message, { spoken = false, uiAction = null, uiActions = null, uiActivity = null, speakFull = false } = {}) {
  return {
    handled: true,
    ok: !!ok,
    message: message || '',
    spoken: !!spoken,
    speakFull: !!speakFull,
    uiAction: uiAction || null,
    uiActions: uiActions || null,
    uiActivity: uiActivity || null,
  };
}

export function cmdDebug(label, data) {
  try {
    if (localStorage.getItem('cerberus_voice_debug') === 'true') {
      if (data !== undefined) console.log(`[atlas-command] ${label}`, data);
      else console.log(`[atlas-command] ${label}`);
    }
  } catch (_) {}
}

export function normalizeSubmitResult(result) {
  if (result && typeof result === 'object' && 'handled' in result) {
    return {
      handled: !!result.handled,
      ok: result.ok !== false,
      message: result.message || result.reply || '',
      spoken: !!result.spoken,
    };
  }
  const text = String(result || '').trim();
  return { handled: false, ok: !!text, message: text, spoken: false };
}

export function resultMessage(result) {
  return result?.message || result?.reply || '';
}
