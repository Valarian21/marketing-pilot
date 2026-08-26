# Fortschritt

Immer zuerst `MARKETING_PILOT_PLAN.md` lesen, dann diese Datei.

## Shot 0 – Discovery und Gerüst: **fertig** (2026-08-26)

Erledigt:
- Host analysiert → `docs/HOST.md`; Stack-Entscheidung → `docs/DECISIONS.md`.
- Paket `marketing-pilot/` (Node 22, pnpm, TypeScript strict): Fastify-API unter `/api/mp/*`, React-SPA unter `/mp/*`, Drizzle-Schema mit allen `mp_`-Tabellen des Domänenmodells (+ `mp_settings`), Migration `0000`.
- `src/host-adapter.ts` (Interface) + `host-adapter.dashboard.ts` + `host-adapter.standalone.ts`; Umschaltung per `MP_STANDALONE`.
- Projekte anlegen/lesen/ändern/löschen (API + UI), Audit-Log-Einträge, Aktivitätsseite (Läufe + Audit), Einstellungsseite (Provider-Status ohne Schlüssel).
- Lese-Endpunkte aller Domänen (liefern `[]`), Schreibpfade der späteren Shots als explizite 501 mit Shot-Nummer.
- `tokens.css` (Theme Gewächshaus, Light/Dark) übernommen, gesamtes UI nur über Tokens.
- `pnpm lint && pnpm typecheck && pnpm test` grün (12 Tests), `pnpm build` ok.
- Betrieb: systemd `app-marketing-pilot` (8105, developer), nginx `/mp/` + `/api/mp/` → 8105, Sidebar-Link „Marketing Pilot“ im Dashboard.

Offen / zu klären (siehe Zusammenfassung Shot 0):
- OpenRouter-Key in `marketing-pilot/.env` eintragen (`OPENROUTER_API_KEY`), `MP_TEST_PROJECT_URL` prüfen.
- Modell-IDs in `config/models.ts` vor Shot 1 gegen OpenRouter prüfen.
- ~~`mp.db` in `scripts/backup.sh` aufnehmen~~ → erledigt in Shot 0.

## Shot 1 – Analyse-Agent: **gebaut** (2026-08-26), Live-Test siehe unten

Erledigt:
- Pipeline `src/server/agents/analysis/` (crawl → brief → competitors → personas → attention → geo), Orchestrierung in `pipeline.ts` (eine `mp_analysis_runs`-Zeile je Lauf, ein `mp_agent_runs`-Eintrag je Schritt mit Tokens/Kosten aus der OpenRouter-Antwort). Läuft losgelöst vom Request, UI pollt alle 3 s. Läufe, die ein Neustart abbricht, werden beim Start als fehlgeschlagen markiert.
- Crawler (Playwright, max. 40 Seiten, robots.txt, Prioritäten Pricing/Features/Docs/Changelog, App-Store-Seiten + GitHub-README, 5 Screenshots als `mp_assets`), Texte in `mp_pages`.
- Provider: `OpenRouterProvider` (Kosten aus `usage.cost`, Retry bei 429/5xx), Suche `brave|serper|duckduckgo-html` (Fallback ohne Key), HTML/robots-Helfer ohne Zusatzbibliotheken.
- Prompts als reine Funktionen in `agents/prompts/analysis.ts` (Snapshot-Tests in `tests/__snapshots__`).
- API: `POST …/analysis/run` (`{from?}` für Teil-Neuläufe), `GET …/analysis` (Gesamtsicht), `PATCH …/brief` (markiert `userEdited` + Felder), `POST …/brief/confirm` (schaltet Strategie frei, Projekt → aktiv), `GET /api/mp/assets/:id/file`.
- UI `/mp/projects/:id/analysis`: Fortschritt je Schritt (mit „ab hier neu“), Brief inline editierbar (Speichern bei Verlassen des Feldes, Pille „vom Nutzer korrigiert“), Screenshots, Wettbewerber mit belegten Beschwerden, Personas als Karten, Attention Map als Rangliste, GEO-Tabelle mit Modellfilter, „Brief bestätigen“.
- 30 Tests grün (Pipeline End-to-End mit Fake-LLM/-Suche/-Crawler).

Offen:
- **Echte Produkt-URL** für einen aussagekräftigen Lauf (Platzhalter `agi-empire.com/marketing-pilot` liegt hinter dem Login).
- Such-API (Brave/Serper) eintragen, sobald DuckDuckGo-HTML zu dünn ist (`MP_SEARCH_PROVIDER`, `MP_SEARCH_API_KEY`).
## Shot 2 – Strategie, Aufgaben, Timeline: offen
## Shot 3 – Content Studio: offen
## Shot 4 – Video-Fabrik: offen
## Shot 5 – Community-Radar, Insights, Wochen-Loop: offen
