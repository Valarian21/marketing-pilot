# Lehreule — Reel-Plan bis Monatsende (12.–30.09.2026)

Ein Reel pro Tag, jedes an **einem konkreten Lehrerproblem** aufgehängt, zusammen decken sie
alle Funktionen des Produkts ab. Format durchgehend: echte Bildschirmaufnahme im Produkt,
deutsche Stimme mit Warmlauf, Untertitel auf dem gemessenen Sprechbeginn, kein Vorspann,
animierte Abschluss-Slide (3,2 s).

Gedreht wird mit dem Pilot-Demokonto (`MP_DEMO_USER`, NRW · Gymnasium). Jedes Stück liegt im
Piloten unter **Lehreule → Studio → Video** und geht nach dem Render automatisch auf „Prüfen".

## Der Plan

| Tag | Thema | Problem der Lehrkraft | Hook (erste Caption-Zeile) | Stand |
|---|---|---|---|---|
| Fr 12.09. | Kernlehrplan-Themen anklicken | „Ist das überhaupt das, was bei uns dran ist?" | Woher weiß die KI, was in Klasse 8 dran ist? | **fertig** |
| Sa 13.09. | Einzelne Aufgabe vereinfachen | Blatt fertig, eine Aufgabe zu schwer | Aufgabe zu schwer? Einmal antippen. | **fertig** |
| So 14.09. | Klausur + Erwartungshorizont | Der Sonntagabend geht für eine Klassenarbeit drauf | Klassenarbeit schreiben: ein halber Abend. Oder zwei Minuten. | **fertig** |
| Mo 15.09. | Differenzierung (Niveau B) | Halbe Klasse kommt nicht mit, keine Zeit für zwei Blätter | Die halbe Klasse kommt nicht mit? Ein Haken. | **fertig** |
| Di 16.09. | Eigener Text → Aufgaben | Lesetext da, Aufgaben fehlen | Dein Text. Deine Aufgaben. Zwei Minuten. | **fertig** |
| Mi 17.09. | Blatt in anderer Sprache | Neu zugewandertes Kind kann dem Blatt nicht folgen | In meiner Klasse sitzt ein Kind, das kaum Deutsch spricht. | **fertig** |
| Do 18.09. | Bonus-Aufgaben für Schnelle | Drei Kinder sind nach fünf Minuten durch | Die Schnellen sind immer zuerst fertig. | geplant |
| Fr 19.09. | Vertretungsstunde in 2 Minuten | 10 Minuten vor der Stunde eingeteilt | Vertretung in der 3. Stunde. Du hast zehn Minuten. | geplant |
| Sa 20.09. | Leseleichte Schrift, mehr Zeilenabstand | LRS-Kind bekommt dasselbe enge Blatt | LRS in der Klasse? Zwei Schalter. | geplant |
| So 21.09. | Council-Stufen (3 / 7 / 15 Credits) | „Kann ich dem Zeug trauen?" | Wie gründlich soll die KI prüfen? Das entscheidest du. | geplant |
| Mo 22.09. | Wochenplanung + Material-Ampel | Montag früh: Was fehlt diese Woche noch? | Deine Woche, rot markiert: das fehlt noch. | geplant · Konto vorbereiten |
| Di 23.09. | Klausur zur Lektüre (Werk wählen) | Klausur zum gelesenen Buch, nicht zu irgendeinem Text | Klausur zur Lektüre — ohne dass die KI das Buch erfindet. | geplant |
| Mi 24.09. | Unterrichtsreihe planen | Reihe für sechs Stunden aufbauen | Sechs Stunden Reihe, ein Rahmenthema. | geplant · Erkundung offen |
| Do 25.09. | Kompetenzen & Anforderungsbereiche | Blatt muss zum Lehrplan-Kompetenzbereich passen | Kompetenzen stehen im Plan — hier klickst du sie an. | geplant |
| Fr 26.09. | Prüfen & Drucken (PDF + Lösungsblatt) | Am Ende muss Papier aus dem Drucker | Druckfertig heißt: Blatt, Lösungen, PDF. | geplant |
| Sa 27.09. | Stundenplan abfotografieren | Stundenplan abtippen? Nein. | Foto vom Stundenplan — den Rest liest die Eule. | geplant · Aufnahme-Technik fehlt |
| So 28.09. | QR an die Klasse, ohne Schülerdaten | Digital verteilen ohne Datenschutz-Ärger | Deine Klasse arbeitet am Handy — ohne ein einziges Schülerdatum. | geplant · Erkundung offen |
| Mo 29.09. | Präsentation / Vorführmodus | Beamer-Folien zum Thema fehlen | Beamer statt Kopierer. | geplant · Demokonto braucht Pro |
| Di 30.09. | Was 15 Gratis-Credits hergeben | „Was kostet mich das eigentlich?" | 15 Credits gratis — das kommt dabei raus. | geplant |

## Regeln für alle Beiträge

- **Ein Problem je Reel.** Der erste Satz benennt es, der letzte löst es auf.
- **Keine Zahlenversprechen**, die nicht auf der Seite stehen (die alten „794 Lehrpläne" sind
  bewusst weg). Erlaubt und belegt: 15 Gratis-Credits, „in unter 2 Minuten", „ohne
  Schülerdaten", „Council aus bis zu zehn KI-Experten", „nach deinem Kernlehrplan".
- **Instagram:** Caption mit Hook in Zeile 1, Link nur in der Bio, 6–8 Hashtags.
  **TikTok:** dieselbe Caption, drei bis vier Hashtags, Ton aus dem Video (Plattform-Sound
  lässt sich über die API nicht anhängen — dort wird von Hand hochgeladen).
- **Vor jeder Freigabe ansehen**: Generierungen scheitern gelegentlich; dann steht der
  Fehlertext im Bild, während die Stimme „fertig" sagt.

## Was für die geplanten Folgen noch fehlt

| Reel | Fehlt | Aufwand |
|---|---|---|
| Wochenplanung (22.09.) | Demokonto braucht Klassen + Stundenplan | einmalig ~15 min im Produkt |
| Stundenplan-Foto (27.09.) | Die Aufnahme kennt keine Datei-Uploads — `upload`-Aktion im Recorder | ~1 h Code + Test |
| QR an die Klasse (28.09.) | Ablauf im Editor noch nicht erkundet (Werkzeuge/Teilen öffnet sich im Mobilbild nicht) | ~30 min Erkundung |
| Präsentation (29.09.) | „Präsentation" ist Pro, das Demokonto ist Gratis | Plan des Demokontos hochsetzen |
| Unterrichtsreihe (24.09.) | Dialog „Reihe planen" noch nicht erkundet | ~30 min Erkundung |

## Produktfehler, die beim Drehen auffielen (offen)

1. **Rohes LaTeX in Mathe-Blättern** (`\frac{3}{7}` statt gesetztem Bruch) — deshalb sind alle
   bisherigen Reels sprachlich, nicht mathematisch.
2. **Markdown-Sternchen in Arbeitsblatt-Lösungen** (`**Begriff**`) — bei Klausuren sauber.

Beides gehört ins Produkt-Repo (`/root/apps/arbeitsblatt-studio`), nicht in den Piloten.
