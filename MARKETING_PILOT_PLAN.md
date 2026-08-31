# Marketing Pilot – Bauplan für Claude Code

> **Für Claude Code:** Diese Datei ist die vollständige Spezifikation. Lies sie einmal komplett. Der Abschnitt **Kontext** gilt für jeden Shot. Arbeite dann den Shot ab, den der Nutzer im Terminal nennt (z. B. „Shot 0“). Wenn der Nutzer „alle Shots“ sagt: Shot 0 bis 5 nacheinander, nach jedem Shot committen, nur bei unlösbaren Fragen stoppen. Halte den Fortschritt in `marketing-pilot/docs/PROGRESS.md` fest (welcher Shot fertig ist, was offen ist), damit eine neue Session weiterarbeiten kann.

## Anleitung für mich (Marcel)

1. Diese Datei als `MARKETING_PILOT_PLAN.md` ins Wurzelverzeichnis des Dashboard-Repos auf dem VPS legen. Dazu `tokens.css` nach `marketing-pilot/src/theme/tokens.css` (Ordner anlegen, Claude Code übernimmt die Datei in Shot 0).
2. Im Repo-Verzeichnis `claude` starten.
3. Ersten Befehl eingeben (eine Zeile):
   `Lies MARKETING_PILOT_PLAN.md komplett und führe Shot 0 aus. Stoppe danach und fasse zusammen.`
4. Ergebnis von Shot 0 prüfen (Stack-Entscheidung, Einhängung, Standalone-Start). Offene Fragen beantworten.
5. Dann entweder Shot für Shot:
   `Lies MARKETING_PILOT_PLAN.md und docs/PROGRESS.md, führe Shot 1 aus.`
   oder in einem Rutsch:
   `Lies MARKETING_PILOT_PLAN.md und docs/PROGRESS.md. Führe Shot 1 bis 5 nacheinander aus, committe nach jedem Shot, frag nur bei unlösbaren Problemen.`
6. Neue Session (z. B. nach Kontext-Reset): immer wieder mit „Lies MARKETING_PILOT_PLAN.md und docs/PROGRESS.md“ beginnen.

Nicht den Text der Datei ins Terminal kopieren; Claude Code liest Dateien selbst, und lange Einfügungen im Terminal gehen schief.

---

## Kontext (gilt für jeden Shot)

Du baust „Marketing Pilot“, ein agentisches Marketing-Tool für meine eigenen SaaS-Produkte. Es läuft zunächst als Modul in meinem bestehenden Dashboard auf diesem VPS und muss später ohne Umbau auf eine eigene URL extrahierbar sein.

Nicht verhandelbare Architektur-Regeln:

1. **Eigenständiges Paket.** Alles lebt in einem Ordner `marketing-pilot/` (bzw. `packages/marketing-pilot/`, wenn das Dashboard ein Monorepo ist). Eigene DB-Tabellen mit Präfix `mp_`, eigene API-Routen unter `/api/mp/*`, eigene Frontend-Routen unter `/mp/*`. Das Dashboard importiert das Paket, nie umgekehrt.
2. **Adapter statt Kopplung.** Alles, was vom Dashboard kommt (Auth/aktueller Nutzer, DB-Connection, Layout-Shell, Navigation), geht durch eine Datei `marketing-pilot/src/host-adapter.ts` mit einem klar definierten Interface. Es gibt eine zweite Implementierung `host-adapter.standalone.ts` (eigene Session, eigenes Layout), die per Env `MP_STANDALONE=true` aktiv wird. Ich muss das Paket später mit `MP_STANDALONE=true` als eigene App starten können, ohne Code zu ändern.
3. **Provider-Adapter.** LLM-Aufrufe ausschließlich über OpenRouter (`OPENROUTER_API_KEY`), Modell pro Aufgabe konfigurierbar in `marketing-pilot/config/models.ts` (Default: ein starkes Modell für Analyse/Strategie, ein günstiges für Massen-Content). Voiceover über ElevenLabs (`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`). Bildgenerierung über ein OpenRouter-Bildmodell hinter einem `ImageProvider`-Interface, damit ich später wechseln kann. Posting-Provider hinter einem `PublishProvider`-Interface: Implementierung 1 ist `manual` (bereitet alles vor, Mensch postet), Implementierung 2 ist `postiz` (optional, per Env). Keine anderen SaaS-Abhängigkeiten ohne Rückfrage.
4. **Freigabe-Stufen.** Jede Aktion mit Außenwirkung (Post, Ad, Directory-Submit, Community-Antwort) hat eine Stufe `auto | review | human_only`. Default ist `review`. `human_only` ist fest für Reddit, Foren, Discord und Ad-Budgets. Jede Freigabe wird mit Nutzer, Zeitpunkt und Inhalt in `mp_audit_log` geschrieben.
5. **Kennzeichnung.** Alle generierten Bilder und Videos bekommen C2PA-Metadaten (Bibliothek `c2pa-node` oder, falls nicht integrierbar, XMP/EXIF-Feld `AI-generated: true` plus Notiz in der Freigabe-Queue). Texte bekommen ein internes Flag `human_edited` (true, sobald der Nutzer den Text vor Freigabe geändert hat).
6. **Beobachtbarkeit.** Jeder Agent-Lauf schreibt in `mp_agent_runs`: Aufgabe, Modell, Tokens, Kosten (aus OpenRouter-Response), Dauer, Ergebnis-Referenz, Fehler. Es gibt eine Seite `/mp/activity`, die das zeigt. Ein Agent, der leise ausfällt, ist ein Bug.
7. **Design über Tokens, Theme „Gewächshaus“.** Alle Farben, Schriften, Radien, Abstände kommen aus `marketing-pilot/src/theme/tokens.css` (liegt bereits im Repo, Light- und Dark-Variante, siehe Abschnitt Theme unten). Kein Inline-Styling mit festen Farben, keine Emojis als UI-Elemente, keine Tailwind-Farbnamen (`bg-green-500`), sondern nur die Tokens. Wenn das Dashboard Tailwind nutzt, die Tokens in der Tailwind-Config als Farben registrieren (`colors.mp.accent = 'var(--mp-accent)'`).
8. **Qualität.** TypeScript strict, Zod-Validierung an allen API-Grenzen, Tests für Agent-Prompts mit Snapshot-Fixtures, `pnpm lint && pnpm typecheck && pnpm test` grün vor jedem Commit. Kleine, beschreibende Commits. Ein `marketing-pilot/README.md`, das erklärt, wie man das Modul im Dashboard und standalone startet.

Domänenmodell (Kern, erweitern wenn nötig):

- `Project` (ein zu bewerbendes SaaS): name, url, status, brief (JSON), brandKit (JSON), createdAt
- `Persona`: projectId, name, description, painPoints[], language, whereTheyHangOut[]
- `Channel`: projectId, platform, rationale, cadence, priority, status
- `Task`: projectId, title, description, type (`research|strategy|content|publish|community|ads|measure`), status (`todo|in_progress|review|done|skipped`), dueAt, assignedTo (`agent|human`), approvalLevel, outputRefs[], order
- `ContentPiece`: projectId, taskId, channel, format (`text|carousel|image|video|article|directory_entry|community_reply|ad_creative`), title, body, assets[], status (`draft|review|approved|published|rejected`), humanEdited, publishedAt, externalUrl, utm
- `Asset`: contentPieceId, kind (`screenshot|recording|voiceover|render|image`), path, meta (JSON, inkl. C2PA-Status)
- `Insight`: projectId, source, period, metrics (JSON), signups, notes
- `GeoSnapshot`: projectId, engine, query, mentioned (bool), position, competitorsMentioned[], rawAnswer, takenAt
- `CommunityLead`: projectId, platform, url, title, excerpt, score, draftReply, status
- `AgentRun`, `AuditLog` wie oben

---

## Shot 0: Discovery und Gerüst

Analysiere zuerst das bestehende Dashboard in diesem Repo: Framework, Router, Auth-Mechanismus, ORM/DB, Styling-System, Build- und Deploy-Setup, Ordnerkonventionen. Schreibe deine Erkenntnisse in `marketing-pilot/docs/HOST.md` (max. eine Seite). Entscheide auf dieser Basis, wie das Paket eingehängt wird, und begründe es dort in drei Sätzen.

Dann lege das Gerüst an: Paketstruktur, `host-adapter.ts` mit Interface und beiden Implementierungen, DB-Migrationen für das Domänenmodell, leere API-Routen mit Zod-Schemas, Frontend-Shell unter `/mp` mit Navigation (Projekte, Timeline, Aufgaben, Content Studio, Freigaben, Community, Insights, Aktivität, Einstellungen), `tokens.css` mit einem neutralen Platzhalter-Theme, `.env.example` mit allen benötigten Variablen, README. Ein Projekt anlegen und löschen muss funktionieren. Standalone-Start muss mit `MP_STANDALONE=true` ebenfalls funktionieren (zeig mir den Befehl).

Stoppe danach und fasse zusammen: Stack-Entscheidung, offene Fragen, was du beim Host nicht ändern durftest.

---

## Shot 1: Analyse-Agent („URL rein, Brief raus“)

Implementiere die Stufe Analyse als Agenten-Pipeline, die pro Projekt gestartet werden kann und als `AgentRun` sichtbar ist:

1. **Crawl**: Landingpage, Pricing, Docs, Changelog, App-Store-/Play-Store-Einträge, GitHub-Readme falls verlinkt. Playwright mit Text-Extraktion, max. 40 Seiten, robots.txt beachten. Screenshots der 5 wichtigsten Seiten als Assets speichern.
2. **Product Brief**: Kernnutzen in einem Satz, Features, Preise, Alleinstellung, Tonalität, Zielgruppe wie das Produkt sie selbst beschreibt. Als strukturiertes JSON (Zod) plus lesbarer Markdown-Sicht.
3. **Wettbewerber**: 5–10 direkte Wettbewerber über Websuche (Provider hinter Interface, Default: eine Such-API meiner Wahl aus `.env`, sonst DuckDuckGo-HTML als Fallback). Pro Wettbewerber: URL, Positionierung, Preis, und die 5 häufigsten Beschwerden aus Reviews (App Stores, G2/Capterra, Reddit), mit Zitaten und Quelle.
4. **Personas**: 2–4 Personas mit Sprache (echte Formulierungen aus den gefundenen Quellen), Schmerzpunkten, Einwänden, Kaufauslösern, und „wo sie sind“ (Subreddits, Foren, Discords, YouTube-Kanäle, Hashtags, Newsletter), jeweils mit Belegen.
5. **Attention Map**: Kanäle gerankt nach Erreichbarkeit für Budget 0–300 €/Monat, mit Begründung, die auf Punkt 3 und 4 verweist.
6. **GEO-Baseline**: 20–30 Kaufabsichts-Fragen generieren, die die Persona einem Chatbot stellen würde. Jede Frage an 3–4 Modelle über OpenRouter schicken (konfigurierbar, z. B. GPT, Claude, Gemini, Perplexity-Sonar). Speichern als `GeoSnapshot`: wird das Produkt genannt, an welcher Position, welche Wettbewerber werden genannt.

UI: Eine Seite `/mp/projects/[id]/analysis` mit Fortschritt pro Schritt, dem fertigen Brief zum Inline-Bearbeiten (jede Änderung wird gespeichert und als „vom Nutzer korrigiert“ markiert), Personas als Karten, Attention Map als Rangliste, GEO-Baseline als Tabelle mit Filter pro Modell. Ein Button „Brief bestätigen“ schaltet die Strategie-Stufe frei.

Teste die Pipeline mit meiner ersten Produkt-URL (in `.env` als `MP_TEST_PROJECT_URL`) und zeig mir das Ergebnis.

---

## Shot 2: Strategie, Aufgaben, Timeline

**Strategie-Agent**: Liest bestätigten Brief, Personas, Attention Map, GEO-Baseline und erzeugt einen Kanalplan: 2–3 Startkanäle, Format je Kanal, Kadenz, 30/60/90-Tage-Ziele mit Messgröße (Signups, nicht Likes), Test-Budget-Vorschlag, und für jeden Punkt einen Satz Begründung mit Verweis auf die Analyse. Der Plan ist ein versioniertes Objekt; spätere Anpassungen (Shot 5) erzeugen neue Versionen mit Diff.

**Aufgaben-Generator**: Aus dem Plan werden `Task`s für die ersten 4 Wochen erzeugt, jede mit Typ, Fälligkeit, `assignedTo` und Freigabe-Stufe. Beispiele: „Directory-Eintrag bei AlternativeTo vorbereiten“ (agent), „r/Teachers: 3 passende Threads finden und Antworten entwerfen“ (agent), „Antworten posten“ (human, human_only), „Reel #1: Onboarding-Demo“ (agent), „Reel #1 freigeben“ (human).

**UI**:
- `/mp/projects/[id]/strategy`: Plan lesbar, jede Empfehlung aufklappbar mit Begründung, Versionen umschaltbar.
- `/mp/projects/[id]/tasks`: Aufgabenliste, gruppiert nach Woche, abhakbar, per Drag sortierbar, Filter nach Typ und Zuständigkeit (Agent/Ich), Fortschrittsanzeige pro Woche. Agent-Aufgaben haben einen „Jetzt ausführen“-Button, der einen `AgentRun` startet und das Ergebnis als `ContentPiece` in die Freigabe legt.
- `/mp/projects/[id]/timeline`: Horizontale Zeitleiste über 12 Wochen. Zeilen sind Kanäle, Einträge sind Aufgaben und veröffentlichte Content-Stücke; Vergangenheit zeigt Ist-Daten (Insights), Zukunft zeigt Plan. Heute-Marker. Klick öffnet Detail-Drawer. Muss auf 1280 px Breite ohne horizontales Scrollen der Seite funktionieren (die Timeline selbst scrollt in ihrem Container).
- `/mp` (Übersicht): Alle Projekte als Karten mit: offene Aufgaben diese Woche, Stücke in Freigabe, Signups letzte 7 Tage, GEO-Sichtbarkeit (Anteil der Fragen, in denen das Produkt genannt wird).

---

## Shot 3: Content Studio (Text, Bild, Carousel)

**Brand-Kit** pro Projekt: Farben und Logo aus der Website extrahieren, Tonalität aus dem Brief, plus ein **Voice-Profil**: Ich lade 5–20 eigene Texte hoch (Posts, Mails, Readme-Abschnitte) oder füge sie ein; der Agent leitet daraus Satzlänge, Lieblingswörter, Humor, Du/Sie, typische Einstiege und No-Gos ab und speichert das als Prompt-Baustein. Ohne Voice-Profil warnt das Studio sichtbar.

**Schreibregeln, die in jeden Text-Prompt gehören** (in `marketing-pilot/src/agents/prompts/voice.ts` zentral):
- Erste Person, konkret, mit Zahlen, Screenshots und Dingen, die schiefgingen. Ein Gedanke pro Post.
- Verboten: „In der heutigen schnelllebigen Welt“, „Game-Changer“, „Lass uns eintauchen“, „revolutionär“, rhetorische Frage als Einstieg gefolgt von Antwort, Dreier-Aufzählungen mit Adjektiv-Stakkato, Emojis als Bullet, Hashtag-Wände, Sätze die mit „Es ist wichtig zu beachten“ beginnen, abschließende Zusammenfassung des gerade Gesagten, Gedankenstriche als Stilmittel im Übermaß.
- Community-Antworten (Reddit, Foren): zuerst die Frage wirklich beantworten, Eigenprodukt höchstens im letzten Drittel, immer mit Offenlegung („Ich bau das Tool selbst“), und ohne Link, wenn das Subreddit Links in Kommentaren verbietet (Regeln des Subreddits vor dem Entwurf lesen und im Entwurf zitieren).
- Nach jedem Entwurf läuft ein zweiter Prompt als **AI-Tell-Prüfer**, der den Text gegen die Verbotsliste und das Voice-Profil bewertet (0–10) und konkrete Änderungen vorschlägt. Unter 7 wird automatisch überarbeitet, maximal zwei Runden. Score wird am Stück angezeigt.

**Formate**:
- Text-Posts für X, Threads, Bluesky, LinkedIn, Facebook, mit Plattform-Längen und ohne Hashtag-Spam.
- **Carousels**: HTML-Templates (3–5 Layouts, tokenbasiert im Brand-Kit) werden per Playwright zu 1080×1080 und 1080×1350 PNG gerendert. Templates müssen eigene Screenshots des Produkts als Slide unterstützen.
- Bilder über `ImageProvider` für Thumbnails und Ad-Hintergründe; nie als Ersatz für Produkt-Screenshots.
- **Pinterest-Pins**: 1000×1500, Titel + Beschreibung + Ziel-URL mit UTM.
- **Directory-Einträge**: Für eine Liste von Verzeichnissen (konfigurierbar, Start: Product Hunt, AlternativeTo, G2, There's An AI For That, SaaSHub, plus nischenspezifische aus der Analyse) werden alle Felder vorbereitet: Tagline in 60 Zeichen, Beschreibung in 3 Längen, Kategorien, Screenshots in den geforderten Größen. Der Nutzer bekommt eine „Einreichen“-Seite mit allen Feldern zum Kopieren, Deep-Link zum Formular und Abhaken.
- **GEO-Artikel**: Vergleichsseiten („X vs Y“), „Beste Tools für …“-Seiten und FAQ-Seiten mit JSON-LD (`FAQPage`, `SoftwareApplication`), als Markdown plus HTML-Export, für meine eigene Website.

**Freigabe-Queue** `/mp/projects/[id]/review`: Stücke nacheinander, Vorschau wie auf der Plattform, Text inline editierbar (setzt `humanEdited`), Buttons Freigeben / Ablehnen mit Grund / Neu generieren mit Hinweis. Freigegebene Stücke landen im **Publish-Paket**: pro Stück eine Seite mit Text zum Kopieren, Assets zum Download, UTM-Link, Deep-Link zur Upload-Seite der Plattform, Button „Als veröffentlicht markieren“ mit Feld für die externe URL. Wenn `PublishProvider=postiz` konfiguriert ist, gibt es zusätzlich „Jetzt planen“.

---

## Shot 4: Video-Fabrik (Screen-Recordings, Voiceover, Reels)

Ziel: Aus einem Skript entstehen ohne Handarbeit vertikale Reels (1080×1920, 20–45 s) und Landscape-Demos (1920×1080) meines Produkts. Qualitätsanspruch: sauber, templated, im Stil von Screen-Studio-Aufnahmen, nicht cinematisch.

1. **Demo-Skript-Agent**: Aus Brief, Persona und Aufgabe („Reel #1: Onboarding“) entsteht ein Skript mit Szenen: pro Szene Voiceover-Text (max. 2 Sätze), UI-Aktion (URL, Klick-Ziel als Text oder Selektor, Tipp-Text), Dauer, Caption-Text. Plus 5 Hook-Varianten für die ersten 2 Sekunden. Skript ist im UI editierbar.
2. **Recording**: Playwright fährt das Skript gegen eine konfigurierte Instanz meines Produkts (`MP_DEMO_BASE_URL`, Login per `.env`-Demo-Account), Viewport für Mobile 390×844 auf 3× Scale oder Desktop 1440×900, Cursor sichtbar (Cursor-Overlay einblenden, da Headless keinen zeigt), Aktionen mit menschlichen Pausen und Ease-Bewegungen. Aufnahme über Playwright-Video oder Frame-Capture (Screenshots mit 30 fps über CDP `Page.screencast`); Zeitstempel pro Aktion speichern, damit Zoom-ins auf Klicks möglich sind. Vor jeder Aufnahme Demo-Daten zurücksetzen, sofern ein Reset-Endpoint konfiguriert ist.
3. **Voiceover**: ElevenLabs pro Szene, mit Timestamps (Alignment-Endpoint) für Wort-genaue Captions. Stimme, Geschwindigkeit und Stil aus dem Brand-Kit.
4. **Assembly** mit Remotion (bevorzugt, weil React-Templates und Tokens wiederverwendbar sind) oder ffmpeg als Fallback: Hook-Karte (Text auf Brand-Farbe, 1,5 s), Aufnahme in einem Geräterahmen mit Zoom-in auf Klick-Punkte (Timestamps aus Schritt 2), Wort-Captions unten, dezente Hintergrundmusik aus einem lizenzfreien Ordner `marketing-pilot/assets/music/` (leer anlegen, Hinweis im README), Endcard mit CTA und URL. Übergänge kurz, kein Ken-Burns-Kitsch. Ausgabe H.264 MP4, plus Thumbnail-PNG aus dem Hook-Frame.
5. **Varianten**: Aus einer Aufnahme automatisch 3 Reels mit unterschiedlichen Hooks und ein Landscape-Video für YouTube rendern.
6. **Auto-Cut**: Stille und Wartezeiten (Ladevorgänge) in der Aufnahme erkennen und rausschneiden, Voiceover entsprechend verschieben.
7. C2PA-Metadaten in die Ausgabe, Thumbnail und Video als Assets am `ContentPiece`, Vorschau im Review mit Player.

UI: `/mp/projects/[id]/studio/video`: Skript-Editor mit Szenen, Button „Aufnehmen und rendern“ mit Fortschritt pro Schritt, Galerie der fertigen Varianten. Job-Queue (BullMQ oder eine einfache DB-Queue mit Worker-Prozess), damit Renders den Webserver nicht blockieren.

Teste mit einem 20-Sekunden-Skript gegen `MP_DEMO_BASE_URL` und zeig mir die Datei.

---

## Shot 5: Community-Radar, Insights, Wochen-Loop

**Community-Radar**: Für die in der Analyse gefundenen Subreddits, Foren und Hacker-News-Suchen läuft ein täglicher Job (Reddit über offizielle OAuth-API nur lesend; Foren über RSS oder Playwright-Text; alles respektvoll mit Rate-Limits). Threads werden gegen Persona-Schmerzpunkte gescort (LLM, 0–100), ab 60 entsteht ein `CommunityLead` mit Antwortentwurf nach den Schreibregeln. Seite `/mp/projects/[id]/community`: Leads nach Score, Entwurf editierbar, Button „Kopieren und Thread öffnen“, Status „geantwortet“ setzen mit URL. Kein automatisches Posten, technisch nicht eingebaut, auch nicht als Option.

**Insights**: UTM-Generator (Quelle, Medium, Kampagne, Stück-ID) in jedem Publish-Paket. Ein Webhook-Endpoint `/api/mp/events` (Bearer-Token), an den mein SaaS `signup`, `activated`, `paid` mit `utm`-Feldern schickt; zusätzlich ein 1-KB-Snippet für die Landingpage, das UTMs im Cookie behält und beim Signup mitschickt. Optional: Plattform-Insights, wenn Postiz-Zugang vorhanden. Seite `/mp/projects/[id]/insights`: Signups pro Kanal und Woche, beste und schlechteste Stücke, GEO-Sichtbarkeit im Verlauf (Baseline wöchentlich neu messen).

**Wochen-Loop**: Sonntags-Job erzeugt einen Klartext-Report (was lief, was nicht, was nächste Woche anders wird), schlägt eine neue Plan-Version mit Diff vor und generiert die Aufgaben der nächsten Woche. Der Report erscheint als Karte auf der Übersicht und ist per Klick als Plan-Update zu übernehmen.

**Abschluss**: End-to-End-Durchlauf auf meinem Testprojekt: Analyse → Strategie → 3 Content-Stücke → 1 Reel → Publish-Paket → ein Signup über den Webhook → Insights zeigen ihn an. Standalone-Start prüfen. README aktualisieren, inklusive Abschnitt „Extraktion auf eigene Domain“ mit den konkreten Schritten.

---

## Theme „Gewächshaus“ (verbindlich)

Charakter: helles, kühles Grün-Grau als Grund, Weiß für Flächen, Moosgrün als einziger Akzent, weiche 14-px-Radien, Pillen für Status. Ruhig, freundlich, „Wachstum“ ohne Kitsch. Referenzbild: Übersichtsseite mit linker Sidebar (228 px), Projekt-Kopf mit großem Titel, vier Kennzahl-Kacheln (Signups-Kachel leicht grün hinterlegt), links Aufgabenliste mit Abhaken, rechts 12-Wochen-Timeline (Kanäle als Zeilen, veröffentlichte Stücke als gefüllte Balken, geplante als gestrichelte) und darunter die Freigabe-Queue.

Schriften (Google Fonts, mit Fallbacks): **Gabarito** 500–700 für Überschriften, Logo und große Zahlen; **Nunito Sans** 400–600 für Fließtext und UI; **DM Mono** für Labels in Versalien, Wochen-Nummern, Statuspillen und alles Tabellarische. Labels in Versalien mit `letter-spacing: .08em`, Zahlen mit `font-variant-numeric: tabular-nums`.

Bausteine: Sidebar-Hintergrund `--mp-sidebar`, aktiver Nav-Eintrag weiße Fläche mit Akzent-Icon; Karten weiß, 1 px `--mp-line`, Radius 14 px; Primär-Button Akzent-Fläche, weiße Schrift, Pillenform; Sekundär-Button Rahmen; Checkbox rund, gefüllt mit Akzent bei erledigt; Statuspillen mit den Paaren aus `tokens.css` (done, review, todo, in_progress, kind). Semantische Farben (warn, bad) sind vom Akzent getrennt und nur für Zustände.

Timeline: Zeilen 32 px hoch, Spalten `repeat(12, minmax(0, 1fr))` mit 1 px `--mp-grid-line`, Heute-Spalte `--mp-today` hinterlegt, Balken 14 px hoch, Radius 7 px, gefüllt = veröffentlicht, gestrichelt = geplant. Die Timeline scrollt in ihrem Container, nie die Seite.

---

## Hinweise für Claude Code (in jedem Shot gültig)

- Frag nach, bevor du die Datenbank oder Auth des Hosts anfasst. Alles andere entscheide selbst und dokumentiere es in `docs/DECISIONS.md`.
- Bevorzuge langweilige, gut gewartete Bibliotheken. Keine Bibliothek mit weniger als einem Jahr Historie ohne Rückfrage.
- Keine Funktion, die Engagement automatisiert (Follows, Likes, DMs, Massen-Kommentare). Das ist kein Feature-Wunsch für später, sondern ein Ausschluss.
- Wenn ein Schritt in einem Shot nicht sauber machbar ist, baue die Vorbereitung (Daten, Text, Assets, Deep-Link, Abhak-Button) und markiere die Aufgabe als `human`, statt eine halbe Automatisierung zu liefern.
- UI-Sprache Deutsch, Code und Kommentare Englisch.
