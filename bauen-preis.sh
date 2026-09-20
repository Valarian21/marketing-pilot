#!/bin/bash
# Preis-Reels bauen: Basis einmal rechnen, daraus die drei App-Fassungen.
cd /home/developer/ai_empire/marketing-pilot
MARKEN=.bau-preis
mkdir -p $MARKEN
for t in "$@"; do
  if [ -f "$MARKEN/$t" ]; then echo "=== $t: schon fertig ==="; continue; fi
  echo "=== $t ==="
  # Schlägt die Basis fehl, darf die Plattform-Runde nicht auf der alten weiterbauen.
  if ! nice -n 10 pnpm exec tsx scripts/reel-preis.ts --drehbuch "$t" --ohne-folgen 2>&1 \
       | grep -E "Szene|Marken|Fertig|rror|Preisstand"; then :; fi
  if [ "${PIPESTATUS[0]}" != "0" ]; then echo "!!! $t: Basis fehlgeschlagen, übersprungen"; continue; fi
  nice -n 10 pnpm exec tsx scripts/reel-plattformen.ts --drehbuch "preis-$t" --ersetzen 2>&1 | grep -E "instagram|tiktok|shorts|rror"
  touch "$MARKEN/$t"
done
echo "=== ETAPPE FERTIG ==="
