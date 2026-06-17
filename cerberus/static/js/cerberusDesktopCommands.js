// Cerberus OS — voice/text desktop command routing (whitelisted actions only)



import { cmdHandled, cmdUnhandled } from './cerberusCommandResult.js';



let _statusCache = null;



async function _fetchJson(url, opts = {}) {

  const res = await fetch(url, { credentials: 'same-origin', ...opts });

  return res.json();

}



async function _desktopStatus() {

  try {

    _statusCache = await _fetchJson('/api/cerberus/desktop/status');

  } catch (_) {

    _statusCache = { enabled: false, bridge_ready: false, message: 'Desktop status unavailable' };

  }

  return _statusCache;

}



export async function parseDesktopIntent(text, { activeProjectId } = {}) {

  const res = await _fetchJson('/api/cerberus/desktop/parse', {

    method: 'POST',

    headers: { 'Content-Type': 'application/json' },

    body: JSON.stringify({

      text,

      active_project_id: activeProjectId || null,

    }),

  });

  return res;

}



export async function executeDesktopCommand(intent) {

  if (!intent?.matched || intent.error) {

    return {

      ok: false,

      message: intent?.message || 'Not a desktop command.',

    };

  }

  const res = await _fetchJson('/api/cerberus/desktop/command', {

    method: 'POST',

    headers: { 'Content-Type': 'application/json' },

    body: JSON.stringify({

      command: intent.command,

      args: intent.args || {},

    }),

  });

  return res;

}



/**

 * Desktop command flow — executes immediately (no confirmation).

 */

export async function handleDesktopMessage(text, {

  activeProjectId,

  onLog,

  speak,

} = {}) {

  const msg = String(text || '').trim();

  if (!msg) return cmdUnhandled();



  const parsed = await parseDesktopIntent(msg, { activeProjectId });

  if (!parsed.matched) return cmdUnhandled();



  const finish = async (ok, message) => {

    onLog?.('cerberus', message);

    let spoken = false;

    if (speak && message) {

      await speak(message);

      spoken = true;

    }

    return cmdHandled(ok, message, { spoken });

  };



  if (parsed.error) {

    return finish(false, parsed.message || 'Could not run that desktop command.');

  }



  if (parsed.require_confirmation) {

    return finish(false, parsed.message || 'That action requires confirmation in the UI.');

  }



  await _desktopStatus();

  if (!_statusCache?.enabled) {

    return finish(false, _statusCache?.message || 'Desktop control is disabled. Enable it in desktop permissions and start the bridge.');

  }



  onLog?.('cerberus', '', { processing: true });

  const result = await executeDesktopCommand(parsed);

  const message = result.message || (result.ok ? `${parsed.label} — done.` : 'Desktop command failed.');

  return finish(!!result.ok, message);

}



const cerberusDesktopCommands = {

  handleDesktopMessage,

  parseDesktopIntent,

  executeDesktopCommand,

};



export default cerberusDesktopCommands;


