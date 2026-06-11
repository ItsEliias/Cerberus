/**
 * nmap-parser.js — NetworkMap vanilla JS port of nmapParser.ts + edgeInference.ts
 * Parses nmap XML and GNS3 JSON into { nodes, edges, excluded, errors }.
 * No external dependencies — uses browser DOMParser only.
 */

/** Derive OS icon character from OS name string */
export function osIcon(os) {
  if (!os) return '?';
  const l = os.toLowerCase();
  if (l.includes('linux') || l.includes('ubuntu') || l.includes('debian') || l.includes('centos') || l.includes('fedora')) return '\u{1F427}';
  if (l.includes('windows')) return '\u{1FA9F}';
  if (l.includes('mac') || l.includes('osx') || l.includes('darwin') || l.includes('ios')) return '\u{1F34E}';
  if (l.includes('cisco') || l.includes('router') || l.includes('switch') || l.includes('juniper') || l.includes('firewall') || l.includes('fortigate')) return '\u{1F4E1}';
  return '?';
}

/** Map common port/service combos to display labels */
export function serviceLabel(service, port) {
  const s = (service ?? '').toLowerCase();
  const map = {
    http: 'HTTP', https: 'HTTPS', ssh: 'SSH', ftp: 'FTP',
    smtp: 'SMTP', pop3: 'POP3', imap: 'IMAP', dns: 'DNS',
    smb: 'SMB', 'microsoft-ds': 'SMB', snmp: 'SNMP',
    rdp: 'RDP', 'ms-wbt-server': 'RDP',
    mysql: 'MySQL', postgresql: 'PostgreSQL', 'ms-sql-s': 'MSSQL',
    ldap: 'LDAP', kerberos: 'Kerberos',
    telnet: 'Telnet', vnc: 'VNC', nfs: 'NFS',
  };
  if (map[s]) return map[s];
  const portMap = {
    80: 'HTTP', 443: 'HTTPS', 22: 'SSH', 21: 'FTP',
    25: 'SMTP', 110: 'POP3', 143: 'IMAP', 53: 'DNS',
    445: 'SMB', 139: 'NetBIOS', 161: 'SNMP',
    3389: 'RDP', 3306: 'MySQL', 5432: 'PostgreSQL',
    1433: 'MSSQL', 389: 'LDAP', 88: 'Kerberos',
    23: 'Telnet', 5900: 'VNC', 2049: 'NFS',
  };
  return portMap[port] || undefined;
}

/** Parse nmap -oX output. Returns { nodes, excluded, errors }. */
export function parseNmapXml(xml) {
  const errors = [];
  const nodes = [];
  let excluded = 0;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      errors.push('XML parse error: ' + (parseError.textContent ?? 'malformed XML'));
      return { nodes, excluded, errors };
    }

    for (const host of Array.from(doc.querySelectorAll('host'))) {
      try {
        const addrEl = host.querySelector('address[addrtype="ipv4"]');
        if (!addrEl) continue;
        const ip = addrEl.getAttribute('addr') ?? '';
        if (!ip) continue;

        const macEl = host.querySelector('address[addrtype="mac"]');
        const macAddress = macEl?.getAttribute('addr') ?? undefined;

        const statusEl = host.querySelector('status');
        const statusState = statusEl?.getAttribute('state') ?? 'unknown';
        const status = statusState === 'up' ? 'up' : statusState === 'down' ? 'down' : 'unknown';

        const hostnameEl = host.querySelector('hostnames hostname');
        const hostname = hostnameEl?.getAttribute('name') ?? undefined;

        // OS match — pick highest accuracy
        const osMatchEls = Array.from(host.querySelectorAll('os osmatch'));
        let os;
        let osAccuracy;
        if (osMatchEls.length > 0) {
          const best = osMatchEls.reduce((a, b) => {
            return parseInt(b.getAttribute('accuracy') ?? '0', 10) > parseInt(a.getAttribute('accuracy') ?? '0', 10) ? b : a;
          });
          os = best.getAttribute('name') ?? undefined;
          const accStr = best.getAttribute('accuracy');
          osAccuracy = accStr ? parseInt(accStr, 10) : undefined;
        }

        const ports = [];
        for (const portEl of Array.from(host.querySelectorAll('ports port'))) {
          try {
            const portId = portEl.getAttribute('portid');
            const protocol = portEl.getAttribute('protocol') ?? 'tcp';
            const stateEl = portEl.querySelector('state');
            const state = stateEl?.getAttribute('state') ?? 'closed';
            const serviceEl = portEl.querySelector('service');
            const serviceName = serviceEl?.getAttribute('name') ?? undefined;
            const product = serviceEl?.getAttribute('product') ?? undefined;
            const version = serviceEl?.getAttribute('version') ?? undefined;
            if (!portId) continue;
            ports.push({ port: parseInt(portId, 10), protocol, state, service: serviceName, product, version });
          } catch { /* skip malformed port */ }
        }

        const openPortCount = ports.filter(p => p.state === 'open').length;
        if (openPortCount === 0) { excluded++; continue; }

        const vulns = parseHostVulns(ip, host);
        nodes.push({
          id: ip, ip, hostname, os, osAccuracy, macAddress, status,
          ports, openPortCount, x: 0, y: 0, fx: null, fy: null,
          vulns: vulns.length > 0 ? vulns : undefined,
        });
      } catch { errors.push('Skipped malformed host entry'); }
    }
  } catch (e) {
    errors.push('Failed to parse XML: ' + e.message);
  }

  return { nodes, excluded, errors };
}

function parseHostVulns(ip, host) {
  const entries = [];
  for (const script of Array.from(host.querySelectorAll('script'))) {
    const id = script.getAttribute('id') ?? '';
    if (!id.startsWith('vuln') && !id.includes('cve') && !id.includes('CVE')) continue;
    const output = script.getAttribute('output') ?? '';
    const cves = [...new Set([...output.matchAll(/CVE-\d{4}-\d+/gi)].map(m => m[0].toUpperCase()))];
    const cvssEl = script.querySelector('elem[key="cvss"]');
    const cvssScore = cvssEl ? parseFloat(cvssEl.textContent ?? '0') : 0;
    const severity = cvssToSeverity(cvssScore);
    if (cves.length > 0 || cvssScore > 0) {
      entries.push({ ip, cves, severity, description: output.slice(0, 200) });
    }
  }
  return entries;
}

function cvssToSeverity(score) {
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  if (score > 0)    return 'low';
  return 'info';
}

/** Parse GNS3 .gns3 topology file into nodes */
export function parseGns3Json(json) {
  const errors = [];
  const nodes = [];
  try {
    const data = JSON.parse(json);
    const topology = data.topology ?? data;
    for (const gn of (topology.nodes ?? [])) {
      const ip = gn.properties?.ip_address || gn.label?.text || gn.node_id;
      if (!ip) continue;
      nodes.push({
        id: ip, ip,
        hostname: gn.label?.text,
        status: 'up',
        ports: [], openPortCount: 0,
        x: gn.x ?? 0, y: gn.y ?? 0, fx: null, fy: null,
      });
    }
  } catch (e) {
    errors.push('Failed to parse GNS3 file: ' + e.message);
  }
  return { nodes, excluded: 0, errors };
}

// ─── Edge inference (port of edgeInference.ts) ────────────────────────────────

function ipToSubnet24(ip) {
  const parts = ip.split('.');
  if (parts.length < 3) return ip;
  return parts.slice(0, 3).join('.');
}

function hasPort(node, ...portNums) {
  return node.ports.some(p => p.state === 'open' && portNums.includes(p.port));
}

function openServiceLabelShared(a, b) {
  for (const p of a.ports.filter(p => p.state === 'open')) {
    const lbl = serviceLabel(p.service, p.port);
    if (lbl && b.ports.some(bp => bp.state === 'open' && bp.port === p.port)) return lbl;
  }
  return undefined;
}

export function inferEdges(nodes) {
  const edges = [];
  const added = new Set();

  function addEdge(aId, bId, svc) {
    const key = [aId, bId].sort().join('|');
    if (added.has(key)) return;
    added.add(key);
    edges.push({ id: `edge-${key}`, source: aId, target: bId, type: 'inferred', service: svc });
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (ipToSubnet24(a.ip) === ipToSubnet24(b.ip)) { addEdge(a.id, b.id, openServiceLabelShared(a, b)); continue; }
      const aSMB = hasPort(a, 445), bSMB = hasPort(b, 445);
      const aAD  = hasPort(a, 88, 389, 636), bAD = hasPort(b, 88, 389, 636);
      if ((aSMB && bAD) || (bSMB && aAD) || (aSMB && bSMB)) { addEdge(a.id, b.id, 'SMB'); continue; }
      const aWeb = hasPort(a, 80, 443), bWeb = hasPort(b, 80, 443);
      if (aWeb && bWeb) { addEdge(a.id, b.id, hasPort(a, 443) || hasPort(b, 443) ? 'HTTPS' : 'HTTP'); continue; }
      if (hasPort(a, 22) && hasPort(b, 22)) { addEdge(a.id, b.id, 'SSH'); continue; }
      if (hasPort(a, 3306, 5432, 1433, 1521) || hasPort(b, 3306, 5432, 1433, 1521)) { addEdge(a.id, b.id, 'DB'); }
    }
  }
  return edges;
}
