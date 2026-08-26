# Entscheidungen (laufend)

Format: Datum · Entscheidung · Grund · Alternative, die verworfen wurde.

## 2026-08-26 (Shot 0)

- **Eigener Node-Dienst statt Modul in `main.py`.** Grund: Host-Regel „nie wieder in main.py“, Plan verlangt TS/Zod/Playwright/Remotion. Verworfen: Python-Paket mit FastAPI-Router (hätte Remotion/c2pa-node unmöglich gemacht) und Next.js (SSR unnötig für ein Admin-Tool hinter Login, deutlich mehr RAM auf dem VPS). Siehe `HOST.md`.
- **Stack:** Fastify 5 + `fastify-type-provider-zod` (Zod 4 an jeder Grenze), better-sqlite3 + Drizzle ORM (SQL-Migrationen im Repo, automatisch beim Start), Vite 7 + React 19 + react-router 7 als SPA unter `/mp/`, Vitest, ESLint 9, TypeScript strict. Alle Bibliotheken > 1 Jahr alt und breit genutzt.
- **Paketort `marketing-pilot/` im Repo-Wurzelverzeichnis** (Plan) statt `services/marketing-pilot/` (Repo-Konvention). Grund: Plan und Nutzeranweisung nennen den Pfad explizit; alle Folge-Sessions suchen dort. Der systemd-Service folgt trotzdem der `app-<slug>`-Konvention.
- **Eigene Datenbank `marketing-pilot/data/mp.db`** statt `mp_`-Tabellen in `empire.db`. Grund: Isolationsregel des VPS (eine SQLite-Datei pro schreibendem Prozess), keine Rückfrage an den Host nötig, Backup über bestehendes `backups`-Muster ergänzbar. Der `mp_`-Präfix bleibt, damit ein späteres Zusammenlegen möglich wäre.
- **Auth im Dashboard-Modus:** Dashboard-JWT wird lokal verifiziert (Secret-Datei nur gelesen). Bearer aus `localStorage.empire_token` (gleiche Origin) *und* Cookie `empire_session` werden akzeptiert. `typ=ws` → 401, wie im Host.
- **Standalone-Auth:** ein Admin-Login aus `.env`, HS256-Session (12 h) als httpOnly-Cookie `mp_session` + Bearer. Keine Nutzerverwaltung — kommt erst, wenn das Tool wirklich für Dritte läuft.
- **Kein Proxy durch `main.py`.** nginx leitet `/mp/` und `/api/mp/` direkt auf 8105 (Muster Atemzug/Date). Dashboard-Neustarts berühren Marketing Pilot nicht.
- **Modell-Defaults** in `config/models.ts`: `anthropic/claude-sonnet-4.5` (stark), `google/gemini-2.5-flash` (günstig) — die IDs, die das Dashboard heute nachweislich über OpenRouter nutzt. Über `MP_MODEL_*` überschreibbar. Vor Shot 1 gegen die aktuelle OpenRouter-Liste prüfen.
- **Sprache:** Code + Kommentare Englisch (Plan-Vorgabe für dieses Paket, überschreibt CLAUDE.md), UI Deutsch, Commit-Messages Deutsch (Repo-Konvention).
- **Migration nicht umbenannt** (`0000_jittery_argent.sql`, Drizzle-Zufallsname) — der Name steht in `meta/_journal.json`; Umbenennen bringt nichts und riskiert Inkonsistenz.
- **Zod-Domänenschemas liegen in `src/shared/`** und werden von Server und Client importiert; Client-Typen sind damit nie „ungefähr“.

## 2026-08-26 (nach Shot 0, Rückmeldung Marcel)

- **Eigener OpenRouter-Key** für Marketing Pilot in `.env` (nicht der Dashboard-Key). Kostenerfassung damit sauber getrennt.
- **Test-Projekt-URL ist nicht lehreule.de** (anderes Projekt, Marcels Vorgabe), sondern vorerst der Platzhalter `https://agi-empire.com/marketing-pilot`. Achtung: die Adresse liegt hinter dem Login – für einen aussagekräftigen Analyse-Lauf braucht es eine öffentliche Produktseite.
- **Sprechende Adresse** `agi-empire.com/marketing-pilot` → 301 auf `/mp/` (Plan-Routen bleiben `/mp/*` und `/api/mp/*`). Sidebar-Link öffnet in neuem Tab (eigener Bereich „Marketing“).
- **Weitere KI-APIs** (Suche, Bild, Video …) dürfen bei Bedarf dazukommen – Marcel hat das ausdrücklich freigegeben; genannt wird trotzdem, was und warum.

## 2026-08-26 (Shot 1)

- **Crawler mit Playwright statt reinem fetch**: viele SaaS-Seiten rendern client-seitig; Browser-Builds liegen ohnehin auf dem VPS (`~/.cache/ms-playwright`, Version 1.62.1 wie `services/browser_render`). Wettbewerber- und Review-Seiten werden dagegen nur per `fetch` gelesen (schnell, kein Browser je Seite).
- **Keine HTML-Parser-Bibliothek** (cheerio o. ä.): Text-Extraktion, `<title>`, robots.txt und die DuckDuckGo-Ergebnisliste sind mit wenigen Regex-Zeilen abgedeckt und getestet. Wechsel auf eine Such-API bleibt ein `.env`-Eintrag.
- **GEO-Bewertung durch ein günstiges Richter-Modell** (eine Bewertung je Frage über alle Engines), nicht per Regex: Produktnennungen sind oft umschrieben („das Tool von …“); der Richter liefert auch Position und genannte Wettbewerber.
- **Fehlgeschlagene GEO-Aufrufe zählen nicht** in die Sichtbarkeit (werden im Schritt-Summary ausgewiesen), sonst würde ein Engine-Ausfall wie „nicht genannt“ aussehen.
- **Neuer Analyse-Lauf setzt Brief-Korrekturen zurück**; das UI fragt vorher nach. Teil-Neuläufe (`from`) lassen frühere Ergebnisse stehen.
- **Prompts auf Englisch, Ausgabe in Produktsprache**: Modelle folgen englischen Anweisungen zuverlässiger; das Ergebnisfeld-Text ist Deutsch, wenn das Produkt deutsch ist.
- **Screenshots/Assets bekommen `projectId`** (nullable `contentPieceId`) – Crawl-Assets gehören zum Projekt, nicht zu einem Content-Stück. Drizzle baute dafür `mp_assets` neu auf; die generierte `INSERT … SELECT` wurde manuell korrigiert (alte Tabelle hatte kein `project_id`).

## 2026-08-26 (Shot 2)

- **Freigabe-Regeln werden serverseitig erzwungen** (`enforceApproval`), nicht nur im Prompt: was das Modell auch zuweist, Veröffentlichen/Ads landen beim Menschen, Reddit/Foren/Discord/Ads sind `human_only`. Gilt für generierte, manuell angelegte und bearbeitete Aufgaben.
- **Plan-Diff ist fachlich, nicht textuell**: Kanäle nach Plattform, Ziele nach Horizont, Budgetposten nach Name. Ein generischer JSON-Diff wäre für Marcel unlesbar.
- **Task-Neuerzeugung ersetzt nur `todo`**: angefangene, in Freigabe befindliche oder erledigte Aufgaben überleben eine neue Planversion.
- **„Jetzt ausführen“ läuft synchron** (ein Modellaufruf, ~10–30 s, nginx-Timeout 600 s); Strategie-Lauf (2 Aufrufe, bis ~2 min) läuft losgelöst mit Polling wie die Analyse.
- **Timeline-Woche kommt aus `dueAt`** relativ zum Plan-Startdatum, Fallback `week`. Zeilen = Plan-Kanäle ∪ Kanäle aus Aufgaben/Stücken; „Allgemein“ für kanalübergreifende Aufgaben.
- **Freigabe-Seite ist in Shot 2 bewusst minimal** (Text + drei Buttons), damit „Jetzt ausführen“ ein Ziel hat; Plattform-Vorschau, Neu-Generieren und Publish-Paket kommen in Shot 3.
- **Globale Nav-Einträge sind projektbezogen** (`ProjectScoped`): zuletzt genutztes Projekt aus `localStorage`, sonst Auswahlliste – statt leerer Seiten.

## 2026-08-26 (Shot 3)

- **Kein c2pa-node**: das Paket zieht einen nativen Rust-Build nach sich, den dieser VPS-Deploy (pnpm + prebuilt binaries) nicht sauber trägt. Stattdessen der vom Plan erlaubte Fallback: `AI-generated: true`-Textchunk + XMP (IPTC `DigitalSourceType = trainedAlgorithmicMedia`) in jedem PNG, Hinweis im Publish-Paket. Ein späterer Wechsel betrifft nur `util/png.ts`.
- **Rendering per Playwright + HTML-Templates** statt Canvas/Sharp: Templates nutzen dieselben Tokens/Schriften wie das UI, Screenshots lassen sich als `<img>` einbetten, keine weitere native Abhängigkeit. Bildskalierung für Directory-Größen läuft ebenfalls über ein HTML-Frame.
- **Bildmodell über OpenRouter `modalities: ["image"]`** hinter `ImageProvider`; Default `google/gemini-2.5-flash-image-preview` (`MP_MODEL_IMAGE`). Bilder nur für Hintergründe/Thumbnails – der Prompt verbietet Text, UI-Mockups und Gesichter.
- **Kritiker-Schwelle 7/10, max. 2 Runden** (Plan); bei Carousel/Pin/Artikel nur 1 Runde, weil die Struktur (Slides, Tabellen) beim Umschreiben leidet.
- **Regenerieren behält die Stück-ID** (Verlauf in Audit + Aufgaben-`outputRefs` bleibt gültig), löscht alte Assets und setzt `humanEdited` zurück.
- **Markdown-Renderer selbst geschrieben** (`shared/markdown.ts`, ~60 Zeilen) statt `marked`/`remark`: nur Überschriften, Absätze, Listen, Tabellen, Links, Code – reicht für Artikel und Vorschau, keine Sanitizer-Fragen, da nur eigene Modellausgabe gerendert wird.
- **Postiz** optional; nur Text wird geplant (Bilder bleiben im manuellen Paket), weil der Upload-Pfad der Postiz-API je Version variiert.
