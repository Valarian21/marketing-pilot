#!/bin/bash
# Einschub-Reels bauen: Basis einmal rechnen, daraus die drei App-Fassungen.
# Läuft in Etappen, weil ein Durchgang rund vier Minuten braucht.
cd /home/developer/ai_empire/marketing-pilot
MARKEN=.bau-einschub
mkdir -p $MARKEN
for t in "$@"; do
  if [ -f "$MARKEN/$t" ]; then echo "=== $t: schon fertig ==="; continue; fi
  echo "=== $t ==="
  nice -n 10 pnpm exec tsx scripts/reel-einschub.ts --drehbuch "$t" --ohne-folgen 2>&1 | grep -E "Einzelbilder|Fertig|rror"
  nice -n 10 pnpm exec tsx scripts/reel-plattformen.ts --drehbuch "einschub-$t" --ersetzen 2>&1 | grep -E "instagram|tiktok|shorts|rror"
  touch "$MARKEN/$t"
done
echo "=== ETAPPE FERTIG ==="
