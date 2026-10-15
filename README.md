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
