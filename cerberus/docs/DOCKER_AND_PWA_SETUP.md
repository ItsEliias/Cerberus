# Installing Cerberus & connecting Docker features

This guide covers **installing Cerberus as an app** (PWA) and **connecting the
Docker-backed features** — sandboxed code execution (OpenSandbox), vector
memory/RAG (ChromaDB), and web search (SearXNG) — including the **ChromeOS**
case.

## How it fits together (read this first)

Cerberus is two things:

- **The app + web UI** — a Python server that serves the interface you install
  as a PWA.
- **Docker-backed features** — OpenSandbox, ChromaDB and SearXNG, which run as
  containers.

The app talks to those services **over HTTP, by URL** — it never needs the
Docker socket itself. So "connecting Docker" always comes down to giving the app
three URLs in **Settings → Sandbox**:

| Setting | Env var | Points at | Example |
|---|---|---|---|
| Sandbox server URL | `SANDBOX_URL` | OpenSandbox server | `http://localhost:8090` |
| Vector store URL | `CHROMA_URL` | ChromaDB | `http://localhost:8100` |
| SearXNG URL | `SEARCH_SEARXNG_INSTANCE` | SearXNG | `http://localhost:8080` |

> **Off by default.** With those unset/unreachable, Cerberus runs fine — the UI
> and non-Docker features work; code execution simply **fails closed** (it never
> runs on the host). The Settings → Sandbox banner shows the live state.

Pick the setup that matches you:

- **[Setup 1 — Remote Docker server + PWA client](#setup-1)** *(recommended)*
- **[Setup 2 — All-in-one on ChromeOS (Crostini)](#setup-2)**
- **[Setup 3 — Sandbox-only in Crostini](#setup-3)**

---

<a name="setup-1"></a>
## Setup 1 — Remote Docker server + PWA client (recommended)

Run the Docker stack on a capable Linux box; use your Chromebook/laptop/phone as
a thin installed-app client. Native Docker (no VM nesting), best performance, and
one server serves every device.

### 1. Stand up the server (on the Linux machine)

```bash
git clone https://github.com/ItsEliias/Cerberus.git
cd Cerberus/cerberus
cp .env.example .env            # then edit secrets (see below)
docker compose up -d            # starts cerberus + opensandbox + chromadb + searxng
```

### 2. Set a real sandbox API key (server)

In `.env`, replace the dev placeholder:

```bash
OPENSANDBOX_API_KEY=<a long random secret>
```

Restart: `docker compose up -d`. The same key goes in the client's
Settings → Sandbox (step 6).

### 3. Confirm the server is reachable

```bash
curl http://<server-ip>:7000/api/health     # -> {"status":"ok"}
```

Note the server's LAN IP (e.g. `192.168.1.50`). For access outside the LAN, see
[Secure remote access with Tailscale](#tailscale).

### 4. Open Cerberus on the client

In Chrome on the Chromebook/laptop, go to `http://<server-ip>:7000` and log in
(first launch: create your admin account).

### 5. Install it as an app (PWA)

- **Chrome / ChromeOS:** click the **install icon** in the address bar (a
  monitor with a ↓), **or** ⋮ menu → **Cast, save & share → Install page as
  app…** → **Install**.
- It opens in its own window with the Cerberus icon and pins to the shelf/taskbar.

### 6. Point the app at the Docker services

In the app: **Settings → Sandbox** (admin only) →

1. Tick **Enable sandboxed code execution**.
2. **Sandbox server URL** → `http://<server-ip>:8090`
3. **API key** → the `OPENSANDBOX_API_KEY` from step 2.
4. *(optional)* **Vector store URL** → `http://<server-ip>:8100`,
   **SearXNG URL** → `http://<server-ip>:8080`.
5. **Save**, then **restart** Cerberus (settings apply on next launch).

> The server's compose file already wires the containers to each other; from the
> client you only point at the **server**, not at individual containers.

### 7. Verify

Re-open **Settings → Sandbox**. The banner should read **✅ Connected to the
Docker sandbox** and run a code snippet without error.

---

<a name="setup-2"></a>
## Setup 2 — All-in-one on ChromeOS (Crostini)

Everything on the Chromebook. Works, but heavier: OpenSandbox spawns its own
containers, so you get containers-inside-Docker-inside the Crostini VM. Best on a
Chromebook with **≥ 8 GB RAM**.

### 1. Enable Linux (Crostini)

**Settings → Advanced → Developers → Linux development environment → Turn on.**
Give it a few GB of disk.

### 2. Install Docker inside Crostini

In the Linux **Terminal**:

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER      # then log out/in of the Linux container
```

### 3. Run the whole stack

```bash
git clone https://github.com/ItsEliias/Cerberus.git
cd Cerberus/cerberus
cp .env.example .env                # set OPENSANDBOX_API_KEY
docker compose up -d
```

The containers reach each other by service name automatically
(`opensandbox-server:8090`, `chromadb:8100`, …) — nothing to configure in the
app for that.

### 4. Expose the web port to ChromeOS

ChromeOS runs Crostini in a VM, so tell it to forward the port:

**Settings → Advanced → Developers → Linux → Port forwarding → add TCP `7000`.**

### 5. Open + install

In Chrome, go to **`http://localhost:7000`** (or `http://penguin.linux.test:7000`)
→ log in → **Install as app** (as in Setup 1, step 5).

### 6. Sandbox settings

Because the app and its Docker services are in the same Crostini network, the
defaults usually work. If the banner shows unreachable, set
**Settings → Sandbox → Sandbox server URL** to `http://opensandbox-server:8090`,
save, restart.

---

<a name="setup-3"></a>
## Setup 3 — Sandbox-only in Crostini

You run Cerberus elsewhere (or as a light instance) but want the **sandbox** on
the Chromebook's Docker.

1. In Crostini, run just the sandbox and publish its port:
   ```bash
   docker run -d -p 8090:8090 -e OPENSANDBOX_SERVER_API_KEY=<key> \
     -v /var/run/docker.sock:/var/run/docker.sock opensandbox/server:latest
   ```
2. Forward TCP `8090` to ChromeOS (Setup 2, step 4).
3. In **Settings → Sandbox**: set **Sandbox server URL** to
   `http://localhost:8090` (or `http://penguin.linux.test:8090`) + the API key →
   Save → restart.

---

<a name="tailscale"></a>
## Secure remote access with Tailscale (optional)

To reach your server from anywhere (not just the LAN) without exposing ports to
the internet:

1. Install Tailscale on the **server** and the **client device**
   (`https://tailscale.com/download`), sign both into the same tailnet.
2. Find the server's Tailscale address: `tailscale ip -4` (e.g. `100.x.y.z`),
   or use its MagicDNS name (e.g. `myserver.tailnet-name.ts.net`).
3. On the client, open `http://<tailscale-name>:7000`, install the PWA, and in
   **Settings → Sandbox** use the same `<tailscale-name>` for the service URLs.

Everything stays inside your private tailnet — no port-forwarding, no public
exposure.

---

## Verifying & troubleshooting

- **Settings → Sandbox banner:**
  - ⚠️ *OFF* — enable the toggle, set the URL, save, restart.
  - ✅ *Connected* — you're good.
  - ⛔ *Enabled but can't reach `<url>`* — the URL/port is wrong or the server is
    down (see below).
- **"Couldn't reach the server":** confirm `curl http://<host>:8090/health`
  succeeds from the client. On ChromeOS, check the Crostini **port forwarding**
  entry exists.
- **Windows firewall / LAN:** allow inbound `7000`/`8090` on the server, and make
  sure the client is on the same network (or tailnet).
- **API key mismatch:** the client's Settings → Sandbox key must equal the
  server's `OPENSANDBOX_API_KEY`.
- **Settings didn't take effect:** they apply on the **next launch** — fully quit
  and reopen Cerberus.

> Security: the sandbox **fails closed**. If it can't reach a configured server,
> code execution errors out — it never silently runs on the host.
