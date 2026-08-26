# Host-Analyse: AI-Empire-Dashboard (Stand 2026-08-26)

| Aspekt | Befund |
|---|---|
| Framework | **Python 3.12 / FastAPI**, eine Monolith-Datei `dashboard/backend/main.py` (~14.900 Zeilen), gestartet als root-Service `ai-empire-dashboard` auf Port 8000. |
| Router | Kein Frontend-Framework: eine `dashboard/frontend/index.html` (~12.000 Zeilen, Inline-CSS/JS), `showPage()`/`routeTo()` als History-API-Router, `PAGE_SLUG`-Tabelle; SPA-Catch-All in `main.py` liefert `index.html` für unbekannte Pfade. |
| Auth | HS256-JWT (`python-jose`), Secret in `dashboard/data/jwt_secret.txt` (Datei, 0600, Besitzer `developer`), Claims `sub`=Benutzername, `exp` 8 h. `AuthMiddleware` verlangt Bearer für `/api/*`, spiegelt Admin-Token als httpOnly-Cookie `empire_session`; Frontend hält das Token in `localStorage.empire_token`. Externe Lehreule-Tokens tragen `typ="ws"` und dürfen nur an `/api/ws/*`. |
| DB / ORM | Rohes `sqlite3` ohne ORM, `dashboard/data/empire.db` (~55 Tabellen), Schema per `CREATE TABLE IF NOT EXISTS` + additive Migrationen in `_run_migrations()`. |
| Styling | Eigenes Inline-CSS mit CSS-Variablen, **kein Tailwind**, kein Build-Schritt, keine Module. |
| Build/Deploy | Kein Build, kein Linter, keine Tests. Deploy = Git-Checkout ist Produktion (`/root/ai_empire` → Symlink hierher) + `systemctl restart`. Einziger statischer Check: `pyflakes main.py`. |
| Tooling auf dem VPS | Node 22.22, corepack/pnpm 11, Python 3.12, ffmpeg, Google Chrome, Playwright-Chromium-Builds (`~/.cache/ms-playwright`), gcc/make. 12 GB RAM, 149 GB frei. |
| Ordnerkonvention für Nebendienste | `docs/vps_isolation.md`: **jede App mit serverseitiger Logik bekommt einen eigenen Prozess, eigene DB, eigenen Port (ab 8101), systemd `app-<slug>`, nur 127.0.0.1**, nginx-Location auf `agi-empire.com/<slug>/` oder Dashboard-Proxy. Beispiele im Repo: `services/quant_lab` (Python, 8104, Dashboard-Proxy `/api/quant/*`), `services/browser_render` (Node, 8600). Außerhalb des Repos: Atemzug 8102, Binderplan 8103, Date 8101. Belegt: 8000, 8100–8104, 8600. |
| Explizite Regel | CLAUDE.md: „sobald eine App User-Accounts, Zahlungen oder serverseitige Logik hat, bekommt sie einen eigenen Service. **Nie wieder in `main.py` einbauen.**“ |

## Entscheidung: Einhängung

Marketing Pilot läuft als **eigener Node/TypeScript-Dienst** (`app-marketing-pilot`, Port **8105**, User `developer`, Paket `marketing-pilot/` in diesem Repo), den nginx unter `agi-empire.com/mp/` und `/api/mp/` direkt erreicht; im Dashboard gibt es nur einen Sidebar-Link. Erstens verbietet die Host-Konvention ausdrücklich neuen Code in `main.py`, und der Plan verlangt TypeScript strict, Zod, Playwright, Remotion und c2pa-node — alles Node-Ökosystem, das in einer Python-Monolith-Datei nicht sauber lebt. Zweitens ist die Auth-Kopplung minimal und bewährt: wie der Lehreule-Service prüft der Dashboard-Adapter das Host-JWT selbst (dieselbe Secret-Datei, nur lesend, `typ=ws` abgelehnt) aus Bearer *oder* Cookie `empire_session`, sodass am Host weder Auth noch DB angefasst werden. Drittens ist damit die spätere Extraktion trivial: dieselbe URL-Struktur `/mp/*` + `/api/mp/*` läuft mit `MP_STANDALONE=true` unverändert hinter einer eigenen Domain — nur der nginx-Block wandert.
