/**
 * static/js/cyberapps/netlab/data.js
 * Built-in NetLab labs, snippets, and reference data.
 * Ported from CyberOS NetLab BUILTIN_LABS + BUILTIN_SNIPPETS + ReferenceView.
 */

// ---------------------------------------------------------------------------
// Built-in Labs (CCNA curriculum, 20 labs)
// ---------------------------------------------------------------------------
export const BUILTIN_LABS = [
  { id:'ccna-01-basic-router', title:'Basic Router Configuration', category:'CCNA', vendor:'Cisco IOS', difficulty:1, description:'Configure a Cisco router from scratch — hostname, passwords, banner, and save.', topology:'Single router R1 connected to a PC for console access.', tags:['router','basic','ios','password','banner'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Enter privileged mode', description:'Access the privileged EXEC mode from user mode.', command:'enable', hints:['Type "enable" at the Router> prompt.'] },
    { id:'s2', number:2, title:'Enter global config', description:'Enter global configuration mode.', command:'configure terminal', hints:['Short form: "conf t"'] },
    { id:'s3', number:3, title:'Set hostname', description:'Set the device hostname to R1.', command:'hostname R1', hints:['This changes the prompt to R1(config)#'] },
    { id:'s4', number:4, title:'Set enable secret', description:'Set an encrypted enable password.', command:'enable secret cisco123', hints:['enable secret uses MD5, stronger than enable password'] },
    { id:'s5', number:5, title:'Disable DNS lookup', description:'Stop the router from trying to resolve typos as DNS names.', command:'no ip domain-lookup', hints:['Prevents long timeouts when you mistype a command'] },
    { id:'s6', number:6, title:'Set MOTD banner', description:'Configure a message-of-the-day banner.', command:'banner motd # Authorized Access Only #', hints:['The # is the delimiter'] },
    { id:'s7', number:7, title:'Save configuration', description:'Copy running config to startup config.', command:'copy running-config startup-config', verificationCommand:'show running-config', expectedOutput:'hostname R1', hints:['Short form: "wr" or "write memory"'] },
  ]},
  { id:'ccna-02-static-routing', title:'Static Routing', category:'CCNA', vendor:'Cisco IOS', difficulty:1, description:'Configure static routes between two routers to enable end-to-end connectivity.', topology:'R1 (10.0.1.1/24) -- 10.0.12.0/30 -- R2 (10.0.2.1/24). Two PCs behind each router.', tags:['routing','static','ip route'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Configure R1 interfaces', description:'Set IP addresses on R1 Gi0/0 (LAN) and Gi0/1 (WAN).', deviceName:'R1', command:'interface g0/0\nip address 10.0.1.1 255.255.255.0\nno shutdown\ninterface g0/1\nip address 10.0.12.1 255.255.255.252\nno shutdown', hints:['Use "no shutdown" to bring up each interface'] },
    { id:'s2', number:2, title:'Configure R2 interfaces', description:'Set IP addresses on R2.', deviceName:'R2', command:'interface g0/0\nip address 10.0.2.1 255.255.255.0\nno shutdown\ninterface g0/1\nip address 10.0.12.2 255.255.255.252\nno shutdown', hints:['WAN link uses /30 subnet'] },
    { id:'s3', number:3, title:'Add static route on R1', description:"Add a static route on R1 pointing to R2's LAN.", deviceName:'R1', command:'ip route 10.0.2.0 255.255.255.0 10.0.12.2', hints:['Format: ip route <network> <mask> <next-hop>'] },
    { id:'s4', number:4, title:'Add static route on R2', description:"Add a static route on R2 pointing to R1's LAN.", deviceName:'R2', command:'ip route 10.0.1.0 255.255.255.0 10.0.12.1', hints:['Remember to add a return route on R2'] },
    { id:'s5', number:5, title:'Verify routing table', description:'Confirm static routes appear in the routing table.', deviceName:'R1', command:'show ip route', verificationCommand:'show ip route', expectedOutput:'S', hints:['S = Static in the routing table'] },
  ]},
  { id:'ccna-03-ospf-single-area', title:'OSPF Single Area', category:'CCNA', vendor:'Cisco IOS', difficulty:2, description:'Configure OSPF area 0 across multiple routers and verify neighbor adjacencies.', topology:'R1 -- R2 -- R3 in a chain. All in OSPF area 0.', tags:['ospf','routing','area 0','dynamic routing'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Configure interfaces with IPs', description:'Assign IP addresses to all router interfaces.', hints:['Ensure interfaces are up with "no shutdown"'] },
    { id:'s2', number:2, title:'Enable OSPF on R1', description:'Start OSPF process and advertise networks.', deviceName:'R1', command:'router ospf 1\nnetwork 10.0.0.0 0.255.255.255 area 0', hints:['Process ID (1) is local only'] },
    { id:'s3', number:3, title:'Enable OSPF on R2 and R3', description:'Repeat OSPF config on remaining routers.', command:'router ospf 1\nnetwork 10.0.0.0 0.255.255.255 area 0', hints:['Same process on each router'] },
    { id:'s4', number:4, title:'Verify OSPF neighbors', description:'Confirm neighbor adjacency is FULL state.', command:'show ip ospf neighbor', verificationCommand:'show ip ospf neighbor', expectedOutput:'FULL', hints:['State should be FULL/DR or FULL/BDR'] },
    { id:'s5', number:5, title:'Verify OSPF routes', description:'Check OSPF routes in routing table.', command:'show ip route ospf', verificationCommand:'show ip route ospf', expectedOutput:'O', hints:['O = OSPF in routing table'] },
  ]},
  { id:'ccna-04-vlan-config', title:'VLAN Configuration', category:'CCNA', vendor:'Cisco IOS', difficulty:1, description:'Create VLANs and assign switch ports to them.', topology:'SW1 with 4 access ports. VLAN 10 (Sales) and VLAN 20 (IT).', tags:['vlan','switching','access port'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Create VLAN 10', description:'Create VLAN 10 and name it Sales.', deviceName:'SW1', command:'vlan 10\nname Sales', hints:['From global config mode, type "vlan 10" directly'] },
    { id:'s2', number:2, title:'Create VLAN 20', description:'Create VLAN 20 and name it IT.', deviceName:'SW1', command:'vlan 20\nname IT', hints:[] },
    { id:'s3', number:3, title:'Assign ports to VLANs', description:'Set Fa0/1-2 to VLAN 10, Fa0/3-4 to VLAN 20.', deviceName:'SW1', command:'interface range fa0/1-2\nswitchport mode access\nswitchport access vlan 10\ninterface range fa0/3-4\nswitchport mode access\nswitchport access vlan 20', hints:['Use interface range to configure multiple ports at once'] },
    { id:'s4', number:4, title:'Verify VLANs', description:'Confirm VLANs exist and ports are assigned.', command:'show vlan brief', verificationCommand:'show vlan brief', expectedOutput:'VLAN10', hints:['show vlan brief shows VLAN ID, name, status, and ports'] },
  ]},
  { id:'ccna-05-intervlan-routing', title:'Inter-VLAN Routing (Router-on-a-Stick)', category:'CCNA', vendor:'Cisco IOS', difficulty:2, description:'Enable routing between VLANs using subinterfaces on a router connected to a trunk port.', topology:'R1 G0/0 connected to SW1 Fa0/24 (trunk). VLANs 10 and 20.', tags:['vlan','routing','subinterface','dot1q','trunk'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Configure trunk port on switch', description:'Set SW1 uplink to router as trunk.', deviceName:'SW1', command:'interface fa0/24\nswitchport mode trunk', hints:['Trunk carries all VLANs by default'] },
    { id:'s2', number:2, title:'Create subinterface for VLAN 10', description:'Create G0/0.10 on R1 with dot1q encapsulation.', deviceName:'R1', command:'interface g0/0.10\nencapsulation dot1q 10\nip address 192.168.10.1 255.255.255.0', hints:['Subinterface number can be anything, convention = VLAN ID'] },
    { id:'s3', number:3, title:'Create subinterface for VLAN 20', description:'Create G0/0.20 on R1 with dot1q encapsulation.', deviceName:'R1', command:'interface g0/0.20\nencapsulation dot1q 20\nip address 192.168.20.1 255.255.255.0', hints:[] },
    { id:'s4', number:4, title:'Enable physical interface', description:'Bring up the physical G0/0 interface.', deviceName:'R1', command:'interface g0/0\nno shutdown', hints:['The physical interface must be up for subinterfaces to work'] },
    { id:'s5', number:5, title:'Verify connectivity', description:'Ping from VLAN 10 PC to VLAN 20 PC through the router.', command:'ping 192.168.20.10 source 192.168.10.10', verificationCommand:'show ip interface brief', expectedOutput:'up', hints:['If ping fails, check default gateways on PCs'] },
  ]},
  { id:'ccna-06-eigrp', title:'EIGRP Configuration', category:'CCNA', vendor:'Cisco IOS', difficulty:2, description:'Configure EIGRP with AS number 100 across multiple routers.', topology:'R1 -- R2 -- R3. All Cisco IOS routers.', tags:['eigrp','routing','dynamic routing','AS'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Enable EIGRP on R1', description:'Start EIGRP process 100 and add networks.', deviceName:'R1', command:'router eigrp 100\nnetwork 10.0.0.0\nno auto-summary', hints:['AS number must match on all routers'] },
    { id:'s2', number:2, title:'Enable EIGRP on R2 and R3', description:'Repeat EIGRP config on R2 and R3.', command:'router eigrp 100\nnetwork 10.0.0.0\nno auto-summary', hints:[] },
    { id:'s3', number:3, title:'Verify EIGRP neighbors', description:'Check EIGRP neighbor adjacencies.', command:'show ip eigrp neighbors', verificationCommand:'show ip eigrp neighbors', expectedOutput:'Q Cnt', hints:['If no neighbors, check AS numbers match'] },
    { id:'s4', number:4, title:'Verify EIGRP routes', description:'Confirm EIGRP routes in routing table.', command:'show ip route eigrp', verificationCommand:'show ip route eigrp', expectedOutput:'D', hints:['D = EIGRP, EX = EIGRP External'] },
  ]},
  { id:'ccna-07-standard-acl', title:'Standard ACL', category:'CCNA', vendor:'Cisco IOS', difficulty:2, description:'Create a numbered standard ACL to permit or deny traffic based on source IP.', topology:'R1 with G0/0 (LAN 192.168.1.0/24) and G0/1 (WAN).', tags:['acl','security','access-list','standard'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Create standard ACL 10', description:'Permit only the 192.168.1.0/24 subnet.', deviceName:'R1', command:'access-list 10 permit 192.168.1.0 0.0.0.255\naccess-list 10 deny any', hints:['Standard ACLs (1-99) filter by source IP only'] },
    { id:'s2', number:2, title:'Apply ACL to interface', description:'Apply ACL 10 inbound on G0/0.', deviceName:'R1', command:'interface g0/0\nip access-group 10 in', hints:['"in" = filter incoming traffic on this interface'] },
    { id:'s3', number:3, title:'Verify ACL', description:'View ACL and match statistics.', command:'show access-lists', verificationCommand:'show access-lists', expectedOutput:'Standard IP access list 10', hints:['The match count shows how many packets matched each ACE'] },
  ]},
  { id:'ccna-08-extended-acl', title:'Extended ACL', category:'CCNA', vendor:'Cisco IOS', difficulty:3, description:'Create a named extended ACL to filter traffic by source, destination, and port.', topology:'R1 between LAN and internet. Block HTTP/HTTPS from 192.168.1.0/24 to specific host.', tags:['acl','security','extended','tcp','named'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Create named extended ACL', description:'Create ACL named BLOCK_WEB that denies HTTP and HTTPS.', deviceName:'R1', command:'ip access-list extended BLOCK_WEB\ndeny tcp 192.168.1.0 0.0.0.255 any eq 80\ndeny tcp 192.168.1.0 0.0.0.255 any eq 443\npermit ip any any', hints:['Named ACLs are easier to manage than numbered'] },
    { id:'s2', number:2, title:'Apply ACL to interface', description:'Apply BLOCK_WEB outbound on G0/1 (WAN).', deviceName:'R1', command:'interface g0/1\nip access-group BLOCK_WEB out', hints:['Extended ACLs should be applied close to the source'] },
    { id:'s3', number:3, title:'Verify ACL', description:'Confirm ACL and check match counts.', command:'show access-lists BLOCK_WEB', verificationCommand:'show access-lists BLOCK_WEB', expectedOutput:'Extended IP access list BLOCK_WEB', hints:['Generate some test traffic then recheck counters'] },
  ]},
  { id:'ccna-09-dhcp-server', title:'DHCP Server', category:'CCNA', vendor:'Cisco IOS', difficulty:1, description:'Configure a Cisco router as a DHCP server for the LAN.', topology:'R1 as DHCP server for 192.168.1.0/24. PCs on LAN.', tags:['dhcp','server','ip helper'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Exclude static IPs', description:'Exclude addresses reserved for devices.', deviceName:'R1', command:'ip dhcp excluded-address 192.168.1.1 192.168.1.10', hints:['Exclude router IPs, servers, printers before creating the pool'] },
    { id:'s2', number:2, title:'Create DHCP pool', description:'Define the DHCP pool with network, gateway, and DNS.', deviceName:'R1', command:'ip dhcp pool LAN\nnetwork 192.168.1.0 255.255.255.0\ndefault-router 192.168.1.1\ndns-server 8.8.8.8\nlease 7', hints:['lease 7 = 7 day lease'] },
    { id:'s3', number:3, title:'Verify DHCP bindings', description:'Check that clients received IPs.', command:'show ip dhcp binding', verificationCommand:'show ip dhcp binding', expectedOutput:'IP address', hints:['Connect a PC and set it to DHCP'] },
  ]},
  { id:'ccna-10-nat-pat', title:'NAT/PAT Configuration', category:'CCNA', vendor:'Cisco IOS', difficulty:2, description:'Configure PAT (NAT overload) to allow multiple inside hosts to share one public IP.', topology:'R1 G0/0=inside LAN, G0/1=outside internet. One public IP on G0/1.', tags:['nat','pat','overload','translation'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Mark inside/outside interfaces', description:'Tag interfaces as NAT inside or outside.', deviceName:'R1', command:'interface g0/0\nip nat inside\ninterface g0/1\nip nat outside', hints:['Inside = LAN side, Outside = WAN side'] },
    { id:'s2', number:2, title:'Create ACL for inside hosts', description:'Create ACL 1 to permit inside LAN addresses.', deviceName:'R1', command:'access-list 1 permit 192.168.1.0 0.0.0.255', hints:['This ACL defines which hosts get translated'] },
    { id:'s3', number:3, title:'Configure PAT', description:'Enable NAT overload using the outside interface IP.', deviceName:'R1', command:'ip nat inside source list 1 interface g0/1 overload', hints:['"overload" = PAT, uses port numbers to multiplex'] },
    { id:'s4', number:4, title:'Verify translations', description:'Generate traffic and verify NAT table.', command:'show ip nat translations', verificationCommand:'show ip nat translations', expectedOutput:'Inside local', hints:['Ping an external host first to populate the table'] },
  ]},
  { id:'ccna-11-ssh-hardening', title:'SSH Hardening', category:'CCNA', vendor:'Cisco IOS', difficulty:2, description:'Disable Telnet and configure SSH version 2 for secure remote management.', topology:'R1 with domain name. Management station on LAN.', tags:['ssh','security','hardening','vty','crypto'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Set hostname and domain', description:'Required before generating RSA keys.', deviceName:'R1', command:'hostname R1\nip domain-name lab.local', hints:['Both hostname and domain-name are required for RSA keygen'] },
    { id:'s2', number:2, title:'Generate RSA key pair', description:'Generate 2048-bit RSA keys for SSH.', deviceName:'R1', command:'crypto key generate rsa modulus 2048', hints:['2048 bits is minimum recommended'] },
    { id:'s3', number:3, title:'Create local user', description:'Create admin account with privilege 15.', deviceName:'R1', command:'username admin privilege 15 secret AdminPass1!', hints:['privilege 15 = full access'] },
    { id:'s4', number:4, title:'Configure VTY lines for SSH only', description:'Restrict VTY lines to SSH and use local auth.', deviceName:'R1', command:'line vty 0 4\nlogin local\ntransport input ssh', hints:['transport input ssh blocks Telnet'] },
    { id:'s5', number:5, title:'Verify SSH', description:'Confirm SSH version and status.', command:'show ip ssh', verificationCommand:'show ip ssh', expectedOutput:'SSH Enabled', hints:['Verify with: ssh -l admin <router-ip> from management host'] },
  ]},
  { id:'ccna-12-stp-root', title:'STP Root Bridge Election', category:'CCNA', vendor:'Cisco IOS', difficulty:2, description:'Influence the STP root bridge election by manipulating bridge priority.', topology:'Three switches SW1, SW2, SW3 in a triangle topology.', tags:['stp','spanning-tree','root bridge','priority'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Observe default STP', description:'View current STP topology before changes.', deviceName:'SW1', command:'show spanning-tree', hints:['Note which switch is currently the root'] },
    { id:'s2', number:2, title:'Set SW1 as root bridge', description:'Lower SW1 bridge priority to win election.', deviceName:'SW1', command:'spanning-tree vlan 1 priority 4096', hints:['Priority must be multiples of 4096'] },
    { id:'s3', number:3, title:'Verify SW1 is root', description:'Confirm SW1 won the root bridge election.', command:'show spanning-tree vlan 1', verificationCommand:'show spanning-tree vlan 1', expectedOutput:'This bridge is the root', hints:['Look for "This bridge is the root" in output'] },
  ]},
  { id:'ccna-13-etherchannel', title:'EtherChannel (LACP)', category:'CCNA', vendor:'Cisco IOS', difficulty:2, description:'Bundle multiple physical links between switches into one logical EtherChannel using LACP.', topology:'SW1 and SW2 connected with Fa0/1 and Fa0/2.', tags:['etherchannel','lacp','portchannel','switching','aggregation'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Configure EtherChannel on SW1', description:'Bundle Fa0/1 and Fa0/2 into Port-channel 1 using LACP active.', deviceName:'SW1', command:'interface range fa0/1-2\nchannel-group 1 mode active\ninterface port-channel 1\nswitchport mode trunk', hints:['LACP active initiates negotiation'] },
    { id:'s2', number:2, title:'Configure EtherChannel on SW2', description:'Mirror configuration on SW2.', deviceName:'SW2', command:'interface range fa0/1-2\nchannel-group 1 mode active\ninterface port-channel 1\nswitchport mode trunk', hints:['Both sides active = LACP will negotiate'] },
    { id:'s3', number:3, title:'Verify EtherChannel', description:'Confirm bundle is up and ports are in use.', command:'show etherchannel summary', verificationCommand:'show etherchannel summary', expectedOutput:'SU', hints:['SU = Layer 2, in use. P = bundled in port-channel'] },
  ]},
  { id:'ccna-14-port-security', title:'Port Security', category:'CCNA', vendor:'Cisco IOS', difficulty:2, description:'Limit the number of MAC addresses on a switch port and set violation actions.', topology:'SW1 with access ports. Maximum 2 MACs per port.', tags:['port-security','switching','security','mac'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Configure port security on Fa0/1', description:'Enable port security with max 2 MACs and restrict violation.', deviceName:'SW1', command:'interface fa0/1\nswitchport mode access\nswitchport port-security\nswitchport port-security maximum 2\nswitchport port-security violation restrict\nswitchport port-security mac-address sticky', hints:['Port must be in access mode first'] },
    { id:'s2', number:2, title:'Verify port security', description:'Check port security status and learned MACs.', command:'show port-security interface fa0/1', verificationCommand:'show port-security interface fa0/1', expectedOutput:'Secure-up', hints:['Secure-up = port security active and port is up'] },
  ]},
  { id:'ccna-15-ipv6-static', title:'IPv6 Static Routing', category:'CCNA', vendor:'Cisco IOS', difficulty:2, description:'Enable IPv6 routing and configure static routes between two routers.', topology:'R1 (2001:db8:1::/64) -- link 2001:db8:12::/64 -- R2 (2001:db8:2::/64)', tags:['ipv6','static routing','unicast-routing'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Enable IPv6 routing', description:'Enable IPv6 unicast routing on both routers.', command:'ipv6 unicast-routing', hints:['Required on all routers that need to forward IPv6 packets'] },
    { id:'s2', number:2, title:'Configure IPv6 addresses on R1', description:'Assign IPv6 addresses to R1 interfaces.', deviceName:'R1', command:'interface g0/0\nipv6 address 2001:db8:1::1/64\nno shutdown\ninterface g0/1\nipv6 address 2001:db8:12::1/64\nno shutdown', hints:['IPv6 link-local is auto-configured, global must be manual'] },
    { id:'s3', number:3, title:'Add IPv6 static route on R1', description:"Route to R2's LAN via the link network.", deviceName:'R1', command:'ipv6 route 2001:db8:2::/64 2001:db8:12::2', hints:['Format: ipv6 route <prefix/len> <next-hop>'] },
    { id:'s4', number:4, title:'Verify IPv6 routing table', description:'Confirm static route in IPv6 routing table.', command:'show ipv6 route', verificationCommand:'show ipv6 route', expectedOutput:'S', hints:['S = Static IPv6 route'] },
  ]},
  { id:'ccna-16-hsrp', title:'HSRP Configuration', category:'CCNA', vendor:'Cisco IOS', difficulty:3, description:'Configure HSRP for first-hop redundancy between two routers sharing a virtual IP.', topology:'R1 (active) and R2 (standby) both connected to same LAN. Virtual IP: 10.0.1.254.', tags:['hsrp','fhrp','redundancy','virtual ip','gateway'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Configure HSRP on R1 (Active)', description:'Set R1 as the active router with higher priority.', deviceName:'R1', command:'interface g0/0\nstandby 1 ip 10.0.1.254\nstandby 1 priority 110\nstandby 1 preempt', hints:['Priority 110 > default 100 makes R1 active'] },
    { id:'s2', number:2, title:'Configure HSRP on R2 (Standby)', description:'Set R2 as standby with default priority.', deviceName:'R2', command:'interface g0/0\nstandby 1 ip 10.0.1.254\nstandby 1 priority 100', hints:['Virtual IP must be same on both routers'] },
    { id:'s3', number:3, title:'Verify HSRP status', description:'Confirm active/standby roles.', command:'show standby brief', verificationCommand:'show standby brief', expectedOutput:'Active', hints:['P = preempt enabled'] },
  ]},
  { id:'ccna-17-rip-v2', title:'RIP Version 2', category:'CCNA', vendor:'Cisco IOS', difficulty:1, description:'Configure RIP version 2 with VLSM support and verify route propagation.', topology:'R1 -- R2 -- R3 running RIPv2.', tags:['rip','routing','dynamic','ripv2'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Configure RIP on R1', description:'Enable RIPv2 with VLSM and add networks.', deviceName:'R1', command:'router rip\nversion 2\nno auto-summary\nnetwork 10.0.0.0', hints:['RIPv1 is classful. Version 2 supports VLSM'] },
    { id:'s2', number:2, title:'Repeat on R2 and R3', description:'Enable RIPv2 on all routers.', command:'router rip\nversion 2\nno auto-summary\nnetwork 10.0.0.0', hints:[] },
    { id:'s3', number:3, title:'Verify RIP routes', description:'Confirm RIP routes in routing table.', command:'show ip route rip', verificationCommand:'show ip route rip', expectedOutput:'R', hints:['R = RIP route in routing table'] },
  ]},
  { id:'ccna-18-vtp', title:'VTP Configuration', category:'CCNA', vendor:'Cisco IOS', difficulty:2, description:'Configure VTP server, client, and transparent modes to synchronize VLAN databases.', topology:'SW1 (server), SW2 (client), SW3 (transparent). Connected in series.', tags:['vtp','vlan','switching','synchronization'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Configure SW1 as VTP server', description:'Set VTP domain, password, and server mode.', deviceName:'SW1', command:'vtp mode server\nvtp domain CYBERLAB\nvtp password Lab123', hints:['Server mode is the default on Cisco switches'] },
    { id:'s2', number:2, title:'Configure SW2 as VTP client', description:'Set SW2 to client mode with same domain/password.', deviceName:'SW2', command:'vtp mode client\nvtp domain CYBERLAB\nvtp password Lab123', hints:['Client cannot add/modify VLANs locally'] },
    { id:'s3', number:3, title:'Create VLAN on server', description:'Create VLAN 30 on SW1 — should propagate to SW2.', deviceName:'SW1', command:'vlan 30\nname Engineering', hints:['VTP propagates VLANs over trunk links'] },
    { id:'s4', number:4, title:'Verify VTP status', description:'Check VTP status and VLAN database.', command:'show vtp status', verificationCommand:'show vtp status', expectedOutput:'VTP Operating Mode', hints:['Compare revision numbers — client should match server'] },
  ]},
  { id:'ccna-19-dhcp-relay', title:'DHCP Relay (ip helper-address)', category:'CCNA', vendor:'Cisco IOS', difficulty:2, description:'Forward DHCP broadcasts across router boundaries using ip helper-address.', topology:'DHCP server at 10.0.0.10. Client LAN 192.168.1.0/24 on different subnet.', tags:['dhcp','relay','helper-address','broadcast'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Configure ip helper-address', description:'Point the router interface toward the DHCP server.', deviceName:'R1', command:'interface g0/0\nip helper-address 10.0.0.10', hints:['Apply on the interface facing the DHCP clients'] },
    { id:'s2', number:2, title:'Verify clients get IPs', description:'Confirm DHCP clients receive addresses.', command:'show ip dhcp binding', verificationCommand:'show ip dhcp binding', expectedOutput:'IP address', hints:['Run this command on the DHCP server'] },
  ]},
  { id:'ccna-20-wireless-basics', title:'Wireless Basics (Conceptual)', category:'CCNA', vendor:'Cisco IOS', difficulty:1, description:'Understand and configure basic wireless settings: SSID, security, and channel.', topology:'Cisco AP connected to SW1. Wireless clients on 192.168.10.0/24.', tags:['wireless','wifi','ssid','wpa2','802.11'], createdAt:'2025-01-01T00:00:00Z', isBuiltin:true, steps:[
    { id:'s1', number:1, title:'Understand 802.11 standards', description:'Review 802.11a/b/g/n/ac/ax bands and speeds.', hints:['802.11a: 5GHz 54Mbps','802.11n: up to 600Mbps','802.11ac: up to 3.5Gbps','802.11ax (WiFi 6): up to 9.6Gbps'] },
    { id:'s2', number:2, title:'Configure SSID and security', description:'Set the SSID name and WPA2-Personal security.', command:'dot11 ssid CYBERLAB-WIFI\nauthentication open\nauthentication key-management wpa version 2\nwpa-psk ascii LabPass123!', hints:['WPA2 uses AES/CCMP encryption'] },
    { id:'s3', number:3, title:'Assign SSID to radio interface', description:'Associate the SSID with the wireless interface.', command:'interface dot11radio 0\nssid CYBERLAB-WIFI\nchannel 6', hints:['Use non-overlapping channels 1, 6, 11 for 2.4GHz'] },
    { id:'s4', number:4, title:'Verify wireless', description:'Check wireless interface status.', command:'show interfaces dot11radio 0', verificationCommand:'show interfaces dot11radio 0', expectedOutput:'is up', hints:['show dot11 associations shows connected clients'] },
  ]},
];

// ---------------------------------------------------------------------------
// Built-in Snippets
// ---------------------------------------------------------------------------
export const BUILTIN_SNIPPETS = [
  { id:'cr-01', title:'Show routing table', command:'show ip route', category:'Cisco Routing', description:'Display the full IPv4 routing table.' },
  { id:'cr-02', title:'OSPF neighbors', command:'show ip ospf neighbor', category:'Cisco Routing', description:'List all OSPF neighbors and their state.' },
  { id:'cr-03', title:'EIGRP neighbors', command:'show ip eigrp neighbors', category:'Cisco Routing', description:'List all EIGRP neighbors.' },
  { id:'cr-04', title:'Static route', command:'ip route {network} {mask} {next-hop}', category:'Cisco Routing', description:'Add a static route.', variables:['{network}','{mask}','{next-hop}'] },
  { id:'cr-05', title:'BGP summary', command:'show bgp summary', category:'Cisco Routing', description:'Show BGP neighbor summary and state.' },
  { id:'cs-01', title:'Show VLANs', command:'show vlan brief', category:'Cisco Switching', description:'List all VLANs and port assignments.' },
  { id:'cs-02', title:'Show spanning tree', command:'show spanning-tree', category:'Cisco Switching', description:'Show STP topology for all VLANs.' },
  { id:'cs-03', title:'Show EtherChannel', command:'show etherchannel summary', category:'Cisco Switching', description:'Show EtherChannel bundle status.' },
  { id:'cs-04', title:'Create VLAN', command:'vlan {vlan-id}\nname {name}', category:'Cisco Switching', description:'Create a VLAN and assign it a name.', variables:['{vlan-id}','{name}'] },
  { id:'cs-05', title:'Access port', command:'interface {int}\nswitchport mode access\nswitchport access vlan {vlan-id}', category:'Cisco Switching', description:'Configure a port as access and assign to VLAN.', variables:['{int}','{vlan-id}'] },
  { id:'acl-01', title:'Show access lists', command:'show access-lists', category:'ACL', description:'Display all configured ACLs and match counts.' },
  { id:'acl-02', title:'Standard ACL permit', command:'access-list {1-99} permit {network} {wildcard}', category:'ACL', description:'Permit a source network in a standard ACL.', variables:['{1-99}','{network}','{wildcard}'] },
  { id:'acl-03', title:'Named extended ACL', command:'ip access-list extended {name}\ndeny tcp {src} {wild} any eq {port}\npermit ip any any', category:'ACL', description:'Create a named extended ACL.', variables:['{name}','{src}','{wild}','{port}'] },
  { id:'nat-01', title:'Show NAT translations', command:'show ip nat translations', category:'NAT', description:'Display active NAT translation table.' },
  { id:'nat-02', title:'PAT overload', command:'ip nat inside source list {acl} interface {int} overload', category:'NAT', description:'Configure PAT using the outside interface IP.', variables:['{acl}','{int}'] },
  { id:'ln-01', title:'Show interfaces', command:'ip addr show', category:'Linux Networking', description:'List all network interfaces and IP addresses.' },
  { id:'ln-02', title:'Show routing table', command:'ip route show', category:'Linux Networking', description:'Display the Linux kernel routing table.' },
  { id:'ln-03', title:'Show listening ports', command:'ss -tulnp', category:'Linux Networking', description:'Show all listening TCP/UDP ports and their processes.' },
  { id:'fg-01', title:'System status', command:'get system status', category:'FortiGate', description:'Show FortiGate firmware version and system info.' },
  { id:'fg-02', title:'Session list', command:'diagnose sys session list', category:'FortiGate', description:'List active firewall sessions.' },
  { id:'v-01', title:'Ping', command:'ping {host}', category:'Verification', description:'Test reachability to a host.', variables:['{host}'] },
  { id:'v-02', title:'Interface brief', command:'show ip interface brief', category:'Verification', description:'Quick view of all interface IPs and states.' },
  { id:'v-03', title:'Show ARP table', command:'show arp', category:'Verification', description:'Display the ARP cache.' },
];

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
export const REFERENCE = {
  'Cisco IOS': {
    Routing: [
      { command:'show ip route', description:'Display the IPv4 routing table' },
      { command:'show ip ospf neighbor', description:'OSPF neighbor adjacencies' },
      { command:'show ip eigrp neighbors', description:'EIGRP neighbor table' },
      { command:'ip route {net} {mask} {nh}', description:'Add static route' },
      { command:'router ospf {pid}', description:'Enter OSPF router mode' },
    ],
    Switching: [
      { command:'show vlan brief', description:'VLAN database summary' },
      { command:'show spanning-tree', description:'STP topology for all VLANs' },
      { command:'show mac address-table', description:'CAM table entries' },
      { command:'show etherchannel summary', description:'Port-channel bundle status' },
    ],
    ACL: [
      { command:'access-list {1-99} permit {src} {wild}', description:'Standard ACL permit entry' },
      { command:'ip access-list extended {name}', description:'Create named extended ACL' },
      { command:'show access-lists', description:'Display ACLs with match counts' },
    ],
    NAT: [
      { command:'ip nat inside', description:'Mark interface as NAT inside' },
      { command:'ip nat outside', description:'Mark interface as NAT outside' },
      { command:'show ip nat translations', description:'Active NAT translation table' },
    ],
    Troubleshooting: [
      { command:'ping {host}', description:'ICMP echo test' },
      { command:'traceroute {host}', description:'Hop-by-hop path trace' },
      { command:'debug ip ospf events', description:'Real-time OSPF debugging' },
      { command:'undebug all', description:'Stop all debug output' },
    ],
  },
  'Linux': {
    Routing: [
      { command:'ip route show', description:'Display kernel routing table' },
      { command:'ip route add {net}/{pfx} via {gw}', description:'Add static route' },
    ],
    Troubleshooting: [
      { command:'ping -c 4 {host}', description:'ICMP echo test (4 packets)' },
      { command:'traceroute {host}', description:'Path trace' },
      { command:'tcpdump -i {int} -n', description:'Capture packets on interface' },
    ],
  },
  'FortiOS': {
    Routing: [
      { command:'get router info routing-table all', description:'Full routing table' },
    ],
    Troubleshooting: [
      { command:'diagnose debug flow trace start 100', description:'Packet flow debug' },
      { command:'diagnose debug disable', description:'Stop all debug output' },
    ],
  },
};

export const FLASH_CARDS = [
  { front:'OSPF AD value?', back:'110 (Internal)' },
  { front:'EIGRP AD value?', back:'90 (internal), 170 (external)' },
  { front:'RIP AD value?', back:'120' },
  { front:'BGP AD value?', back:'20 (eBGP), 200 (iBGP)' },
  { front:'OSPF Hello/Dead timers?', back:'10s / 40s (broadcast), 30s / 120s (NBMA)' },
  { front:'VLAN range (normal)?', back:'1 – 1005' },
  { front:'VLAN range (extended)?', back:'1006 – 4094' },
  { front:'STP port priority default?', back:'128' },
  { front:'PAT uses what for multiplexing?', back:'Port numbers (Layer 4)' },
  { front:'NAT Inside Local?', back:'Private IP of inside host' },
  { front:'NAT Inside Global?', back:'Public IP used after translation' },
];
