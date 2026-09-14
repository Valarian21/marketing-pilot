#!/bin/bash
# Aus den fertigen Reels kleine Vorschaufassungen und Standbilder fürs Artifact.
# 540x960 und CRF 32 reichen für eine Ansicht im Browser; die Datei, die
# hochgeladen wird, bleibt das Original in voller Auflösung.
set -e
cd /home/developer/ai_empire/marketing-pilot
ZIEL=/tmp/claude-1000/-home-developer-ai-empire/503a6e68-9f30-495b-88bc-3935bf78ec62/scratchpad/stuecke
mkdir -p $ZIEL
python3 - "$ZIEL" <<'PY'
import json, os, subprocess, sys
ziel = sys.argv[1]
daten = json.load(open("/tmp/claude-1000/-home-developer-ai-empire/503a6e68-9f30-495b-88bc-3935bf78ec62/scratchpad/stuecke.json"))
for th in daten:
    for f in th["fassungen"]:
        if not f["video"]:
            continue
        name = f"{th['drehbuch']}-{f['plattform']}"
        mp4 = os.path.join(ziel, name + ".mp4")
        jpg = os.path.join(ziel, name + ".jpg")
        if not os.path.exists(mp4):
            subprocess.run(["ffmpeg", "-v", "error", "-i", f["video"], "-vf", "scale=540:-2",
                            "-c:v", "libx264", "-preset", "medium", "-crf", "32", "-pix_fmt", "yuv420p",
                            "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-y", mp4], check=True)
        if not os.path.exists(jpg):
            subprocess.run(["ffmpeg", "-v", "error", "-ss", "1.2", "-i", f["video"], "-frames:v", "1",
                            "-vf", "scale=360:-2", "-q:v", "6", "-y", jpg], check=True)
        f["vorschau"] = os.path.basename(mp4)
        f["standbild"] = os.path.basename(jpg)
        f["datei"] = f["video"].replace("/home/developer/ai_empire/marketing-pilot/", "")
        f["bytes"] = os.path.getsize(f["video"])
        del f["video"]
json.dump(daten, open("/tmp/claude-1000/-home-developer-ai-empire/503a6e68-9f30-495b-88bc-3935bf78ec62/scratchpad/stuecke-fertig.json", "w"), indent=2, ensure_ascii=False)
gesamt = sum(os.path.getsize(os.path.join(ziel, x)) for x in os.listdir(ziel))
print(f"{len(daten)} Themen, Vorschaudateien zusammen {gesamt/1e6:.1f} MB")
PY
