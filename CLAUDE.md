# CLAUDE.md — Marketing Pilot

Ergänzt die CLAUDE.md des Wurzel-Repos. Eigenes GitHub-Repo (`marketing-pilot`),
Commits gehören **in diesen Ordner**, nicht in die Wurzel.

## Content bauen: erst das Playbook lesen

**Vor jedem Reel, Bildpost oder Caption-Text: `docs/CONTENT_PLAYBOOK.md` lesen und
danach arbeiten.** Dort stehen Tonfall, Slide-Layout, Takt, Abspann, Folgen-Hinweis,
der Post-Katalog und die Checkliste. Die Datei existiert genau deshalb, weil sonst in
jeder Sitzung ein anderes Design und eine andere Sprache entsteht.

Bewährt sich eine Abweichung, wird sie **dort eingetragen** — nicht nur umgesetzt.

## Sprache

Code und Kommentare in diesem Paket sind **Englisch** (Plan-Vorgabe, siehe
`docs/DECISIONS.md` vom 26.08.). UI, Content und Commit-Messages sind **Deutsch**.
Die Reel-Skripte unter `scripts/` sind die Ausnahme: dort ist alles Deutsch, weil sie
Drehbücher enthalten.

## Die wichtigsten Wege

```bash
pnpm exec tsx scripts/reel-binder.ts --drehbuch <name>   # Kunstseiten-Reel bauen
pnpm exec tsx scripts/reel-abspann.ts --bauen            # Abspann-Muster
pnpm exec tsc --noEmit -p tsconfig.tools.json            # Typprüfung der Skripte
pnpm test                                                # Vitest
```

`MP_LLM_PAUSED=true` steht seit dem 08.09. in der `.env`: Texte kommen aus der
Claude-Sitzung, nicht aus dem Worker. Den OpenRouter-Key trotzdem **nicht** entfernen —
der Worker stirbt sonst beim Start.
