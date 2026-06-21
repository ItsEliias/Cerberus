/**
 * cc-changelog.js — // WHAT'S NEW panel for the CC ASSISTANT tab.
 *
 * Mounts below the DOCUMENTS panel. Collapsed by default — click the
 * header to expand and lazy-load /api/changelog. Body is rendered with
 * textContent (the changelog source is untrusted — could come from a
 * markdown file authored by anyone with repo write, or from git log
 * subjects which contain author-supplied text). The "GENERATED FROM GIT"
 * badge surfaces when the backend fell back to git log instead of a
 * curated CHANGELOG.md.
 */

export function buildChangelogPanel() {
  return `
<section class="cc-changelog-panel" id="cc-changelog-panel" aria-label="What's new">
  <header class="cc-changelog-head" id="cc-changelog-head" role="button" tabindex="0" aria-expanded="false" aria-controls="cc-changelog-body">
    <span class="cc-changelog-title">// WHAT'S NEW</span>
    <span class="cc-changelog-gen-badge" id="cc-changelog-gen-badge" hidden>GENERATED FROM GIT</span>
    <span class="cc-changelog-chevron" id="cc-changelog-chevron" aria-hidden="true">▶</span>
  </header>
  <div class="cc-changelog-body" id="cc-changelog-body" hidden></div>
</section>`.trim();
}

export function loadChangelog(root) {
  if (!root || !root.querySelector) return;
  const head    = root.querySelector('#cc-changelog-head');
  const body    = root.querySelector('#cc-changelog-body');
  const chevron = root.querySelector('#cc-changelog-chevron');
  if (!head || !body) return;

  let loaded = false;

  const toggle = async () => {
    const expanded = !body.hidden;
    if (expanded) {
      body.hidden = true;
      head.setAttribute('aria-expanded', 'false');
      if (chevron) chevron.textContent = '▶';
      return;
    }
    body.hidden = false;
    head.setAttribute('aria-expanded', 'true');
    if (chevron) chevron.textContent = '▼';
    if (!loaded) await _fetchAndRender(root);
    loaded = true;
  };

  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
}

async function _fetchAndRender(root) {
  const body  = root.querySelector('#cc-changelog-body');
  const badge = root.querySelector('#cc-changelog-gen-badge');
  if (!body) return;

  body.textContent = 'Loading…';
  try {
    const r = await fetch('/api/changelog', { credentials: 'same-origin' });
    if (!r.ok) {
      body.textContent = `// FAILED: HTTP ${r.status}`;
      return;
    }
    const data = await r.json();
    const content = String(data && data.content || '').trim();
    if (badge) badge.hidden = !data || !data.generated;

    // Surface the last ~20 entries. For curated CHANGELOG.md we keep the
    // top of the file; for the git-log fallback the backend already caps
    // at 20 commits, so this is a defensive trim against pathological
    // file sizes.
    body.textContent = _limitEntries(content, 60).trim() || '(no content)';
  } catch (_) {
    body.textContent = '// FAILED: network error';
  }
}

function _limitEntries(text, maxLines) {
  if (!text) return '';
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + '\n…';
}
