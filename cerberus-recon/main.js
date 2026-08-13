'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// node-pty is native; require lazily so the window still opens (with a helpful
// error) if it hasn't been rebuilt for this Electron ABI.
let pty = null;
let ptyLoadError = null;
try { pty = require('node-pty'); } catch (err) { ptyLoadError = err; }

const CONFIG_DIR = path.join(app.getPath('userData'), 'cerberus-recon');
const SCOPE_FILE = path.join(CONFIG_DIR, 'scope.json');
const SESSIONS_FILE = path.join(CONFIG_DIR, 'sessions.json');
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch (_) {} }
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

let mainWindow = null;
let ptyProc = null;
let currentWorkdir = null;

// ── Findings folder ─────────────────────────────────────────────────────
// Findings live as one JSON per finding under <root>/. Screenshots for a
// finding <id> live in <root>/<id>/. When a workdir is set we watch its
// .cerberus/findings folder so agent-written findings appear live; otherwise
// we fall back to a folder under userData.
function findingsRoot() {
  const root = currentWorkdir
    ? path.join(currentWorkdir, '.cerberus', 'findings')
    : path.join(CONFIG_DIR, 'findings');
  ensureDir(root);
  return root;
}

function listFindings() {
  const root = findingsRoot();
  let out = [];
  try {
    for (const name of fs.readdirSync(root)) {
      if (!name.endsWith('.json')) continue;
      const f = readJson(path.join(root, name), null);
      if (f && f.id) out.push(f);
    }
  } catch (_) {}
  return out;
}

function findingAssets(id) {
  const dir = path.join(findingsRoot(), String(id));
  const shots = [];
  try {
    for (const name of fs.readdirSync(dir).sort()) {
      const ext = path.extname(name).toLowerCase();
      if (!IMG_EXT.has(ext)) continue;
      const buf = fs.readFileSync(path.join(dir, name));
      shots.push({ name, dataUrl: `data:${MIME[ext]};base64,${buf.toString('base64')}` });
    }
  } catch (_) {}
  return shots;
}

let watcher = null;
let watchDebounce = null;
function pushFindings() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('findings:list', listFindings());
  }
}
function startFindingsWatch() {
  if (watcher) { try { watcher.close(); } catch (_) {} watcher = null; }
  const root = findingsRoot();
  try {
    watcher = fs.watch(root, { recursive: true }, () => {
      clearTimeout(watchDebounce);
      watchDebounce = setTimeout(pushFindings, 150);
    });
  } catch (_) { /* recursive watch unsupported — findings still load on demand */ }
  pushFindings();
}

// ── Terminal / Claude Code subprocess ───────────────────────────────────
function resolveLaunchCommand() {
  const override = process.env.CERBERUS_SHELL;
  if (override) return { cmd: override };
  const isWin = process.platform === 'win32';
  return { cmd: isWin ? 'claude.cmd' : 'claude', fallback: isWin ? 'powershell.exe' : (process.env.SHELL || 'bash') };
}

function spawnPty(cwd) {
  if (!pty) return;
  if (ptyProc) { try { ptyProc.kill(); } catch (_) {} ptyProc = null; }

  const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');
  const launch = resolveLaunchCommand();
  const workingDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();

  const bootstrap = launch.fallback
    ? `command -v ${launch.cmd} >/dev/null 2>&1 && exec ${launch.cmd} || { echo "[cerberus] '${launch.cmd}' not found on PATH — dropping to shell."; exec ${launch.fallback}; }`
    : `exec ${launch.cmd}`;
  const spawnArgs = os.platform() === 'win32' ? ['-NoLogo', '-Command', bootstrap] : ['-lc', bootstrap];

  ptyProc = pty.spawn(shell, spawnArgs, {
    name: 'xterm-256color', cols: 100, rows: 30, cwd: workingDir,
    env: Object.assign({}, process.env, { CERBERUS: '1', TERM: 'xterm-256color' }),
  });
  ptyProc.onData((data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pty:data', data); });
  ptyProc.onExit(({ exitCode }) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pty:exit', exitCode);
    ptyProc = null;
  });
}

// ── IPC ─────────────────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('pty:start', (_e, cwd) => {
    if (cwd) { currentWorkdir = cwd; startFindingsWatch(); }
    if (ptyLoadError) return { ok: false, error: 'node-pty failed to load. Run `npm run rebuild`. ' + ptyLoadError.message };
    spawnPty(cwd);
    return { ok: true };
  });
  ipcMain.on('pty:input', (_e, data) => { if (ptyProc) ptyProc.write(data); });
  ipcMain.on('pty:resize', (_e, { cols, rows }) => {
    if (ptyProc && cols > 0 && rows > 0) { try { ptyProc.resize(cols, rows); } catch (_) {} }
  });

  // Workdir
  ipcMain.handle('workdir:set', (_e, dir) => { currentWorkdir = dir; startFindingsWatch(); return { ok: true }; });
  ipcMain.handle('workdir:get', () => currentWorkdir);
  ipcMain.handle('dialog:pickDir', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths.length) return { ok: false };
    currentWorkdir = res.filePaths[0];
    startFindingsWatch();
    return { ok: true, path: currentWorkdir };
  });

  // Scope / sessions (userData JSON)
  ipcMain.handle('scope:get', () => readJson(SCOPE_FILE, { targets: [] }));
  ipcMain.handle('scope:save', (_e, d) => { writeJson(SCOPE_FILE, d); return { ok: true }; });
  ipcMain.handle('sessions:get', () => readJson(SESSIONS_FILE, { sessions: [] }));
  ipcMain.handle('sessions:save', (_e, d) => { writeJson(SESSIONS_FILE, d); return { ok: true }; });

  // Findings (folder)
  ipcMain.handle('findings:list', () => listFindings());
  ipcMain.handle('findings:write', (_e, finding) => {
    writeJson(path.join(findingsRoot(), `${finding.id}.json`), finding);
    pushFindings();
    return { ok: true };
  });
  ipcMain.handle('findings:delete', (_e, id) => {
    try { fs.rmSync(path.join(findingsRoot(), `${id}.json`), { force: true }); } catch (_) {}
    pushFindings();
    return { ok: true };
  });
  ipcMain.handle('findings:assets', (_e, id) => findingAssets(id));
  ipcMain.handle('findings:root', () => findingsRoot());

  // Reproduce — type a retrace instruction into the live Claude Code session.
  ipcMain.handle('findings:reproduce', (_e, finding) => {
    if (!ptyProc) return { ok: false, error: 'No live session. Restart the terminal first.' };
    const rel = path.join('.cerberus', 'findings', String(finding.id));
    const steps = (finding.steps || []).map((s, i) => `  ${i + 1}. ${typeof s === 'string' ? s : s.text}`).join('\n');
    const prompt =
      `Reproduce finding "${finding.title}" on ${finding.target || 'the target'}. ` +
      `Retrace these steps, and after each one save a screenshot as ${rel}/step-<n>.png so the repro is documented:\n${steps}\n`;
    ptyProc.write(prompt);
    return { ok: true };
  });
}

// ── Window ──────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320, height: 860, minWidth: 980, minHeight: 620,
    backgroundColor: '#060708',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  ensureDir(CONFIG_DIR);
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (watcher) { try { watcher.close(); } catch (_) {} }
  if (ptyProc) { try { ptyProc.kill(); } catch (_) {} }
  if (process.platform !== 'darwin') app.quit();
});
