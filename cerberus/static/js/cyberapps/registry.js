/**
 * static/js/cyberapps/registry.js
 *
 * Central registry for all CyberOS native apps mounted inside Cerberus.
 * Migrator agents push their entry here; the bootstrap in index.js reads
 * this array to render the pill nav and wire mount/destroy hooks.
 *
 * Each entry shape:
 * {
 *   id:      string   — unique slug, e.g. "cyberlab"
 *   name:    string   — display name in the pill nav, e.g. "CyberLab"
 *   icon:    string   — inline SVG string (16x16) OR an icon class string
 *   init:    function — (container: HTMLElement, ctx: CyberAppContext) => void
 *   destroy: function — () => void  (called before another app mounts)
 *   vault:   boolean  — true if this app requires vault unlock before init
 * }
 *
 * ADDING YOUR APP
 * ---------------
 * 1. Create static/js/cyberapps/<id>/index.js that exports { init, destroy }.
 * 2. Push an entry into CYBER_APPS_REGISTRY below.
 * 3. Do NOT modify static/index.html — the panel and pills are managed here.
 */

window.CYBER_APPS_REGISTRY = [
  // Migrators: push your entry here.
  // Example (uncomment and fill in):
  //
  // {
  //   id: 'cyberlab',
  //   name: 'CyberLab',
  //   icon: '<svg width="16" height="16" ...></svg>',
  //   init: (container, ctx) => { window.CyberLabApp.init(container, ctx); },
  //   destroy: () => { window.CyberLabApp.destroy(); },
  //   vault: true,
  // },
];
