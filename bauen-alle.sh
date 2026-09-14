#!/bin/bash
# Je Thema eine Basis bauen und daraus die drei App-Fassungen legen.
#
# Schonend gegenüber dem Rest des Servers: `nice`, eine Atempause zwischen den
# Themen (der Speicher wird erst beim Prozessende freigegeben) und eine Marke je
# fertigem Thema — nach einem Abbruch läuft der nächste Start da weiter, wo er
# aufgehört hat.
cd /home/developer/ai_empire/marketing-pilot
MARKEN=.bau-fertig
mkdir -p $MARKEN
# Ohne Argumente alle, sonst die genannten — der Bau zieht Spitzen von rund 2 GB
# und wird als Hintergrundaufgabe gestoppt, sobald der Server eng wird. Deshalb
# läuft er in Etappen im Vordergrund.
THEMEN="${@:-slab starter neunfaecher dreissig pikachu preise futuristic aera illustrator duell seitenwert vintagemodern}"
for t in $THEMEN; do
  if [ -f "$MARKEN/$t" ]; then echo "=== $t: schon fertig ==="; continue; fi
  echo "=== $t: Basis ==="
  nice -n 10 pnpm exec tsx scripts/reel-binder.ts --drehbuch "$t" --plattform instagram --ohne-folgen 2>&1 | grep -E "Clips|Fertig|!|rror"
  sleep 3
  echo "=== $t: Fassungen ==="
  nice -n 10 pnpm exec tsx scripts/reel-plattformen.ts --drehbuch "$t" 2>&1 | grep -E "instagram|tiktok|shorts|rror"
  touch "$MARKEN/$t"
  sleep 5
done
# Ohne Vorschaubild zeigen Mediathek und Freigabe auf dem Handy eine schwarze
# Fläche — mobile Browser laden Videos nicht von sich aus.
echo "=== Vorschaubilder ==="
nice -n 10 pnpm exec tsx scripts/reel-vorschaubilder.ts 2>&1 | tail -1
echo "=== ALLE FERTIG ==="
