# Panspermia.io

Browser multiplayer evolution game: Spore's cell stage meets agar.io. Design: `memory/ROADMAP.md`, decisions: `memory/DECISIONS.md`.

Requires Node >= 24 (the server runs TypeScript natively, no build step).

```sh
npm install
npm run dev        # server :2567 + client http://localhost:5173
npm run check      # typecheck all workspaces + tests
npm run build      # client production bundle -> client/dist
npm run play       # production: build, then one server on :2567 serving the game page too (no dev cheats)
npm run tunnel     # share :2567 at a public https://….trycloudflare.com address (needs cloudflared)
```

Workspaces: `shared/` (constants + sync schema, imported as TS source), `server/` (Colyseus), `client/` (Vite + Three.js).
In dev the client connects to `<page host>:2567`; a production build connects to the address it was served from.
Override either with `VITE_SERVER_URL`. Health check: `GET /health`.

## Playtest with friends (free, from your PC)

1. Install Cloudflare's tunnel client once: `winget install --id Cloudflare.cloudflared` (no account needed).
2. Terminal 1: `npm run play` and wait for "listening on :2567".
3. Terminal 2: `npm run tunnel` and share the `https://….trycloudflare.com` address it prints.

The address changes every time the tunnel restarts, and the game is only up while your PC and both terminals are.
Stop with Ctrl+C in each terminal. Anyone with the link can join while it runs; dev cheats stay off.

## Public alpha (always on: a Hetzner VPS)

Players open `https://<server-ip-with-dashes>.sslip.io` (a free hostname with a real Let's Encrypt certificate).
Caddy terminates HTTPS and proxies to the game server on `127.0.0.1:2567`; systemd keeps it running; the firewall
lets only ssh, http and https in. Files: `deploy/` (provision, deploy, systemd unit, Caddyfile) and `.github/workflows/ci.yml`.

- **Deploys are automatic**: every push runs the tests; a push to `master` that passes them is deployed
  (`deploy/deploy.sh`: fetch, check out the commit, `npm ci`, build, restart, wait for `/health`, roll back if it
  doesn't answer). Open tabs show "Server updating…" and reload into the new build. A deploy restarts the pond.
- **Setup, once**: create the server (Ubuntu 24.04, your ssh key), then from this repo
  `ssh root@IP "bash -s -- <ip-with-dashes>.sslip.io master '$(cat ~/.ssh/panspermia_deploy.pub)'" < deploy/provision.sh`
  (step by step: `deploy/SETUP.md`).
  GitHub repository secrets: `DEPLOY_HOST` (the IP), `DEPLOY_SSH_KEY` (the private key `~/.ssh/panspermia_deploy`),
  `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 IP`), `DEPLOY_SITE` (the sslip.io name). The deploy key can only run
  `deploy.sh` with a commit of master.
- **On the server**: logs `journalctl -u panspermia -f`; tuning in `/etc/panspermia.env` (`MAX_ROOMS`: rooms at once,
  each a whole sim with its bots), then `systemctl restart panspermia`; the Hall of Fame is `/var/lib/panspermia/hall.db`.
  Deploy a given commit by hand: `sudo -u panspermia bash /opt/panspermia/deploy/deploy.sh <full sha>`.
