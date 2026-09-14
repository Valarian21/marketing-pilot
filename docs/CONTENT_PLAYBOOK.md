# Content-Playbook Binderplan

**Diese Datei ist die Vorgabe, nicht die Anregung.** Wer Content für Binderplan baut —
Reel, Bildpost, Caption — arbeitet sie ab, statt sich in jeder Sitzung neu zu überlegen,
wie ein Reel aussieht. Abweichungen sind erlaubt, aber sie werden hier eingetragen,
wenn sie sich bewährt haben. Sonst ist in vier Wochen wieder alles anders.

Stand: 14.09.2026. Gilt für Instagram, TikTok, Threads, YouTube Shorts.

---

## 1. Die Stimme

Wir schreiben als **Sammler, der sich auskennt** — nicht als Marke, die Sammler anspricht.
Der Unterschied entscheidet in dieser Nische über alles: Pokémon-Sammler riechen eine
Werbeagentur auf zwanzig Meter, und der erste Satz, der nach Broschüre klingt, kostet den
ganzen Beitrag.

**Was die Stimme ausmacht**

- Kurze Sätze. Punkt statt Komma. Ein Gedanke je Zeile.
- Konkret vor allgemein: „Glumanda unten in der Schlucht" statt „beeindruckende Motive".
- Fachwissen beiläufig, nie belehrend. Setnummern, Illustratoren, Seltenheiten fallen
  nebenbei — so, wie man sie im Gespräch erwähnt, nicht wie im Katalog.
- Die eigene Meinung darf stehen. „Die vernünftige Wahl" über Bisasam ist eine Haltung,
  und Haltung erzeugt Kommentare.
- Zahlen nur, wenn sie stimmen und die Quelle mitläuft (Cardmarket, Stand, Basis).

**Was sofort verbrennt**

| Nie | Warum |
|---|---|
| „Tauche ein in die Welt von …" | Agenturdeutsch, erste Zeile, Reel ist tot |
| „Entdecke jetzt unser Tool" | Wir verkaufen kein Tool, wir zeigen eine Seite |
| „🔥 UNGLAUBLICH 🔥", Emoji-Ketten | TikTok-Spam von 2021 |
| „Wusstest du, dass …" | Der Standardanfang jeder KI-Caption |
| Drei Adjektive hintereinander | „atemberaubende, einzigartige, hochwertige" |
| Ausrufezeichen am Satzende | Höchstens eines je Beitrag, besser keines |
| Behauptungen über Karten, die man nachprüfen kann | Siehe „Im Slab sieht man die Rückseite nie" — falsch, und die Nische merkt es sofort |
| „Als Sammler weißt du …" | Anbiedern. Wir *sind* Sammler, wir müssen es nicht sagen |
| Jeder Hinweis auf KI (Bild, Caption, Fußzeile) | Siehe unten — lenkt vom Beitrag ab, öffnet eine fremde Debatte |

**Verboten: jeder sichtbare Hinweis auf KI.** Kein „Bild: KI · Karten: echt" im Video,
keine Zeile „Die Bilder sind KI-erzeugt" in der Beschreibung, kein „KI-generiert" in einer
Fußzeile, keine Erwähnung von Modellen oder Bildgeneratoren. Der Beitrag zeigt eine
Binderseite — das ist die Aussage, und jeder Zusatz darüber, wie sie entstanden ist, lenkt
davon ab und lädt zu einer Debatte ein, die nichts mit dem Produkt zu tun hat. Die Regel
gilt für Reels, Bildposts, Captions und Slides gleichermaßen.

**Ebenfalls gestrichen: der Markenhinweis** „Kein offizielles Pokémon-Produkt." (seit
14.09.2026). Dass ein Binder-Planer kein Produkt von Nintendo ist, sieht jeder in der
Nische auf den ersten Blick; der Satz kostete in kurzen Captions rund 40 Zeichen und las
sich wie eine Rechtsabteilung im Feed. Kein Beitrag trägt mehr eine Fußnote — weder über
KI noch über die Marke.

Unberührt bleiben allein **die Metadaten**: Renders tragen weiter `AI-generated: true` als
PNG-Textchunk bzw. MP4-Kommentar. Unsichtbar, kostet nichts, beantwortet die Frage, falls
eine Plattform sie stellt.

**Der Fachlichkeits-Test.** Vor dem Veröffentlichen: Würde jemand mit 15 Jahren
Sammelerfahrung an irgendeiner Stelle die Augen verdrehen? Falsche Setzuordnung, falsche
Seltenheitsstufe, „seltene 1st Edition" bei einer Karte ohne Stempel, Preise ohne Zustand
— jeder dieser Fehler kostet mehr Glaubwürdigkeit, als das Reel Reichweite bringt.

---

## 2. Reel-Bauplan

Der Bauplan steckt in `scripts/reel-binder.ts` (Bild, Takt, Text) und
`src/server/agents/video/abspann-binderplan.ts` (Abspann). Wer ein neues Drehbuch anlegt,
erbt damit das Layout automatisch. Die Werte hier stehen im Code, nicht im Kopf.

### Format und Takt

- **1080 × 1920**, 25 fps, immer mit Ton (Reels über die Graph-API sind ohne Tonspur stumm).
- **Ohne Stimme.** 85–92 % sehen Reels stumm; eine Stimme, die dem Text hinterherläuft,
  schadet mehr, als sie trägt. Der Takt steht im Drehbuch, nicht in der Tonspur.
- **Gesamtlänge 18–28 s** inklusive Abspann. Darunter trägt der Aufbau nicht, darüber
  fällt die Durchsichtrate.
- **Je Clip 2,6–4,6 s.** Untergrenze ist Lesbarkeit: zwei Zeilen Text brauchen 2,5 s.
- Der **erste Clip ist die Hook** und beginnt bei 200 ms — nicht später.

### Text im Bild

| Rolle | Schrift | Größe | Zeilen |
|---|---|---|---|
| Hook (Clip 1) | Bungee, Versalien | 86 px | 2, je ≤ **16** Zeichen |
| Zwischenzeile | Archivo 800 | 62 px | 2, je ≤ 30 Zeichen |
| Schluss (letzter Clip) | Archivo 800 | 72 px | 2, je ≤ 26 Zeichen |

- Sitz: **unten links**, über einem Schleier, darüber ein gelber Strich (96 × 9 px) als
  Anker. Der Schleier ist Pflicht — ohne ihn verschwindet weiße Schrift über hellen Seiten.
- Akzentfarbe ist das **Binderplan-Gelb `#F5C518`**, nicht das Blau: Blau über dunklen
  Bildern ist unsichtbar.
- Das Skript warnt beim Bauen, wenn eine Zeile umbricht. Diese Warnung wird nicht ignoriert.
  Bis zum 14.09.2026 prüfte es **die Hook nicht mit** — Bungee in Versalien ist fast doppelt so
  breit wie eine Zwischenzeile, und „ACHT LEERE FÄCHER." (18 Zeichen) stand dreizeilig im Bild.
  Gemessen passen 16 Zeichen, nicht die achtzehn, die hier vorher standen.
- **Kennzeichnung** „Bild: KI · Karten: echt" läuft dauerhaft mit, außer das Reel zeigt
  ausschließlich echte Scans (`kennzeichnung: false`).

### Folgen-Hinweis mit Pfeil (seit 14.09.2026)

Eine Pille `@binderplan.app` mit gelbem „Folgen"-Knopf **und ein Pfeil auf den echten
Folgen-Knopf der App**, 2,6 s lang, ab dem vorletzten Clip (`folgenAbClip` überschreibt,
`null` schaltet ab).

**Warum mitten im Reel und nicht im Abspann.** Der Abspann ist der einzige Moment, in dem
die Adresse im Bild steht; zwei Aufforderungen in drei Sekunden heben sich auf. Und: Wer
den Abspann sieht, ist ohnehin geblieben — der Hinweis gehört an die Stelle, an der das
Reel gerade geliefert hat und noch alle zusehen.

**Je App eine eigene Fassung.** Der Knopf steht überall woanders, also wird das Reel je
Ziel gebaut: `--plattform instagram | tiktok | shorts`. Nur diese eine Ebene unterscheidet
sich.

| App | Wo der Knopf liegt | Unsere Anordnung |
|---|---|---|
| Instagram | Autorzeile unten links, „Folgen" neben dem Namen | Pille unten links, Pfeil nach unten rechts |
| YouTube Shorts | Kanalzeile unten links, „Abonnieren" | wie Instagram, Pfeil etwas flacher |
| TikTok | Profilbild mit rotem Plus, Aktionsspalte rechts | Pille rechts über der Spalte, Pfeil nach unten rechts |

Die Zielkoordinaten in `SITZE` (`scripts/reel-binder.ts`) sind **am Bild geschätzt, nicht
am Gerät gemessen** — sie verschieben sich mit App-Version und Geräteformat. Wer ein Muster
gegen einen echten Screenshot hält, korrigiert sie dort.

Bei Instagram und Shorts steht die Pille da, wo sonst der Satz steht. Der **Satz weicht**:
Seine Einblendung endet 150 ms bevor die Pille kommt. Erst der Text, dann der Hinweis —
nie beides übereinander.

### Abspann

Variante **d („Aufbauen")**, **3200 ms**: Das leere Logoraster fällt ein, die drei Felder
füllen sich (550/680/810 ms), kurzer Puls, dann `binderplan.app` (ab 1150 ms), der Claim
„Plane deine Seite, bevor du kaufst." und die Pille „Kostenlos, ohne Anmeldung".

Die 3200 ms sind kein Geschmack, sondern eine Korrektur: Das Ausblenden beginnt bei
`ABSPANN_MS − 420`. Bei den früheren 2000 ms verschwand der Abspann bei 1580 ms — die
Fußzeile war erst bei 1800 ms vollständig da. Jetzt steht das fertige Bild rund eine
Sekunde, bevor es geht.

**Der Abspann gehört hinter jedes Video — ausnahmslos.** Kunstseiten-Reels, Preis-Reels,
Erklärstücke, Stories: Was als Video herausgeht, endet mit diesem Abspann. Er ist die
einzige Stelle, an der die Adresse im Bild steht, und Wiedererkennung entsteht aus
Wiederholung, nicht aus Abwechslung.

Fertige Reels rüstet `scripts/reel-abspann.ts --anhaengen alle` nach; die Länge des alten
Abspanns kommt aus `meta.abspannMs` (ältere Reels: 2000).

### Musik

Fester Track je Drehbuch, nicht zufällig — sonst ergibt ein zweiter Lauf ein anderes Reel.
Lautstärke auf Reel-Pegel (`loudnorm I=-16`), nicht gedämpft: ohne Stimme trägt die Musik
allein.

---

## 3. Die Beschreibung

**Aufbau, immer gleich:**

1. **Zeile 1 = die Hook aus dem Video**, wortgleich. Das ist der einzige Teil, den die
   meisten sehen.
2. Leerzeile. Dann **zwei bis vier kurze Absätze**: was zu sehen ist, warum es interessant
   ist, welches Fachdetail dazugehört.
3. Bei Kunstseiten: **ein Satz, wie es gebaut ist** („ein Motiv über alle neun Fächer,
   ausgedruckt in 63 × 88 mm, die Kartenfächer bleiben frei"). Das ist der Nutzwert, der
   geteilt wird.
4. **Keine Fußnoten.** Kein Wort über KI, kein Markenhinweis, kein Haftungssatz — der
   Beitrag endet mit seiner Frage (siehe Abschnitt 1).
5. **Eine Frage am Schluss.** Keine Aufforderung zum Liken — eine echte Frage, auf die ein
   Sammler eine Meinung hat.
6. Hashtags erst danach, durch eine Leerzeile getrennt.

**Der Stil ist „meinungsstark"** (am 14.09.2026 aus fünf Mustern gewählt). Das heißt: eine
eigene Position, offen ausgesprochen, mit einer Einladung zum Widerspruch am Schluss. Kein
Ausgewogenheits-Deutsch, keine Aufzählung von Vorteilen. Beispiel:

> Drei Slabs. Oder eine Seite.
>
> Ich verstehe Grading. Wirklich. Aber eine Karte, die in einer Box im Schrank liegt, macht
> niemandem Freude — auch dir nicht.
>
> Im Binder schlägst du sie auf. Und daneben liegt die Entwicklung, aus der sie kommt.
>
> Sagt mir, warum ich falsch liege.

Die Position muss dabei **haltbar** sein: eine Meinung über Geschmack (Binder vs. Slab,
Vintage vs. Modern, welche Illustration die bessere ist) — nie eine Behauptung über Fakten,
die jemand nachschlagen und widerlegen kann. Und bei Formaten, die beide Lager ansprechen
sollen (Post-Art D), gilt das Gegenteil: dort **keine** Partei ergreifen.

**Länge: 350–500 Zeichen für Instagram, höchstens 150 für TikTok und Threads.** Am
14.09.2026 lagen die ersten Fassungen bei 600 bis 1.100 Zeichen — das liest im Feed
niemand, und es klang nach Erklärung statt nach Meinung. Drei Absätze reichen: Hook,
Beobachtung mit Haltung, Frage. Die Quellenzeile zählt nicht zur Länge, ist aber Pflicht.

**Zwei Fassungen je Stück.** Das Drehbuch trägt `caption` (Instagram, 60–120 Wörter) und
`captionKurz` (TikTok, Threads, Shorts). Der Bau nimmt je nach `--plattform` die passende
und kürzt die Schlagworte von sechs auf drei. Fehlt die Kurzfassung, nimmt er die ersten
zwei Absätze der langen — besser ist eine eigene, die mit der Pointe beginnt.

**Hashtags:** 5 bis 6, nie mehr. Aufbau: ein Set-/Themen-Tag (`#pokemon151`,
`#30thcelebration`), ein Motiv-Tag (`#binderart`, `#kantostarter`), ein bis zwei
Nischen-Tags (`#pokemonsammeln`, `#chasecards`), zum Schluss `#binderplan`. Keine
Reichweiten-Tags wie `#fyp` oder `#viral` — sie bringen in dieser Nische nichts und sehen
nach Verzweiflung aus.

**Je Kanal:**

- **Instagram:** voller Aufbau, Link nur in der Bio.
- **TikTok:** Zeile 1 plus ein Satz, maximal drei Tags. Lange Captions werden abgeschnitten.
- **Threads:** kein Link (Reichweite bricht ein), **ein** Topic-Tag, 2–4 Sätze, offene
  Frage. Antworten zählen dort mehr als Likes — auf jede Antwort wird geantwortet.
- **YouTube Shorts:** Titel = Hook, Beschreibung zwei Sätze plus Adresse.

---

## 3a. Was gebaut ist

Zwölf Drehbücher stehen in `scripts/reel-binder.ts`, jedes in drei Fassungen (Instagram,
TikTok, Shorts). Gebaut wird **in zwei Schritten**:

```bash
pnpm exec tsx scripts/reel-binder.ts --drehbuch <name> --plattform instagram --ohne-folgen
pnpm exec tsx scripts/reel-plattformen.ts --drehbuch <name>
```

Der erste Lauf rechnet das Reel einmal — fertig bis auf die Folgen-Pille, der Satz des
vorletzten Clips weicht ihr trotzdem schon. Der zweite legt die Pille für jede App auf und
schreibt drei Stücke mit dem je passenden Text. Gemessen am 14.09.2026: 65 s für die Basis,
25 s je Fassung. Alles dreimal komplett zu bauen kostete **vier Minuten pro Fassung** — bei
zwölf Themen der Unterschied zwischen einer halben und zweieinhalb Stunden.

Eine einzelne Fassung ohne Basis geht weiter direkt:
`reel-binder.ts --drehbuch <name> --plattform tiktok`.

| Drehbuch | Thema | Post-Art | Quelle |
|---|---|---|---|
| `slab` | Drei Slabs. Oder eine Seite. | A | Kunstseite |
| `starter` | Welcher war deiner? | A | Kunstseite |
| `dreissig` | 30 Jahre — plan schon mal | A | Kunstseite |
| `neunfaecher` | Neun Fächer, ein Bild | F | Kunstseite |
| `pikachu` | 30 Jahre, 30 Pikachu | B | Kartenscans |
| `preise` | Set kommt Mittwoch, Preise stehen schon | B | Katalog |
| `futuristic` | Zwei Karten, ein Preis | B | Katalog |
| `aera` | Die neun teuersten der WotC-Zeit | C | Katalog, Bereich `era` |
| `illustrator` | Neun Karten, ein Zeichner | — | Katalog, Bereich `illustrator` |
| `duell` | Welche ist teurer? | — | Katalog |
| `seitenwert` | Was kostet diese Seite? | — | Katalog |
| `vintagemodern` | Team Vintage oder Team Modern? | D | Katalog |
| `raketen` | Preis-Raketen der Woche | — | `priceMovers`, 7 Tage |
| `exaera` | Acht davon hat ein Mann gezeichnet | C | Katalog, Bereich `era` |
| `sugimori` | Der Mann, der die Originale gezeichnet hat | — | Katalog, Bereich `illustrator` |
| `glurakduell` | 1999 gegen 2025 | D | Katalog |
| `billigseite` | Eine volle Seite für 106 € | — | Katalog, Preisgrenze |
| `farbblau` | Neun Karten, ein Blau | G | Bildmotiv-Analyse, Ton 210° |
| `farbgruen` | Dieselbe Idee in Grün | G | Bildmotiv-Analyse, Ton 130° |
| `feelinara` | Eine Karte, und die Seite drumherum | G | Bildmotiv-Analyse, Anker cel30-153 |
| `bisaflor` | Eine Karte, acht Lücken | A | Kunstseite `luFp3Ss3iCi_` |
| `mauzigasse` | Ein Pokémon, drei Regionen | A | Kunstseite `oGTiqnIKyVjU` |
| `turtok` | Oben Strand, unten Riff | A | Kunstseite `oW6p_fCa7CgP` |

**Daten und Bilder für ein neues Drehbuch** holt `scripts/reel-daten.ts`: Es fragt den
Produktkatalog ab, legt die Scans unter `assets/<projekt>/karten/` ab und gibt die
Drehbuch-Zeilen fertig aus.

```bash
pnpm exec tsx scripts/reel-daten.ts --bereich era:klassik --n 9
pnpm exec tsx scripts/reel-daten.ts --bereich illu:"Mitsuhiro Arita" --n 9
pnpm exec tsx scripts/reel-daten.ts --pokemon Rayquaza      # alle Karten eines Pokémon
pnpm exec tsx scripts/reel-daten.ts --karten ex8-102,M6-113 # einzelne, für Vergleiche
```

**Ein Namensschild nur, wo die Karte ihren Namen nicht selbst zeigt.** Auf einer Vorderseite
liegt es genau über dem gedruckten Namen; dort gehört es nicht hin. Rückseiten und
Zusatzangaben (Set, Jahr) sind der Grund, warum es das Feld gibt.

Was der Katalog liefert, steht mit einer Abdeckungszahl da (`coverage`): Unter 80 %
nachbepreiste Karten wird ein Bereich nicht gepostet — die Rangliste wäre schief.

## 4. Der Post-Katalog

Sechs Sorten, jede mit festem Zweck. Was nicht in diesen Katalog passt, ist ein Versuch —
Versuche laufen als einzelner Beitrag, nicht als Serie, und kommen erst nach Zahlen dazu.

### A — Binderseite des Tages (Kunstseite) · **täglich** · trägt alles

Das Format, das bisher als einziges verlässlich läuft. Eine Kunstseite aus der Vitrine,
Fahrt über die Fächer, Wandel vom ganzen Blatt zur Seite in Hüllen.

- **Bauweise:** `scripts/reel-binder.ts --drehbuch <name>`, Bausteine `ganz` / `binder` /
  `drei` / `fahrt` / `wandel`.
- **Hook-Muster:** ein Widerspruch oder eine Entscheidung. „Sechs Fächer sind leer.",
  „Drei Slabs. Oder eine Seite.", „Welcher war deiner?"
- **Schluss:** eine Frage oder eine Aufforderung zum Weiterschicken („Schick das dem, der
  Schiggy genommen hat.") — Sends sind der stärkste Reichweitenhebel außerhalb der Follower.
- **Zusätzlich als Bildpost:** dieselbe Seite als Einzelbild, Layout siehe Abschnitt 5.

### B — Top-Karten eines Sets · **1–2 × pro Woche**

Die Rangliste, die es schon gibt: Top 9 oder Top 20 eines Sets, Preise aus Cardmarket,
30-Tage-Schnitt als Basis.

- **Bauweise:** Ranglisten-Bundle (`generateDataBundle`, Bereich `set`), Reel-Variante mit
  `fuellung`: das Blatt füllt sich Karte für Karte, jede mit Preisschild.
- **Die Spitze kommt zuletzt — immer.** Das Blatt füllt sich **aufsteigend**: Platz 9 zuerst,
  die teuerste Karte allein am Schluss. Wer den Höchstpreis zuerst zeigt, hat nach zwei
  Sekunden nichts mehr zu erzählen, und der Rest des Reels ist ein Abstieg. Im Code machen
  das `aufsteigend()` und `ohneSpitze()`; am 14.09.2026 war es in drei neuen Ranglisten
  versehentlich andersherum und musste nachgebaut werden.
- **Pflicht an jeder Zahl:** Stand, Quelle, Basis („Cardmarket, 30-Tage-Schnitt, Stand
  13.09."). Ohne das ist die Zahl angreifbar, und in dieser Nische wird sie angegriffen.
- **Eine Rangliste braucht eine Beobachtung.** Neun Preise sind eine Liste; erst die
  Verbindung dazwischen ist ein Beitrag — „acht davon hat derselbe Mann gezeichnet", „oben
  steht nicht das Base-Set", „die berühmteste ist nur Platz fünf".
- **Hook-Muster:** die Spitze zuerst verdecken. „Die teuerste Karte im Set kostet mehr als
  das Display." Auflösung am Ende.

### C — Top-Karten einer ganzen Ära · **1 × pro Woche**

Dasselbe, eine Stufe größer: WOTC, e-Card, EX, HGSS, Schwarz/Weiß, Mega. Der Bereich
`era` ist im Datenprovider vorhanden (`listEras()`), das Bundle kann ihn direkt.

- **Warum eigenes Format:** Eine Ära ist eine Zugehörigkeit, kein Produkt. „Die teuersten
  Karten der HGSS-Ära" spricht alle an, die damals gesammelt haben — auch die, die das Set
  nicht kennen.
- **Hook-Muster:** Jahreszahl als Anker. „2010 hast du die im Schulhof getauscht."
- **Vorsicht:** Ären mit wenigen nachbepreisten Karten liefern schiefe Ranglisten. Die
  Abdeckung (`coverage`) steht im Bundle — unter 80 % wird der Zeitraum nicht gepostet.

### D — Vintage vs. Modern · **1 × pro Woche**

Zwei Karten desselben Pokémon aus verschiedenen Ären nebeneinander, Preis gegen Preis.
Beispiel: Rayquaza ex (Deoxys, 2005) gegen Rayquaza aus einem aktuellen Set.

- **Hook:** „Team Vintage oder Team Modern?" — die Kategorie heißt intern **vintage-vs-modern**.
- **Aufbau:** links alt, rechts neu, beide verdeckt → Auflösung nacheinander → Frage.
- **Warum es funktioniert:** Es zwingt zu einer Antwort, und beide Lager kommentieren.
  Wichtig ist, **keine Partei zu ergreifen** — sobald wir eine Seite wählen, hört die eine
  Hälfte auf zu diskutieren.
- **Auswahlregel:** dasselbe Pokémon, vergleichbare Seltenheitsstufe, beide Preise mit
  Verlauf. Ein Vergleich zwischen einer Alt-Illustration und einer Massenkarte ist kein
  Vergleich, sondern ein Taschenspielertrick — und wird als solcher erkannt.
- **Status:** Bautyp fehlt noch, Daten sind da.

### E — Beste und schwächste Sets der Woche · **1 × pro Woche, fester Tag**

„Das Set mit dem stärksten Anstieg der letzten sieben Tage war X, das schwächste Y."

- **Status:** braucht eine neue Datenfunktion. `priceMovers()` arbeitet auf Kartenebene;
  für Sets fehlt die Aggregation (Median der Kartenbewegungen je Set, Mindestzahl Karten
  mit Verlauf). Solange die nicht steht, wird das Format **nicht** geschätzt.
- **Ehrlichkeitsregel:** Nur Zeiträume, die wirklich gemessen sind. Der Preisverlauf
  speichert seit Kurzem und nur Bewegungen — „seit 2020" können wir nicht belegen und
  behaupten es deshalb nicht.
- **Wiedererkennung:** immer derselbe Wochentag, immer dasselbe Layout. Das Format lebt
  davon, dass man es erwartet.

### F — Eigenwerbung: das Werkzeug · **höchstens 1 von 7 Beiträgen**

Wie eine Seite entsteht: Motiv wählen, neun Fächer, Druck in 63 × 88 mm, einstecken.

- **Regel:** Nutzwert zeigen, nicht Funktionen aufzählen. Der Beitrag muss auch ohne
  Kaufabsicht etwas wert sein — sonst ist er Werbung, und Werbung wird weggewischt.
- **Der Anlass ist besser als die Ankündigung:** „Von Hand: zuschneiden, abmessen, hoffen"
  funktioniert, „Neu: unser Planer" nicht.

### G — Farbseiten · **1–2 × pro Woche**

Neun Karten, die **farblich zusammenpassen** — gebaut aus der Bildmotiv-Analyse des Produkts
(`card_art_tags` kennt für 23.461 Karten die drei dominanten Farben). Das ist das Format,
das am direktesten zeigt, wofür ein Planer gut ist: Wer nach Setnummer sortiert, bekommt nie
eine Seite, die als Bild funktioniert.

```bash
pnpm exec tsx scripts/reel-farbseite.ts --ton 210 --max 100
pnpm exec tsx scripts/reel-farbseite.ts --anker cel30-153 --mitte cel30-153 --max 0
```

Drei Regeln, alle am 14.09.2026 aus Fehlversuchen entstanden:

- **Nicht nur der Farbton zählt.** Nach reinem Ton landen neben einer blass-rosa Karte
  knallige Feuerkarten — derselbe Winkel, völlig andere Wirkung. Sättigung und Helligkeit
  gehen mit ins Maß (0,3 Sättigungsunterschied wiegt etwa 18° Farbton).
- **Nur vollflächige Seltenheiten.** Eine gewöhnliche Holo zeigt ein Bildfenster von einem
  Drittel Kartenhöhe; neun davon sind neun Rahmen, keine Seite.
- **Das Budget ausschöpfen, nicht unterbieten.** Sortiert nach Farbnähe *und Preis
  absteigend* — beim ersten Lauf kostete eine 100-€-Seite ganze sechs Euro, rechnerisch
  richtig und im Binder enttäuschend.

Für Karten, die die Analyse noch nicht kennt (frische Sets), rechnet das Werkzeug die
Farben aus dem Scan.

### Vorschläge, die dazukommen sollten

| Idee | Warum | Aufwand |
|---|---|---|
| **Karten-Duell** („Welche ist teurer?") | Zwingt zum Raten, hält bis zur Auflösung, erzeugt Kommentare. Stärkstes Watch-Time-Format, das mit unseren Daten baubar ist. | klein — zwei Karten, Verdeckung, Auflösung |
| **Was kostet diese Seite?** | Neun Karten, eine Summe. Sammler rechnen sofort mit, viele schicken es weiter („so viel liegt bei dir im Binder"). | klein — Preise + Binder haben wir |
| **Sammler-Fehler** (Hüllen, Sonne, Druckstellen, Binder-Dellen) | Reiner Nutzwert, braucht keine Daten, wird gespeichert und geteilt. Sends sind der Hebel. | klein, aber redaktionell |
| **Illustrator-Seiten** (Arita, Mitsuhiro Arita, 5ban) | Der Bereich `illustrator` ist im Provider schon da. Kennerthema, hohe Bindung in der Nische. | klein — Bereich umstellen |
| **Neues Set: erste Preise** | Terminbezogen, hoher Neuigkeitswert (siehe 30th Celebration). Funktioniert nur am Erscheinungstag. | mittel, kalendergetrieben |

Nicht empfohlen: Unboxing (haben wir nicht), Gewinnspiele (holt Konto-Sammler, keine Nutzer),
Preisprognosen (unbelegbar, beschädigt die Glaubwürdigkeit dauerhaft).

### Wochenrhythmus

| Tag | Pflicht | dazu |
|---|---|---|
| Mo | A — Binderseite | E — Sets der Woche |
| Di | A | B — Top-Karten Set |
| Mi | A | Duell oder Sammler-Fehler |
| Do | A | C — Ära |
| Fr | A | D — Vintage vs. Modern |
| Sa | A | B oder Illustrator |
| So | A | F — Werkzeug |

---

## 5. Bildposts

Nicht jeder Beitrag muss ein Reel sein. Ein Einzelbild kostet Minuten statt einer Stunde,
und auf Threads trägt es weiter als Video.

### Layout „Seite des Tages" (1080 × 1350)

Für Post-Art A als Einzelbild. Aufbau von oben:

1. **Kopfzeile**, klein, Versalien, gelb: `BINDERSEITE DES TAGES` — links, mit gelbem Strich.
2. **Die Seite** als Hüllenansicht (neun Fächer, Nähte sichtbar), leicht gekippt, mit
   Schlagschatten. Sie füllt die Bildmitte und ist der einzige Held.
3. **Titelzeile** darunter, Archivo 800, zweizeilig — derselbe Satz wie die Reel-Hook.
4. **Fußleiste**: rechts die Pille `binderplan.app`. Links bleibt frei — dort stand bis zum
   14.09.2026 ein KI-Hinweis, der ersatzlos entfallen ist.

Kein Logo oben *und* unten. Keine Rahmen um das Bild. Keine zweite Farbe außer Gelb.

**Als Beitrag anlegen**, nicht nur als Datei: `scripts/stueck-anlegen.ts --plan <datei.json>`
rendert den Bildpost und legt das Stück mit Kanal, Sorte, Text und Schlagworten an. Das reine
Bild ohne Stück gibt `scripts/bildpost-seite.ts`; das Layout liegt für beide in
`src/server/agents/studio/bildpost.ts`.

**Pinterest ist eine Suchmaschine, kein Feed.** Dort beginnt die Beschreibung mit dem Motiv in
Worten („Drei Vögel, eine Reihe: Arktos, Zapdos und Lavados …") und endet mit den Begriffen, unter
denen jemand danach sucht — nicht mit einer Frage, und ohne ein einziges Hashtag. Das ist die
einzige Stelle, an der die Regel „Zeile 1 = Hook, wortgleich" bewusst nicht gilt.

### Layout „Rangliste" (1080 × 1350)

Steht schon: `binderRankHtml()` in `src/server/agents/studio/render.ts` — Platzziffer,
Kartenbild, Name, Nummer, Illustrator, Preis, Fußzeile mit Stand und Quelle. Wird für
B, C und die Einzelbilder der Threads-Beiträge verwendet.

---

## 6. Checkliste vor dem Veröffentlichen

- [ ] Hook im Bild = Zeile 1 der Caption, wortgleich?
- [ ] Jede Zahl mit Stand, Quelle und Basis?
- [ ] Fachlich nachprüfbar richtig (Set, Nummer, Seltenheit, Illustrator)?
- [ ] Kein sichtbarer KI-Hinweis im Bild, in der Caption, in der Fußzeile?
- [ ] Folgen-Pille mit Pfeil für die richtige App gebaut (`--plattform`)?
- [ ] Abspann angehängt, 3200 ms?
- [ ] Keine Zeilenumbruch-Warnung beim Bauen?
- [ ] Tonspur vorhanden (sonst stummes Reel)?
- [ ] 5–6 Hashtags, kein `#fyp`?
- [ ] Schlussfrage ist eine echte Frage?
- [ ] Erster Satz würde einen Sammler nicht die Augen verdrehen lassen?
