# Panspermia.io

Browser multiplayer evolution game: Spore's cell stage meets agar.io. Design: `memory/ROADMAP.md`, decisions: `memory/DECISIONS.md`.

Requires Node >= 24 (the server runs TypeScript natively, no build step).

```sh
npm install
npm run dev        # server :2567 + client http://localhost:5173
npm run check      # typecheck all workspaces + tests
npm run build      # client production bundle -> client/dist
```

Workspaces: `shared/` (constants + sync schema, imported as TS source), `server/` (Colyseus), `client/` (Vite + Three.js).
Client server URL defaults to `<page host>:2567`; override with `VITE_SERVER_URL`.
