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
