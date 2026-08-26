# Marketing Pilot

Agentisches Marketing-Tool für die eigenen SaaS-Produkte. Läuft als Modul im
AI-Empire-Dashboard (`agi-empire.com/mp/`) und ohne Codeänderung standalone.
Spezifikation: `../MARKETING_PILOT_PLAN.md`. Fortschritt: `docs/PROGRESS.md`.

## Architektur in einem Absatz

Ein Node-22-Prozess (Fastify) liefert die API unter `/api/mp/*` und die React-SPA
unter `/mp/*`. Daten liegen in `data/mp.db` (SQLite, Tabellen mit Präfix `mp_`,
Drizzle-Migrationen laufen beim Start). Alles, was vom Host kommt (Login, Zurück-Link),
geht durch `src/host-adapter.ts`; `MP_STANDALONE` wählt zwischen
`host-adapter.dashboard.ts` (Dashboard-JWT wird lokal geprüft) und
`host-adapter.standalone.ts` (eigener Login). LLM-Aufrufe nur über OpenRouter,
Modell je Aufgabe in `config/models.ts`. Warum so: `docs/HOST.md`, `docs/DECISIONS.md`.

## Voraussetzungen

Node ≥ 22.12, pnpm (via `corepack enable pnpm`), Chrome/Playwright-Browser und ffmpeg
sind auf dem VPS vorhanden. `pnpm install` baut `better-sqlite3` (vorkompiliert).

## Starten

```bash
cd marketing-pilot
cp .env.example .env && chmod 600 .env     # Werte eintragen
pnpm install
pnpm build                                 # Server (tsc) + Client (vite) nach dist/

# 1) Als Dashboard-Modul (Standard): prüft Dashboard-JWTs, Port 8105
pnpm start
# → http://127.0.0.1:8105/mp/  (in Produktion via nginx: https://agi-empire.com/mp/)

# 2) Standalone mit eigenem Login
MP_STANDALONE=true MP_STANDALONE_PASSWORD='geheim' MP_PORT=8106 pnpm start
# → http://127.0.0.1:8106/mp/  (Login: MP_STANDALONE_USER, Default „marcel")

# Entwicklung (API mit tsx-Watch + Vite-Dev-Server mit Proxy auf /api)
pnpm dev                                   # http://localhost:5173/mp/
```

Dashboard-Modus braucht Lesezugriff auf `../dashboard/data/jwt_secret.txt`
(oder `MP_HOST_JWT_SECRET`); der Login passiert im Dashboard, das Token kommt per
Cookie `empire_session` oder Bearer aus `localStorage.empire_token` mit.

## Qualität

```bash
pnpm lint && pnpm typecheck && pnpm test   # vor jedem Commit grün
```

Tests laufen gegen eine In-Memory-DB mit einem Fake-Host (`tests/helpers.ts`).

## Produktion auf dem VPS

- systemd: `deploy/app-marketing-pilot.service` → `/etc/systemd/system/`, User `developer`,
  `127.0.0.1:8105`, `MemoryMax=1G`. Neustart: `sudo systemctl restart app-marketing-pilot`.
- nginx: Block aus `deploy/nginx-mp.conf` in `sites-available/ai-empire` (Locations `/mp/`
  und `/api/mp/` → 8105). `/mp` ohne Slash leitet um.
- Dashboard: Sidebar-Link „Marketing Pilot“ (`data-ext`, kein SPA-Routing).
- Logs: `journalctl -u app-marketing-pilot -f`. Daten: `data/mp.db` (WAL) — in
  `scripts/backup.sh` aufnehmen.
- Deploy nach Codeänderung: `pnpm build && sudo systemctl restart app-marketing-pilot`.

## Ordner

```
config/models.ts        Modell-Routing (Env-überschreibbar)
src/host-adapter*.ts    Host-Schnittstelle + beide Implementierungen
src/shared/schemas.ts   Zod-Domänenmodell (Server + Client)
src/server/             Fastify-App, Routen, Drizzle-Schema + Migrationen, Provider-Interfaces
src/client/             React-SPA (Shell, Seiten), app.css nur mit Tokens
src/theme/tokens.css    Theme „Gewächshaus“ (Light/Dark) – einzige Farbquelle
tests/                  Vitest
deploy/                 systemd-Unit + nginx-Snippet
docs/                   HOST.md, DECISIONS.md, PROGRESS.md
data/                   mp.db, Session-Secret, Assets (gitignored)
```

## Freigabe-Stufen und Kennzeichnung

Jede Aktion mit Außenwirkung trägt `auto | review | human_only` (Default `review`;
`human_only` fest für Reddit, Foren, Discord, Ad-Budgets). Freigaben landen mit Nutzer,
Zeit und Inhalt in `mp_audit_log`; jeder Modellaufruf in `mp_agent_runs` (Seite „Aktivität“).
Engagement-Automatisierung (Follows, Likes, DMs, Massen-Kommentare) ist ausgeschlossen.
