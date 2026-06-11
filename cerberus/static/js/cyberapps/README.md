# Cyber Apps — Per-App Module Convention

Each migrated CyberOS app lives in its own subdirectory:

```
static/js/cyberapps/<id>/index.js
```

The module must export two functions (either as ES module exports or by
setting `window.<AppName>App = { init, destroy }`):

```js
/**
 * Mount the app into the provided container element.
 *
 * @param {HTMLElement} container  - The #cyber-apps-content div.
 * @param {CyberAppContext} ctx    - { user, theme, onVaultUnlock }
 */
export function init(container, ctx) { /* ... */ }

/**
 * Tear down the app: remove event listeners, clear timers, etc.
 * Called before another app mounts or the panel closes.
 */
export function destroy() { /* ... */ }
```

Then register in `registry.js`:

```js
window.CYBER_APPS_REGISTRY.push({
  id:      'myapp',
  name:    'My App',
  icon:    '<svg ...></svg>',
  init:    (container, ctx) => window.MyApp.init(container, ctx),
  destroy: () => window.MyApp.destroy(),
  vault:   false,  // set true if the app requires vault unlock
});
```

Do NOT modify `static/index.html` directly. The panel scaffold and pill
nav are managed by `static/js/cyberapps/index.js`.
