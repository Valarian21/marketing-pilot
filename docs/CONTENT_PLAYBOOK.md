# Content-Playbook Binderplan

**Diese Datei ist die Vorgabe, nicht die Anregung.** Wer Content für Binderplan baut —
Reel, Bildpost, Caption — arbeitet sie ab, statt sich in jeder Sitzung neu zu überlegen,
wie ein Reel aussieht. Abweichungen sind erlaubt, aber sie werden hier eingetragen,
wenn sie sich bewährt haben. Sonst ist in vier Wochen wieder alles anders.

Stand: 16.09.2026. Gilt für Instagram, TikTok, Threads, YouTube Shorts.

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

### Set-Logo: sobald ein Beitrag über ein bestimmtes Set spricht (seit 16.09.2026)

**Geht es im Beitrag um ein Set, steht dessen Logo im Bild.** Rangliste eines Sets,
Neuerscheinung, Chase-Karte, „die teuerste Karte aus X" — überall dasselbe: freigestelltes
Set-Logo als eigene Ebene über dem Blatt, **oben mittig**, 47 % der Bildbreite, `top: 3,5 %`,
mit doppeltem Schlagschatten (sonst verschwindet Gold auf einer hellen Karte). Es läuft
über die ganze Dauer mit, nicht nur im ersten Clip — wer bei Sekunde 6 einsteigt, muss
sehen, worüber geredet wird.

Das ist keine Deko, sondern die schnellste Auskunft, die ein Reel geben kann: Das Logo
erkennt die Nische in einem Zehntel der Zeit, die eine Textzeile braucht, und es beantwortet
die häufigste Kommentarfrage („aus welchem Set?") im Bild statt in den Kommentaren.

Kein Logo bei allgemeinen Themen — Kunstseiten, Farbseiten, Slab-Meinung, Werkzeug: dort
gibt es kein Set, auf das es zeigen könnte.

**Woher die Datei kommt.** Je Set ein freigestelltes PNG mit Alpha unter
`data/assets/<projekt>/marke/<set>-setlogo.png` (cel30: 2173 × 1200).

TCGdex hat Set-Logos, aber **nur unter dem sprachabhängigen Pfad**:
`assets.tcgdex.net/de/<serie>/<set>/logo.png` (auch `/en/`) — unter `/univ/` liegt allein das
kleine `symbol.png`, und das ist für ein Reel zu klein und zu unbekannt. Das Feld `symbol` in
unserer `sets`-Tabelle zeigt deshalb ins Leere, wenn man ein Logo sucht. Für Vorab-Sets, die
TCGdex noch nicht führt (cel30), gibt es dort gar nichts — dann von Hand ablegen. Die Datei
bleibt liegen und gilt für alle folgenden Beiträge.

**Stand der Technik:** Die Logo-Ebene kann heute nur `reel-binder.ts` und dort nur der
Baustein `karten` (`logo: "cel30-setlogo.png"`). Die gemeinsame Bühne
(`video/binderbuehne.ts`, Formate H, I, J) kennt sie noch nicht — wer das nächste Set-Reel
über eine Preis-Rangliste baut, hebt sie zuerst dorthin (`BuehnenWahl`), statt sie ein
zweites Mal zu schreiben.

### Kartenwirbel: eine Karte umdrehen (seit 16.09.2026)

Clip-Typ `flip` in `reel-binder.ts`: Die Karte liegt mit der Rückseite oben, wirbelt herum
und bleibt auf ihrem Scan stehen. Darunter zieht Rauch in der Farbe der Karte. Gebaut für
die drei RGB-Mew (`rgbmew`), taugt für jede einzelne Karte, die eine Enthüllung verdient.

**Erst die Bildquelle prüfen, dann bauen.** Für Vorab-Sets stehen die Scans in
`cards.image_alt` — `image_de`/`image_en` sind dort leer, weil TCGdex das Set noch nicht
führt. Am 16.09.2026 habe ich nur die beiden TCGdex-Spalten abgefragt, die Karten für
bildlos gehalten und eine Silhouette gebaut; die Bilder lagen längst bei Serebii
(`serebii.net/card/30thcelebration/<nr>.jpg`). **Eine Karte nie nachzeichnen oder erfinden**
— wenn wirklich kein Bild existiert, ist die Rückseite mit Namensschild die ehrliche Lösung.

**Der Drehweg muss ein ungerades Vielfaches von 180° sein.** Start ist 180° (Rückseite
vorn); wer 720° dreht, landet wieder auf der Rückseite, und das Standbild danach zeigt die
Vorderseite — im Video sieht das aus wie ein Schnitt, nach dem die Karte plötzlich richtig
herum liegt. Gebaut sind **540° auf 1,1 s** (27 Bilder). Prüfen: `(180 + Weg) mod 360 === 0`.

**Grenze der Drehung: rund 45° je Bild.** Wir rendern ohne Bewegungsunschärfe; darüber
springt die Karte, statt zu wirbeln. 900° auf 1,08 s waren in der Mitte 90° je Bild — das
blinkte nur. Die Kurve ist `smootherstep` (6p⁵ − 15p⁴ + 10p³): Spitze beim 1,875-fachen des
Durchschnitts (37,5° je Bild), und am Ende sind Geschwindigkeit **und** Beschleunigung null.
Das ist der Unterschied zwischen „hält an" und „kommt zur Ruhe": Mit `smoothstep` lag der
letzte Schritt bei 6,3°, mit `smootherstep` bei 0,4°. Kippen und Wachsen laufen als
**quadratischer** Sinus mit — ein einfacher ließe die Karte im letzten Bild noch 1° schief
stehen, während das Standbild danach gerade ist.

Die Karte sitzt bei `KARTE_Y = 410` — bei 370 lief ihre obere Ecke beim Kippen durch das
Set-Logo.

### Rauch als Hintergrund (seit 16.09.2026)

Statt eines flachen Verlaufs zieht hinter der Karte Rauch. Eine Textur (SVG `feTurbulence`,
1560 × 2480), zwei Fenster wandern gegenläufig darüber, ffmpeg setzt sie zwischen Grund und
Karte. Deshalb sind Grund und Karte **getrennte Renders**: Die Karten-Ebene ist durchsichtig,
sonst läge der Rauch über der Karte.

Drei Dinge, die den Unterschied machen:

- **Farbe kommt aus einer Alphamaske (`alphamerge`), nicht aus `blend`.** Graue Wolken per
  `screen`/`multiply` über einen farbigen Grund ergaben schmutziges Grau — `screen` zieht mit
  Grau Richtung Weiß, `multiply` frisst die Sättigung.
- **Die Textur braucht die richtige Körnung.** `baseFrequency` 0.0016 gab weichen Farbnebel
  ohne Schwaden, 0.0070 wurde körnig und unruhig. Gewählt: 0.0040/0.0055 mit vier Oktaven.
- **Die Bewegung sind Sinusbahnen mit Zeitversatz je Clip.** Eine gerade Fahrt läuft aus der
  Textur heraus; ohne Versatz fängt der Rauch bei jedem Schnitt von vorn an und springt.
- **Der Weg muss weit sein, nicht nur vorhanden.** Mit ±180 px (5 px je Bild) war die
  Bewegung messbar, aber unsichtbar: Eine weiche Wolke, um fünf Pixel verschoben, ändert
  kaum eine Helligkeit — zwischen zwei Bildern hatten nur 8.000 Pixel überhaupt einen
  anderen Wert. Jetzt ist die Textur 2040 × 3000 groß und der Weg ±380 bis ±420 px, also
  rund 12 px je Bild; damit bewegen sich 180.000 Pixel je Bild sichtbar.

### Folgen-Hinweis: Pille ohne Pfeil (seit 15.09.2026)

Eine dunkle Pille unter der Seite: das Binderplan-Zeichen, `@binderplan.app`, darunter in
Gelb `folgen für mehr Seiten`. 2,6 s lang, nach der letzten Textzeile. Kein Pfeil.

**Warum der Pfeil weg ist.** Er zeigte auf den echten Folgen-Knopf der App — aber wo der
senkrecht sitzt, ist nirgends dokumentiert und ändert sich mit App-Version, Gerätehöhe und
Systemleisten. In der Handy-Ansicht zeigte er bei TikTok und Shorts auf irgendetwas; nur
Instagram passte. Ein Pfeil, der danebenzeigt, ist schlechter als keiner.

**Der Gewinn: eine Fassung für alle.** Ohne Pfeil gibt es nichts mehr, das je App anders
liegen müsste. `SITZE` in `src/server/agents/video/folgen-pille.ts` steht für alle drei
Ziele auf derselben Stelle (`PILLE_Y = 1318`, unten links). Die drei App-Fassungen bleiben
trotzdem getrennte Stücke — wegen der unterschiedlich langen Captions, nicht wegen des
Bildes.

**Warum mitten im Reel und nicht im Abspann.** Der Abspann ist der einzige Moment, in dem
die Adresse im Bild steht; zwei Aufforderungen in drei Sekunden heben sich auf. Und: Wer
den Abspann sieht, ist ohnehin geblieben — der Hinweis gehört an die Stelle, an der das
Reel gerade geliefert hat und noch alle zusehen.

**Wo sie im Stück sitzt: bei rund zwei Dritteln, nicht am Schluss.** Bis zum 15.09. kam
die Pille nach der letzten Textzeile und damit direkt vor dem Abspann — das las sich wie
zweimal Werbung hintereinander, erst „folge uns", dann die Adresse. Jetzt läuft sie in der
Lücke **vor der Schlusszeile**, und nach ihr kommt noch Inhalt.

Die Lücke wird aufgemacht, nicht gesucht (`folgenFenster()` in `folgen-pille.ts`): Die
vorletzte Zeile endet, wenn die Pille kommt, und die Schlusszeile rückt so weit nach
hinten, dass sie erst danach beginnt. Das verlängert das Stück um wenige Sekunden —
billiger als eine Zeile, die unter der Pille steht. Pille und Text stehen an derselben
Stelle unter der Seite und dürfen sich nie überlagern.

Die Gesamtlänge rechnet immer mit der Pille, auch wenn der Lauf gerade keine baut: Aus der
Basis entstehen die App-Fassungen, und die legen sie an genau diese Stelle.

**Der Clip mit der Pille bekommt keinen Text** (gemessen am 16.09.2026). Die Pille beginnt
400 ms nach dem Schnitt, der Text 160 ms danach und endet 150 ms vor ihr — er steht also
**90 ms, egal wie lang der Clip ist**, und im fertigen Video ist an seiner Stelle nichts.
Die Fassungen können das nicht heilen: `reel-plattformen.ts` legt nur die Pille auf, die
Texte sind in der Basis schon eingebrannt. Wer an dieser Stelle etwas sagen will, schiebt
es einen Clip nach vorn und gibt der Pille ein eigenes Bild. `reel-binder.ts` warnt beim
Bauen, wenn der Pillen-Clip ein `zeig` trägt.

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
| `rgbmew` | Die seltensten Karten aller Zeiten | B | Kartenwirbel + Rauch |
| `haesslich` | Die hässlichste Karte des Jahres | — | RGB-Bühne, Meinung (nicht gebaut) |
| `verkauft` | 8.229 Euro. Für ein Mew. Verkauft. | B | RGB-Bühne mit Belegen — **abgelöst durch das Hook-Layout (K)** |
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
| `coolshit`, `harmonie1`–`8` | Die Seite füllt sich, Fach für Fach | H | echte Binderseiten (`reel-einschub.ts`) |
| `tool-vorlage`, `tool-vitrine`, `tool-markt` | Werbung: die App in Handy-Ansicht | — | Bildschirmaufnahme (`reel-tool.ts`) |
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

### G — Farbseiten (Art-Kategorie „Binder Art“) · **1–2 × pro Woche**

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

### H — **Matching Cards** (Art-Kategorie „Binder Art“) · **Serie, 1 × pro Tag möglich**

Neun leere Hüllen, dann gleitet Karte für Karte in ihr Fach, bis die Seite voll ist.
Gebaut mit `scripts/reel-einschub.ts` aus einer **echten Seite eines echten Binders** —
Karten-Ids ins Drehbuch, fertig.

```bash
pnpm exec tsx scripts/reel-einschub.ts --drehbuch <name> --ohne-folgen
pnpm exec tsx scripts/reel-plattformen.ts --drehbuch einschub-<name>
```

Was am Format nicht verhandelbar ist — jeder Punkt ist einmal falsch gebaut worden:

- **Die Taschen sind seitlich offen, nicht oben.** Aus oben offenen Hüllen fallen die
  Karten, sobald der Binder senkrecht steht. Linke und mittlere Spalte werden **von
  rechts** eingeschoben, die rechte **von links** (`OEFFNUNG`) — die Öffnungen zeigen zur
  Seitenmitte.
- **Kein Streifen an der Öffnungskante.** Er verdeckt nach dem Einschieben den Kartenrand;
  das Abschneiden während der Fahrt leistet das Fach durch `overflow: hidden` allein.
- **Keine Ringe.** Die Lochreihe sitzt in der linken Randleiste der Hülle, mehr braucht es
  nicht. Ringe davor sehen aus wie Aufkleber.
- **Die Seite sitzt mittig**, links wie rechts 72 px Rand, und ist 936 px breit.
- **Der Text steht unter der Seite**, nicht darüber, und **alle Zeilen sind gleich groß**.
  Die Schrift verkleinert sich automatisch, wenn eine Zeile sonst umbräche.
- **Die Folgen-Pille kommt nach der letzten Textzeile** und sitzt ebenfalls unter der Seite
  (`folgenVersatz` im Stück-`meta`, wird von `reel-plattformen.ts` übernommen). Die
  Gesamtlänge rechnet **immer** mit der Pille — auch die Basis, sonst ragt sie in den Abspann.
- **Einzelbilder statt Bildschirmaufnahme.** Eine abgefilmte Animation landet bei rund
  1,6 Mbit/s, und das sieht man an den Kartentexten. Gerendert wird nur die Bewegung; die
  Standzeit danach hängt ffmpeg als Standbild an (155 statt 351 Renders).

**Der Textsatz der Serie** (gleich für jede Seite, nur die Zahl wechselt):

> So sieht eine geplante Seite aus.
> Farben, die harmonieren. Aus **N** Sets.
> Zusammengestellt von Binderplan.
> Bau deine eigene.

Die Set-Zahl wird **nachgezählt**, nicht geschätzt — zwei Karten aus demselben Set sind ein
Set. Fertig gebaut: `coolshit` (Seite 14 aus „Cool Shit") und `harmonie1` bis `harmonie8`.

### I — **Artwork Pages** (Art-Kategorie „Binder Art“) · **seit 15.09.2026**

Dieselbe Bühne wie H, aber in **zwei Wellen**. Erst schieben sich die echten Karten in ihre
Fächer; dann steht die Seite kurz still, und man sieht die Lücken. Danach fahren die
gemalten Teile an ihre Plätze, und aus neun Feldern wird ein Bild.

```bash
# karten: neun Fächer, leerer Eintrag = gemaltes Teil; kunstseite: die Artwork-Id
pnpm exec tsx scripts/reel-einschub.ts --drehbuch kunstseite151 --ohne-folgen
pnpm exec tsx scripts/reel-plattformen.ts --drehbuch einschub-kunstseite151
```

- **Die Pause zwischen den Wellen ist der Inhalt** (`PAUSE = 1400`). Ohne sie sieht man
  nicht, dass die Karten echt sind und der Rest dazukommt — dann ist es nur ein Bild.
- **Die Bildteile kommen dichter** (0,72 × Versatz) und tragen einen flacheren Schatten als
  eine Karte: Papier ist dünner, und die sechs Teile sollen am Ende als ein Bild lesen.
- **Kein Zuschnitt in einem Bildwerkzeug.** Die gespeicherte Kunstseite zeigt genau die
  Blattfläche; das Bild wird in Blattgröße hinter das Fach gelegt und um die Fachposition
  verschoben. `artwork.py: kachel()` rechnet mit denselben 63 × 88 mm und 4 mm Naht wie
  `blattMasse` — deshalb passt es auf den Pixel.
- **Nie auf drei Karten festlegen.** Die Kunstseiten im Produkt haben zwischen einer und
  sieben Ankerkarten. Der Text sagt das ausdrücklich, sonst erwartet die Hälfte der
  Zuschauer ein Format, das es so nicht gibt.

**Der Textsatz der Serie:**

> So hebst du deine besten Karten hervor.
> Eine Karte, zwei oder fünf.
> Den Rest der Seite malt Binderplan dazu.
> Herunterladen. Ausdrucken. Einstecken.
> Nur auf binderplan.

Fertig gebaut: `kunstseite151` („151 Charizard Evos", drei echte Karten in den Fächern
1, 5 und 9).

### J — **Preis-Rangliste** · Top 10 und Top 20 · **seit 15.09.2026**

Dieselbe Bühne wie H und I, nur mit Platzziffern und Preisschildern. Fünf
Varianten, ein Aufbau — der Unterschied ist allein der **Bereich**:

| Variante | Bereich | Aufbau |
|---|---|---|
| Top 10 eines Sets | `set:sv03.5` | 9 Karten auf einer Seite, Platz 1 einzeln |
| Top 20 einer Ära | `era:klassik` | 18 Karten auf zwei Seiten, Platz 2 und 1 einzeln |
| Top 10 eines Illustrators | `illu:"Mitsuhiro Arita"` | wie Set |
| Top 20 einer Seltenheit | `rar:"Special Illustration Rare"` | wie Ära |
| Top 10 eines Pokémon | `poke:Glurak` | wie Set |

```bash
pnpm exec tsx scripts/reel-preis.ts --drehbuch <name> --nur-liste   # erst die Zahlen ansehen
pnpm exec tsx scripts/reel-preis.ts --drehbuch <name> --ohne-folgen
pnpm exec tsx scripts/reel-plattformen.ts --drehbuch preis-<name>
```

Was am Format nicht verhandelbar ist:

- **Die Spitze kommt zuletzt.** Die Seite füllt sich von Platz 10 aufwärts bis
  Platz 2, dann bekommt Platz 1 ein eigenes Bild. Wer mit dem Teuersten
  anfängt, hat nach zwei Sekunden nichts mehr zu zeigen. Bei der Zwanziger
  läuft Seite A von 20 bis 12, Seite B von 11 bis 3.
- **Platzziffer unten links, Preis unten rechts.** Oben links stünde die Ziffer
  auf dem Kartennamen — und den will man lesen.
- **Die Spitze steht allein**, nicht als zehntes Fach: Auf der Seite sind alle
  Karten gleich groß, damit wäre Platz 1 nichts Besonderes.
- **Preise beim Bauen geholt, nicht im Drehbuch.** Eine einbetonierte Liste ist
  nach einer Woche falsch. Was gebaut wurde, steht danach im `meta` des Stücks
  (`rangliste`, `preisStand`, `summeEur`).
- **Grundlage ist der 30-Tage-Schnitt** (`avg30`), nie der Trendpreis — der
  folgt einzelnen Verkäufen und hebt eine Karte schon mal um das Vierfache.
- **Zahlen im Text kommen aus Platzhaltern**: `{summe}`, `{stand}`, `{top1}`,
  `{top1preis}`, `{top2preis}`, `{anzahl}`, `{bereich}`. Von Hand abgetippte
  Zahlen veralten still.
- **Die letzte Zeile ist eine Frage**, keine Aufforderung: „Over- oder
  underrated?" steht am Ende jeder Preis-Rangliste (beim Illustrator „Sammelt
  ihr seine Karten?"). Eine Meinungsfrage zu einem Preis bringt Kommentare;
  „Preise im Tool" bringt keine. Sie läuft **nach** der Folgen-Pille.

Die Textzeilen hängen an **Marken** im Zeitstrahl (`start`, `vollA`, `seiteB`,
`vollB`, `zwei`, `eins`), nicht an Millisekunden: Die Länge der Szenen hängt am
Aufbau, eine feste Zahl wäre bei jeder Änderung falsch.

Fertig gebaut: `set151`, `aeraklassik`, `illuarita`, `raritysir`, `pokeglurak`.

### K — **Hook-Layout** (`scripts/reel-hook.ts`) · **seit 17.09.2026**

Das zweite Layout neben der Binderseiten-Bühne — für Beiträge, die eine **einzige Zahl
oder Behauptung** tragen (Verkaufspreis, Rekord, Gerücht). Entstanden, nachdem das erste
RGB-Verkaufs-Reel im Handy-Kontaktbogen durchgefallen war: Zeilen von 62 px (3 % der
Bildhöhe) unten links, sechs Zahlen in 20 s, 18 s Standbild, die erste Sekunde schwarz.

**Prüfmethode, die den Unterschied gezeigt hat:** Kontaktbogen des Reels in **270 px
Breite** (2 Bilder je Sekunde). Was dort nicht lesbar ist, ist im Feed nicht lesbar.
Vor jeder Freigabe eines Hook-Reels anschauen.

Fünf Regeln, alle im Skript verankert:

1. **Die Zahl ist das Bild.** Eine je Einstellung, mittig, Bungee in Binderplan-Gelb mit
   schwarzer Kontur, bis 250 px (13 % der Höhe). Breite: 0,663 em je Zeichen, höchstens
   1.000 px — „KAUFEN?" lief mit 0,6 rechts aus dem Bild. Sätze gehören in die Caption.
2. **Die Karte füllt das Bild** — 900 px, 4° gekippt, mit Lichtstreifen, und sie zoomt in
   jeder Einstellung um 6 %. Gerechnet auf dem doppelt großen Render (`scale` je Bild +
   `crop`; **nicht** `zoompan`, das nahm die 2160-px-Quelle als Ausschnitt). Der
   Skalierungsfaktor liegt nur auf `body` — in `html,body{}` wirkt er doppelt.
3. **Erste Sekunde: Karte und Zahl knallen rein** (Pop 1,35 → 1,12 → 0,96 → 1, je 40 ms),
   dazu der rote Stempel. Kein Einblenden am Anfang. Der Beweis (weißer Zettel mit
   Datum, Titel, Preis in eBay-Grün, 150 px) kommt **danach** — erst Behauptung, dann Beleg.
4. **Höchstens vier Zahlen, steigender Takt**: 1,6 s Hook, 1,8 s Beweis, dann drei
   Karten à 0,9 s, 1,8 s Zusammenfassung, 3,0 s Pille (ohne Text), 2,4 s Frage.
5. **Die letzte Einstellung ist die erste** (rote Karte → rote Karte): Das Reel läuft
   nahtlos in die Schleife, Wiederholungen zählen als Wiedergabe.

Set-Logo klein oben links (300 px), nicht mittig — das Bild gehört der Karte. Der Abspann
bleibt 3,2 s; bei 16 s Gesamtlänge ist das ein Fünftel, eine Kurzform (1,8 s) für
Hook-Reels steht zur Entscheidung an.

Fertig gebaut: `verkauft` (Stück `verkauft-hook`, drei Fassungen über `reel-plattformen.ts`).

### Die Bühne: eine Binderseite für alle drei Formate

H, I und J zeigen **dieselbe** Seite — dunkles Kunstleder, durchsichtige Hülle
mit Lochleiste, neun Taschen, ein Glanz über der ganzen Folie, Text darunter.
Sie steht in `src/server/agents/video/binderbuehne.ts` und nirgends sonst:

| Was | Wert |
|---|---|
| Bild | 1080 × 1920 |
| Blattbreite / oben | 860 px / 200 px (Hülle 936 px, also 72 px Rand) |
| Fach | 63 von 67 mm — **nicht** ein Drittel der Seite |
| Einschubrichtung | linke + mittlere Spalte von rechts, rechte von links |
| Textzeile | ab 1.463 px, eine Größe für alle Zeilen, schrumpft statt umzubrechen |
| Folgen-Pille | an derselben Stelle wie der Text (`folgenVersatz`) |
| Einzelkarte | 640 px breit, ab 393 px — für die Spitze einer Rangliste |

Ein neues Format baut darauf auf, statt die Seite noch einmal zu bauen:
`seiteHtml(faecher)` für die Seite, `einzelHtml(bild)` für eine einzelne Karte,
`textHtml(zeile)` für die Zeile darunter.

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
- [ ] Folgen-Pille gesetzt und **vor** dem Abspann zu Ende (`reel-plattformen.ts`)?
- [ ] Abspann angehängt, 3200 ms?
- [ ] Keine Zeilenumbruch-Warnung beim Bauen?
- [ ] Tonspur vorhanden (sonst stummes Reel)?
- [ ] 5–6 Hashtags, kein `#fyp`?
- [ ] Schlussfrage ist eine echte Frage?
- [ ] Erster Satz würde einen Sammler nicht die Augen verdrehen lassen?
