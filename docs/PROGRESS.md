# Fortschritt

Immer zuerst `MARKETING_PILOT_PLAN.md` lesen, dann diese Datei.

## Shot 0 – Discovery und Gerüst: **fertig** (2026-08-26)

Erledigt:
- Host analysiert → `docs/HOST.md`; Stack-Entscheidung → `docs/DECISIONS.md`.
- Paket `marketing-pilot/` (Node 22, pnpm, TypeScript strict): Fastify-API unter `/api/mp/*`, React-SPA unter `/mp/*`, Drizzle-Schema mit allen `mp_`-Tabellen des Domänenmodells (+ `mp_settings`), Migration `0000`.
- `src/host-adapter.ts` (Interface) + `host-adapter.dashboard.ts` + `host-adapter.standalone.ts`; Umschaltung per `MP_STANDALONE`.
- Projekte anlegen/lesen/ändern/löschen (API + UI), Audit-Log-Einträge, Aktivitätsseite (Läufe + Audit), Einstellungsseite (Provider-Status ohne Schlüssel).
- Lese-Endpunkte aller Domänen (liefern `[]`), Schreibpfade der späteren Shots als explizite 501 mit Shot-Nummer.
- `tokens.css` (Theme Gewächshaus, Light/Dark) übernommen, gesamtes UI nur über Tokens.
- `pnpm lint && pnpm typecheck && pnpm test` grün (12 Tests), `pnpm build` ok.
- Betrieb: systemd `app-marketing-pilot` (8105, developer), nginx `/mp/` + `/api/mp/` → 8105, Sidebar-Link „Marketing Pilot“ im Dashboard.

Offen / zu klären (siehe Zusammenfassung Shot 0):
- OpenRouter-Key in `marketing-pilot/.env` eintragen (`OPENROUTER_API_KEY`), `MP_TEST_PROJECT_URL` prüfen.
- Modell-IDs in `config/models.ts` vor Shot 1 gegen OpenRouter prüfen.
- ~~`mp.db` in `scripts/backup.sh` aufnehmen~~ → erledigt in Shot 0.

## Shot 1 – Analyse-Agent: **fertig** (2026-08-26)

Live-Test gegen Platzhalter `https://agi-empire.com/marketing-pilot` (liegt hinter dem Login → nur Login-Seite crawlbar): alle 6 Schritte durchgelaufen, 0,86 $ (GEO 0,51 $ für 25 Fragen × 4 Engines), 10 Wettbewerber mit 45 belegten Beschwerden, 4 Personas, 8 Kanäle, GEO-Sichtbarkeit 0 %. Inhaltlich wertlos (Modelle haben „Marketing-Automation“ aus dem Namen abgeleitet) – Brief-Prompt danach geschärft: bei Login-/Platzhalterseiten wird das gesagt statt geraten. **Für einen echten Lauf braucht es eine öffentliche Produkt-URL von Marcel.**

Erledigt:
- Pipeline `src/server/agents/analysis/` (crawl → brief → competitors → personas → attention → geo), Orchestrierung in `pipeline.ts` (eine `mp_analysis_runs`-Zeile je Lauf, ein `mp_agent_runs`-Eintrag je Schritt mit Tokens/Kosten aus der OpenRouter-Antwort). Läuft losgelöst vom Request, UI pollt alle 3 s. Läufe, die ein Neustart abbricht, werden beim Start als fehlgeschlagen markiert.
- Crawler (Playwright, max. 40 Seiten, robots.txt, Prioritäten Pricing/Features/Docs/Changelog, App-Store-Seiten + GitHub-README, 5 Screenshots als `mp_assets`), Texte in `mp_pages`.
- Provider: `OpenRouterProvider` (Kosten aus `usage.cost`, Retry bei 429/5xx), Suche `brave|serper|duckduckgo-html` (Fallback ohne Key), HTML/robots-Helfer ohne Zusatzbibliotheken.
- Prompts als reine Funktionen in `agents/prompts/analysis.ts` (Snapshot-Tests in `tests/__snapshots__`).
- API: `POST …/analysis/run` (`{from?}` für Teil-Neuläufe), `GET …/analysis` (Gesamtsicht), `PATCH …/brief` (markiert `userEdited` + Felder), `POST …/brief/confirm` (schaltet Strategie frei, Projekt → aktiv), `GET /api/mp/assets/:id/file`.
- UI `/mp/projects/:id/analysis`: Fortschritt je Schritt (mit „ab hier neu“), Brief inline editierbar (Speichern bei Verlassen des Feldes, Pille „vom Nutzer korrigiert“), Screenshots, Wettbewerber mit belegten Beschwerden, Personas als Karten, Attention Map als Rangliste, GEO-Tabelle mit Modellfilter, „Brief bestätigen“.
- 30 Tests grün (Pipeline End-to-End mit Fake-LLM/-Suche/-Crawler).

Offen:
- **Echte Produkt-URL** für einen aussagekräftigen Lauf (Platzhalter `agi-empire.com/marketing-pilot` liegt hinter dem Login).
- Such-API (Brave/Serper) eintragen, sobald DuckDuckGo-HTML zu dünn ist (`MP_SEARCH_PROVIDER`, `MP_SEARCH_API_KEY`).
## Shot 2 – Strategie, Aufgaben, Timeline: **gebaut** (2026-08-26)

Erledigt:
- Strategie-Agent `agents/strategy/plan.ts`: liest bestätigten Brief, Personas, Attention Map, Wettbewerber, GEO-Zusammenfassung → `StrategyPlan` (2–3 Startkanäle mit Format/Kadenz/Begründung+Bezug, 30/60/90-Tage-Ziele nur mit Geschäftszahlen, Testbudget ≤ 300 €, Kernbotschaft, Risiken). Versioniert in `mp_strategy_plans`, jede Version mit `diff` zur vorherigen (Kanäle, Ziele, Budget, Summary). „Plan anpassen“ mit Hinweis erzeugt neue Version.
- Aufgaben-Generator: 4 Wochen, `mp_tasks` mit `week`, `channel`, `planVersion`, `dueAt` = Startdatum + Woche/Tag. Server erzwingt Freigabe-Regeln (`enforceApproval`): publish/ads → Mensch; Reddit/Foren/Discord/Ads → `human_only`. Neu-Erzeugung ersetzt nur unangetastete `todo`-Aufgaben.
- „Jetzt ausführen“ (`agents/strategy/execute.ts`): Agent-Aufgabe → `ContentPiece` (Format aus Typ/Titel abgeleitet) mit Status `review`, Aufgabe → `review`, `outputRefs`. Schreibregeln zentral in `agents/prompts/voice.ts` (Verbotsliste, Community-Regeln).
- API: `GET/POST …/strategy`, `…/strategy/versions/:v`, `…/tasks/generate`, Tasks CRUD + `reorder` + `execute`, `GET …/timeline`, `GET /api/mp/overview`, `GET/PATCH /api/mp/content/:id` (Freigabe/Ablehnung/veröffentlicht mit Audit inkl. Inhalt).
- UI: Projekt-Subnavigation (Übersicht · Analyse · Strategie · Aufgaben · Timeline · Freigaben); `/strategy` (Plan, aufklappbare Begründungen, Versionswahl mit Diff), `/tasks` (nach Woche, runde Checkbox, Drag-Sortierung je Woche, Filter Typ/Zuständig, Fortschritt je Woche, „Jetzt ausführen“, manuelle Aufgabe), `/timeline` (12 Wochen, Kanäle als Zeilen, gefüllt = veröffentlicht, gestrichelt = geplant, Heute-Spalte, Detail-Drawer, scrollt im Container), `/review` (Vorstufe: Text editierbar, Freigeben/Ablehnen/veröffentlicht), Übersicht mit echten Kennzahlen (`/overview`). Globale Nav-Einträge springen zum zuletzt genutzten Projekt.
- 38 Tests grün.

Offen: Ist-Daten in der Timeline (Insights) kommen mit Shot 5; Live-Test siehe Zusammenfassung.
## Shot 3 – Content Studio: **gebaut** (2026-08-26)

Erledigt:
- **Brand-Kit** (`agents/studio/brandkit.ts`): Farben (gewichtete Häufigkeit + Button-Farben + `theme-color`), Logo (Header-Bild/og:image/Icon → als Asset gespeichert), Schriften per Playwright von der Website; Primärfarbe im UI wählbar.
- **Voice-Profil** (`agents/studio/voice.ts`): 5–20 eigene Texte im Brand-Kit (max. 30), Agent leitet Anrede, Satzlänge, Lieblingswörter, Humor, Einstiege, No-Gos und einen Prompt-Baustein ab; ohne Profil warnt das Studio sichtbar.
- **Schreibregeln** zentral in `agents/prompts/voice.ts` (Verbotsliste, Community-Regeln, Voice-Block) – in jedem Text-Prompt.
- **AI-Tell-Prüfer** (`agents/studio/critic.ts`): Score 0–10 gegen Verbotsliste + Voice-Profil, unter 7 automatische Überarbeitung (max. 2 Runden), Score + Protokoll am Stück.
- **Formate** (`agents/studio/generate.ts`): Text-Posts (X 280 / Threads 500 / Bluesky 300 / LinkedIn 3000 / Facebook 2000, Hashtag-Limit), Carousels (5 Token-Layouts, Playwright-Render 1080×1080 + 1080×1350, Produkt-Screenshots als Slides), Pinterest-Pins (1000×1500, UTM-Ziel-URL), Bilder/Ad-Hintergründe über `ImageProvider` (OpenRouter-Bildmodell, nie als Screenshot-Ersatz), Directory-Einträge (Tagline ≤ 60, Beschreibung in 3 Längen, Kategorien, Alternativen, erster Kommentar, Screenshots in den geforderten Größen; Liste in `config/directories.ts`, je Projekt über `PUT …/directories`), GEO-Artikel (Vergleich / Beste Tools / FAQ, Markdown + HTML-Export mit JSON-LD FAQPage + SoftwareApplication).
- **Kennzeichnung**: alle gerenderten/generierten PNGs bekommen `AI-generated: true` + XMP (IPTC DigitalSourceType) als PNG-Chunks (`util/png.ts`); Hinweis im Publish-Paket. c2pa-node bewusst nicht (native Rust-Build, siehe DECISIONS).
- **Freigabe-Queue** `/review`: Stücke nacheinander, Plattform-Vorschau (Post-Karte, Slides, Artikel-HTML), Text inline editierbar (`humanEdited`), Freigeben / Ablehnen mit Grund / Neu generieren mit Hinweis, AI-Tell-Protokoll.
- **Publish-Paket** `/publish/:pieceId`: Text kopieren, Assets laden, UTM-Link, Deep-Link zur Upload-Seite, „Als veröffentlicht markieren“ mit externer URL; Directory-Variante mit allen Feldern zum Kopieren + Abhaken; „Jetzt planen“ bei `MP_PUBLISH_PROVIDER=postiz`.
- API: `GET …/studio`, `POST …/brandkit/extract`, `PATCH …/brandkit`, `POST/DELETE …/voice/samples`, `POST …/voice/derive`, `POST …/content` (ContentRequest), `POST /content/:id/regenerate`, `GET /content/:id/package`, `POST /content/:id/schedule`, `GET /content/:id/export.html`, `GET/PUT …/directories`, `POST …/directories/:slug/prepare`.

Offen: Community-Antworten (Shot 5), Video (Shot 4); Voice-Profil braucht Marcels eigene Texte.
## Shot 4 – Video-Fabrik: offen
## Shot 5 – Community-Radar, Insights, Wochen-Loop: offen
