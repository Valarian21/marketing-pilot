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

## 2026-08-26 (Feedback-Runde)

- **Kosten am Stück statt am Projekt**: jeder Lauf trägt `pieceId` + `provider`; ElevenLabs liefert keine Preise, deshalb Schätzung über Zeichen (konfigurierbar). Analyse/Strategie bleiben Projektkosten (kein Stück).
- **Änderungswünsche editieren statt neu erzeugen**: ein „Kürzer“ darf nicht den ganzen Text neu würfeln – der Edit-Prompt ändert nur das Genannte. Bei Videos entscheidet ein Diff der Aktionen (nicht nur das Modell), ob neu aufgenommen werden muss.
- **Aufnahmen bleiben, Zwischendateien nicht**: `.webm`-Aufnahmen ermöglichen billige Re-Renders; Segmente/Bodies/Overlays sind reproduzierbar und werden sofort gelöscht. Löschen ist bewusst manuell (Speicher-Tab), damit nie ein fertiges Video ohne Marcel verschwindet.
- **Szenen-Check per Vision-Modell** (günstiges Modell, ~0,001 $/Szene): billiger als jede Heuristik und erklärt dem Menschen in einem Satz, was das Bild zeigt.

## Szenenbilder für den Szenen-Check kommen aus der fertigen Aufnahme, nicht aus `page.screenshot()` (2026-08-26)

`page.screenshot()` während der Playwright-Aufnahme setzt in Chromium für ~1 s die erzwungene
Geräte-Skalierung zurück – im Screencast erscheint die Seite dann als Miniatur in der Ecke
(sichtbar am Start jeder Szene). Die Standbilder werden deshalb nachträglich per ffmpeg aus dem
webm gezogen (0,4 s vor Szenenende, auf 600 px Breite verkleinert). Nebeneffekt: die Aufnahme
läuft ohne Unterbrechung, und das Bild entspricht exakt dem, was im Video zu sehen ist.

## Video-Qualitätsrunde: 25 fps, rAF-Scrollen, waitFor, ElevenLabs-Modell (2026-08-26)

- **25 fps statt 30.** Playwrights Screencast liefert fest 25 fps; ein 30-fps-Schnitt verdoppelt jedes
  fünfte Bild – auf Scrolls sichtbar als Ruckeln. Instagram/TikTok/YouTube nehmen 25 fps an.
- **Scrollen per requestAnimationFrame** im scrollbaren Container unter dem Cursor (Dialoge scrollen
  in sich selbst) statt Wheel-Ticks: Chromiums Smooth-Scroll überlagerte 40 Ticks zu Stufen. Regel im
  Prompt: nur scrollen, wenn etwas sichtbar werden muss, höchstens einmal je Szene.
- **waitFor** (Ziel-Text, max. Wartezeit bis 240 s): Der Recorder wartet, bis die App fertig ist,
  markiert die Zeit als Idle, der Schnitt entfernt sie wie einen Freeze (0,9 s bleiben). So passen
  Voiceover („Fertig.“) und Bild (fertiges Blatt) zusammen, ohne dass 90 s Spinner auf Band liegen.
- **ElevenLabs:** `eleven_multilingual_v2` nimmt keinen `language_code` und rät die Sprache je Satz
  („Material“ englisch). Standard jetzt `eleven_turbo_v2_5` mit fester Sprache aus dem Skript,
  neutrale Voice-Settings (style 0, kein Speaker-Boost – die alten Werte verfärbten die Stimme) und
  `previous_text`/`next_text` als Satzkontext. Modell und Settings per `.env` umschaltbar; Marcel wählt
  nach Hörproben (A–E im Chat vom 26.08.).
- **UI-Karte** (`mp_settings` `ui-map:<projectId>`): sichtbare Button-/Link-/Feld-Beschriftungen
  jeder Aufnahme fließen in Skript- und Revise-Prompt – der Agent rät keine Buttonnamen mehr.
- **„Neu generieren“ bei Videos** startet einen Render-Job; der Studio-Pfad hatte Aufnahmen und
  Renders gelöscht und nichts erzeugt (Vorfall 26.08., 19:14).

## Voiceover am Stück, Musik mit Ducking (2026-08-27)

Szenenweise TTS klang abgehackt: fünf kalte Starts, keine gemeinsame Prosodie (v3 kennt kein
`previous_text`). Jetzt geht das ganze Skript in **einen** ElevenLabs-Aufruf, Szenen durch `[pause]`
(v3) bzw. `<break time="0.7s"/>` (v2) getrennt; die Wort-Timestamps werden über Zeichen-Offsets den
Szenen zugeordnet und das Szenen-Audio aus dem Master geschnitten (mit 120/180 ms Vor-/Nachlauf, nie
in Nachbarwörter). Audio-Tags (`[excited]` …) und reine Satzzeichen erscheinen nie in Untertiteln.
Stille Szenenenden werden auf Stimme + 1,5 s gekappt (das Ergebnis des letzten Klicks bleibt ≥ 0,8 s).
Musikbett mit Sidechain-Kompressor (Stimme drückt Musik weg), Grundpegel 30 %. Reels standardmäßig
**ohne** Musik – auf Instagram/TikTok kommt der Sound lizenzsauber aus der Plattform-Bibliothek;
Landscape (YouTube/Website) mit Musik. ElevenLabs-Music-API bräuchte am Key `music_generation`.

## Produktdaten: Schnappschuss statt Direktzugriff (2026-08-31, Shot 6)

Der Plan sah vor, Binderplans `app.db` direkt read-only zu öffnen, mit dem Hinweis „gleicher
Unix-User `developer` – prüfen“. Die Prüfung fiel negativ aus: **`/root` ist `drwx------`**. Der
Pilot läuft als `developer` und kommt an `/root/apps/binderplan/app.db` nicht heran, obwohl die
Datei selbst `0644` ist — es scheitert an der Traversierung.

Ein ACL-Traversierungsrecht (`setfacl -m u:developer:x /root`) wäre der kurze Weg gewesen und
wurde **verworfen**: unter `/root` liegen weitere world-readable Datenbanken, darunter Lehreules
713 MB große Kundendatenbank (`/root/apps/arbeitsblatt-studio/data/app.db`) sowie die von atemzug
und date-einladung. Für ein Marketing-Feature das Kundendaten dreier Produkte zu öffnen ist kein
vertretbarer Tausch.

Stattdessen der im Plan als Fallback vorgesehene Weg, aber als Normalfall: ein root-eigener
systemd-Timer (`deploy/binderplan-snapshot.{sh,service,timer}`) legt stündlich eine konsistente
Kopie nach `data/cache/binderplan.db` (Besitzer `developer`, `0640`). Kopiert wird über das
**SQLite-Online-Backup** (`Connection.backup`), nicht per `cp` — sonst wäre die Kopie bei aktivem
WAL inkonsistent. Das Ziel hat kein WAL, der Leser braucht also keine `-wal`/`-shm`-Rechte.
Zwei Vorteile, die den Umweg rechtfertigen: Binderplan spürt von unserer Leselast nichts, und der
Provider kann die Datei nicht einmal versehentlich sperren. Preise sind davon unberührt — die holt
der Pilot ohnehin selbst frisch von TCGdex; der Schnappschuss liefert nur Karten- und Set-Stamm.

**Kartenbilder gehen über HTTP**, nicht über Dateien: Binderplans Bildcache liegt ebenfalls unter
`/root`. Die Kette ist eigener Cache → `127.0.0.1:8103/api/img/card/…` → TCGdex-URL aus der Karte.

## Region kommt vom Set, nicht von der Karte (2026-08-31, Shot 6)

In Binderplan gibt es Altbestände, deren `cards.region` und `sets.region` sich widersprechen:
`neo4-4` („Dunkles Psiana“) ist als `intl`-Karte an das `jp`-Set `neo4` gehängt, dessen Name
`闇、そして光へ...` lautet. Nach `cards.region` gefiltert landete die Karte in einer deutschen
Rangliste — auf einer Slide stünde dann ein japanischer Set-Name. Maßgeblich ist deshalb die
Region des **Sets**. Betrifft Ären-Abfragen und Preis-Bewegungen; bei einem konkreten Set stellt
sich die Frage nicht.

## Preis-Bewegungen sind noch zu dünn für eine Serie (2026-08-31, Shot 6)

`priceMovers` funktioniert und ist getestet, aber Binderplans `price_history` trägt beim Bau nur
**1.698 Zeilen über 350 von 33.732 Karten an 6 Tagen**. Gefüllt wird, was Nutzer ansehen. Die
Folge sind echte, aber wilde Ausschläge (Nachtara/Unerschrocken 133 € → 687 € in vier Tagen,
+416 %) bei dünn gehandelten Karten. Die Zahlen sind korrekt gemessen — als wöchentliche Serie
„Preis-Raketen“ (Shot 9) wären sie trotzdem irreführend. Die Vorschau nennt deshalb offen, auf wie
vielen Karten mit Verlauf eine Liste beruht (`withHistory`). **Vor Shot 9 zu klären:** entweder
eine eigene, dichtere Preisreihe im Pilot aufbauen (der Nachlader schreibt ohnehin täglich in
`mp_card_prices`) oder die Serie auf Karten mit mindestens N Messpunkten und einem Mindest-Basispreis
beschränken.

## Ein veralteter Preis ist besser als kein Preis (2026-08-31, Shot 6)

Ist eine Karte nicht frisch bepreisbar (TCGdex antwortet nicht, oder der Nachlade-Deckel greift),
bleibt der alte Wert stehen, statt die Karte aus der Liste zu werfen — dieselbe Regel, die
Binderplan selbst anwendet. Ehrlich bleibt das, weil `priceStand` einer Liste immer den **ältesten**
Stand ihrer Karten trägt, nicht den jüngsten: die Fußzeile einer Slide sagt damit im Zweifel ein
älteres Datum, nie ein zu schönes.

## Ein Bündel teilt seine Slides, nicht seine Captions (2026-09-01, Shot 7)

Der Plan wollte „einmal erzeugen, überall posten". Die Frage war, wie fein geschnitten wird.
Entschieden: **Slides sind gemeinsam, Text ist es nie.** Alle Plattform-Stücke eines Laufs
zeigen auf dieselben PNG-Dateien; unterschiedlich sind Caption, Hashtag-Zahl, Link-Regel und
Textlängen-Limit. Nur zwei Dinge zwingen zu einer zweiten Datei: eine andere Bildgröße
(TikTok 1080×1920, Pinterest 1000×1500) und die CTA-Slide, weil auf Instagram/TikTok „Link in
Bio" steht und sonst die Domain.

Damit trägt jedes Mitglied fremde Asset-IDs. `buildPackage` löst Assets deshalb jetzt über die
Liste **am Stück** auf (`piece.assets`) und nur ersatzweise über `mp_assets.content_piece_id` —
die Dateien selbst hängen am Leit-Stück, damit Speicher-Tab und Aufräumen eine klare Heimat
haben. Neu erzeugt wird ein Bündel immer als Ganzes und immer über sein Leit-Stück, dessen ID
dabei erhalten bleibt (sonst brächen alle Links auf das Stück).

**Nicht umgesetzt:** eine Plattform in zwei Größen. Der Plan las sich stellenweise so, als
bekäme Instagram 1080×1350 *und* 1080×1920. Hochgeladen wird aber ein Seitenverhältnis; ein
Story-Schnitt wäre ein eigenes Stück mit eigener Caption. Das kommt, wenn Shot 10 Slots je
Kanal kennt — vorher wären es nur unbenutzte Dateien.

## Hashtags sind Plattform-Politik, kein Modell-Geschmack (2026-09-01, Shot 7)

Bis Shot 6 stand „max 2 Hashtags" fest in den Schreibregeln — richtig für LinkedIn und X, falsch
für Instagram und TikTok, wo die Nischen-Discovery genau darüber läuft. Die Zahl steht jetzt in
`HASHTAG_POLICY` (`shared/channels.ts`) und geht von dort in den Prompt.

Was das Modell vorschlägt, wird trotzdem nachbearbeitet: `applyHashtagPolicy` stutzt auf das
Maximum und füllt aus dem Projekt-Vorrat **nur bis zum Minimum** auf. Der Grund für die
Asymmetrie: die Vorschläge des Modells passen zum konkreten Text, der Vorrat ist allgemein.
Bis zum Maximum aufzufüllen würde jeden Beitrag mit denselben zehn Tags enden lassen.

Der Vorrat selbst wird einmal per LLM vorgeschlagen und gehört danach dem Menschen — es gibt
bewusst keinen Weg, auf dem er sich selbst nachschärft.

## Ohne Kartenbild keine Slide — und die Rangfolge ist die der Liste (2026-09-01, Shot 7)

`topCards` liefert die Rangfolge; ein Bild lädt der Provider aber nicht immer (alte Sets, Lücken
im TCGdex-Bestand). Eine Slide ohne Karte ist wertlos, also wird über den Bedarf hinaus geholt
(n + 5) und übersprungen, was kein Bild hergibt.

Damit ist Rang 3 auf der Slide der dritte Platz **der veröffentlichten Liste**, nicht zwingend
der dritte des Sets. Die Alternative — Ränge der Abfrage beibehalten und Lücken zeigen (1, 2, 4,
…) — wäre auf einer Slide schlicht ein Fehler. Ehrlich bleibt es, weil die übersprungenen Karten
namentlich in den Hinweisen am Stück stehen und der Gesamtwert über die tatsächlich gezeigten
Karten gerechnet wird, nicht über die ursprüngliche Abfrage.

## Zahlen gehen fertig formatiert in den Prompt (2026-09-01, Shot 7)

Der erste Livelauf schrieb „626.08 €" in die Instagram-Caption, obwohl auf der Slide „626,08 €"
stand: der Prompt hatte die Preise mit `toFixed(2)` übergeben, und das Modell hat brav zitiert,
was es bekam. Preise, Gesamtwert und Datum werden jetzt vor dem Prompt lokalisiert, und die
Regel sagt ausdrücklich, dass auch das Trennzeichen zum Zitat gehört.

Das ist die allgemeine Form der Shot-6-Regel „Zahlen sind heilig": heilig ist nicht der Wert,
sondern die **Zeichenkette**, die der Leser sieht. Deshalb bildet `changeLabel` die Pfeil-Zeile
(„▲ +38 % in 7 Tagen") auch nur einmal — Slide und Caption tragen dieselbe.

## Die Länge des Reels wird entschieden, bevor der Text geschrieben wird (2026-09-01, Shot 8)

Ein Reel muss unter 60 Sekunden bleiben. Der Plan sah vor, notfalls die Standzeit zu senken
oder Karten zu kappen — beides tut `planSlideshow`. Der erste Livelauf zeigte, warum das
allein nicht reicht: das Modell hatte „die Top 10" in Caption und Cover geschrieben, dann kappte
der Job zwei Karten, und das Video zeigte acht. Eine falsche Zahl, erzeugt von der eigenen
Mechanik — genau das, was die Regel „Zahlen sind heilig" verhindern soll.

Deshalb läuft die Planung **zweimal**: einmal im Generator, vor dem einzigen Modellaufruf, mit
geschätzten Sprechdauern — dort fallen Karten weg, und das Modell sieht von vornherein nur die
Liste, die auch im Video steht. Und einmal im Job, mit den echten Dauern; dort darf nur noch die
Standzeit nachgeben. Muss der Job doch kappen, korrigiert er zusätzlich `meta.cards`, damit die
Prüfspur in der Freigabe dem Video entspricht.

Damit die beiden Läufe zum selben Ergebnis kommen, bilden sie den gesprochenen Satz mit
derselben Funktion (`reelCardLine`) und schätzen mit demselben Schätzer.

## Sprechdauer wird pro Zeichen geschätzt, nicht pro Wort (2026-09-01, Shot 8)

`estimateDurationMs` aus der Video-Fabrik rechnet 380 ms je Wort. Für Fließtext stimmt das; für
Reel-Zeilen liegt es weit daneben, weil deutsche Zahlwörter beliebig lang werden:
„sechshundertsechsundzwanzig" ist **ein** Wort und dauert fast zwei Sekunden.

Gemessen an echten Läufen (eleven_v3, deutsch): ein Reel mit acht Karten dauerte 58 s, macht
rund 6 s je Kartenzeile bei etwa 50 Zeichen — also **110 ms je Zeichen** (`MS_PER_SPOKEN_CHAR`).
`estimateReelLineMs` nimmt den größeren der beiden Werte. Wer die Konstante anfasst, sollte
vorher wieder messen: an ihr hängt, wie viele Karten überhaupt eingeplant werden.

## Untertitel gehören bei Daten-Slides nach oben (2026-09-01, Shot 8)

Reels setzen Wort-Captions üblicherweise ins untere Drittel, und genau das tut die
Video-Fabrik (`layoutFor`). Auf einer Daten-Slide steht dort aber schon der Kartenname, der
Preis und die Quellen-Fußzeile — der erste Render legte das Overlay quer über den Namen.

`reelLayout` setzt die Captions deshalb auf 11 % der Höhe, direkt unter die Rang-Pille. Über dem
Kartenbild ist der einzige verlässlich freie Streifen, und auf Hook- und Endkarte (Text mittig)
stört er ebenfalls nicht.

## Der Kritiker verträgt jetzt beide Antwortformen (2026-09-01, Shot 8)

`gemini-2.5-flash` beantwortet `[task:ai-tell-critic]` mal mit `issues: ["Satz"]`, mal mit
`issues: [{quote, why}]`. Das Zod-Schema verlangte Strings, der Retry half nicht, und der ganze
Lauf endete mit 500 — nicht nur bei Daten-Formaten, sondern bei jedem Stück, das durch den
Kritiker geht. Das Schema nimmt jetzt beides und faltet Objekte zu einer Zeile zusammen. Die
Zeile landet ohnehin nur in den Hinweisen am Stück.

## Serien-Slots rechnen in Berlin, nicht in UTC (2026-09-01, Shot 9)

Zeitstempel bleiben überall UTC — das ist richtig und bleibt so. Ein Serien-Slot ist aber keine
Zeitmessung, sondern eine Verabredung: „montags um 9" heißt neun Uhr in Berlin. In UTC gerechnet
wanderte der Beitrag zweimal im Jahr um eine Stunde, und das an einem Tag, an dem niemand daran
denkt.

`agents/series/time.ts` rechnet deshalb konsequent über `Intl` in `Europe/Berlin`. Der
Doppellauf-Schutz ist bewusst kein Minutenvergleich, sondern die Frage „lief die Serie heute
(Berliner Datum) schon?" — das übersteht jeden Neustart und jede Uhrverstellung. Nicht behandelt
ist die doppelte Stunde der Zeitumstellung; ein Slot um 2 Uhr nachts kann an genau zwei Tagen im
Jahr eine Stunde danebenliegen. Für Redaktionsslots am Vormittag ohne Belang.

## Lieber eine Wiederholung nach einem Jahr als ein ausgefallener Slot (2026-09-01, Shot 9)

Die Rotation sperrt jedes Set für 26 Wochen. Was passiert, wenn alle Sets gesperrt sind? Zwei
Möglichkeiten: den Lauf ausfallen lassen oder die Sperre brechen.

Entschieden für **das am längsten Ungezeigte** — bei einem wöchentlichen Kanal ist eine
Wiederholung nach über einem halben Jahr unauffällig, ein stiller Montag dagegen fällt auf.
Anders bei „Neues Set": dort ist der Ausfall die richtige Antwort, weil die Serie eine Aussage
über Aktualität macht. Fällt sie aus, endet der Job **erfolgreich** mit Begründung — ein rotes
„fehlgeschlagen" für „es gab nichts Neues" wäre eine Lüge über den eigenen Zustand.

## Preis-Raketen brauchen zwei Filter, nicht einen (2026-09-01, Shot 9)

Shot 6 hatte die Frage offen gelassen, ob Binderplans dünner Preisverlauf für eine wöchentliche
Serie reicht. Der erste echte Lauf hat sie beantwortet: Nachtara +416 %, Absol +437 %, Simsala
+508 % — auf Karten mit drei Messpunkten. Die Zahlen sind korrekt gemessen und trotzdem
unbrauchbar; bei dünn gehandelten Karten misst der Cardmarket-Trendpreis die Datenlage, nicht
den Markt.

Ein Filter allein genügt nicht: mehr Messpunkte zu verlangen entfernt die stillen Karten, nicht
die wilden. Deshalb **beide** Grenzen — mindestens 4 Messpunkte im 7-Tage-Fenster *und*
höchstens 200 % Ausschlag (`minHistoryPoints`, `maxChangePct`, beide je Serie einstellbar).
Bleiben danach weniger als fünf Karten übrig, fällt der Lauf aus. Mit den Grenzen führte
dieselbe Abfrage Glurak mit +18,4 % auf 672,50 € an — eine Aussage, die man posten kann.

Die Alternative aus Shot 6, eine eigene dichtere Preisreihe aufzubauen, bleibt möglich (der
Nachlader schreibt ohnehin täglich in `mp_card_prices`), ist aber erst in Monaten aussagekräftig.

## Teil-Änderungen dürfen nichts zurücksetzen (2026-09-01, Shot 9)

`SeriesParams.partial()` schien der offensichtliche Typ für einen PATCH — ist er aber nicht: ein
optionales Feld mit `.default()` liefert beim Parsen trotzdem den Vorgabewert. Ein PATCH, der nur
die Sperrfrist ändern sollte, setzte damit Umfang und Plattformen still zurück (live passiert und
erst an den Ausgabedaten aufgefallen).

`SeriesCreate` und `SeriesPatch` nehmen jetzt lose Teilmengen (`z.record`) und prüfen erst das
**zusammengeführte** Ergebnis gegen `SeriesParams`. Die Validierung geht nicht verloren, sie
greift eine Ebene später. Wer anderswo im Piloten einen PATCH auf ein Objekt mit Defaults baut,
sollte dieselbe Falle im Kopf haben.

## Die Hausregel wird an einer Stelle erzwungen, nicht an zwölf (2026-09-01, Shot 10)

„Reddit, Foren und Discord haben keinen Code-Pfad, der postet" ist seit V1 gesetzt. Mit sechs
Providern und einem Zeitplan gäbe es plötzlich viele Stellen, an denen diese Regel brechen
könnte. Deshalb hat sie genau einen Ort: `posterFor()` liefert für alles, was in
`PLATFORM_POSTING` als `blocked`, `manual` oder `needs_audit` steht, **null** — unabhängig davon,
ob jemand einen Poster registriert hat. `schedulePiece` und `runScheduledPost` fragen beide
darüber, und ein Test prüft es namentlich für Reddit, X, TikTok und YouTube.

Dieselbe Tabelle trägt den Grund im Klartext, und der steht wörtlich im UI. „Manuell" ist keine
fehlende Funktion, sondern eine Entscheidung — wer sie liest, soll auch lesen, warum: X kostet
0,20 $ je Post mit Link, LinkedIn gibt es nur übers Partnerprogramm, TikTok und YouTube sperren
Beiträge aus nicht auditierten Projekten.

## Instagram holt Medien, statt sie zu bekommen (2026-09-01, Shot 10)

Bluesky, Telegram und Mastodon nehmen Dateien entgegen. Instagram und Pinterest nicht: sie
verlangen eine **öffentlich erreichbare URL** und laden von dort. Die Alternativen wären ein
öffentliches Verzeichnis (nein) oder ein Zwischen-Hoster (unnötig).

Gewählt: signierte, ablaufende Adressen unter `/go/a/<token>` — HMAC über Asset-ID und
Ablaufzeit mit einem Geheimnis, das beim ersten Gebrauch entsteht. Sechs Stunden Gültigkeit
reichen für jeden Container-Fluss und sind kurz genug, dass ein durchgesickerter Link wertlos
wird. Kein Verzeichnis, kein ratbarer Pfad, und der Vergleich läuft zeitkonstant.

## Ein gescheiterter Auto-Post wird zur Aufgabe, nicht zur Fehlermeldung (2026-09-01, Shot 10)

Der Zeitplan ist eine Abkürzung des Drei-Schritt-Wegs, kein Ersatz. Wenn Bluesky 500 antwortet
oder ein Token abgelaufen ist, darf der Beitrag nicht einfach verschwinden: `runScheduledPost`
setzt den Eintrag auf `failed`, schreibt den Anbieter-Fehlertext dazu **und** legt die Aufgabe
„Von Hand posten: …" an, die aufs fertige Publish-Paket zeigt. Beides landet im Audit.

Aus demselben Grund gibt es keinen automatischen zweiten Versuch: ein Beitrag, der zum Slot
nicht rausging, ist eine Sache für einen Menschen — nicht für eine Schleife, die um drei Uhr
nachts dasselbe Token noch einmal probiert.

## Voll automatisch nur für Daten-Formate, mit Deckel und Digest (2026-09-01, Shot 10)

Der Plan erlaubt `publishMode: "auto"` — Serien-Stücke ohne Einzelfreigabe. Drei Grenzen halten
das eng, und alle drei stehen im Code, nicht in der Doku:

1. **Nur `data_carousel`.** Bei Daten-Formaten kommt jede Zahl deterministisch aus dem Provider;
   ein Reel existiert zum Zeitpunkt des Serienlaufs außerdem noch gar nicht.
2. **Nur Kanäle mit echtem Poster** — `posterFor()` entscheidet, siehe oben.
3. **Nur bis zum Wochendeckel** des Kanals (Default 5). Ist er erreicht, bleibt das Stück in der
   Freigabe, mit Notiz.

Der Standard ist überall `manual`. Ob ein Kanal wirklich ohne Einzelfreigabe posten darf, bleibt
Marcels Entscheidung; der Digest „Heute automatisch gepostet" mit Direktlink zum Löschen ist die
Gegenleistung dafür, dass er sie treffen kann.

## Der Showcase fotografiert die App, statt sie nachzubauen (2026-09-01, Shot 11)

Binderplans öffentliche API (`GET /api/binders/<id>`) liefert Name, Layout und die Kartenliste —
damit ließe sich eine Binderseite bequem selbst rendern, ohne Browser, ohne Abhängigkeit von
fremdem DOM. Trotzdem läuft der Showcase über einen echten Screenshot der geteilten Ansicht.

Der Grund ist inhaltlich, nicht technisch: das Format heißt „schau dir meinen Binder an" und soll
**das Produkt** zeigen. Ein selbst gebautes Raster zeigt Karten, keine App. Der Preis dafür ist
eine Abhängigkeit von Binderplans Markup (`.slots`, `.seiten-nav`, `#preis-toggle`) — bricht die,
schlägt der Lauf mit klarer Meldung fehl, statt leere Bilder zu liefern.

## Die Fußzeile richtet sich nach dem Bild, nicht nach dem Schalter (2026-09-01, Shot 11)

Der erste Showcase-Lauf trug „Preise: Cardmarket-Trend · Stand 01.09.2026" unter einer
Binderseite, auf der kein einziger Preis stand: die Aufnahme hatte den Schalter „Preise" nicht
getroffen. Der zweite Lauf traf ihn — und es standen trotzdem keine Preise im aufgenommenen
Bereich.

Deshalb entscheidet nicht mehr die Absicht (`withPrices`) und auch nicht der Zustand des
Schalters, sondern der Befund: steht im `.slots`-Bereich ein Eurobetrag, trägt die Slide die
Preis-Fußzeile, sonst die neutrale. Dieselbe Haltung wie bei den Zahlen der Ranglisten — eine
Angabe darf nur behaupten, was tatsächlich zu sehen ist.

## Ein Logo ist nahezu quadratisch — ein Screenshot nicht (2026-09-01)

Der Brand-Extraktor nahm bisher „das erste Bild im Header, sonst og:image, sonst das Favicon". Bei
Binderplan lieferte das `hero.png` — einen App-Screenshot. Als Kachel im Banner und erst recht im
runden Profilbild wurde daraus unlesbarer Brei.

Die Auswahl sammelt jetzt Kandidaten **mit ihren echten Maßen** (`naturalWidth/Height`, `sizes` am
Icon-Link) und liest zusätzlich das **Web-Manifest** — wer eine PWA hat, hinterlegt dort ein
sauberes Icon in mehreren Größen, und das ist die verlässlichste Quelle überhaupt. Gewählt wird das
größte nahezu quadratische Bild (Verhältnis 0,8–1,25) ab 96 px; erst wenn es keins gibt, greift die
alte Reihenfolge.

Zweite Regel im Social-Kit selbst: ein Logo wird im Profilbild **randlos** gesetzt statt mittig
verkleinert. App-Icons bringen ihren eigenen Hintergrund mit; ein Quadrat auf einer zweiten Fläche
sieht im runden Zuschnitt nach Fehler aus.

## Ein ZIP ohne Kompression, dafür ohne Abhängigkeit (2026-09-01)

Das Social-Kit soll als eine Datei herunterladbar sein. Naheliegend wäre eine Bibliothek gewesen —
für sechs PNGs, die bereits komprimiert sind. Deflate hätte sie um Promille geschrumpft.

`util/zip.ts` schreibt stattdessen ein ZIP mit Methode 0 („stored"): rund hundert Zeilen, von jedem
Betriebssystem lesbar, keine neue Abhängigkeit. Die CRC32-Implementierung wird im Test gegen
`zlib.crc32` geprüft, nicht gegen eine abgeschriebene Konstante — bei selbst gebauten Formaten ist
die Gegenprobe wichtiger als der Code.

## Einrichtungsschritte sind Aufgaben, aber keine Wochen-Aufgaben (2026-09-01)

Marcels Einrichtungs-Anleitung lag zuerst im Dashboard, die Kampagnen-Aufgaben im Piloten — zwei
Orte für dieselbe Frage „was muss ich als Nächstes tun?".

Jetzt liegt alles in `mp_tasks`, aber mit dem eigenen Typ `setup` und **Woche 0**: die Aufgabenseite
zeigt sie als eigenen Block „Einrichtung · einmalig, ohne Frist", der nie „vergangen" wird und keine
Fortschrittswarnung auslöst. Die Freigabe-Stufe wird dort nicht angezeigt — sie sagt, wie viel der
Agent allein darf, und bei einem Einrichtungsschritt gibt es keinen Agenten. Lange Anleitungen
stehen als aufklappbarer Markdown-Block, damit die Liste lesbar bleibt.

## Zwei Formensprachen statt einer (2026-09-01)

Binderplan hat mit „Neunundneunzig" eine Marke bekommen, die mit Lehreule nichts zu tun hat: harte
Konturen, Aufkleber-Schatten, zwei Signalfarben. Der Pilot bedient beide Produkte mit **denselben**
Slide-Vorlagen — eine zweite Kopie der Templates wäre in drei Monaten auseinandergelaufen.

Deshalb trägt das Brand-Kit jetzt einen `style` (`weich` | `kontur`) plus `accent2` und `contour`.
`themeVars()` liefert je Stil andere Schriften und einen anderen Slide-Grund, `base()` setzt eine
Klasse am `<body>`, und ein einziger CSS-Block bringt die Aufkleber-Sprache mit. Lehreule bleibt
unberührt, weil sein Kit weiterhin `weich` ist.

Eine Regel gilt in beiden Welten: **der Grund einer Rangkarte ist ruhig.** Im weichen Stil ein
zarter Verlauf, im Konturstil schlicht hell. Der erste Render mit gelbem Grund sah aus wie ein
Warnschild, und die Karte — das einzige, worum es geht — verschwand darin.

## Eine zweite Preisquelle als Wahrheitsprobe (2026-09-01)

„Mewtu ★" stand mit 56,98 € in einer veröffentlichten Liste. Die Karte kostet rund 1.200 €.
Die Ursache lag nicht im Piloten: TCGdex verknüpft diese Karte mit dem falschen
Cardmarket-Produkt — sichtbar wird das erst, wenn man **dieselbe Antwort** weiterliest, denn dort
nennt TCGplayer 5.000 $ für dieselbe Karte. Bei Gold-Star-Karten passiert das öfter.

Die Gegenprobe kostet nichts: der Dollar-Preis kommt in derselben Antwort mit. Weicht er um mehr
als das Fünffache ab, ist nicht der Markt unterschiedlich, sondern die Verknüpfung kaputt — eine
Stichprobe über bekannte Karten liegt zwischen 0,8× und 2,7×. Solche Karten fallen aus Ranglisten
und Bewegungen heraus, statt mit einer falschen Zahl auf eine Slide zu geraten.

Das ist die dritte Ausbaustufe derselben Haltung: Shot 6 hat Zahlen deterministisch gemacht, Shot 9
unglaubwürdige Ausschläge gefiltert, und hier wird die Quelle selbst gegengeprüft. Wo nur eine
Quelle spricht, wird nichts verworfen — eine Vermutung ist kein Beweis.
