// Cerberus OS — global shell helpers (ticker, model status, routing, init)



export function isCerberusHomeRoute(path = window.location.pathname) {

  return path === '/home';

}



export function isAtlasAssistantRoute(path = window.location.pathname) {

  return path === '/assistant';

}



export function isCerberusAgentsRoute(path = window.location.pathname) {

  return path === '/agents';

}



export function isCerberusProjectsRoute(path = window.location.pathname) {

  return path === '/projects';

}



export function isCerberusFinanceRoute(path = window.location.pathname) {

  return path === '/finance';

}



export function isAtlasShellRoute(path = window.location.pathname) {

  return isCerberusHomeRoute(path)

    || isCerberusAgentsRoute(path)

    || isCerberusProjectsRoute(path)

    || isCerberusFinanceRoute(path)

    || path === '/assistant'

    || path === '/memory'

    || path === '/tasks'

    || path === '/notes'

    || path === '/calendar'

    || path === '/library'

    || path === '/cookbook';

}



export function cerberusHomeUrl() {

  return '/home';

}



export function atlasAgentsUrl() {

  return '/agents';

}



export function cerberusProjectsUrl() {

  return '/projects';

}



export function cerberusFinanceUrl() {

  return '/finance';

}



export function atlasAssistantUrl(sessionId) {

  return sessionId ? `/assistant#${sessionId}` : '/assistant';

}



export function initAtlasShell() {

  document.body.classList.add('cerberus-os');

}



/**

 * Enable horizontal marquee on the briefing bar when text overflows.

 * Label stays pinned; only the message track scrolls.

 */

export function updateBriefingTicker() {

  const ticker = document.getElementById('cerberus-briefing-ticker');

  const track = document.getElementById('cerberus-briefing-ticker-track');

  const textEl = document.getElementById('cerberus-home-briefing-text');

  const cloneEl = document.getElementById('cerberus-briefing-ticker-clone');

  if (!ticker || !track || !textEl) return;



  ticker.classList.remove('cerberus-ticker--scroll');

  track.style.removeProperty('--atlas-ticker-duration');

  if (cloneEl) cloneEl.textContent = '';



  const text = textEl.textContent || '';

  if (!text.trim()) return;



  requestAnimationFrame(() => {

    const overflow = textEl.scrollWidth > ticker.clientWidth + 4;

    if (!overflow) return;



    if (cloneEl) cloneEl.textContent = text;

    ticker.classList.add('cerberus-ticker--scroll');

    const pxPerSec = 48;

    const duration = Math.max(12, (textEl.scrollWidth + 80) / pxPerSec);

    track.style.setProperty('--atlas-ticker-duration', `${duration}s`);

  });

}



/** Sync the Assistant status pill with the current model picker state. */

export function updateAtlasModelStatus(modelId) {

  const pill = document.getElementById('cerberus-model-status');

  const textEl = document.getElementById('cerberus-model-status-text');

  if (!pill || !textEl) return;



  const hasModel = !!(modelId && modelId !== 'Select model');

  pill.classList.toggle('cerberus-status-pill--online', hasModel);

  pill.classList.toggle('cerberus-status-pill--offline', !hasModel);



  if (hasModel) {

    const short = modelId.split('/').pop();

    textEl.textContent = `Model online · ${short}`;

    pill.title = modelId;

  } else {

    textEl.textContent = 'Select a model';

    pill.title = 'No model selected';

  }

}


