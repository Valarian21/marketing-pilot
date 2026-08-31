# Marketing Pilot – Ausbauplan V2: Binderplan & Daten-Content (Shots 6–11)

> **Für Claude Code:** Dieser Plan setzt `MARKETING_PILOT_PLAN.md` (Shots 0–5, alle gebaut) fort. Lies zuerst diese Datei komplett, dann `docs/PROGRESS.md`. Alle Regeln aus dem Kontext-Abschnitt von V1 gelten unverändert (Host-Adapter, `mp_`-Tabellen, Freigabe-Stufen, Audit, Tokens-Theme, TypeScript strict, Zod, Tests, kleine Commits, `docs/PROGRESS.md` und `docs/DECISIONS.md` pflegen). Der Abschnitt **Kontext V2** unten ergänzt sie. Arbeite den Shot ab, den Marcel im Terminal nennt (z. B. „Shot 6“). Bei „alle Shots“: Shot 6 bis 10 nacheinander, nach jedem Shot committen, nur bei unlösbaren Fragen stoppen. Shot 11 nur auf ausdrücklichen Wunsch.

**Ziel in einem Satz:** Der Marketing Pilot vermarktet zusätzlich zu Lehreule auch **Binderplan** (binderplan.app, Pokémon-Binder-Planer, läuft auf diesem VPS, Port 8103) – mit datengetriebenem Nischen-Content („Die 15 teuersten Karten aus …“), Carousel-Slides und Slideshow-Reels aus echten Kartendaten, fertigen Caption-/Hashtag-Paketen je Plattform, wiederkehrenden Content-Serien und – wo kostenlos möglich – automatischem Posten nach Freigabe.

---

## Anleitung für mich (Marcel)

1. Diese Datei als `MARKETING_PILOT_PLAN_V2.md` neben `MARKETING_PILOT_PLAN.md` ins `marketing-pilot/`-Verzeichnis auf dem VPS legen.
2. **Sofort, ohne neuen Code** (Abschnitt „Was heute schon geht“ ganz unten): Binderplan als Projekt anlegen, Analyse laufen lassen, Kanal-Profile eintragen.
3. Claude Code starten: `Lies MARKETING_PILOT_PLAN_V2.md und docs/PROGRESS.md, führe Shot 6 aus. Stoppe danach und fasse zusammen.`
4. Die **offenen Fragen** (vorletzter Abschnitt) beantworten – spätestens vor Shot 10.
5. Neue Session immer mit „Lies MARKETING_PILOT_PLAN_V2.md und docs/PROGRESS.md“ beginnen.

---

## Ist-Stand-Analyse (31.08.2026, Repo-Stand d79b1c8)

Was da ist und trägt: die komplette Pipeline Analyse → Strategie → Studio (Text/Carousel/Pin/Bild/Directory/Artikel) → Video-Fabrik (Playwright-Recording + ffmpeg) → Freigabe → 3-Schritt-Publish mit Kurzlinks (`/go/<code>`, Klickzählung) → Insights/Webhook → Wochen-Loop. Dazu Kanal-Profile je Projekt (`mp_settings channels:<pid>`), Heute-Cockpit, Job-Queue mit Worker und Scheduler, Kosten je Stück, AI-Tell-Kritiker, 82 Tests. Mehrere Projekte sind von Anfang an vorgesehen – **Binderplan ist schlicht das zweite Projekt**, am Grundgerüst muss dafür nichts umgebaut werden.

Was für Marcels Binderplan-Ziele fehlt (daraus ergeben sich die Shots):

1. **Kein datengetriebener Content.** Das Studio schreibt aus Brief/Persona – es gibt keine Anbindung an Produktdaten. Für „Top 15 teuerste Karten aus Set X“ braucht es einen Provider, der Binderplans Karten-/Preisdatenbank liest (→ Shot 6).
2. **Carousel-Templates kennen nur Text/Screenshot-Slides** (`agents/studio/render.ts`), keine Ranking-Slides mit Kartenbild + Preis; Größen nur 1080×1080/1350, kein 1080×1920 (TikTok-Fotomodus, Stories) (→ Shot 7).
3. **Ein Stück = eine Plattform.** Für „einmal erzeugen, überall posten“ fehlt das Bundle: gleiche Assets, aber je Plattform eigene Caption, Hashtags und Link-Regel (→ Shot 7).
4. **Hashtags sind global auf max. 2 begrenzt** (Schreibregeln in `agents/prompts/voice.ts` + `studio.ts`) – richtig für LinkedIn/X, falsch für Instagram/TikTok-Nischen-Discovery. `PLATFORM_LIMITS` in `util/utm.ts` kennt zudem kein `tiktok` (→ Shot 7).
5. **Video kann nur Screen-Recordings.** Für Top-Listen braucht es Slideshow-Reels aus Kartenbildern (Countdown, Preis-Overlays, optional Voiceover) – die ffmpeg-/Overlay-/Caption-Bausteine aus `agents/video/assemble.ts` sind wiederverwendbar (→ Shot 8).
6. **Keine wiederkehrenden Content-Serien.** Aufgaben kommen aus dem Strategie-Plan; „jeden Montag ein Top-Set-Carousel, ohne Set-Wiederholung“ gibt es nicht (→ Shot 9).
7. **Posten ist manuell** (3-Schritt-Flow; Postiz-Provider plant nur Text, lädt keine Medien hoch). Kein Zeitplan, kein Direkt-Posting über die kostenlosen Plattform-APIs, keine Link-in-Bio-Seite (→ Shot 10).

Bereits erfüllt (nicht neu bauen, nur wissen): Marcels Wunsch „Kurzlink, der die Plattformen öffnet, und Seiten in den Einstellungen eintragen“ existiert seit der UX-Runde vom 27.08.: Kanal-Profile je Projekt, `<ChannelTag>`-Links, Deep-Links zu den Upload-Seiten, Kurzlinks `agi-empire.com/go/…` mit Klickzählung im Publish-Paket.

### Binderplan-Fakten (aus dem Binderplan-Repo, für alle Shots)

- Eigener Dienst auf dem VPS: Python/FastAPI, Port **8103**, SQLite `app.db` (WAL) + Bild-Cache `cache/` im Binderplan-Verzeichnis (`BASE` in dessen `main.py`, Zeile ~27).
- Tabellen (Auszug): `cards` (id, set_id, local_id/num, name_de/en/ja, image_de/en/alt, category, rarity, kind/kinds, illustrator, hp, region intl|ja, release_date …), `sets` (id, name/name_en, serie_id/serie_name, release_date, region, symbol), `card_prices` (card_id, **eur**, **eur_holo**, updated_at – Cardmarket-Trend in Euro über TCGdex), `price_history` (card_id, datum, eur – täglicher Job, auf ~3000 Karten gedeckelt), `binders` (name, mode, layout, options, items, user_id), `pokemon` (dex, Namen, familie).
- **Ären** sind in Binderplans `main.py` (Zeilen ~60–137) definiert: ids `klassik, ex, dp, pl, hgss, bw, xy, sm, swsh, sv, me` mit deutschen/englischen Namen („swsh“ = Schwert & Schild) und einer Serie→Ära-Zuordnung + Datumslogik für Quer-Serien (POP, Trainer-Kits, McDonald's). Japanische Serien gesondert (`JP_AEREN`).
- Kartenbilder: hochauflösend als webp im Cache (`cache/cards/high/<id>[.en].webp`), öffentlich über `GET /api/img/card/{card_id}?variante=high&lang=de|en`; Quelle TCGdex-Asset-URLs (`cards.image_de/en` + `/high.webp`), Fallback pokemontcg.io (`image_alt`).
- Preise: `_fetch_price` holt je Karte `pricing.cardmarket` von `https://api.tcgdex.net/v2/{en|ja}/cards/{id}` (Trend/avg30/avg/low, plus `-holo`-Varianten). **Wichtig: `card_prices` ist nicht vollständig** – gefüllt wird, was Nutzer ansehen, der Tagesjob frischt max. 3000 auf. Für Top-Listen über ganze Sets/Ären muss der Provider fehlende/alte Preise selbst nachladen (s. Shot 6).
- Binder-Share: `GET /api/binders/{id}` ist öffentlich lesbar (View-Only-Share-Links der App) – Grundlage für Binder-Showcase-Content (Shot 11).

---

## Kontext V2 (gilt für jeden Shot, zusätzlich zu V1)

1. **Binderplan wird ausschließlich gelesen.** Der Marketing Pilot öffnet Binderplans `app.db` read-only und schreibt **nie** hinein (eigener Preis-Cache in `mp.db`). Binderplan-Code wird in Shots 6–10 nicht angefasst; falls etwas nur mit einer Binderplan-Änderung sauber geht → stoppen und fragen (Ausnahme in Shot 11 explizit geregelt).
2. **Produktdaten hinter einem Interface** (`ProductDataProvider`), Projekt-Konfiguration entscheidet, ob ein Projekt eine Datenquelle hat. Lehreule bleibt ohne – alles Neue ist generisch und darf Lehreule-Flows nicht verändern.
3. **Zahlen sind heilig.** In Daten-Formaten kommen Rang, Namen, Set und Preise deterministisch aus dem Provider – das LLM formuliert nur Caption/Hooks/Hashtags und darf Zahlen weder erfinden noch runden (Prompt-Regel + Test). Preisangabe immer mit Stand-Datum.
4. **Rechtliche Leitplanken Karten-Content:** Kartenbilder nur redaktionell (Ranking/Information), niemals Pokémon-Logos oder offizielle Grafiken in unsere Templates einbauen, keine Anmutung „offizielles Pokémon-Produkt“. Jede Daten-Slide trägt eine kleine Fußzeile: `Preise: Cardmarket-Trend · Stand TT.MM.JJJJ · binderplan.app` und die Caption-Pakete enthalten einmalig den Hinweis „Kein offizielles Pokémon-Produkt / not affiliated with Nintendo or The Pokémon Company“. Die bestehende KI-Kennzeichnung (`util/png.ts`, MP4-Metadaten) gilt auch hier – Kartenfotos selbst sind keine KI-Bilder, die Slides als Ganzes werden wie bisher markiert.
5. **Freigabe-Stufen bleiben das Rückgrat.** Neue Auto-Posting-Wege posten ausschließlich freigegebene Stücke; `human_only` für Reddit/Foren/Discord/Ads bleibt unantastbar; jede automatische Veröffentlichung landet mit Inhalt in `mp_audit_log`.
6. **Plattform-Fakten beim Bau verifizieren.** Der Abschnitt „Plattform-Fakten“ unten ist Recherche-Stand 31.08.2026 – vor Implementierung des jeweiligen Providers die aktuelle Doku prüfen und Abweichungen in `docs/DECISIONS.md` festhalten.

---

## Shot 6: Produktdaten-Provider (Binderplan lesen, Preise sicherstellen)

**Ziel:** `topCards`-/`priceMovers`-Abfragen über Sets und Ären liefern verlässliche, aktuelle Daten samt Kartenbildern – die Grundlage für alles Weitere.

1. **Interface** `src/server/providers/product-data.ts`:
   - `listSets(region?)`, `listEras()` (ids + DE/EN-Namen), `resolveSet(nameOrId)`,
   - `topCards(q: { scope: {set?: string; era?: string; region?: "intl"|"ja"}; n: number; priceBasis: "max"|"normal"|"holo"; minPrice?: number; excludeKinds?: string[] })` → Karten mit Rang, Namen (de/en), Set-Name, local_id, Rarität, Illustrator, `priceEur`, `priceBasisUsed`, `priceUpdatedAt`, Gesamtwert der Liste,
   - `priceMovers(q: { days: 7|30; direction: "up"|"down"; minBaseEur: number; n: number })` aus `price_history` (Absolut- und Prozent-Änderung),
   - `cardImage(cardId, lang)` → lokaler Dateipfad (s. Punkt 4),
   - `newestSets(n)` (nach `release_date`, für Serien in Shot 9).
2. **Implementierung `binderplan`** (`product-data.binderplan.ts`):
   - Öffnet die DB aus `MP_BINDERPLAN_DB` (Default: `../binderplan/app.db` relativ zum Paket – Pfad beim Einbau am echten VPS-Layout prüfen) **read-only** via better-sqlite3 (`{ readonly: true, fileMustExist: true }`). Achtung WAL: der Reader braucht Lesezugriff auf `-wal`/`-shm` (gleicher Unix-User `developer` – prüfen; falls Berechtigungen klemmen, Fallback: DB-Datei einmal je Lauf nach `MP_DATA_DIR/cache/binderplan.db` kopieren und die Kopie lesen, Kopie max. 1 h alt).
   - **Ären-Logik nachbauen:** die `AEREN`-/`AERA_SERIEN`-Tabellen und die Datumslogik aus Binderplans `main.py` als Konstante in TS übernehmen (Quelle im Kommentar nennen), mit Tests gegen bekannte Zuordnungen (z. B. `swsh1`→swsh, `sv01`→sv, und ein POP-/McDonald's-Set, das über das Datum der laufenden Ära zugeschlagen wird).
   - `priceBasis: "max"` (Default) = `max(eur, eur_holo)` – bei alten Holos ist die Holo-Variante die wertvolle.
3. **Preis-Vollständigkeit:** eigene Tabelle **`mp_card_prices`** (card_id PK, eur, eur_holo, source `binderplan|tcgdex`, fetchedAt) in `mp.db`. Ablauf je Abfrage: Preise aus Binderplans `card_prices` lesen; Karten ohne Preis oder älter als `MP_PRICE_MAX_AGE_HOURS` (Default 72) direkt von TCGdex nachladen (`https://api.tcgdex.net/v2/{en|ja}/cards/{id}`, `pricing.cardmarket`, Trend→avg30→avg→low wie Binderplan, 4–6 parallel, Timeout 20 s, höflich mit kleinem Delay) und in `mp_card_prices` cachen – **nie** in Binderplans DB schreiben. Effektiver Preis = der frischere aus beiden Quellen. Ein ganzes Set (150–250 Karten) muss in < 2 min komplett bepreist sein; eine Ären-Abfrage lädt nur die Top-Kandidaten nach (erst grob nach vorhandenen Preisen sortieren, dann die obersten ~3·n Karten auffrischen, dann final ranken – nicht 3500 Karten je Lauf).
4. **Bilder:** `cardImage` versucht in dieser Reihenfolge: Binderplans Cache-Datei (`MP_BINDERPLAN_CACHE`, Default `../binderplan/cache`, `cards/high/<safe_id>[.en].webp`) → `http://127.0.0.1:8103/api/img/card/<id>?variante=high&lang=…` → TCGdex-URL aus `cards.image_de/en` + `/high.webp`. Ergebnis wird nach `MP_DATA_DIR/cache/cards/` kopiert/geladen und von dort verwendet (Render braucht lokale Dateien für Data-URLs).
5. **Projekt-Konfiguration:** `mp_settings` Schlüssel `dataSource:<projectId>` = `{ "provider": "binderplan" }` (per `PUT /api/mp/projects/:id/data-source`, Zod-Schema; leer = keine Datenquelle). Nur mit Datenquelle zeigen Studio/Serien später die Daten-Formate.
6. **API + UI:**
   - `GET /api/mp/projects/:id/data/status` → DB gefunden, Karten-/Set-/Preis-Zahlen, Anteil Preise < 72 h, letzter Binderplan-Preislauf (`kv preishistorie_lauf`), Cache-Größe.
   - `GET /api/mp/projects/:id/data/preview?kind=top&set=…|era=…&n=15&basis=max` und `?kind=movers&days=7` → JSON-Vorschau (lädt fehlende Preise nach, meldet Fortschritt einfach synchron mit längerer Timeout-Route oder als Mini-Job – entscheide selbst, dokumentiere).
   - Einstellungen-Seite des Projekts: Block „Produktdaten“ mit Status, Datenquelle-Auswahl und einer kleinen Tabellen-Vorschau („teuerste 10 aus <neuestes Set>“) zum Verifizieren.
7. **Tests:** Fixture-SQLite (3 Sets über 2 Ären + ja-Set, ~30 Karten, Preise teils fehlend/alt) im Repo; Tests für Ären-Mapping, `priceBasis`, Nachlade-Logik (Fake-TCGdex), movers, Bild-Fallback-Kette (Fake-fs/-http). Read-only-Garantie: Test, dass der Provider keine Schreib-Statements gegen die Binderplan-DB absetzt (readonly-Flag genügt + Assertion).

**Abnahme:** Preview liefert für ein echtes Set („Silberne Sturmwinde“/`swsh12` o. ä.) und für die Ära `swsh` je eine plausible Top-15 mit Bildpfaden, Preisen und Stand-Datum; Status-Seite grün; `pnpm lint && pnpm typecheck && pnpm test` grün.

---

## Shot 7: Daten-Carousel + Plattform-Pakete (Captions & Hashtags je Kanal)

**Ziel:** Ein Klick (oder später eine Serie) erzeugt aus einer Top-Liste fertige Carousel-Slides in zwei Formaten **und** je Ziel-Plattform ein eigenes Stück mit passender Caption, Hashtags und Link-Regel – gebündelt in der Freigabe.

1. **Neues Format `data_carousel`** in `shared/schemas.ts` (ContentPiece.format erweitern) + `ContentRequest` um `dataQuery` (das topCards-/movers-Query-Objekt aus Shot 6) und `bundlePlatforms: string[]`.
2. **Neue Render-Templates** in `agents/studio/render.ts` (tokenbasiert wie bisher, Brand-Kit-Farben):
   - `rankingSlideHtml`: Kartenbild groß (object-fit contain, nie beschneiden, weicher Schatten/Glow), Rang-Pill (DM Mono), Kartenname + Set/Nummer-Zeile, Preis groß mit `tabular-nums` („1.250 €“), dezenter Verlaufs-Hintergrund; Preis-Pfeil-Variante für movers (▲ +38 % in 7 Tagen).
   - `rankingCoverHtml`: Titel („Die 15 teuersten Karten aus Silberne Sturmwinde“), Gesamtwert der Liste, 2–3 Karten angedeutet gefächert, Brand.
   - `rankingCtaHtml`: Produkt-Screenshot (aus `mp_assets` des Projekts) + ein Satz CTA + Kurzlink bzw. „Link in Bio“-Hinweis.
   - **Disclaimer-Fußzeile auf jeder Slide** (klein, mono): `Preise: Cardmarket-Trend · Stand TT.MM.JJJJ · binderplan.app`.
   - Größen: **1080×1350** (IG-Feed) und **1080×1920** (TikTok-Fotomodus/Story) – die feste `SIZES`-Konstante in `generate.ts` wird formatabhängig.
3. **Generator** in `agents/studio/` (neben `generate.ts`, z. B. `data-content.ts`): Provider-Query ausführen → Slides deterministisch bauen (Reihenfolge absteigend, Countdown-Logik 15→1 optional per Param) → **ein** LLM-Aufruf (cheap) für Titel, Hook, Caption-Basistext und Hashtag-Vorschläge, mit den echten Zahlen im Prompt und der Regel „Zahlen exakt übernehmen, nichts erfinden“; Kritiker-Runde nur auf die Caption. Karten ohne ladbares Bild werden übersprungen (nächste rückt nach, Log-Hinweis am Stück).
4. **Plattform-Pakete (Bundle):** ein Lauf erzeugt je Plattform aus `bundlePlatforms` (Start: `instagram`, `tiktok`, `pinterest`, `facebook`; optional `bluesky`, `x`) ein eigenes ContentPiece mit gemeinsamen Assets, aber eigener Caption (Länge, Ansprache), eigenem Hashtag-Satz und Link-Regel (appOnly → „Link in Bio“, sonst Kurzlink) – verknüpft über `meta.bundleId` (= id des Leit-Stücks). Freigabe-UI gruppiert Bundles: eine Karte, Plattform-Tabs, „Alle freigeben“. Publish-Seite je Stück bleibt wie gehabt (Kurzlink, Deep-Link, kopieren).
5. **Hashtag-Engine:** `mp_settings` `hashtags:<projectId>`: Pools `{ brand: string[], topics: Record<string,string[]>, byLanguage: { de: string[], en: string[] } }` mit UI in den Projekt-Einstellungen (vorbefüllt per einmaligem LLM-Vorschlag aus Analyse/Personas, editierbar). Plattform-Politik zentral (z. B. in `shared/channels.ts`): Instagram 6–10, TikTok 3–6, Pinterest 0 (Keywords in Beschreibung), Facebook 0–2, LinkedIn/X/Threads max. 2 (bestehende Regel). Die Schreibregeln in `prompts/voice.ts` entsprechend parametrisieren statt global „max 2“.
6. **Kleinkram, jetzt mit erledigen:** `PLATFORM_LIMITS` um `tiktok: 2200` und `youtube: 5000` ergänzen; `ContentRequest.language` (de|en) für EN-Varianten (Binderplan ist DE-first, EN verdoppelt die Nische – als Bundle-Doppel nur wenn `language: "both"`).
7. **Tests:** Fixture-Provider (aus Shot 6) → Bundle-Erzeugung mit Snapshot der Slide-HTMLs (Zahlen exakt), Hashtag-Zahlen je Plattform, appOnly-Link-Regeln, Bundle-Gruppierung im API-Payload.

**Abnahme:** „Top 15 der Schwert-&-Schild-Ära“ erzeugt in einem Lauf: IG-Stück (17 Slides × 2 Größen: Cover + 15 + CTA), TikTok-Stück (1080×1920), Pinterest-Pin (bestehender Pin-Renderer mit Ranking-Cover), Facebook-Stück; alle Preise identisch mit der Preview aus Shot 6; Disclaimer auf jeder Slide; Freigabe zeigt ein Bundle.

---

## Shot 8: Daten-Reel (Slideshow-Video aus der Top-Liste)

**Ziel:** Aus denselben Daten entsteht ohne Aufnahme ein vertikales Reel (1080×1920, 25 fps, 30–60 s): Countdown durch die Karten, Preis-Overlays, Hook und Endcard – wahlweise stumm (Plattform-Sound), mit Voiceover oder mit Musikbett.

1. **Neuer Job-Typ `video.slideshow`** im Worker (eigener Handler neben `renderVideoJob` in `agents/video/`; Recording-Pipeline bleibt unberührt). Payload: pieceId (Format `data_reel`), Slide-/Datenreferenzen, Optionen `{ voiceover: boolean, music: "none"|"bed", secondsPerCard: 1.4–2.5, order: "countdown"|"topfirst", hookVariants: n }`.
2. **Bausteine wiederverwenden** aus `agents/video/assemble.ts`: HTML-Overlay-Rendering (Playwright, gleiche Token-Templates), Wort-Caption-Technik, Musik-Ducking, `AI-generated`-Metadaten, Thumbnail-Erzeugung. Neu ist nur die Bildspur: je Karte ein Segment aus dem gerenderten 1080×1920-Slide-PNG mit sanftem `zoompan` (Scale 1.0→1.06), harte Schnitte oder 120-ms-Blenden, Hook-Karte 1,5 s vorn („Platz 1 ist 1.200 € wert.“ – Hook-Text aus dem LLM-Aufruf von Shot 7), Endcard 2,5 s mit CTA + Kurzlink-Text.
3. **Ton:** Standard **ohne Musik** (bestehende Entscheidung: Sound kommt lizenzsauber aus der Plattform-Bibliothek); optional Voiceover über die vorhandene ElevenLabs-Strecke (ein Aufruf am Stück, Zahlen ausgeschrieben „zwölfhundert Euro“, Wort-Captions unten); optional Musikbett aus `assets/music/` für YouTube/Landscape.
4. **Ausgabe:** H.264/AAC MP4 1080×1920 25 fps ≤ 60 s, Thumbnail = Platz-1-Frame; Assets ans Stück wie gehabt; Re-Render („Aufnahme wiederverwenden“-Analogie: Slides wiederverwenden, nur Ton/Schnitt neu) ohne Neuberechnung der Daten.
5. **Bundle-Anschluss:** `data_reel` wird Teil des Bundles aus Shot 7 (Plattform-Stücke instagram/tiktok/youtube teilen dieselbe MP4-Datei, eigene Captions); Format-Dispatch in „Jetzt ausführen“ (`agents/strategy/execute.ts`) um die Daten-Formate erweitern.
6. **Tests:** Handler mit Fake-Renderer/-ffmpeg-Aufrufliste (Argument-Snapshots wie bei den bestehenden Video-Tests), Timing-Berechnung (n Karten × Sekunden + Hook + Endcard ≤ 60 s → sonst secondsPerCard automatisch senken oder n kappen mit Hinweis), Zahlen-in-Overlay-Snapshot.

**Abnahme:** Fixture-Lauf erzeugt ein abspielbares ~35-s-Reel mit 15 Karten im Countdown, Preis-Overlays, Endcard; einmal mit Voiceover (oder geschätzten Captions ohne Key) gerendert; Worker-Speicher bleibt unter dem bestehenden Deckel.

---

## Shot 9: Serien-Engine (wiederkehrender Content ohne Zuruf)

**Ziel:** Marcel legt einmal fest „2× pro Woche ein Top-Set-Carousel + wöchentlich Preis-Raketen“, und der Pilot erzeugt die Bundles von selbst in die Freigabe – ohne Wiederholungen.

1. **Tabelle `mp_content_series`:** id, projectId, name, kind (`top_set | top_era | price_movers | new_set | artist_spotlight | guess_the_price | binder_showcase | custom`), params (JSON: scope/region/n/priceBasis/language/formats [`data_carousel`,`data_reel`,`pin`]/platforms/secondsPerCard …), cadence (JSON: Wochentage + Uhrzeit Europe/Berlin, z. B. `{ days: ["mon","thu"], hour: 9 }`), status (`active|paused`), lastRunAt, coverage (JSON: z. B. verwendete set_ids/Themen mit Datum), createdAt/updatedAt.
2. **Scheduler-Erweiterung** (`scheduler.ts` im Worker, Muster wie Radar/GEO): fällige Serien ausführen → Bundle erzeugen (Shot 7/8) → Stücke in `review` → zugehörige Publish-Aufgaben (`mp_tasks`, verlinkt wie im Heute-Cockpit üblich) → Audit. Kein Doppellauf (Zeitstempel wie bisher in `mp_settings`).
3. **Dedup/Rotation:** `top_set` rotiert durch Sets (Reihenfolge: neueste Sets zuerst, dann höchster Gesamtwert; ein Set frühestens nach `minWeeksBetweenRepeats` wieder, Default 26); `top_era` rotiert Ären; `price_movers` ist immer frisch (7-Tage-Fenster); `new_set` feuert nur, wenn ein Set < 60 Tage alt ist und genug Preise hat; Coverage im Serien-Datensatz festhalten.
4. **Serien-Katalog** (Vorlagen mit Erklärtext, im UI anlegbar):
   - **Top-Set** („Die 15 teuersten Karten aus <Set>“) – Carousel + Reel.
   - **Top-Ära** („… der Schwert-&-Schild-Ära“) – Carousel + Reel.
   - **Preis-Raketen der Woche** (movers up, minBase 5 €) – Carousel; ideal auch als Telegram-Kanal-Post (Shot 10).
   - **Neues Set im Blick** („Diese 10 Karten aus <Set> musst du kennen“).
   - **Artist Spotlight** („10 Karten von <Illustrator>“ – `cards.illustrator`).
   - **Errate den Preis** (Engagement: Slide 1 Karte ohne Preis, Slide 2 Auflösung; Caption fragt nach Schätzungen).
   - **Binder-Showcase** (erst nach Shot 11 aktivierbar).
5. **UI `/mp/projects/:id/series`:** Liste mit Status/letzter Lauf/nächster Lauf, Anlegen aus dem Katalog (Parameter-Formular + „Vorschau erzeugen“ = einmaliger Testlauf ohne Serie), Pausieren, „Jetzt ausführen“. Heute-Cockpit: Serien-Output erscheint automatisch unter „Freigeben“/„Posten“; zusätzlich eine leise Warn-Karte, wenn eine Serie zweimal in Folge unfreigegeben liegen blieb (Stau = Kadenz zu hoch).
6. **Tests:** Fälligkeits-Berechnung (Zeitzone!), Rotation/Dedup über mehrere simulierte Wochen, Stau-Erkennung, „Vorschau erzeugen“ ohne Serienzustand.

**Abnahme:** Zwei aktive Serien erzeugen über zwei simulierte Wochen die richtigen Bundles ohne Set-Wiederholung; im echten Betrieb liegt nach dem nächsten Scheduler-Takt ein komplettes Bundle in der Freigabe.

---

## Shot 10: Veröffentlichen v2 – Bio-Seite, Zeitplan, Auto-Posting wo kostenlos

**Ziel:** Der Weg nach der Freigabe wird so kurz wie möglich: eine Link-in-Bio-Seite für Instagram/TikTok, geplante Slots je Kanal, und automatisches Posten über die kostenlosen Wege – hinter dem bestehenden `PublishProvider`-Interface, streng nach Freigabe.

1. **Link-in-Bio-Seite:** öffentliche Route `GET /go/bio/<projectCode>` (läuft über die bestehende nginx-`/go/`-Location; `projectCode` = kurzer Code in `mp_settings`, kein Projekt-UUID-Leak): gebrandet aus dem Brand-Kit, Produktlink (UTM `source=bio`), darunter die zuletzt veröffentlichten/aktiven Kurzlinks (je Stück ein Flag „im Bio zeigen“ im Publish-Paket, Default: die 5 neuesten veröffentlichten). Klicks zählen über die bestehende Kurzlink-Mechanik. Marcel trägt diese eine URL in die Instagram-/TikTok-Profile ein.
2. **Zeitplan:** Tabelle `mp_scheduled_posts` (id, pieceId, platform, scheduledAt, status `queued|posted|failed|cancelled`, providerRef, error, createdAt) + Slots je Kanal-Profil (Erweiterung der Profile aus `src/server/channels.ts`: `slots: [{day, hour}]`, Zeitzone Europe/Berlin). Buttons „Freigeben & einplanen“ (nächster freier Slot) in Freigabe/Publish. Worker-Scheduler postet fällige Einträge über den Provider; Fehler → Status `failed` + automatische Mensch-Aufgabe mit Link zum manuellen 3-Schritt-Paket (Fallback bleibt immer funktionsfähig).
3. **Provider-Ausbau** (alle hinter `PublishProvider`; je Plattform ein kleines Modul `providers/publish/<platform>.ts`; Zugangsdaten je **Projekt-Kanal-Profil** in `mp_settings`, im UI maskiert; `.env` nur für globale Defaults):
   - **`bluesky`** (sofort, offen): App-Passwort, `com.atproto`-Login, Bilder hochladen + posten. Der einfachste komplette Durchstich – zuerst bauen, daran den Zeitplan testen.
   - **`telegram`** (offen): Bot-API, Kanal-Posts mit Bild/Album – ideal für „Preis-Raketen“-Kanal.
   - **`mastodon`** (offen): Token, Statuses + Media.
   - **`meta`** (Instagram Business + Facebook-Page, kostenlos): eigener Meta-App-Zugang im Entwicklermodus reicht laut Doku für **eigene** Konten (App-Rollen), ohne App-Review – **beim Setup verifizieren**. IG-Container-Flow für `IMAGE`/`CAROUSEL`/`REELS` (Medien müssen über öffentliche URLs erreichbar sein → signierte, ablaufende Asset-Route `GET /go/a/<token>` ergänzen, nginx `/go/` deckt das ab), ~100 API-Posts/24 h je IG-Konto, lange Tokens mit Refresh. FB-Page-Posts über dieselbe App.
   - **`pinterest`**: API v5 Pins erstellen; Zugang muss beantragt werden (Trial/Standard Access) – Provider bauen, aber als „beantragt/inaktiv“ kennzeichnen, bis der Zugang da ist.
   - **`youtube`**: Upload über Data API ist quota-frei möglich (~6 Uploads/Tag Standard-Quota), **aber**: Videos aus nicht auditierten API-Projekten werden auf privat gesperrt → Provider nur bauen, wenn Marcel den Audit beantragt; sonst manueller Flow (Deep-Link auf Studio-Upload existiert).
   - **`tiktok`**: Content Posting API erfordert App-Audit, vorher sind Posts nur SELF_ONLY/privat → **bewusst manuell lassen** (Fotomodus-Slides + Reel per App, 3-Schritt-Flow + Bio-Link), bis Marcel den Audit will.
   - **`x`**: **nicht automatisieren** (API-Kosten, s. Produktplan-Recherche ~0,20 $/Post mit Link) – manueller Flow bleibt.
   - **`postiz` v2 (optional, statt/neben direkt):** Self-Host auf dem VPS ist kostenlos (Open Source; eigener Dienst nach VPS-Konvention, nur 127.0.0.1, Anleitung in `docs/POSTIZ.md`); bestehenden Provider um Medien-Upload erweitern (erst Upload-Endpoint, dann Post mit Media-Referenzen – API-Pfad je Version prüfen, deshalb hinter Feature-Flag). Ehrlicher Hinweis in der Doku: Auch Postiz braucht je Plattform deine eigenen App-Zugänge; die Plattform-Regeln oben gelten genauso – Postiz spart UI, nicht die App-Reviews.
   - **Reddit/Foren/Discord: unverändert `human_only`, kein Code-Pfad der postet** (bestehender Test bleibt bestehen und wird um die neuen Provider erweitert: kein Provider akzeptiert `platform=reddit`).
4. **Auto-Stufe konkret:** Kanal-Profil bekommt `publishMode: "manual" | "scheduled" | "auto"`. `scheduled` = nach menschlicher Freigabe zum Slot posten (Empfehlung). `auto` = Serien-Stücke dieses Kanals dürfen **ohne Einzel-Freigabe** zum Slot posten – nur wählbar für Daten-Formate (deterministische Zahlen), mit Wochen-Deckel (`autoWeeklyCap`, Default 5) und täglicher Digest-Karte im Cockpit („Heute automatisch gepostet: …“ mit Sofort-Löschen-Deep-Link zur Plattform). Default bleibt überall `manual`; die Stufen-Semantik aus V1 (`mp_audit_log` mit Inhalt) gilt für jeden Auto-Post.
5. **Insights-Anschluss:** am Stück `meta.postedVia` (`manual|postiz|api:<platform>`) + `mp_scheduled_posts`-Verknüpfung; Insights zeigen Klicks/Signups wie bisher über Kurzlink/UTM, plus Zählung „per API gepostet“ je Kanal.
6. **Tests:** Provider-Clients gegen Fakes (Request-Snapshots), Slot-Berechnung, Fallback bei Fehler (Aufgabe entsteht), Auto-Deckel, Reddit-Sperre, signierte Asset-URLs (Ablauf, kein Verzeichnis-Listing).

**Abnahme:** Ein freigegebenes Fixture-Stück wird per Zeitplan über Bluesky (Test-Account) mit Bild gepostet und im Audit protokolliert; Meta-Provider besteht den Dry-Run gegen Fakes und ist per Projekt-Einstellungen konfigurierbar; Bio-Seite ist über `/go/bio/…` erreichbar und zählt Klicks; TikTok/X erscheinen im UI ausdrücklich als „manuell (bewusst)“ mit Ein-Satz-Begründung.

---

## Shot 11 (optional, nach den Fragen unten): Binder-Showcase & Feinschliff

1. **Binder-Showcase-Serie:** Marcel pflegt 3–5 „Vorzeige-Binder“ in Binderplan (eigener Account); ihre View-Only-Share-Links (öffentlich lesbar über `GET /api/binders/{id}`) stehen in den Serien-Params. Der Pilot öffnet die Share-Ansicht per Playwright (Bausteine aus Recorder/Renderer), screenshottet einzelne Binder-Seiten (echte Produkt-Screenshots im Sinne der V1-Regel) und baut daraus Carousel („5 Binder-Seiten, die süchtig machen“) + CTA-Slide. Reel-Variante: kurzes Scroll-Recording durch den Binder über die bestehende Video-Fabrik gegen `https://binderplan.app` – dafür die Demo-Zugänge (`MP_DEMO_*`) **projektbezogen** machen (Settings je Projekt mit Env-Fallback; kleines, sauberes Refactoring in `agents/video/record.ts`-Umfeld).
2. **Katalog erweitern:** `guess_the_price` und `artist_spotlight` aktivieren (reine Konfigurationsarbeit, wenn Shot 7/9 sauber sind).
3. **Lehreule-Gegenprobe:** ein kompletter Lehreule-Durchlauf (Studio + Video) als Regressionstest, dass nichts vom Daten-Ausbau in die brief-basierten Flows geblutet hat.

---

## Plattform-Fakten (Recherche-Stand 31.08.2026 – beim Bau verifizieren)

- **Instagram/Facebook (Meta Graph API):** kostenlos; Business-/Creator-Konto + verknüpfte FB-Page Pflicht; Publishing von Bild/Carousel/Reels über Container-Flow; ~100 API-Posts/24 h je IG-Konto; für **eigene** Konten reicht eine App im Entwicklermodus mit App-Rollen (kein Review) – verifizieren; Medien nur per öffentlicher URL.
- **TikTok Content Posting API:** kostenlos, aber ohne bestandenen App-Audit sind Posts privat (SELF_ONLY); Audit-Prozess laut Produktplan-Recherche 1–2 Wochen.
- **YouTube Data API:** Upload kostenlos (Quota reicht für ~6 Videos/Tag), aber Videos aus nicht auditierten API-Projekten werden auf **privat** gesperrt; Audit beantragen oder manuell posten.
- **Pinterest API v5:** kostenlos, Zugang muss beantragt/freigeschaltet werden.
- **Bluesky (AT Protocol), Mastodon, Telegram Bot API:** offen und kostenlos, keine Reviews.
- **X:** Posten mit Link laut Produktplan-Recherche ~0,20 $/Post – bewusst manuell.
- **LinkedIn:** API nur übers Partnerprogramm – manuell (bestehender Flow).
- **Postiz:** Open Source, self-hosted kostenlos; ersetzt nicht die eigenen Plattform-App-Zugänge.
- **Reddit:** nur lesen/Entwürfe (kulturell + bestehende Hausregel `human_only`).

## Offene Fragen an Marcel (spätestens vor Shot 10 beantworten)

1. **Instagram:** Hast du ein Business-/Creator-Konto für Binderplan, verknüpft mit einer Facebook-Page? (Ohne das kein Meta-API-Posting.)
2. **Weg zum Auto-Posting:** Direkt-Provider (Empfehlung: erst Bluesky/Telegram, dann Meta) oder Postiz self-hosted als zentrale Posting-Oberfläche – oder beides?
3. **Sprache:** Binderplan-Content nur Deutsch, oder DE+EN-Bundles (EN-Pokémon-Nische ist deutlich größer)?
4. **Auto-Stufe:** Welche Kanäle dürfen nach Freigabe automatisch zum Slot posten – und willst du für Daten-Serien echtes Voll-Auto (ohne Einzel-Freigabe, mit Wochen-Deckel + Digest)?
5. **Audits:** TikTok-Audit und/oder YouTube-API-Audit beantragen (einmaliger Aufwand, Wochen Vorlauf) – oder bleiben die zwei manuell?
6. **Start-Kanäle:** Vorschlag: Instagram + TikTok als Kern, Pinterest als Evergreen, Telegram-Kanal für Preis-Raketen, Bluesky gratis mitnehmen – einverstanden?

## Was heute schon geht (ohne neuen Code)

1. **Binderplan als Projekt anlegen** (`https://binderplan.app`) und die Analyse laufen lassen – die URL ist öffentlich, der Lauf wird (anders als beim Login-Platzhalter damals) inhaltlich etwas hergeben. Brief prüfen/bestätigen, Strategie erzeugen.
2. **Kanal-Profile eintragen** (Projekt → Einstellungen → Kanäle & Profile): deine Instagram-/TikTok-/Pinterest-/Facebook-Seiten – genau das ist der „Seiten in den Einstellungen“-Wunsch; damit verlinken Aufgaben, Timeline und Publish-Pakete sofort auf deine echten Seiten, und die Kurzlinks (`agi-empire.com/go/…`) laufen bereits.
3. **Voice-Beispiele hochladen** (5–20 eigene Texte), damit Captions nach dir klingen.
4. Erste generische Stücke testen (Carousel/Reel über Landingpage) – die Daten-Formate kommen dann mit Shot 6–8.
