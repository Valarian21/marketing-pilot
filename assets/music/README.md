# Musikbett für die Reels

Die Video-Fabrik wählt aus diesem Ordner **zufällig einen Track**, mischt ihn geduckt unter das
Reel (Sidechain gegen die Stimme, Gesamt-Loudness −14 LUFS) und blendet die letzten 2,5 s aus.
Ohne Datei rendert sie stumm und schreibt eine Warnung ans Stück.

**Dateien mit `_` am Anfang werden übersprungen.** So bleibt `_platzhalter-pad.mp3` (32 kbit/s,
nur zum Testen der Kette gebaut) liegen, ohne je unter einem Beitrag zu landen.

## Warum der Ordner überhaupt gebraucht wird

Auf Instagram und TikTok kommt der Sound normalerweise aus der Plattform-Bibliothek — lizenzsauber
und gut für die Ausspielung. **Das geht nur beim Posten von Hand.** Über die Graph-API lässt sich
kein Plattform-Sound anhängen, und seit der Zeitplan die Reels selbst absetzt, gingen sie stumm
raus. Deshalb braucht der API-Weg ein eigenes Bett.

Beim manuellen TikTok-Upload gilt weiter der bessere Weg: Originallautstärke im TikTok-Editor auf 0
und einen Trending-Sound darüberlegen. Dieselbe MP4 bedient also beide Wege.

## Was hier hineingehört

Lizenz: **CC0 oder Pixabay Content License** (frei für kommerzielle Nutzung, keine Namensnennung
nötig). Keine CC-BY-Tracks — die Namensnennung müsste in jede Bildunterschrift, und das ist bei
automatischem Posten nicht durchzuhalten.

Quellen, die das hergeben:

- **pixabay.com/music** — Filter „Music", Lizenz ist für alle Treffer die Pixabay Content License
- **freemusicarchive.org** — nur mit Lizenzfilter **CC0**, nicht CC-BY
- **incompetech.com** — scheidet aus: alles CC-BY

Auswahlkriterien für 15–20-Sekunden-Reels:

| Kriterium | Wert |
|---|---|
| Länge | ≥ 30 s (wird auf die Reel-Länge beschnitten) |
| Bitrate | ≥ 128 kbit/s |
| Aufbau | gleichmäßig, **kein** großer Drop oder Break in den ersten 20 s |
| Charakter | rhythmisch, hell, ohne Gesang — Gesang kämpft mit den Untertiteln |
| Tempo | 100–125 BPM, damit die 2,4-s-Schnitte auf den Takt fallen |
| Anzahl | 6–8 Tracks, sonst hört man die Wiederholung |

## Nachweis

Zu jeder Datei eine gleichnamige `.txt` daneben legen — Quelle, Titel, Urheber, Lizenz, Datum des
Downloads. Das ist die einzige Stelle, an der später nachvollziehbar ist, woher ein Track kam.

```
sommer-lauf.mp3
sommer-lauf.txt   →   Pixabay · „Summer Run" von <Urheber> · Pixabay Content License · geladen 08.09.2026
```
