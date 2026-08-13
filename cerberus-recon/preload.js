'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cerberus', {
  // Terminal
  ptyStart: (cwd) => ipcRenderer.invoke('pty:start', cwd),
  ptyInput: (data) => ipcRenderer.send('pty:input', data),
  ptyResize: (size) => ipcRenderer.send('pty:resize', size),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_e, data) => cb(data)),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_e, code) => cb(code)),

  // Workdir
  pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
  setWorkdir: (dir) => ipcRenderer.invoke('workdir:set', dir),
  getWorkdir: () => ipcRenderer.invoke('workdir:get'),

  // Scope / sessions
  getScope: () => ipcRenderer.invoke('scope:get'),
  saveScope: (d) => ipcRenderer.invoke('scope:save', d),
  getSessions: () => ipcRenderer.invoke('sessions:get'),
  saveSessions: (d) => ipcRenderer.invoke('sessions:save', d),

  // Findings (folder-backed, live)
  listFindings: () => ipcRenderer.invoke('findings:list'),
  writeFinding: (f) => ipcRenderer.invoke('findings:write', f),
  deleteFinding: (id) => ipcRenderer.invoke('findings:delete', id),
  findingAssets: (id) => ipcRenderer.invoke('findings:assets', id),
  findingsRoot: () => ipcRenderer.invoke('findings:root'),
  reproduce: (f) => ipcRenderer.invoke('findings:reproduce', f),
  onFindingsList: (cb) => ipcRenderer.on('findings:list', (_e, list) => cb(list)),
});
