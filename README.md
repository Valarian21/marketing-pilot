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

## Analyse (Shot 1)

`POST /api/mp/projects/:id/analysis/run` startet die Pipeline Crawl → Brief → Wettbewerber →
Personas → Attention Map → GEO-Baseline; `{ "from": "geo" }` wiederholt nur ab einem Schritt.
Fortschritt und Ergebnis: `GET …/analysis`, UI unter `/mp/projects/:id/analysis`. Jeder Schritt
ist ein Eintrag in `mp_agent_runs` (Seite „Aktivität“). Brief-Änderungen im UI werden als
„vom Nutzer korrigiert“ gespeichert; „Brief bestätigen“ schaltet die Strategie-Stufe frei.
Websuche: `MP_SEARCH_PROVIDER=brave|serper` + Key, sonst DuckDuckGo-HTML. GEO-Engines:
`MP_GEO_MODELS` (Komma-Liste von OpenRouter-IDs).

## Strategie, Aufgaben, Timeline (Shot 2)

`POST …/strategy/run` (`{note?}`) erzeugt eine neue Planversion (Diff zur vorherigen) und die
Aufgaben der ersten 4 Wochen; `POST …/tasks/generate` nur die Aufgaben. Aufgaben: `POST …/tasks`,
`PATCH/DELETE /api/mp/tasks/:id`, `POST …/tasks/reorder`, `POST /api/mp/tasks/:id/execute`
(Agent-Aufgabe → ContentPiece in Freigabe). `GET …/timeline` liefert 12 Wochen je Kanal,
`GET /api/mp/overview` die Projektkarten. Freigabe-Regeln werden serverseitig erzwungen.

## Content Studio (Shot 3)

`/mp/projects/:id/studio`: Brand-Kit aus der Website (`POST …/brandkit/extract`), Voice-Profil aus
eigenen Texten (`POST …/voice/samples`, `POST …/voice/derive`), Entwürfe je Format
(`POST …/content` mit `{format, platform?, topic, hint, template?, articleKind?, directory?}`),
Directory-Einträge (`POST …/directories/:slug/prepare`), GEO-Artikel mit HTML-Export
(`GET /content/:id/export.html`). Jeder Text läuft durch den AI-Tell-Prüfer; Bilder werden als
KI-generiert gekennzeichnet. Freigabe unter `/review`, Publish-Paket unter `/publish/:pieceId`
(`GET /content/:id/package`). Postiz: `MP_PUBLISH_PROVIDER=postiz` + `POSTIZ_API_URL/KEY`.

## Video-Fabrik (Shot 4)

Zwei Prozesse: die API (`app-marketing-pilot`) stellt Render-Jobs in `mp_jobs` ein, der Worker
(`app-marketing-pilot-worker`, `deploy/app-marketing-pilot-worker.service`, Start lokal:
`node dist/server/src/server/worker.js`) nimmt Aufnahme (Playwright), Voiceover (ElevenLabs),
Overlays und ffmpeg-Schnitt. Konfiguration: `MP_DEMO_BASE_URL`, `MP_DEMO_USER`, `MP_DEMO_PASSWORD`,
`MP_DEMO_RESET_URL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`; Musik nach `assets/music/`.
API: `POST …/video/script`, `PUT /content/:id/script`, `POST /content/:id/video/render`
(`{variants, landscape}`), `GET /jobs/:id`. UI: `/mp/projects/:id/studio/video`.

## Community, Insights, Wochen-Loop (Shot 5)

`GET/PUT …/community/sources`, `POST …/community/scan` (Job), `PATCH /api/mp/community/:id`;
`POST /api/mp/events` (öffentlich, Bearer `MP_EVENTS_TOKEN`), `GET …/insights`, `GET …/insights/snippet`;
`GET …/reports`, `POST …/reports/run`, `POST /api/mp/reports/:id/adopt|dismiss`. Der Worker plant
Radar (täglich), GEO-Messung (wöchentlich) und Report (sonntags) selbst (`MP_SCHEDULER=false` schaltet ab).

## Extraktion auf eigene Domain

Das Paket ist heute ein eigener Prozess; „extrahieren“ heißt nur: anders erreichbar machen.

1. **Repo trennen** (optional): `git subtree split -P marketing-pilot -b marketing-pilot` und in ein
   neues Repo pushen; `pnpm install && pnpm build` dort. Nichts im Code verweist auf das Dashboard-Repo
   außer dem Standardpfad zum JWT-Secret (nur im Dashboard-Modus benutzt).
2. **Standalone-Modus** in `.env`: `MP_STANDALONE=true`, `MP_STANDALONE_USER`, `MP_STANDALONE_PASSWORD`,
   `MP_PUBLIC_BASE=https://marketing.example.com`, `MP_DATA_DIR` auf ein persistentes Verzeichnis.
   `MP_HOST_*`-Variablen entfallen.
3. **Daten mitnehmen**: `data/` (mp.db, assets, session_secret.txt) kopieren – SQLite-Datei plus
   Ordner, keine Migration nötig (läuft beim Start).
4. **Dienste**: beide Units (`deploy/*.service`) mit neuem `WorkingDirectory` installieren; Worker
   braucht Playwright-Browser (`pnpm exec playwright install chromium`) und ffmpeg.
5. **nginx**: ein Server-Block für die neue Domain, `location / { proxy_pass http://127.0.0.1:8105; }`
   (der Dienst leitet `/` auf `/mp/`). Certbot für TLS. Alte Locations `/mp/` und `/api/mp/` im
   Dashboard-Block entfernen, Sidebar-Link im Dashboard auf die neue URL zeigen lassen.
6. **Webhook-URL** in deinem Produkt und im Landingpage-Snippet auf `https://marketing.example.com/api/mp/events`
   umstellen (das Snippet aus `/insights` neu kopieren – es enthält die URL).
7. Prüfen: `/api/mp/health` → `mode: standalone`; Login mit dem Standalone-Konto; ein Test-Render.

## Freigabe-Stufen und Kennzeichnung

Jede Aktion mit Außenwirkung trägt `auto | review | human_only` (Default `review`;
`human_only` fest für Reddit, Foren, Discord, Ad-Budgets). Freigaben landen mit Nutzer,
Zeit und Inhalt in `mp_audit_log`; jeder Modellaufruf in `mp_agent_runs` (Seite „Aktivität“).
Engagement-Automatisierung (Follows, Likes, DMs, Massen-Kommentare) ist ausgeschlossen.
