#!/usr/bin/env bash
# Konsistenter Nur-Lese-Schnappschuss von Binderplans app.db für den Marketing Pilot.
#
# Warum überhaupt eine Kopie: /root ist drwx------, der Pilot läuft als `developer`
# und kommt an /root/apps/binderplan/app.db nicht heran. Ein Traversierungsrecht auf
# /root kam nicht in Frage — dort liegen auch die world-readable Kundendatenbanken
# von Lehreule, atemzug und date-einladung. Kopiert wird deshalb als root und
# ausschließlich diese eine Datei.
#
# Die Kopie ist bewusst der Normalfall, nicht der Notnagel: Binderplan bleibt von
# Lese-Last und Sperren des Piloten völlig unberührt. Karten- und Set-Daten ändern
# sich selten; Preise holt sich der Pilot ohnehin selbst frisch von TCGdex.
set -euo pipefail

QUELLE=${1:-/root/apps/binderplan/app.db}
ZIEL=${2:-/home/developer/ai_empire/marketing-pilot/data/cache/binderplan.db}

[ -r "$QUELLE" ] || { echo "Quelle nicht lesbar: $QUELLE" >&2; exit 1; }
install -d -o developer -g developer -m 750 "$(dirname "$ZIEL")"

TMP="$ZIEL.neu"
# sqlite3-Online-Backup statt cp: konsistent trotz WAL und laufender Schreibzugriffe.
# Das Ziel bekommt kein WAL, der Leser braucht also keine -wal/-shm-Rechte.
python3 - "$QUELLE" "$TMP" <<'PY'
import sqlite3, sys
quelle, ziel = sys.argv[1], sys.argv[2]
src = sqlite3.connect(f"file:{quelle}?mode=ro", uri=True)
dst = sqlite3.connect(ziel)
with dst:
    src.backup(dst)
dst.close()
src.close()
PY

chown developer:developer "$TMP"
chmod 640 "$TMP"
mv -f "$TMP" "$ZIEL"   # atomar: ein gerade lesender Prozess behält seine Inode
echo "Schnappschuss: $ZIEL ($(stat -c%s "$ZIEL") Bytes, $(date -Is))"
