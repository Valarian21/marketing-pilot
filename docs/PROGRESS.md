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

Live-Test an **Lehreule** (2026-08-26): Brand-Kit extrahiert (Palette #8B8199/#615572/#ECDCC8 …, Schriften Source Sans 3 + Nunito, Logo via og:image), LinkedIn-Post (AI-Tell 7/10, 13 s), Carousel „Klausur mit Erwartungshorizont“ (7 Slides × 2 Größen, echter Playwright-Render mit Produkt-Screenshot, 34 s), AlternativeTo-Eintrag (Tagline 58/60, 3 Screenshots 1280×800, Alternativen = die 6 analysierten Wettbewerber), Vergleichsartikel „Lehreule vs meinUnterricht“ (11.800 Zeichen, Tabelle, FAQPage + SoftwareApplication JSON-LD, HTML-Export). Gesamtkosten der Studio-Läufe ≈ 0,05 $. Gelernt: lange Artikel nicht als JSON-String anfordern (Escaping bricht) → jetzt Markdown + separates Meta-JSON; Consent-Banner vor Screenshots wegklicken.

Offen: Community-Antworten (Shot 5), Video (Shot 4); Voice-Profil braucht Marcels eigene Texte (Studio warnt so lange).
## Shot 4 – Video-Fabrik: **gebaut** (2026-08-26)

Erledigt:
- **Skript-Agent** (`agents/video/script.ts`, Prompt `prompts/video.ts`): Szenen mit Voiceover (max. 2 Sätze), UI-Aktionen (goto/click/type/scroll/hover/wait/press mit Text-Zielen oder Selektoren), Caption, Mindestdauer; 5 Hook-Varianten; CTA; Geräte. Als ContentPiece `video` (Entwurf), im UI komplett editierbar (`PUT /content/:id/script`).
- **Recording** (`agents/video/record.ts`): Playwright `recordVideo`, Mobile 390×844 @3× (1170×2532) oder Desktop 1440×900, Cursor-Overlay + Klick-Ripple per Init-Script, eased Mausbewegungen mit menschlichen Pausen, Ziel-Suche über Rolle/Text/Placeholder/Label/Selektor, Zeitstempel je Szene + Klickpunkte, Login außerhalb des aufgezeichneten Kontexts (`MP_DEMO_*`), Reset-Endpoint vorab, Fehler je Szene protokolliert statt Abbruch.
- **Voiceover** (`agents/video/voice.ts`): ElevenLabs `with-timestamps` → Wort-Timings; ohne Key geschätzte Timings (Video läuft trotzdem, Hinweis am Stück).
- **Assembly** (`agents/video/assemble.ts`, **ffmpeg statt Remotion**, siehe DECISIONS): Auto-Cut eingefrorener Strecken (freezedetect, > 1,8 s → 0,9 s), Letztes-Frame-Padding auf Voiceover-Länge, Zoom-in auf den Klickpunkt (zoompan), Concat, Hook-Karte 1,5 s, Geräterahmen + Hintergrund, Wort-Captions als transparente PNG-Overlays (aktives Wort hervorgehoben), Endcard 2,5 s, Musikbett aus `assets/music/` (-18 dB, Fade-out), H.264/AAC MP4 mit `AI-generated`-Metadaten, Thumbnail = Hook-Frame (PNG gekennzeichnet).
- **Varianten**: je Hook ein Reel (Standard 3) + ein Landscape-Schnitt 1920×1080 aus der Desktop-Aufnahme.
- **Job-Queue** (`jobs.ts`, Tabelle `mp_jobs`) + **Worker-Prozess** (`worker.ts`, systemd `app-marketing-pilot-worker`, MemoryMax 3G): API stellt ein, Worker rendert; Herzschlag in `mp_settings`, UI warnt, wenn der Worker steht; abgebrochene Jobs werden beim Neustart markiert.
- UI `/mp/projects/:id/studio/video`: Skript-Editor (Ziel, Geräte, CTA, Hooks, Szenen mit Aktionen), „Aufnehmen und rendern“, Fortschritt je Schritt, Galerie mit Playern; Freigabe zeigt Videos mit Player; Asset-Endpoint streamt mit Range-Requests.
- 57 Tests.

Live-Test an **Lehreule** (2026-08-26, ohne Demo-Login und ohne ElevenLabs-Key): Skript-Agent in 14 s (4 Szenen über die öffentliche Landingpage, 5 Hooks, CTA), Render-Job 260 s (Mobile + Desktop-Aufnahme 21 s, 111 Overlays, 2 Reels 1080×1920 + Landscape 1920×1080, je 27,6 s, H.264/AAC mit `AI-generated`-Metadaten, Thumbnails). Drei Live-Bugs behoben: ffmpeg-OOM (→ dreistufiger Schnitt), Mobile-Video nur in der Ecke (→ `--force-device-scale-factor=3`), Cookie-Banner im Bild (→ Consent-Dismiss beim Recording). Für Aufnahmen *in* der App fehlen `MP_DEMO_BASE_URL/USER/PASSWORD`, für Sprache `ELEVENLABS_API_KEY/VOICE_ID`.
## Shot 5 – Community-Radar, Insights, Wochen-Loop: **gebaut** (2026-08-26)

Erledigt:
- **Community-Radar** (`agents/community/radar.ts`): Quellen aus Personas/Attention Map abgeleitet (Subreddits, RSS-Feeds, Hacker News), je Projekt editierbar. Reddit über die offizielle OAuth-API (read-only, `REDDIT_CLIENT_ID/SECRET`) oder – ohne App – über die öffentlichen JSON-Endpunkte mit 2,5 s Abstand; HN über Algolia; Foren über RSS/Atom (eigener Mini-Parser). Threads werden gegen Persona-Schmerzpunkte gescort (0–100, günstiges Modell, Batches à 25); ab 60 entsteht ein `CommunityLead` mit Antwortentwurf nach den Schreibregeln, Subreddit-Regeln werden gelesen, zitiert und beachtet (kein Link bei Link-Verbot). Seite `/community`: Leads nach Score, Entwurf editierbar, „Kopieren und Thread öffnen“, „beantwortet“ mit URL. **Kein Posting eingebaut** (Test prüft, dass es keine Post-Route gibt). Täglicher Scan über den Scheduler.
- **Insights** (`agents/insights/insights.ts`): Webhook `POST /api/mp/events` (Bearer `MP_EVENTS_TOKEN`; Browser-Beacons ohne Token nur für `signup`), 1-KB-Snippet für die Landingpage (UTM 90 Tage im Cookie, `mpTrack("signup", userId)`), Seite `/insights`: Signups pro Woche/Kanal, beste/schwächste Stücke über `utm_content` = Stück-ID, GEO-Sichtbarkeit im Verlauf (wöchentliche Neu-Messung als Job `geo.measure`).
- **Wochen-Loop** (`agents/loop/weekly.ts`): Sonntags-Job sammelt Fakten der Woche (Signups, Kanäle, veröffentlichte Stücke, Aufgabenstand, beantwortete Leads, GEO) → Klartext-Report („Was lief / Was nicht / Nächste Woche anders“) + vorgeschlagene Planversion mit Diff. Karte auf der Übersicht; „Übernehmen“ erzeugt Planversion (`createdBy: weekly-loop`) und die Aufgaben der Folgewoche, „Verwerfen“ protokolliert.
- **Scheduler** im Worker (`scheduler.ts`): täglich Radar, wöchentlich GEO, sonntags ab 18 Uhr UTC Report – nur für Projekte mit bestätigtem Brief; Zeitstempel in `mp_settings`, kein Doppellauf.
- 67 Tests.

**Abschluss – End-to-End auf Lehreule** (2026-08-26): Analyse → Brief bestätigt → Strategie-Plan v1 (3 Startkanäle: r/lehrerzimmer, Instagram, Facebook-Gruppen; Ziele 150 Signups/30 T, Aktivierungen 60 T/90 T; 150 €) → LinkedIn-Post, Carousel, AlternativeTo-Eintrag, Vergleichsartikel (Studio) → Reel + Landscape (Landingpage) und App-Demo mit Login als Demo-Konto `marketing-pilot@example.com` (Werkbank, 3/5 Szenen sauber, 2 mit falsch geratenen Buttons – im Skript-Editor korrigierbar) → Publish-Paket (UTM, Deep-Link) → Signup über den Webhook (Browser-Beacon, `utm_source=linkedin`) → Insights zeigen ihn → Wochen-Report mit Plan-Vorschlag. Standalone-Start geprüft (`mode: standalone`, Login, `/mp/`). Gelernt: Aufgaben-/Report-Antworten brauchen 12–14k Output-Tokens (sonst abgeschnittenes JSON); Reddit sperrt `.json` von der VPS-IP (403) – Fallback auf `new.rss` mit Browser-UA, OAuth-App bleibt der saubere Weg.

## Nachbesserungen nach Marcels Feedback (2026-08-26, Abend)

- **ElevenLabs aktiv** (`ELEVENLABS_API_KEY/VOICE_ID` in `.env`): Voiceover mit Wort-Timings; Kosten werden aus Zeichen × `ELEVENLABS_USD_PER_1K_CHARS` (Default 0,22) geschätzt und je Szene als Lauf gebucht.
- **Kosten je Stück** über alle Anbieter: `mp_agent_runs` hat `piece_id` + `provider`; jedes Stück zeigt `costUsd` (Studio-Liste, Freigabe, Video-Seite, Aktivität mit 7-Tage-Summe und Anbieter-Split).
- **Änderungswunsch per Prompt** (`POST /content/:id/revise`, Box auf Freigabe- und Video-Seite): Text-Stücke werden gezielt editiert (nur das Genannte ändert sich), bei Videos wird das Skript angepasst – Zeitangaben („Sekunde 12–20“) werden über die gespeicherte Szenen-Zeitleiste auf Szenen gemappt; nur Text/Untertitel geändert → Re-Render **ohne neue Aufnahme** (Aufnahmen bleiben am Stück), Aktionen geändert → neue Aufnahme.
- **Szenen-Check** (neuer Job-Schritt `check`): pro Szene ein Screenshot an ein Vision-Modell – „passt das Bild zum Voiceover?“; Abweichungen (z. B. Tour über der App) landen in den Render-Hinweisen und im Skript-Editor, und fließen in Änderungswünsche ein. Willkommenstouren werden zusätzlich schon beim Login-Besuch weggeklickt; Scrollen läuft jetzt mit Easing in 40 kleinen Schritten.
- **Speicher-Tab** (`/storage`): freier Platz, Belegung von `data/`, Dateien je Projekt/Stück (Videos, Aufnahmen, Bilder) mit Größe; Löschen je Stück (Zwischendateien / Aufnahmen / alles), einzelne Assets, verwaiste Ordner. Zwischendateien (Segmente, Overlays) werden nach jedem Render automatisch entfernt.

### Nachbesserungen nach dem Live-Test (26.08., abends)

- Alte Render-Assets löschten die frisch gerenderten Dateien gleichen Pfads (Fix: nur Pfade
  entfernen, die kein neues Asset belegt).
- Worker-Heartbeat lief nur zwischen Jobs → UI meldete den Worker mitten im Render als tot.
- Recorder: fehlgeschlagenes `type`-Ziel fällt auf das erste sichtbare Textfeld zurück;
  Prompts verbieten erfundene CSS-Selektoren (der Agent hatte `input[name='topic']` erfunden).
- Szenenbilder aus dem webm statt `page.screenshot()` (Miniatur-Artefakt, s. DECISIONS).
- Live-Beispiel Änderungswunsch: „Es gibt keinen Button ‚Neu‘ – der Button heißt ‚Material
  erstellen‘ …“ → Skript in 23 s angepasst, Neuaufnahme automatisch, Szenen-Check danach 2/5
  statt 5/5 Abweichungen; zweite Anweisung korrigierte Szene 3.
- Recorder: Klick auf eine Feldbeschriftung ohne `<label for>` trifft jetzt das Feld darunter,
  `type` ohne Ziel schreibt ins fokussierte Feld (Revise-Skripte trennen gern click + type).
- **Offen (Skript-Entscheidung, nicht Code):** In Lehreule öffnet „Arbeitsblatt erstellen“ den
  Dialog „KI-Aktion bestätigen · 3 Credits“. Das Demo-Skript klickt ihn nicht weg, deshalb zeigen
  Szene 4/5 den Dialog statt des fertigen Blatts. Wer das echte Ergebnis im Video will, braucht
  einen Klick auf „Ja, 3 Credits nutzen“ + ~2 Min Wartezeit je Aufnahme (kostet Demo-Credits,
  Konto hat 12) – oder ein vorab erzeugtes Blatt, das Szene 5 per goto öffnet.

### Qualitätsrunde Video (26.08., spät)

- Ruckeln: zwei Ursachen behoben (30-fps-Schnitt einer 25-fps-Quelle; Wheel-Tick-Scrollen) → rAF-Scroll
  + 25 fps; Prompt-Regel „nur scrollen, wenn nötig“.
- Stimme: Modell/Settings per `.env`, Sprache fest, Satzkontext; Hörproben A–E an Marcel geschickt.
- Credits dürfen laut Marcel verbraucht werden: Demo-Skript bestätigt „Ja, 3 Credits nutzen“, wartet per
  `waitFor` auf „Drucken / als PDF“, Szene 5 zeigt das fertige Blatt; nur mobile Aufnahme (3 Credits je Render).
- „Neu generieren“ auf Video-Stück löschte alle Dateien → jetzt Render-Job.
- UI-Karte je Projekt aus den Aufnahmen; Prompts kennen `waitFor` und Bestätigungsdialoge.
- Recorder-Stalls: Aktionen dauerten 10–27 s (scrollIntoViewIfNeeded wartet auf „stabile“ Elemente;
  `networkidle` tritt in Lehreule nie ein). Jetzt JS-scrollIntoView + Deckel 1,5–2,5 s; Zielsuche
  ≤ 0,6 s (Probe). `waitFor` verlangt ein unverdecktes Ziel (Button hinter Overlay zählte als fertig).
- Marcel hat **eleven_v3** gewählt → Standard in `.env`; Hörproben unter `/mp/hoerproben/index.html`.
- Render-Optionen auf der Video-Seite: Reel-Anzahl, Landscape (Desktop-Aufnahme = doppelte Credits),
  „Aufnahme wiederverwenden“ (nur Stimme/Schnitt neu, keine Credits).
- Recorder-Tempo: Ursache ist die Kodierlast bei dpr 3 (ffmpeg 230 % CPU auf 6 Kernen), nicht die
  Zielsuche → mobile Aufnahme auf dpr 2 (780×1688). Messung steht aus, weil Lehreule seit ~20:10
  mit „OpenRouter-Guthaben aufgebraucht“ (Haupt-Key) nichts mehr generiert – Marcel lädt auf.
- **26.08., 21:46 – erster durchgängig stimmiger App-Demo-Render:** Credit-Dialog bestätigt, 78 s auf das
  fertige Blatt gewartet (herausgeschnitten), Szenen-Check 5/5, keine Warnungen, Reel 31 s, 25 fps. Aktionen
  mit dpr 2 halb so lang wie vorher (Hover 4 s, Klicks 5–10 s). Stück-Kosten kumuliert 0,82 $ (9 Renders).
- Medien-Übersicht (`/mp/media`), Zeitstempel (erstellt/bearbeitet/gerendert) und gruppierte Navigation.
- Offen/Ideen: Demo-Skript setzt Fach/Klasse nicht (Blatt wird „Deutsch Klasse 5“ statt Mathe 3); Lehreule-Tipp-
  Overlay im Editor („Alles auf dem Blatt lässt sich anpassen“) könnte per dismiss-Regel weg; Landscape
  kostet doppelte Credits (Schalter vorhanden).

### Design „Werkbank“ + Recorder-Feinschliff (26.08., Nacht)

- Design A aus dem Konzept-Artifact umgesetzt: `tokens.css` komplett neu (Palette, Schriften, Radien, keine
  Kartenschatten, Basisregeln am Dateiende), Sidebar mit Projektblock (aktuelles Projekt, Wechsler, „Alle“),
  gruppierte Navigation, Pills nur für Status, eckige Knöpfe. Screenshots geprüft: Projekt, Medien, Freigaben, Speicher.
- Recorder: Tipp-Overlays schließen, Klick-Pausen kürzer, Select per Option, Textfelder ersetzen statt anhängen,
  Zielsuche nur sichtbare Treffer + exakt vor lose (Probe: Fach → select#g-subject, Klasse → input#g-grade).
- Demo-Skript setzt Fach Mathematik / Klasse 3 / Thema „Einmaleins üben“ → Lehreule liefert ein 2-seitiges
  Mathe-Blatt (vorher: Mathe-Thema im Deutsch-Blatt, ⅓ Seite).
- 27.08. 00:30 – Render mit Fach Mathematik/Klasse 3: 2-seitiges Einmaleins-Blatt (98 % Füllung), Tipp-Overlay
  geschlossen, Szenen-Check 5/5, 0 Fehler. Lehren: `type` ohne Ziel nach Klick auf ein `<select>` (Fokus-Fallback
  kannte kein select); Tipp-Schließer muss versteckte „Tipp:“-Knoten ignorieren (33 im Lehreule-DOM).
- Smartphone-Mockup: Mitschnitt bekommt eine Rundeck-Alphamaske (alphamerge) und sitzt kleiner im Rahmen
  (880×1400 statt 940×1500), Rahmen 20 px statt 12 px – eckige Videoecken ragten an den runden Rahmenecken heraus.
  Geht per „Aufnahme wiederverwenden“ ohne Neuaufnahme.

### Stimme & Musik, Phase 1+2 (27.08.)

- Voiceover am Stück (ein Request, Pausen per Tag), Sprechregeln + v3-Audio-Tags im Skript-/Revise-Prompt,
  Untertitel ohne Tags, stille Szenenenden gekappt, Musik-Ducking, Musik-Schalter (keine/nur Landscape/alle).
- Platzhalter-Musikbett `assets/music/platzhalter-pad.mp3` (synthetisch, ersetzen!); MP3s dort sind gitignored.
- Hörprobe F (v3 mit Tags) unter `/mp/hoerproben/index.html`. Key-Rechte für Music-API fehlen (`music_generation`).
- Phase 3 offen: Lautheit −14 LUFS, UI-Sounds, Stabilität 0.3 vs 0.5 per Hörprobe.
- UI-Politur nach Sichtprüfung aller 15 Seiten: Knöpfe nie umbrechend (nowrap, 13 px), Video-Toolbar als eigene
  Optionszeile (Reels/Landscape/Musik/Aufnahme wiederverwenden, Primärknopf rechts), Szenenkarten kompakt (Feld-
  flex-basis wurde in Spaltenkarten zur Höhe), `waitFor` im Aktions-Dropdown, Studio-Reiter gestylt, Tabellen-
  überschriften/Zahlen/Daten ohne Umbruch, Aktivität einspaltig, Objekt-IDs gekürzt, Speicher-Formate lesbar.

## UX-Runde „Vom Stück zum Post“ (27.08.)

Gesamtanalyse aller 18 Seiten mit echten Lehreule-Daten: das System erzeugte viel, aber der Weg vom Stück zum Post lief
über vier Seiten ohne Verbindung – der Wochen-Report meldete „keine einzige geplante Aktion ausgeführt“. Fünf Pakete:

1. **Fehler**: Projekt-Übersicht zeigte fest 0/0/0 (jetzt `/overview`); UTM-Kampagne nahm den ersten Plan-Kanal
   (LinkedIn-Post trug `reddit-r-lehrerzimmer`) → Kampagne = Kanal des Stücks; Platzhalter-Titel („internal label“)
   → `saneTitle` nimmt die erste Textzeile; Timeline hatte doppelte Kanäle („Instagram“/„instagram“, „website“/
   „AlternativeTo“) → `canonicalChannel` in `src/shared/channels.ts`; „Jetzt ausführen“ erzeugte für Reel-Aufgaben
   einen Text → Dispatch nach Format (Video-Skript, Studio-Text/Carousel/Pin, sonst generische Notiz).
2. **Kanäle & Profile** (`GET/PUT /api/mp/projects/:id/profiles`, `mp_settings channels:<pid>`): je Plattform die
   eigene Seite (mehrere je Plattform erlaubt, z. B. Facebook-Gruppen). `<ChannelTag>` macht jeden Kanalnamen in
   Aufgaben, Timeline, Studio, Medien, Publish und Community-Quellen zum Link (neuer Tab); Subreddits werden aus dem
   Namen abgeleitet, ohne Profil öffnet die Plattform-Startseite.
3. **„Heute“-Cockpit** (`/projects/:id`, `GET …/today`): Freigeben · Posten (Text kopieren & Plattform öffnen) ·
   Antworten · Meine Aufgaben, dazu „Der Agent kann jetzt“ mit Alle-ausführen und Einrichtungs-Hinweise. Startseite
   springt ins Cockpit des zuletzt genutzten/einzigen Projekts (`/projects` bleibt die Liste). Aufgaben: laufende
   Woche aufgeklappt und markiert, andere eingeklappt; Publish-Aufgaben zeigen ihr Stück (`Task.link`, Heuristik in
   `today.ts`: eigenes Output, sonst neuester unveröffentlichter Entwurf gleichen Formats/Kanals, jeder Entwurf nur
   einer Aufgabe), Haken fragt nach der Post-URL und setzt das Stück auf veröffentlicht; „Im Studio erstellen“
   belegt Format/Plattform/Thema vor; Sidebar-Zähler für Freigaben und Aufgaben.
4. **Publish-Flow**: drei Schritte (Text kopieren → Plattform öffnen [kopiert automatisch] → fertig melden).
   **Kurzlinks** `mp_shortlinks` + `GET /go/:code` (öffentlich, nginx-Location `/go/` → 8105, 302 mit UTM, zählt
   Klicks): der Post trägt `agi-empire.com/go/xxxxxx` statt der 150-Zeichen-UTM-URL; Instagram/TikTok bekommen keinen
   Link im Text, sondern den „Link in Bio“-Hinweis. Insights zeigen Klicks je Stück.
5. **Politur**: Freigabe zeigt Reels mit Hook-Frame als Poster, Landscape eingeklappt, Video-Skript als Leseansicht,
   „Freigeben & posten“ springt ins Paket; Projekt-Reiter nur noch Heute · Analyse · Strategie (Rest ist in der
   Sidebar); „Stufe n“-Labels durch die Bereichsnamen ersetzt; Löschen-Knöpfe leise.

Nicht gebaut: Zusammenlegen von „produzieren“ + „posten“ zu einer Karte (Heuristik zu unsicher) – stattdessen zeigt
die Publish-Aufgabe ihr Stück. 82 Tests. Analyse-Test `runs all steps…` ist zeitabhängig flaky (409-Erwartung).

## Shot 6 – Produktdaten-Provider (Binderplan lesen, Preise sicherstellen): **fertig** (2026-08-31)

Erledigt:
- **Interface** `src/server/providers/product-data.ts`: `listSets`, `listEras`, `resolveSet`,
  `newestSets`, `topCards`, `priceMovers`, `cardImage`, `status`. Generisch – Lehreule bleibt
  ohne Datenquelle und alle brief-basierten Flows unverändert.
- **Ären-Logik** `providers/binderplan-eras.ts`: `AEREN`, `AERA_SERIEN`, `_aera_fuer_set` und
  `_aera_sql` aus Binderplans `main.py` (Zeilen ~60–137) nach TS übernommen, mit Quellenangabe im
  Kommentar. Getestet gegen feste Zuordnungen (`swsh`, `sv`, `col`→hgss) und über das Datum
  zugeschlagene Quer-Serien (McDonald's 2022 → swsh, POP 2005 → ex, Trainer-Kit 2010 → hgss).
- **Provider** `providers/product-data.binderplan.ts`: öffnet die Datenbank `readonly` +
  `fileMustExist`. Preisquellen werden zusammengeführt (Binderplans `card_prices` und unsere
  `mp_card_prices`, der frischere gewinnt); `priceBasis: "max"` nimmt die teurere von normal/holo
  und nennt die verwendete Variante mit.
- **Preis-Vollständigkeit**: neue Tabelle `mp_card_prices` (Migration `0009`). Fehlende und
  Preise älter als `MP_PRICE_MAX_AGE_HOURS` (72) werden von TCGdex nachgeladen – exakt Binderplans
  Schlüssel-Reihenfolge (`trend` → `avg30` → `avg` → `low`, dito `-holo`), 6 parallel, 20 s Timeout,
  120 ms Pause zwischen den Wellen. Ein ganzes Set wird immer komplett bepreist; bei Ären greift
  ein Deckel von 400 Abfragen, priorisiert nach bekanntem Preis (Top 3·n) und danach nach
  Sammlernummer absteigend – in modernen Sets liegen die Secret Rares über der Set-Grenze, das ist
  der beste Anhalt, den die Kartendaten ohne Preis hergeben. Was nicht angefasst wurde, meldet
  `coverage.skipped` offen ans UI.
- **Bilder**: `cardImage` mit Fallback-Kette eigener Cache → `127.0.0.1:8103/api/img/card/…` →
  TCGdex-URL, Endung folgt dem Content-Type (webp/png).
- **API**: `GET …/data` (Status + Set-/Ären-Listen), `PUT …/data-source`, `GET …/data/preview`
  (`kind=top|movers`), `GET …/data/card-image/:cardId`. Vorschau läuft synchron – ein Set ist in
  unter 10 s durch, dafür lohnt keine Job-Queue.
- **UI**: Karte „Produktdaten“ auf der Projektseite (`#produktdaten`): Datenquelle wählen, Status
  (Bestand, Frischeanteil, Alter des Schnappschusses, letzter Preislauf der Quelle, Bildcache) und
  eine Vorschau-Tabelle mit Kartenbild, Preis und der Fußzeile, die später auf jede Slide gehört:
  `Preise: Cardmarket-Trend · Stand TT.MM.JJJJ · binderplan.app`.
- **Betrieb**: `deploy/binderplan-snapshot.{sh,service,timer}` – stündlicher root-Timer, der eine
  konsistente Kopie von Binderplans `app.db` nach `data/cache/binderplan.db` legt. Warum überhaupt:
  siehe DECISIONS („Schnappschuss statt Direktzugriff“). Neue `.env`-Schlüssel: `MP_BINDERPLAN_DB`,
  `MP_BINDERPLAN_API`, `MP_TCGDEX_API`, `MP_PRICE_MAX_AGE_HOURS`.
- **19 neue Tests** gegen eine Fixture-Datenbank im app.db-Format (5 Sets über 3 Ären inkl. jp-Set,
  21 Karten, Preise teils fehlend/veraltet) – ohne Netz und ohne den Schnappschuss vom VPS.
  Abgedeckt: Ären-Mapping, `priceBasis`, Nachlade-Logik mit TCGdex-Attrappe, Deckel und
  Priorisierung, eigener Cache, Regions-Semantik, movers, Bild-Fallback-Kette, Status – und die
  **Lese-Garantie** (Schreibversuche gegen das Handle scheitern; der Fixture-Preis bleibt
  unverändert). Gesamt jetzt **101 Tests**.

Live-Abnahme (2026-08-31, Projekt „Binderplan“, Kaltstart ohne Cache):
- **Silberne Sturmwinde** (`swsh12`): 215 Karten in **8,7 s** vollständig bepreist, Gesamtwert
  867,46 €, Stand 31.08.2026. Platz 1 Lugia V 186/195 mit 626,08 € – die bekannte Chase-Karte des
  Sets, die Liste ist plausibel. `coverage: 215/215, 0 übersprungen`.
- **Ära Schwert & Schild**: 3.710 Karten im Bereich, 385 nachgeladen, 12,5 s. Platz 1–3 Nachtara
  VMAX (1.125 €), Rayquaza VMAX (1.040 €), Gengar VMAX (982 €) – die tatsächlichen Spitzenkarten
  der Ära.
- Kartenbild über die API: HTTP 200, `image/webp`, 78 KB. Unbekanntes Set: `400 Set unbekannt`.

Gelernt / Abweichungen vom Plan:
- Direktzugriff auf `/root/apps/binderplan/app.db` ist unmöglich (`/root` ist `drwx------`); der
  Schnappschuss ist deshalb der Normalfall, nicht der Notnagel. Details in DECISIONS.
- Die Region eines Sets, nicht die der Karte, ist maßgeblich – sonst rutschen japanische Set-Namen
  in deutsche Ranglisten.
- Der Plan schreibt `region: "intl"|"ja"`; in den Daten heißt es `jp`. Der Code folgt den Daten.

Offen:
- `priceMovers` ist gebaut und getestet, aber Binderplans Preisverlauf ist zu dünn für eine
  wöchentliche Serie (1.698 Zeilen über 350 Karten an 6 Tagen). **Vor Shot 9 entscheiden**, ob der
  Pilot eine eigene dichtere Reihe aufbaut oder die Serie auf Karten mit genug Messpunkten
  beschränkt wird – siehe DECISIONS.
- Der Schnappschuss ist stündlich; ein Set, das Binderplan gerade erst synchronisiert hat, ist im
  Pilot also bis zu eine Stunde später sichtbar. Für Content unkritisch.

## Shot 7 – Daten-Carousel + Plattform-Pakete: **fertig** (2026-09-01)

Erledigt:
- **Neues Format `data_carousel`** (`shared/schemas.ts`), dazu `DataQuery` (Bereich, Umfang,
  Preisbasis, Countdown) und an `ContentRequest` die Felder `dataQuery`, `bundlePlatforms`,
  `language` (`de|en|both`). Ein Lauf erzeugt ein **Bündel**: mehrere ContentPieces mit
  gemeinsamen Slides, aber je Plattform eigener Caption, eigenem Hashtag-Satz und eigener
  Link-Regel. Zusammengehalten über `meta.bundleId` (= ID des Leit-Stücks).
- **Ranking-Vorlagen** in `agents/studio/render.ts`: `rankingSlideHtml` (Kartenbild groß mit
  weichem Glow, Rang-Pill in DM Mono, Preis in `tabular-nums`, Pfeil-Variante für Bewegungen),
  `rankingCoverHtml` (Titel, Gesamtwert, drei gefächerte Karten), `rankingCtaHtml`
  (Produkt-Screenshot, ein Satz, Link bzw. „Link in Bio“). Auf **jeder** Slide die Fußzeile
  `Preise: Cardmarket-Trend · Stand TT.MM.JJJJ · binderplan.app`.
- **Generator** `agents/studio/data-content.ts`: Provider-Abfrage → Bilder laden → Slides
  deterministisch bauen → **ein** LLM-Aufruf für Titel, Cover-Titel, Hook, CTA-Zeile und je
  Plattform Caption + Hashtags → Kritiker-Runde nur auf die Caption des Leit-Stücks. Die
  Zahlen gehen bereits **fertig formatiert** in den Prompt („626,08 €“), damit das Modell sie
  zitiert statt sie zu rechnen; die Rangliste liegt zusätzlich als Prüfspur in `meta.cards`.
- **Größen je Plattform** statt der festen `SIZES`: 1080×1350 (Instagram/Facebook/LinkedIn/X/
  Threads/Bluesky), 1080×1920 (TikTok/YouTube), 1000×1500 (Pinterest). Gleiche Größe = gleiche
  Datei; nur die CTA-Slide gibt es zweimal, weil „Link in Bio“ und die Domain sich unterscheiden.
- **Hashtag-Politik** zentral in `shared/channels.ts` (`HASHTAG_POLICY`): Instagram 6–10,
  TikTok 3–6, YouTube 3–5, Facebook/LinkedIn/X/Threads/Bluesky 0–2, Pinterest 0. Die
  Schreibregeln in `prompts/voice.ts` sind entsprechend parametrisiert — die bisherige globale
  Regel „max 2 Hashtags“ ist weg. Vorrat je Projekt in `mp_settings hashtags:<projectId>`
  (`src/server/hashtags.ts`), einmal per LLM vorgeschlagen, danach im Studio-Reiter „Hashtags“
  editierbar. `applyHashtagPolicy` stutzt auf das Maximum und füllt nur bis zum **Minimum** aus
  dem Vorrat auf.
- **`PLATFORM_LIMITS`** um `tiktok: 2200` und `youtube: 5000` ergänzt.
- **API**: `GET/PUT /projects/:id/hashtags`, `POST /projects/:id/hashtags/suggest`,
  `GET /content/:id/bundle`, `POST /content/:id/bundle/status` („Alle freigeben“ als ein
  Vorgang mit einem Audit-Eintrag).
- **UI**: Studio-Formular kennt „Daten-Carousel“ (nur bei vorhandener Datenquelle) mit Bereich,
  Umfang, Preisbasis, Reihenfolge, Sprache und Plattform-Auswahl; neuer Reiter „Hashtags“;
  Freigabe gruppiert Bündel (Plattform-Reiter, „Alle N freigeben“, „Bündel ablehnen“) und zeigt
  bei Daten-Stücken die Rangliste als aufklappbare Prüfspur; „Zuletzt erzeugt“ zeigt ein Bündel
  als eine Zeile mit `+n`.
- **16 neue Tests** (Gesamt **117**): Plattform-Politik, Hashtag-Stutzen/Auffüllen, Bündel-Erzeugung
  gegen eine Fixture-Datenbank mit vorgefülltem Bildcache (kein Netz), Größen/Caption/Tags je
  Plattform, geteilte Dateien, exakte Zahlen auf den Slides, CTA nach Link-Regel, Publish-Paket
  eines Bündel-Mitglieds, Bündel-Freigabe samt Audit, Ablehnung ohne Datenquelle.

Live-Abnahme (2026-09-01, Projekt „Binderplan“, Set `swsh12`, Top 15, vier Plattformen):
- Erster Lauf **2 min 41 s** (Preise kalt), Neu-Erzeugung danach **1 min 42 s** (54 Dateien).
  Gesamtwert 867,46 €, Platz 1 Lugia V 186 mit 626,08 € — Zahl für Zahl identisch mit der
  Vorschau aus Shot 6. Instagram 10 Tags, TikTok 5, Facebook 2, Pinterest 0.
- Kosten des ganzen Bündels: **0,02 $** (ein Content-Aufruf + zwei Kritiker-Runden).
- Slides visuell geprüft (Cover, Rang 1, CTA in beiden Link-Varianten, 1080×1350 und 1080×1920).
- Der Hashtag-Vorschlag lieferte für Binderplan sechs Themengruppen (sammeln, organisation,
  preise, kaufverkauf, nostalgie, digital) plus DE/EN-Listen.

Gelernt / nachgebessert:
- Der erste Livelauf schrieb „626.08 €“ in die Caption: der Prompt hatte `toFixed(2)` geliefert.
  Zahlen gehen jetzt lokalisiert in den Prompt, mit der ausdrücklichen Regel, das Trennzeichen
  mit zu übernehmen. Ebenso das Datum: `31.8.2026` → `31.08.2026` (zweistellig).
- Eine Kritiker-Runde reichte nicht (Caption blieb bei 6/10); zwei Runden wie beim Carousel
  bringen sie auf 7/10.
- Das Kartenfächer-Cover schnitt die äußeren Karten ab (Versatz 0,26·Breite, Höhe statt Breite
  begrenzt). Jetzt Versatz 0,17·Breite, `max-width: 40 %`, äußere Karten auf 0,9 skaliert.

Offen:
- `data_reel` (Shot 8) fehlt noch — der Hook aus diesem Lauf liegt bereits in `meta.hook` bereit.
- Der Format-Dispatch in „Jetzt ausführen“ (`agents/strategy/execute.ts`) kennt die Daten-Formate
  noch nicht; laut Plan gehört das zu Shot 8.
- Die Kosten eines Bündels stehen vollständig am Leit-Stück, die Mitglieder zeigen 0,00 $. Das ist
  richtig (ein Lauf), in der Liste aber erklärungsbedürftig.
