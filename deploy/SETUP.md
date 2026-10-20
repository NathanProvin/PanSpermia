# Hosting the game from the old gaming PC, step by step

What you end up with:
- The gaming PC runs the game in Docker whenever you switch it on for a playtest.
- Players reach it over HTTPS through a Cloudflare tunnel. No port is opened on your router, and your home IP stays hidden.
- Every push to `master` that passes the tests builds a new image of the game; the PC picks it up within 5 minutes,
  and players' open tabs reload into it.

**Cost:** €0, plus the PC's electricity while it is on. With your own domain (step 5b): about €10/year.

**Time:** about 45 minutes the first time, most of it installing Docker.

There are two machines:
- **the dev PC**, where you write code and push;
- **the gaming PC**, which hosts the game.

They can be the same machine, but nothing needs to be installed on the gaming PC except Docker.

---

## Step 1 — The gaming PC: Docker Desktop

1. **Windows up to date:** Settings → Windows Update → install everything, reboot.
2. **Virtualisation on.** Task Manager → Performance → CPU → *Virtualisation: Enabled*. If it says *Disabled*, turn on
   Intel VT-x / AMD-V (sometimes called *SVM Mode*) in the BIOS. Its key at boot is usually Del or F2.
3. **Install Docker Desktop** from <https://www.docker.com/products/docker-desktop/>.
   - It is free for personal use and small companies.
   - Keep *Use WSL 2 instead of Hyper-V* ticked. If Windows asks to install or update WSL, accept and reboot.
4. **Start Docker Desktop**, accept the terms, and skip the sign-in (not needed).
5. **Docker Desktop settings** (the gear icon):
   - *General* → **Start Docker Desktop when you sign in to your computer**: on. Containers set to restart then
     come back on their own at each boot.
   - *Resources* → leave the defaults. Docker uses what the game needs.
6. **Check it works.** In PowerShell:

   ```powershell
   docker version
   docker compose version
   ```

   Both print versions. An error means Docker Desktop isn't running yet: wait until its whale icon stops animating.
7. **Sleep.** While a playtest runs, the PC must not sleep: Settings → System → Power → *Screen and sleep* → *When
   plugged in, put my device to sleep after*: **Never**. Or switch it back after each session.

---

## Step 2 — Publish the first image (dev PC, with Claude)

The image is built by GitHub Actions from `master`. The Docker setup is still on the `deploy-home` branch.

1. **Claude pushes the branch.** The *Actions* tab shows a **ci** run with one **test** job. Only `master` publishes
   images, so nothing is published yet.
2. **Once the test job is green, Claude merges into `master` and pushes.** The new **ci** run has two jobs:
   - **test**;
   - then **image**, which builds the game and pushes it to GitHub's container registry as
     `ghcr.io/nathanprovin/panspermia`.
3. **Make the image public, once.** A first image is private, and the gaming PC would need a login to pull it.
   - On GitHub: your profile picture → *Your profile* → *Packages* → **panspermia** → *Package settings* (bottom right).
   - *Danger Zone* → *Change visibility* → **Public** → type the name to confirm.

   The image only holds what the public repo already shows: no secret is in it.

---

## Step 3 — The game's folder on the gaming PC

In PowerShell on the gaming PC:

```powershell
mkdir C:\Panspermia
cd C:\Panspermia
curl.exe -fsSL -o compose.yaml https://raw.githubusercontent.com/NathanProvin/PanSpermia/master/compose.yaml
```

That one file is all the PC needs. It describes four containers:

| Container | What it does |
|---|---|
| `game` | The game server, published only to this PC as <http://localhost:2567> |
| `quick` or `named` | The Cloudflare tunnel that lets players in (step 5) |
| `updater` | Checks every 5 minutes for a new image and restarts the game with it |

Optional: a `.env` file next to it holds the settings. Create it with Notepad, and save it as **All files**, not `.txt`:

```ini
# rooms at once: each is a whole pond with its bots, about one CPU core; the 51st player opens a second room
MAX_ROOMS=1
```

---

## Step 4 — First start, on this PC only

```powershell
cd C:\Panspermia
docker compose up -d game updater
```

The first time, Docker downloads the images (about 300 MB). Then open <http://localhost:2567> on the gaming PC: you
should be in the pond.

`docker compose ps` lists the containers; `game` reads `healthy` after about a minute.

---

## Step 5 — Let players in

Pick one of the two.

### 5a — Quick tunnel: free, no account, a new address at each start

```powershell
docker compose --profile quick up -d
docker compose logs quick
```

In the log, find the box with `https://<random-words>.trycloudflare.com` and send that address to the players. It
changes whenever the `quick` container restarts: after a reboot, or after `down` / `up`. Run `docker compose logs quick`
again to get the new one.

### 5b — Your own domain: a fixed address (about €10/year)

1. **Cloudflare account:** sign up for free at <https://dash.cloudflare.com/sign-up>.
2. **A domain.**
   - Buy one in the dashboard (*Domain Registration* → *Register Domains*). Cloudflare sells at cost, about €10/year
     for a `.com`.
   - Or add one you already own (*Add a domain*) and change its nameservers at your registrar to the two Cloudflare
     gives you.
   - The `panspermia` name still needs its IP check before you build a brand on it. Any domain works for playtests.
3. **The tunnel.**
   - Dashboard → *Zero Trust* (choose the free plan if asked) → *Networks* → *Tunnels* → **Create a tunnel** →
     *Cloudflared* → name it `panspermia-home` → *Save tunnel*.
   - On the next page, choose **Docker**. It shows a command ending in `--token eyJ…`. Copy only the long token after
     `--token `. Don't run that command: compose does it for you.
   - *Next* → **Public hostname**:
     - **Subdomain:** `play`
     - **Domain:** yours
     - **Type:** `HTTP`
     - **URL:** `game:2567`
   - *Save*. That last line is the name of the game's container inside compose.
4. **On the gaming PC,** add the token to `C:\Panspermia\.env`:

   ```ini
   TUNNEL_TOKEN=eyJ...the whole token...
   ```

   Then:

   ```powershell
   docker compose --profile named up -d
   ```

   Players open `https://play.<your-domain>`. The tunnel shows **Healthy** in the Cloudflare dashboard.

   Treat the token like a password: anyone holding it can attach their own server to your address. If it leaks,
   regenerate it in the tunnel's settings and update `.env`.

---

## Step 6 — Day to day

| What | Command (PowerShell, in `C:\Panspermia`) |
|---|---|
| Start a playtest | `docker compose --profile quick up -d` (or `--profile named`) |
| Stop it | `docker compose --profile quick down` (same profile as the start) |
| The game's log | `docker compose logs -f game` (Ctrl+C to leave) |
| Is it up? | `docker compose ps`; <http://localhost:2567/health> answers `{"ok":true,…}` |
| Which version is running | `docker image inspect ghcr.io/nathanprovin/panspermia:latest --format "{{.Created}}"` |
| Update now (not wait 5 min) | `docker compose pull game; docker compose up -d game` |
| Change `MAX_ROOMS` | edit `.env`, then `docker compose up -d game` |

- **Updates are automatic.** You push to `master` → tests → a new image → within 5 minutes the updater restarts the
  game with it. Players' tabs show "Server updating…" and reload. Every update restarts the pond, so prefer working on
  a branch and merging into `master` when it's worth a restart.
- **The Hall of Fame** lives in the Docker volume `panspermia_hall`. It survives updates, restarts and `down`; only
  `down -v` deletes it. To back it up:

  ```powershell
  docker run --rm -v panspermia_hall:/data -v ${PWD}:/backup alpine cp /data/hall.db /backup/hall.db
  ```

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `docker compose pull` says *denied* or *unauthorized* | The package is still private: redo step 2.3. |
| The page says "The pond is full" | `MAX_ROOMS` rooms are full (50 players each): raise it in `.env` if the CPU keeps up. |
| The game doesn't update after a push | Check the push's **image** job is green in *Actions*, then `docker compose logs updater`. |
| `quick` shows no address | `docker compose logs quick` again after 10 s; check the PC is online. |
| The tunnel is *Down* in the Cloudflare dashboard | Check `docker compose logs named`: usually a wrong or regenerated `TUNNEL_TOKEN`. |
| Docker Desktop won't start | Reboot; check virtualisation is on (step 1.2); in PowerShell as admin: `wsl --update`. |

---

## What protects your home network

- No port is opened on the router. The tunnel dials out to Cloudflare, and players reach the game through Cloudflare.
  They never see your IP.
- The game listens only on the gaming PC itself (`127.0.0.1:2567`), never on the home network.
- The game runs as an unprivileged user inside its container, with dev cheats off.
- The updater needs Docker's control socket to restart the game. It only pulls the image from your own repository,
  and only CI, after the tests pass, can publish to it.
