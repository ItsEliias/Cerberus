/**
 * panels.js — Floating panels: Import modal, Node detail panel.
 * Pure vanilla JS — no framework.
 */

import { parseNmapXml, parseGns3Json, inferEdges } from './nmap-parser.js';

// ─── Common helpers ────────────────────────────────────────────────────────────

function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.cls)  e.className = opts.cls;
  if (opts.text) e.textContent = opts.text;
  if (opts.html) e.innerHTML = opts.html;
  if (opts.style) Object.assign(e.style, opts.style);
  for (const [k, v] of Object.entries(opts.attrs ?? {})) e.setAttribute(k, v);
  return e;
}

function input(placeholder, opts = {}) {
  const i = el('input', { attrs: { type: 'text', placeholder } });
  Object.assign(i.style, { background: '#0d0e18', border: '1px solid rgba(42,51,71,0.75)', borderRadius: '6px', padding: '6px 10px', color: '#e2e8f0', fontSize: '12px', width: '100%', boxSizing: 'border-box', outline: 'none' });
  if (opts.value != null) i.value = opts.value;
  return i;
}

const btnBase = { padding: '6px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', border: '1px solid', transition: 'all 150ms' };

function btn(text, style = {}) {
  const b = el('button', { text });
  Object.assign(b.style, btnBase, style);
  return b;
}

function makeGraph(nodes, name, importSource, edges) {
  return {
    id: `graph-${Date.now()}`,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes,
    edges: edges ?? inferEdges(nodes),
    metadata: { importSource },
  };
}

// ─── Import Modal ─────────────────────────────────────────────────────────────

export function openImportModal(onImport) {
  // Backdrop
  const backdrop = el('div', { style: { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '9999', backdropFilter: 'blur(4px)' } });

  const box = el('div', { style: { background: 'rgba(13,14,24,0.98)', border: '1px solid rgba(255,255,255,0.055)', borderRadius: '14px', width: '560px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.7)' } });
  backdrop.appendChild(box);

  // Header
  const header = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: 'rgba(255,140,66,0.04)', borderBottom: '1px solid rgba(255,140,66,0.10)' } });
  header.appendChild(el('span', { text: 'Import Scan Data', style: { fontWeight: '700', fontSize: '13px', color: '#e2e8f0' } }));
  const closeBtn = btn('×', { background: 'transparent', color: '#8b949e', border: 'none', fontSize: '20px', padding: '0 4px' });
  closeBtn.addEventListener('click', () => backdrop.remove());
  header.appendChild(closeBtn);
  box.appendChild(header);

  // Tabs
  const tabs = ['file', 'paste', 'gns3'];
  const tabLabels = { file: 'Import File', paste: 'Paste XML', gns3: 'GNS3 JSON' };
  let activeTab = 'file';

  const tabBar = el('div', { style: { display: 'flex', padding: '8px 16px 0', gap: '2px', borderBottom: '1px solid rgba(42,51,71,0.5)' } });
  box.appendChild(tabBar);

  const body = el('div', { style: { flex: '1', overflowY: 'auto', padding: '20px' } });
  box.appendChild(body);

  function renderTabs() {
    tabBar.innerHTML = '';
    for (const t of tabs) {
      const tb = el('button', { text: tabLabels[t] });
      const isActive = t === activeTab;
      Object.assign(tb.style, { flex: '1', padding: '8px 4px', fontSize: '11px', fontWeight: isActive ? '600' : '400', background: 'transparent', border: 'none', borderBottom: `2px solid ${isActive ? '#d29922' : 'transparent'}`, color: isActive ? '#d29922' : '#8b949e', cursor: 'pointer' });
      tb.addEventListener('click', () => { activeTab = t; renderTabs(); renderBody(); });
      tabBar.appendChild(tb);
    }
  }

  function renderBody() {
    body.innerHTML = '';
    if (activeTab === 'file')  renderFileTab(body, onImportDone);
    if (activeTab === 'paste') renderPasteTab(body, onImportDone);
    if (activeTab === 'gns3')  renderGns3Tab(body, onImportDone);
  }

  function onImportDone(graph) {
    backdrop.remove();
    onImport(graph);
  }

  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  renderTabs();
  renderBody();
  document.body.appendChild(backdrop);
}

function renderFileTab(container, onSave) {
  const zone = el('div', { style: { borderRadius: '10px', padding: '32px 24px', textAlign: 'center', cursor: 'pointer', border: '2px dashed rgba(42,51,71,0.7)', background: 'rgba(13,14,24,0.5)', transition: 'all 0.2s' } });
  const status = el('p', { text: 'Click to select nmap XML file, or drag & drop', style: { fontSize: '13px', color: 'rgba(139,148,158,0.7)' } });
  const hint = el('p', { text: 'Supports .xml (nmap -oX format)', style: { fontSize: '11px', color: '#8b949e', marginTop: '4px' } });
  zone.appendChild(status); zone.appendChild(hint);
  container.appendChild(zone);

  const feedback = el('div', { style: { fontSize: '12px', marginTop: '10px' } });
  container.appendChild(feedback);

  let parsedNodes = [];

  function loadXml(xml, name) {
    const r = parseNmapXml(xml);
    parsedNodes = r.nodes;
    feedback.innerHTML = '';
    feedback.appendChild(el('div', { text: `Found ${r.nodes.length} hosts, ${r.nodes.reduce((a,n) => a + n.openPortCount, 0)} open ports`, style: { color: '#3fb950' } }));
    if (r.excluded > 0) feedback.appendChild(el('div', { text: `${r.excluded} hosts with no open ports excluded`, style: { color: '#d29922' } }));
    for (const err of r.errors) feedback.appendChild(el('div', { text: '✗ ' + err, style: { color: '#f85149' } }));
    if (r.nodes.length > 0) renderSaveRow(container, r.nodes, 'nmap-xml', name, onSave);
  }

  zone.addEventListener('click', () => {
    const fi = document.createElement('input');
    fi.type = 'file'; fi.accept = '.xml';
    fi.addEventListener('change', () => {
      const file = fi.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => loadXml(ev.target.result, file.name.replace(/\.xml$/i, ''));
      reader.readAsText(file);
    });
    fi.click();
  });

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = '#ff8c42'; zone.style.background = 'rgba(255,140,66,0.06)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = 'rgba(42,51,71,0.7)'; zone.style.background = 'rgba(13,14,24,0.5)'; });
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.style.borderColor = 'rgba(42,51,71,0.7)'; zone.style.background = 'rgba(13,14,24,0.5)';
    const file = e.dataTransfer.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => loadXml(ev.target.result, file.name.replace(/\.xml$/i, ''));
    reader.readAsText(file);
  });
}

function renderPasteTab(container, onSave) {
  const ta = el('textarea', { attrs: { placeholder: '<?xml version="1.0"...\n<nmaprun ...>' }, style: { minHeight: '200px', background: 'rgba(10,10,15,0.8)', border: '1px solid rgba(42,51,71,0.6)', borderRadius: '6px', padding: '12px', color: '#e2e8f0', fontSize: '12px', fontFamily: 'monospace', resize: 'vertical', outline: 'none', width: '100%', boxSizing: 'border-box' } });
  container.appendChild(ta);

  const parseBtn = btn('Parse →', { background: 'rgba(42,51,71,0.3)', borderColor: 'rgba(42,51,71,0.75)', color: '#e2e8f0' });
  const row = el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' } });
  row.appendChild(parseBtn); container.appendChild(row);

  const feedback = el('div', { style: { fontSize: '12px', marginTop: '8px' } });
  container.appendChild(feedback);

  parseBtn.addEventListener('click', () => {
    const xml = ta.value.trim(); if (!xml) return;
    const r = parseNmapXml(xml);
    feedback.innerHTML = '';
    feedback.appendChild(el('div', { text: `Found ${r.nodes.length} hosts`, style: { color: '#3fb950' } }));
    for (const err of r.errors) feedback.appendChild(el('div', { text: '✗ ' + err, style: { color: '#f85149' } }));
    if (r.nodes.length > 0) renderSaveRow(container, r.nodes, 'paste', `Pasted Scan ${new Date().toLocaleDateString()}`, onSave);
  });
}

function renderGns3Tab(container, onSave) {
  const ta = el('textarea', { attrs: { placeholder: '{ "topology": { "nodes": [...] } }' }, style: { minHeight: '200px', background: 'rgba(10,10,15,0.8)', border: '1px solid rgba(42,51,71,0.6)', borderRadius: '6px', padding: '12px', color: '#e2e8f0', fontSize: '12px', fontFamily: 'monospace', resize: 'vertical', outline: 'none', width: '100%', boxSizing: 'border-box' } });
  container.appendChild(ta);

  const parseBtn = btn('Parse →', { background: 'rgba(42,51,71,0.3)', borderColor: 'rgba(42,51,71,0.75)', color: '#e2e8f0' });
  container.appendChild(parseBtn);

  const feedback = el('div', { style: { fontSize: '12px', marginTop: '8px' } });
  container.appendChild(feedback);

  parseBtn.addEventListener('click', () => {
    const json = ta.value.trim(); if (!json) return;
    const r = parseGns3Json(json);
    feedback.innerHTML = '';
    feedback.appendChild(el('div', { text: `Found ${r.nodes.length} nodes`, style: { color: '#3fb950' } }));
    for (const err of r.errors) feedback.appendChild(el('div', { text: '✗ ' + err, style: { color: '#f85149' } }));
    if (r.nodes.length > 0) renderSaveRow(container, r.nodes, 'gns3', `GNS3 ${new Date().toLocaleDateString()}`, onSave);
  });
}

function renderSaveRow(container, nodes, importSource, defaultName, onSave) {
  const prev = container.querySelector('.nm-save-row');
  if (prev) prev.remove();
  const row = el('div', { cls: 'nm-save-row', style: { display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center' } });
  const nameInput = input('Graph name…', { value: defaultName });
  nameInput.style.flex = '1';
  const saveBtn = btn(`Import (${nodes.length} nodes)`, { background: 'rgba(255,140,66,0.12)', borderColor: 'rgba(255,140,66,0.3)', color: '#ff8c42' });
  row.appendChild(nameInput); row.appendChild(saveBtn);
  container.appendChild(row);
  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || defaultName;
    onSave(makeGraph(nodes, name, importSource));
  });
}

// ─── Node Detail Panel ────────────────────────────────────────────────────────

const PORT_NAMES = {
  21:'FTP',22:'SSH',23:'Telnet',25:'SMTP',53:'DNS',67:'DHCP',68:'DHCP',
  69:'TFTP',80:'HTTP',110:'POP3',111:'RPC',123:'NTP',135:'MSRPC',
  137:'NetBIOS',138:'NetBIOS',139:'NetBIOS',143:'IMAP',161:'SNMP',
  389:'LDAP',443:'HTTPS',445:'SMB',465:'SMTPS',500:'IKE',514:'Syslog',
  515:'LPD',587:'SMTP',631:'IPP',636:'LDAPS',993:'IMAPS',995:'POP3S',
  1080:'SOCKS',1194:'OpenVPN',1433:'MSSQL',1521:'Oracle',1723:'PPTP',
  2049:'NFS',2181:'Zookeeper',3306:'MySQL',3389:'RDP',4444:'Metasploit',
  4899:'Radmin',5432:'PostgreSQL',5900:'VNC',5985:'WinRM',6379:'Redis',
  6443:'K8s API',8080:'HTTP-Alt',8443:'HTTPS-Alt',8888:'HTTP-Dev',
  9200:'Elasticsearch',27017:'MongoDB',11211:'Memcached',
};

function stateColor(state)  { return state === 'open' ? '#3fb950' : state === 'filtered' ? '#d29922' : '#484f58'; }
function stateBg(state)     { return state === 'open' ? 'rgba(63,185,80,0.08)' : state === 'filtered' ? 'rgba(210,153,34,0.08)' : 'rgba(72,79,88,0.08)'; }
function stateBorder(state) { return state === 'open' ? 'rgba(63,185,80,0.22)' : state === 'filtered' ? 'rgba(210,153,34,0.22)' : 'rgba(72,79,88,0.22)'; }

export function buildNodeDetailPanel(node, onClose, onAnnotate) {
  const panel = el('div', { style: { position: 'absolute', top: '0', right: '0', bottom: '0', width: '320px', background: 'var(--panel, #1a1d23)', borderLeft: '1px solid var(--border, #3a2a2a)', overflowY: 'auto', zIndex: '30', display: 'flex', flexDirection: 'column' } });

  // Header
  const hdr = el('div', { style: { padding: '14px 16px 10px', borderBottom: '1px solid rgba(42,51,71,0.4)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } });
  const ipArea = el('div');
  const ipRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
  const ipLbl = el('span', { text: node.ip, style: { fontSize: '14px', fontWeight: '700', color: '#e2e8f0', fontFamily: 'monospace' } });
  const statusDot = el('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: node.status === 'up' ? '#3fb950' : '#484f58', display: 'inline-block', flexShrink: '0' } });
  ipRow.appendChild(statusDot); ipRow.appendChild(ipLbl);
  if (node.hostname) ipArea.appendChild(el('div', { text: node.hostname, style: { fontSize: '11px', color: '#8b949e', fontFamily: 'monospace', marginTop: '2px' } }));
  ipArea.appendChild(ipRow);
  const closeBtn = btn('×', { background: 'transparent', border: 'none', color: '#8b949e', fontSize: '18px', padding: '0 4px' });
  closeBtn.addEventListener('click', onClose);
  hdr.appendChild(ipArea); hdr.appendChild(closeBtn);
  panel.appendChild(hdr);

  // OS + MAC
  if (node.os || node.macAddress) {
    const meta = el('div', { style: { padding: '8px 16px', borderBottom: '1px solid rgba(42,51,71,0.3)', fontSize: '11px', color: '#8b949e' } });
    if (node.os) meta.appendChild(el('div', { text: `OS: ${node.os}${node.osAccuracy ? ` (${node.osAccuracy}%)` : ''}` }));
    if (node.macAddress) meta.appendChild(el('div', { text: `MAC: ${node.macAddress}` }));
    panel.appendChild(meta);
  }

  // Health
  const openPorts = node.ports.filter(p => p.state === 'open');
  const badge = el('div', { style: { padding: '8px 16px', borderBottom: '1px solid rgba(42,51,71,0.3)', display: 'flex', gap: '8px', flexWrap: 'wrap' } });
  badge.appendChild(el('span', { text: `${openPorts.length} open ports`, style: { fontSize: '10px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.2)', color: '#3fb950' } }));
  if (node.vulns && node.vulns.length > 0) {
    const worst = node.vulns[0].severity;
    const vc = worst === 'critical' ? '#ff4444' : worst === 'high' ? '#ff8800' : worst === 'medium' ? '#ffcc00' : '#44cc44';
    badge.appendChild(el('span', { text: `${node.vulns.length} vuln${node.vulns.length > 1 ? 's' : ''}`, style: { fontSize: '10px', padding: '2px 8px', borderRadius: '10px', background: `rgba(255,68,68,0.08)`, border: `1px solid rgba(255,68,68,0.2)`, color: vc } }));
  }
  panel.appendChild(badge);

  // Ports table
  const portsTitle = el('div', { text: 'PORTS', style: { padding: '10px 16px 4px', fontSize: '9px', fontWeight: '700', color: '#8b949e', letterSpacing: '0.07em' } });
  panel.appendChild(portsTitle);

  const tbl = el('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '11px' } });
  const thead = el('tr');
  for (const h of ['Port', 'State', 'Service', 'Version']) {
    const th = el('th', { text: h, style: { padding: '4px 8px', textAlign: 'left', fontSize: '9px', color: '#8b949e', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid rgba(42,51,71,0.3)' } });
    thead.appendChild(th);
  }
  tbl.appendChild(thead);

  for (const p of node.ports) {
    const tr = el('tr');
    const svcName = p.service || PORT_NAMES[p.port] || '—';
    const cells = [
      { text: `${p.port}/${p.protocol}`, style: { color: '#e2e8f0', fontFamily: 'monospace', fontWeight: '600' } },
      { html: `<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:${stateBg(p.state)};border:1px solid ${stateBorder(p.state)};color:${stateColor(p.state)}">${p.state}</span>` },
      { text: svcName, style: { color: '#e2e8f0' } },
      { text: [p.product, p.version].filter(Boolean).join(' ') || '—', style: { color: '#8b949e', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
    ];
    for (const c of cells) {
      const td = el('td', c.html ? { html: c.html } : { text: c.text });
      Object.assign(td.style, { padding: '5px 8px', borderBottom: '1px solid rgba(42,51,71,0.2)', verticalAlign: 'middle' }, c.style ?? {});
      tr.appendChild(td);
    }
    tbl.appendChild(tr);
  }
  panel.appendChild(tbl);

  // Vulnerabilities section
  if (node.vulns && node.vulns.length > 0) {
    const vTitle = el('div', { text: 'VULNERABILITIES', style: { padding: '12px 16px 4px', fontSize: '9px', fontWeight: '700', color: '#8b949e', letterSpacing: '0.07em' } });
    panel.appendChild(vTitle);
    for (const v of node.vulns) {
      const vc = v.severity === 'critical' ? '#ff4444' : v.severity === 'high' ? '#ff8800' : v.severity === 'medium' ? '#ffcc00' : '#44cc44';
      const vRow = el('div', { style: { margin: '0 16px 6px', padding: '8px 10px', borderRadius: '6px', background: `rgba(255,68,68,0.04)`, border: `1px solid rgba(255,68,68,0.12)` } });
      vRow.appendChild(el('div', { style: { display: 'flex', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' } }));
      for (const cve of v.cves) {
        const chip = el('span', { text: cve, style: { fontSize: '9px', padding: '1px 6px', borderRadius: '4px', background: `rgba(255,68,68,0.08)`, border: `1px solid rgba(255,68,68,0.2)`, color: vc } });
        vRow.querySelector('div').appendChild(chip);
      }
      if (v.description) vRow.appendChild(el('p', { text: v.description.slice(0, 120), style: { fontSize: '10px', color: '#8b949e', margin: '0' } }));
      panel.appendChild(vRow);
    }
  }

  // Annotation
  const annTitle = el('div', { text: 'ANNOTATION', style: { padding: '12px 16px 4px', fontSize: '9px', fontWeight: '700', color: '#8b949e', letterSpacing: '0.07em' } });
  panel.appendChild(annTitle);
  const annInput = el('textarea', { style: { margin: '0 16px 12px', width: 'calc(100% - 32px)', minHeight: '60px', background: 'rgba(10,10,15,0.6)', border: '1px solid rgba(42,51,71,0.5)', borderRadius: '6px', padding: '8px', color: '#e2e8f0', fontSize: '11px', fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box', display: 'block' } });
  annInput.value = node.annotation ?? '';
  annInput.placeholder = 'Add a note for this host…';
  annInput.addEventListener('blur', () => { if (onAnnotate) onAnnotate(node.id, annInput.value); });
  panel.appendChild(annInput);

  return panel;
}
