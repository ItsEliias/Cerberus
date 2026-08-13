'use strict';

/* Copies xterm's browser bundles out of node_modules into renderer/vendor
   so the renderer can load them under a strict 'self' CSP (no CDN). Runs
   automatically on `npm install` via the postinstall hook. */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'renderer', 'vendor');
fs.mkdirSync(dest, { recursive: true });

const copies = [
  ['@xterm/xterm/lib/xterm.js', 'xterm.js'],
  ['@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['@xterm/addon-fit/lib/addon-fit.js', 'xterm-addon-fit.js'],
];

let ok = true;
for (const [from, to] of copies) {
  const src = path.join(root, 'node_modules', from);
  try {
    fs.copyFileSync(src, path.join(dest, to));
    console.log(`[vendor] ${to}`);
  } catch (err) {
    ok = false;
    console.warn(`[vendor] MISSING ${from} — run 'npm install' first (${err.code})`);
  }
}
process.exit(ok ? 0 : 0); // never fail the install; just warn
