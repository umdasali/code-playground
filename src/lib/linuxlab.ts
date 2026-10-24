// The exercises of the Linux lab: each one is a fresh simulated server plus a list of checks over its final state.
import { apachePlan, dhcpProblem, fileText, forwardingOn, httpHead, PCAP_PATH, reach, type Machine, type Proc, type World } from "./linuxsim";
import { ipToString, parseIp } from "./network";

export interface Check { text: string; done: boolean }
export interface Exercise {
  id: string;
  group: string;
  title: string;
  brief: string[];
  hints: string[]; // commands offered as one-click chips
  make: () => Machine;
  checks: (m: Machine) => Check[];
}

const HOME = "/home/student";

function baseMachine(over: Omit<Partial<Machine>, "world"> & { world?: Partial<World> } = {}): Machine {
  const { world, ...rest } = over;
  const m: Machine = {
    user: "student", cwd: HOME, hostname: "lab",
    fs: {
      "/etc/hosts": "127.0.0.1 localhost\n127.0.1.1 lab\n",
      "/etc/resolv.conf": "nameserver 127.0.0.53\noptions edns0 trust-ad\n",
      "/etc/ssh/sshd_config": "# This is the sshd server system-wide configuration file.\nInclude /etc/ssh/sshd_config.d/*.conf\n\n#Port 22\n#PermitRootLogin prohibit-password\n#PasswordAuthentication yes\nKbdInteractiveAuthentication no\nUsePAM yes\nX11Forwarding yes\nPrintMotd no\nAcceptEnv LANG LC_*\n",
      "/etc/netplan/01-netcfg.yaml": "network:\n  version: 2\n  renderer: networkd\n  ethernets:\n    enp0s3:\n      dhcp4: true\n",
      "/etc/network/interfaces": "auto lo\niface lo inet loopback\n\nauto eth0\niface eth0 inet dhcp\n",
      "/etc/sysctl.conf": "# /etc/sysctl.conf - Configuration file for setting system variables\n#net.ipv4.ip_forward=1\n#net.ipv6.conf.all.forwarding=1\n",
      "/proc/sys/net/ipv4/ip_forward": "0\n",
    },
    dirs: ["/etc", "/etc/ssh", "/etc/netplan", "/etc/network", "/home", HOME, "/var", "/var/www", "/tmp", "/root"],
    ifaces: [
      { name: "lo", up: true, addrs: ["127.0.0.1/8"], mac: "00:00:00:00:00:00" },
      { name: "enp0s3", up: true, addrs: ["10.0.2.15/24"], mac: "08:00:27:3a:1c:5e" },
    ],
    routes: [{ dst: "10.0.2.0/24", dev: "enp0s3" }, { dst: "default", via: "10.0.2.2", dev: "enp0s3" }],
    dns: ["10.0.2.3"],
    installed: ["openssh-server", "ufw", "net-tools", "traceroute", "curl", "lsof"],
    svc: { ssh: { active: true, enabled: true, ports: [22] }, ufw: { active: false, enabled: true, ports: [] } },
    ufw: { enabled: false, defaultIn: "deny", rules: [] },
    policy: { INPUT: "ACCEPT", FORWARD: "ACCEPT", OUTPUT: "ACCEPT" },
    rules: [], procs: [],
    world: { lan: [], internet: ["8.8.8.8", "1.1.1.1", "142.250.77.46"], names: { "google.com": "142.250.77.46" }, dnsServers: ["8.8.8.8", "1.1.1.1", "10.0.2.3"], ...world },
    keyAuthorized: false, events: [], lines: [], nextPid: 3000,
    ...rest,
  };
  return m;
}

const staticNet = (m: Machine, name: string, addr: string, gw: string | null) => {
  const i = m.ifaces.find((x) => x.name === name)!;
  i.addrs = [addr];
  const net = ipToString((parseIp(addr.split("/")[0])! & (0xffffffff << (32 - Number(addr.split("/")[1])))) >>> 0);
  m.routes = m.routes.filter((r) => r.dev !== name);
  m.routes.push({ dst: `${net}/${addr.split("/")[1]}`, dev: name });
  if (gw) m.routes.push({ dst: "default", via: gw, dev: name });
};

const has = (text: string, re: RegExp) => re.test(text);
const ifaceHas = (m: Machine, dev: string, addr: string) => !!m.ifaces.find((i) => i.name === dev)?.addrs.includes(addr);
const defaultVia = (m: Machine) => m.routes.find((r) => r.dst === "default")?.via ?? null;
const ufwAllows = (m: Machine, re: RegExp) => m.ufw.rules.filter((r) => re.test(r));

const WELCOME = (t: string) => [`Welcome to the lab. ${t}`, "Type 'help' for the commands this simulated server understands."];

export const EXERCISES: Exercise[] = [
  {
    id: "static-ip", group: "Interfaces and addressing", title: "Static IP with netplan",
    brief: [
      "The server uses DHCP on enp0s3. Give it a static address:",
      "address 192.168.10.20/24, gateway 192.168.10.1, DNS 8.8.8.8 and 1.1.1.1.",
      "Edit /etc/netplan/01-netcfg.yaml, apply it, then verify with ip addr show, ip route show and ping 8.8.8.8.",
    ],
    hints: ["ip addr show", "sudo nano /etc/netplan/01-netcfg.yaml", "sudo netplan apply", "ip route show", "ping -c 3 8.8.8.8", "resolvectl status"],
    make: () => baseMachine({ world: { lan: ["192.168.10.1"], dnsServers: ["8.8.8.8", "1.1.1.1"] } }),
    checks: (m) => {
      const f = fileText(m, "/etc/netplan/01-netcfg.yaml");
      return [
        { text: "Netplan file has 192.168.10.20/24 and dhcp4 is off", done: has(f, /192\.168\.10\.20\/24/) && !has(f, /dhcp4:\s*(true|yes)/i) },
        { text: "Netplan file has gateway 192.168.10.1 (gateway4 or a default route)", done: has(f, /192\.168\.10\.1\b(?!\d)/) && has(f, /gateway4|via:/) },
        { text: "Netplan file lists DNS 8.8.8.8 and 1.1.1.1", done: has(f, /8\.8\.8\.8/) && has(f, /1\.1\.1\.1/) },
        { text: "Applied: enp0s3 shows 192.168.10.20/24 in ip addr show", done: ifaceHas(m, "enp0s3", "192.168.10.20/24") },
        { text: "Applied: default route via 192.168.10.1", done: defaultVia(m) === "192.168.10.1" },
        { text: "Applied: DNS servers are 8.8.8.8 and 1.1.1.1", done: m.dns.includes("8.8.8.8") && m.dns.includes("1.1.1.1") },
        { text: "ping 8.8.8.8 works", done: reach(m, "8.8.8.8") },
      ];
    },
  },
  {
    id: "subnet-split", group: "Interfaces and addressing", title: "Subnet scenario (4 equal subnets)",
    brief: [
      "Divide 192.168.10.0/24 into 4 equal subnets (use the Subnetting lab if you want to check your maths).",
      "Give eth0 the FIRST usable address of the SECOND subnet, with the LAST usable address of that subnet as the default gateway.",
      "This machine uses /etc/network/interfaces. Make it permanent, restart networking, and verify with ip addr show eth0.",
    ],
    hints: ["ip addr show eth0", "sudo nano /etc/network/interfaces", "sudo systemctl restart networking", "ip route show", "ping -c 2 192.168.10.126"],
    make: () => {
      const m = baseMachine({ ifaces: [
        { name: "lo", up: true, addrs: ["127.0.0.1/8"], mac: "00:00:00:00:00:00" },
        { name: "eth0", up: true, addrs: ["10.0.2.15/24"], mac: "08:00:27:3a:1c:5e" },
      ], world: { lan: ["192.168.10.126", "192.168.10.66"] } });
      m.routes = [{ dst: "10.0.2.0/24", dev: "eth0" }, { dst: "default", via: "10.0.2.2", dev: "eth0" }];
      m.dirs.push("/etc/network");
      return m;
    },
    checks: (m) => {
      const f = fileText(m, "/etc/network/interfaces");
      return [
        { text: "Interfaces file sets eth0 static, address 192.168.10.65", done: has(f, /iface\s+eth0\s+inet\s+static/) && has(f, /address\s+192\.168\.10\.65(\/26)?\s*$/m) },
        { text: "Interfaces file has netmask 255.255.255.192 (or /26) and gateway 192.168.10.126", done: (has(f, /netmask\s+255\.255\.255\.192/) || has(f, /address\s+192\.168\.10\.65\/26/)) && has(f, /gateway\s+192\.168\.10\.126/) },
        { text: "Applied: ip addr show eth0 shows 192.168.10.65/26", done: ifaceHas(m, "eth0", "192.168.10.65/26") },
        { text: "Applied: default route via 192.168.10.126", done: defaultVia(m) === "192.168.10.126" },
        { text: "The gateway answers ping", done: reach(m, "192.168.10.126") && ifaceHas(m, "eth0", "192.168.10.65/26") },
      ];
    },
  },
  {
    id: "hosts-dns", group: "Interfaces and addressing", title: "Local name resolution",
    brief: [
      "Make labserver.iitism.local resolve to 192.168.10.50 using /etc/hosts.",
      "Then point /etc/resolv.conf at the lab DNS server 192.168.10.2 (nameserver line).",
      "Verify with getent hosts labserver.iitism.local and ping -c 2 labserver.iitism.local.",
    ],
    hints: ["cat /etc/hosts", "sudo nano /etc/hosts", "echo '192.168.10.50 labserver.iitism.local' | sudo tee -a /etc/hosts", "sudo nano /etc/resolv.conf", "getent hosts labserver.iitism.local", "ping -c 2 labserver.iitism.local"],
    make: () => {
      const m = baseMachine({ world: { lan: ["192.168.10.1", "192.168.10.2", "192.168.10.50"], dnsServers: ["192.168.10.2"], names: { "intranet.iitism.local": "192.168.10.60" } } });
      staticNet(m, "enp0s3", "192.168.10.20/24", "192.168.10.1");
      m.fs["/etc/resolv.conf"] = "nameserver 127.0.0.53\n";
      m.dns = [];
      return m;
    },
    checks: (m) => {
      const hosts = fileText(m, "/etc/hosts");
      const resolv = fileText(m, "/etc/resolv.conf");
      return [
        { text: "/etc/hosts maps 192.168.10.50 to labserver.iitism.local", done: has(hosts, /^\s*192\.168\.10\.50\s+(\S+\s+)*labserver\.iitism\.local(\s|$)/m) },
        { text: "/etc/resolv.conf has nameserver 192.168.10.2", done: has(resolv, /^\s*nameserver\s+192\.168\.10\.2\s*$/m) },
        { text: "ping labserver.iitism.local reaches the server", done: m.events.includes("ping:192.168.10.50") },
      ];
    },
  },
  {
    id: "dhcp", group: "Network services", title: "DHCP server (isc-dhcp-server)",
    brief: [
      "This server (enp0s3 = 172.16.5.1/24) must hand out addresses 172.16.5.50 to 172.16.5.150, with a 24-hour lease and gateway 172.16.5.1.",
      "Install isc-dhcp-server, declare the subnet in /etc/dhcp/dhcpd.conf, set INTERFACESv4 in /etc/default/isc-dhcp-server, then restart and check the service.",
    ],
    hints: ["sudo apt install -y isc-dhcp-server", "sudo nano /etc/dhcp/dhcpd.conf", "sudo nano /etc/default/isc-dhcp-server", "sudo dhcpd -t", "sudo systemctl restart isc-dhcp-server", "systemctl status isc-dhcp-server", "ss -tulnp"],
    make: () => {
      const m = baseMachine({ world: { lan: ["172.16.5.10"] } });
      staticNet(m, "enp0s3", "172.16.5.1/24", null);
      return m;
    },
    checks: (m) => {
      const c = fileText(m, "/etc/dhcp/dhcpd.conf").replace(/#.*$/gm, "");
      return [
        { text: "isc-dhcp-server is installed", done: m.installed.includes("isc-dhcp-server") },
        { text: "dhcpd.conf declares subnet 172.16.5.0 netmask 255.255.255.0", done: has(c, /subnet\s+172\.16\.5\.0\s+netmask\s+255\.255\.255\.0\s*\{/) },
        { text: "Pool: range 172.16.5.50 172.16.5.150", done: has(c, /range\s+172\.16\.5\.50\s+172\.16\.5\.150\s*;/) },
        { text: "Gateway: option routers 172.16.5.1", done: has(c, /option\s+routers\s+172\.16\.5\.1\s*;/) },
        { text: "Lease time 24 hours: default-lease-time 86400", done: has(c, /default-lease-time\s+86400\s*;/) },
        { text: 'INTERFACESv4="enp0s3" in /etc/default/isc-dhcp-server', done: has(fileText(m, "/etc/default/isc-dhcp-server"), /^INTERFACESv4="enp0s3"/m) },
        { text: "The service is active (running)", done: !!m.svc.dhcp?.active && dhcpProblem(m) === null },
      ];
    },
  },
  {
    id: "apache", group: "Network services", title: "Web server on port 8080",
    brief: [
      "Install Apache (apache2), make it listen on 8080 instead of 80, and serve a custom document root /var/www/iitism that contains an index.html.",
      "Change Listen in /etc/apache2/ports.conf and the VirtualHost in /etc/apache2/sites-available/000-default.conf, restart, and verify with curl -I http://localhost:8080.",
    ],
    hints: ["sudo apt install -y apache2", "sudo nano /etc/apache2/ports.conf", "sudo nano /etc/apache2/sites-available/000-default.conf", "sudo mkdir -p /var/www/iitism", "echo '<h1>IIT ISM</h1>' | sudo tee /var/www/iitism/index.html", "sudo systemctl restart apache2", "curl -I http://localhost:8080", "ss -tulnp"],
    make: () => baseMachine(),
    checks: (m) => {
      const plan = apachePlan(m);
      const vh = plan.vhosts.find((v) => v.port === 8080);
      return [
        { text: "apache2 is installed", done: m.installed.includes("apache2") },
        { text: "ports.conf listens on 8080 (and no longer on 80)", done: plan.ports.includes(8080) && !plan.ports.includes(80) },
        { text: "A VirtualHost *:8080 uses DocumentRoot /var/www/iitism", done: vh?.root === "/var/www/iitism" },
        { text: "/var/www/iitism/index.html exists", done: "/var/www/iitism/index.html" in m.fs },
        { text: "apache2 is running and listening on 8080", done: !!m.svc.apache2?.active && m.svc.apache2.ports.includes(8080) },
        { text: "curl -I http://localhost:8080 returns 200 OK", done: !!m.svc.apache2?.active && httpHead(m, 8080)[0]?.includes("200") },
      ];
    },
  },
  {
    id: "ssh", group: "Network services", title: "SSH hardening and key login",
    brief: [
      "Change sshd to listen on port 2222 and disable root login (PermitRootLogin no) in /etc/ssh/sshd_config, then restart ssh.",
      "Generate a key pair with ssh-keygen, copy it to the second machine (student@192.168.10.30, whose sshd listens on 2222) with ssh-copy-id, and log in without a password.",
    ],
    hints: ["sudo nano /etc/ssh/sshd_config", "sudo sshd -t", "sudo systemctl restart ssh", "ss -tulnp", "ssh-keygen -t rsa -b 4096", "ssh-copy-id -p 2222 student@192.168.10.30", "ssh -p 2222 student@192.168.10.30"],
    make: () => {
      const m = baseMachine({ world: { lan: ["192.168.10.1", "192.168.10.30"], ssh: { ip: "192.168.10.30", port: 2222, user: "student", host: "node2" } } });
      staticNet(m, "enp0s3", "192.168.10.20/24", "192.168.10.1");
      m.dirs.push(`${HOME}/.ssh`);
      return m;
    },
    checks: (m) => {
      const f = fileText(m, "/etc/ssh/sshd_config");
      return [
        { text: "sshd_config has Port 2222", done: has(f, /^\s*Port\s+2222\s*$/m) },
        { text: "sshd_config has PermitRootLogin no", done: has(f, /^\s*PermitRootLogin\s+no\s*$/mi) },
        { text: "ssh was restarted and listens on 2222 (see ss -tulnp)", done: !!m.svc.ssh?.active && m.svc.ssh.ports.includes(2222) && !m.svc.ssh.ports.includes(22) },
        { text: "A key pair exists in ~/.ssh", done: Object.keys(m.fs).some((p) => p.startsWith(`${HOME}/.ssh/`) && p.endsWith(".pub")) },
        { text: "The public key was copied to 192.168.10.30 (ssh-copy-id)", done: m.keyAuthorized },
        { text: "ssh -p 2222 student@192.168.10.30 logs in without a password", done: m.events.includes("ssh-login") },
      ];
    },
  },
  {
    id: "ufw", group: "Firewall", title: "ufw: SSH only from one host",
    brief: [
      "Allow incoming SSH (port 22) only from 192.168.1.100 and block everything else coming in, but keep web traffic (80 and 443) open.",
      "Set the default incoming policy to deny, add the rules, enable ufw and read the result with ufw status.",
    ],
    hints: ["sudo ufw default deny incoming", "sudo ufw allow from 192.168.1.100 to any port 22", "sudo ufw allow 80/tcp", "sudo ufw allow 443/tcp", "sudo ufw enable", "sudo ufw status verbose", "sudo ufw status numbered"],
    make: () => baseMachine(),
    checks: (m) => [
      { text: "ufw is enabled", done: m.ufw.enabled },
      { text: "Default incoming policy is deny", done: m.ufw.defaultIn === "deny" },
      { text: "Port 22 is allowed from 192.168.1.100", done: ufwAllows(m, /^22(\/tcp)?\|ALLOW IN\|192\.168\.1\.100$/).length > 0 },
      { text: "No rule lets any other host reach port 22", done: ufwAllows(m, /^(22(\/tcp)?|OpenSSH)\|ALLOW IN\|Anywhere$/).length === 0 },
      { text: "Ports 80 and 443 are allowed", done: ufwAllows(m, /^80(\/tcp)?\|ALLOW IN\|Anywhere$/).length > 0 && ufwAllows(m, /^443(\/tcp)?\|ALLOW IN\|Anywhere$/).length > 0 },
    ],
  },
  {
    id: "icmp", group: "Firewall", title: "iptables: block ping, keep HTTP/HTTPS",
    brief: [
      "Drop all incoming ICMP echo requests (ping) with iptables, while keeping ports 80 and 443 open.",
      "Add the rules to the INPUT chain, then list them with iptables -L INPUT -n or iptables -S.",
    ],
    hints: ["sudo iptables -A INPUT -p icmp --icmp-type echo-request -j DROP", "sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT", "sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT", "sudo iptables -L INPUT -n", "sudo iptables -S"],
    make: () => baseMachine(),
    checks: (m) => {
      const input = m.rules.filter((r) => r.table === "filter" && r.chain === "INPUT");
      const ping = input.findIndex((r) => /-p icmp/.test(r.spec) && /--icmp-type (echo-request|8)/.test(r.spec) && /-j (DROP|REJECT)/.test(r.spec));
      const open = (port: number) => m.policy.INPUT === "ACCEPT" || input.some((r) => new RegExp(`-p tcp .*--dport ${port}\\b`).test(r.spec) && /-j ACCEPT/.test(r.spec));
      return [
        { text: "INPUT drops ICMP echo-request", done: ping >= 0 },
        { text: "Port 80 is not blocked (accepted or policy ACCEPT)", done: open(80) && !input.some((r) => /--dport 80\b/.test(r.spec) && /-j (DROP|REJECT)/.test(r.spec)) },
        { text: "Port 443 is not blocked (accepted or policy ACCEPT)", done: open(443) && !input.some((r) => /--dport 443\b/.test(r.spec) && /-j (DROP|REJECT)/.test(r.spec)) },
      ];
    },
  },
  {
    id: "nat", group: "Firewall", title: "IP forwarding and NAT (masquerade)",
    brief: [
      "This machine routes between an internal LAN (enp0s8, 192.168.20.0/24) and the outside (enp0s3).",
      "Enable IP forwarding now and permanently (/etc/sysctl.conf), then add a masquerade rule so 192.168.20.0/24 can reach the outside through enp0s3.",
    ],
    hints: ["cat /proc/sys/net/ipv4/ip_forward", "sudo sysctl -w net.ipv4.ip_forward=1", "sudo nano /etc/sysctl.conf", "sudo sysctl -p", "sudo iptables -t nat -A POSTROUTING -s 192.168.20.0/24 -o enp0s3 -j MASQUERADE", "sudo iptables -t nat -L -n", "ip route show"],
    make: () => {
      const m = baseMachine({ world: { lan: ["192.168.10.1"] } });
      staticNet(m, "enp0s3", "192.168.10.20/24", "192.168.10.1");
      m.ifaces.push({ name: "enp0s8", up: true, addrs: ["192.168.20.1/24"], mac: "08:00:27:9b:44:02" });
      m.routes.push({ dst: "192.168.20.0/24", dev: "enp0s8" });
      return m;
    },
    checks: (m) => [
      { text: "IP forwarding is on now (net.ipv4.ip_forward = 1)", done: forwardingOn(m) },
      { text: "It is permanent: net.ipv4.ip_forward=1 is uncommented in /etc/sysctl.conf", done: has(fileText(m, "/etc/sysctl.conf"), /^\s*net\.ipv4\.ip_forward\s*=\s*1\s*$/m) },
      { text: "nat POSTROUTING masquerades 192.168.20.0/24 out of enp0s3", done: m.rules.some((r) => r.table === "nat" && r.chain === "POSTROUTING" && /-s 192\.168\.20\.0\/24/.test(r.spec) && /-o enp0s3/.test(r.spec) && /-j MASQUERADE/.test(r.spec)) },
    ],
  },
  {
    id: "route-fault", group: "Troubleshooting", title: "Why can't this host reach the internet?",
    brief: [
      "Users on this host (192.168.10.20/24) can reach the LAN but not the internet.",
      "Diagnose it with ping, traceroute (or tracepath) and ip route show, fix the route right now, and fix the netplan file so it survives a reboot (the real gateway is 192.168.10.1).",
    ],
    hints: ["ip addr show", "ip route show", "ping -c 2 8.8.8.8", "ping -c 2 192.168.10.1", "ping -c 2 192.168.10.254", "traceroute 8.8.8.8", "sudo ip route replace default via 192.168.10.1", "cat /etc/netplan/01-netcfg.yaml", "sudo nano /etc/netplan/01-netcfg.yaml", "sudo netplan apply"],
    make: () => {
      const m = baseMachine({ world: { lan: ["192.168.10.1", "192.168.10.77"], dnsServers: ["8.8.8.8"] } });
      staticNet(m, "enp0s3", "192.168.10.20/24", "192.168.10.254");
      m.dns = ["8.8.8.8"];
      m.fs["/etc/netplan/01-netcfg.yaml"] = "network:\n  version: 2\n  renderer: networkd\n  ethernets:\n    enp0s3:\n      dhcp4: no\n      addresses: [192.168.10.20/24]\n      gateway4: 192.168.10.254\n      nameservers:\n        addresses: [8.8.8.8]\n";
      return m;
    },
    checks: (m) => [
      { text: "You looked at the routing table (ip route show)", done: m.events.includes("ip-route") },
      { text: "You traced the path (traceroute or tracepath)", done: m.events.includes("traceroute") },
      { text: "Running system: default route is via 192.168.10.1 and ping 8.8.8.8 works", done: defaultVia(m) === "192.168.10.1" && reach(m, "8.8.8.8") },
      { text: "Persistent: the netplan file has gateway 192.168.10.1, not .254", done: has(fileText(m, "/etc/netplan/01-netcfg.yaml"), /192\.168\.10\.1\b(?!\d)/) && !has(fileText(m, "/etc/netplan/01-netcfg.yaml"), /192\.168\.10\.254/) },
    ],
  },
  {
    id: "port-fault", group: "Troubleshooting", title: "Who is using port 8080?",
    brief: [
      "Apache is configured for port 8080 but will not start (try: sudo systemctl start apache2, then read the status).",
      "Find the process that holds port 8080 with ss -tulnp, netstat -tulnp or lsof -i :8080, stop it with kill, then start Apache and check curl -I http://localhost:8080.",
    ],
    hints: ["sudo systemctl start apache2", "systemctl status apache2", "sudo ss -tulnp", "sudo netstat -tulnp", "sudo lsof -i :8080", "ps aux", "kill 2381", "sudo systemctl start apache2", "curl -I http://localhost:8080"],
    make: () => {
      const m = baseMachine();
      m.installed.push("apache2");
      m.fs["/etc/apache2/ports.conf"] = "Listen 8080\n";
      m.fs["/etc/apache2/sites-available/000-default.conf"] = "<VirtualHost *:8080>\n    DocumentRoot /var/www/html\n</VirtualHost>\n";
      m.fs["/etc/apache2/sites-enabled/000-default.conf"] = m.fs["/etc/apache2/sites-available/000-default.conf"];
      m.fs["/var/www/html/index.html"] = "<h1>It works</h1>\n";
      m.dirs.push("/var/www/html");
      m.svc.apache2 = { active: false, enabled: true, ports: [], error: "(98)Address already in use: AH00072: make_sock: could not bind to address 0.0.0.0:8080" };
      const rogue: Proc = { pid: 2381, user: "student", name: "python3", cmd: "python3 -m http.server 8080", port: 8080, proto: "tcp" };
      m.procs = [rogue, { pid: 2455, user: "student", name: "bash", cmd: "-bash", proto: "tcp" }];
      return m;
    },
    checks: (m) => [
      { text: "You found the process on port 8080 (ss, netstat or lsof)", done: m.events.some((e) => e === "ss" || e === "netstat" || e === "lsof") },
      { text: "The process holding port 8080 (PID 2381) was stopped", done: m.events.includes("killed:2381") },
      { text: "apache2 is now running on 8080", done: !!m.svc.apache2?.active && m.svc.apache2.ports.includes(8080) },
      { text: "curl -I http://localhost:8080 returns 200 OK", done: !!m.svc.apache2?.active && httpHead(m, 8080)[0]?.includes("200") },
    ],
  },
  {
    id: "packets", group: "Troubleshooting", title: "Packet capture and analysis",
    brief: [
      "1) Capture 10 ICMP packets while pinging: run tcpdump -i any -c 10 icmp (as root).",
      "2) Read the saved capture ~/capture.pcap with tcpdump -nn -r capture.pcap. Find the client and server addresses and the handshake flags ([S], [S.], [.]).",
      "3) Report them with: answer <client-ip> <server-ip>.",
    ],
    hints: ["ping -c 2 8.8.8.8", "sudo tcpdump -i any -c 10 icmp", "sudo tcpdump -i any -c 10 port 80", "ls", "sudo tcpdump -nn -r capture.pcap", "answer 10.0.0.5 10.0.0.9"],
    make: () => {
      const m = baseMachine({ world: { lan: ["192.168.10.1"] } });
      staticNet(m, "enp0s3", "192.168.10.20/24", "192.168.10.1");
      m.installed.push("tcpdump");
      m.fs[PCAP_PATH] = "\u0000pcap";
      return m;
    },
    checks: (m) => [
      { text: "Captured exactly 10 packets with tcpdump -i any -c 10", done: m.events.includes("tcpdump10") },
      { text: "Read capture.pcap with tcpdump -r", done: m.events.includes("pcap") },
      { text: "Identified the client and the server (answer <client> <server>)", done: m.events.includes("answer-ok") },
    ],
  },
];

export const exerciseById = (id: string) => EXERCISES.find((e) => e.id === id) ?? EXERCISES[0];
export const GROUPS = [...new Set(EXERCISES.map((e) => e.group))];
export const welcomeFor = (e: Exercise) => WELCOME(e.title);
