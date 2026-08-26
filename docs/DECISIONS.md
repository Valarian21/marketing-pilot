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

## 2026-08-26 (Shot 4)

- **ffmpeg statt Remotion**: Remotion hätte ein zweites Chrome, ein Webpack-Bundle und deutlich mehr RAM (der Dienst läuft mit 1–2 GB Deckel) gebraucht. Die Vorteile (React-Templates, Tokens) holt sich der ffmpeg-Weg über HTML-Overlays, die Playwright rendert – dieselben Token-Templates wie Carousel und Pin. Zoom, Auto-Cut und Captions sind ffmpeg-Filter (`zoompan`, `freezedetect`, `overlay … enable`).
- **Eigene Worker-Prozess statt BullMQ**: BullMQ braucht Redis; eine SQLite-Tabelle mit atomarem Claim reicht für einen Render zur Zeit und hält die Isolation (ein Prozess, eine DB). Der Worker hat einen eigenen Speicherdeckel, damit ein Render nie die API trifft.
- **Playwright `recordVideo` statt CDP-Screencast**: robust, keine Frame-Synchronisation nötig; Zeitstempel kommen aus der Wanduhr relativ zum Seitenstart (±200 ms), was für Zoom-Fenster von 1,6 s reicht.
- **Handy-Aufnahme mit `--force-device-scale-factor=3`**: Playwrights Recorder (und der CDP-Screencast) liefern bei emuliertem `deviceScaleFactor` nur CSS-Pixel (390 px in der Ecke eines 1170-px-Videos); CSS-`zoom` auf `html` ändert die Media-Queries nicht. Läuft Chromium selbst mit Skalierungsfaktor 3, ist das Video 1170×2532 in Gerätepixeln und die Seite sieht weiterhin 390 px. Getestet an lehreule.de.
- **Schnitt in drei Durchgängen**: ein einziger Filtergraph über die volle Aufnahme (mehrere `trim`-Zweige + 60 Endlos-Bildeingänge für Captions) wurde vom OOM-Killer bei 1,9 GB beendet. Jetzt: Szene per Input-Seeking vorschneiden, Segmente per Concat-Demuxer kopieren, Captions als Bildeingänge nur in ihrem Zeitfenster (`-itsoffset`/`-t`). Spitze ≈ 1,9 GB → Worker-Deckel 3 GB.
- **Login außerhalb der Aufnahme**: Anmeldung läuft in einem separaten Kontext, der `storageState` wird in den aufgezeichneten Kontext übernommen – Zugangsdaten erscheinen nie im Video.
- **Ohne ElevenLabs-Key trotzdem rendern**: Captions aus geschätztem Timing (≈ 2,6 Wörter/s), Hinweis am Stück. Sobald `ELEVENLABS_API_KEY`/`VOICE_ID` gesetzt sind, wird automatisch gesprochen.
- **Provenance im MP4** nur als Container-Metadaten (`comment=AI-generated: true`) – c2pa gilt wie bei den Bildern als offen (nativer Build).
- **Klick-Zoom pro Szene nur auf den ersten Klick**: mehrere Zooms pro 3–5-Sekunden-Szene wirken nervös.

## 2026-08-26 (Shot 5)

- **Reddit ohne OAuth-App trotzdem lauffähig**: die öffentlichen `.json`-Endpunkte funktionieren read-only mit User-Agent und langsamer Kadenz; mit `REDDIT_CLIENT_ID/SECRET` (Script-App) wechselt der Radar automatisch auf `oauth.reddit.com`. Nur lesen – es gibt keinen Code-Pfad, der postet.
- **Browser-Beacons ohne Token nur für `signup`**: das Landingpage-Snippet kann kein Geheimnis tragen; `activated`/`paid` müssen vom Produkt-Backend mit `MP_EVENTS_TOKEN` kommen. Herkunft (`via: browser|server`) steht am Event.
- **Wochen-Report ist ein Vorschlag, kein Auto-Update**: der Plan ändert sich erst, wenn Marcel „Übernehmen“ klickt; dann entstehen Planversion und Aufgaben der Folgewoche in einem Schritt.
- **Scheduler im Worker, nicht in der API**: der API-Prozess bleibt zustandslos; ein Neustart des Workers holt fällige Jobs sofort nach, Zeitstempel in `mp_settings` verhindern Doppelläufe.
- **Stücke ↔ Signups über `utm_content` = Stück-ID**: kein zusätzliches Tracking nötig, jeder UTM-Link aus dem Publish-Paket trägt die ID.
- **Reddit-Fallback über `new.rss`**: die JSON-Endpunkte antworten von der VPS-IP mit 403 („network policy“), der Atom-Feed `r/<sub>/new.rss` liefert mit Browser-User-Agent. Block-Seiten werden erkannt und im Job-Log genannt; `hot` bleibt gesperrt. Mit `REDDIT_CLIENT_ID/SECRET` läuft alles über `oauth.reddit.com` (inkl. Regeln).
