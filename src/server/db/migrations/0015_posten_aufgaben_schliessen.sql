-- Offene „Posten"-Aufgaben schließen.
--
-- Sie stammen aus dem Strategieplan der Lehreule-Zeit („Erstes Instagram-Reel
-- posten", „Erste Reddit-Antwort posten") und beziehen sich auf nichts, was der
-- Pilot heute tut: seit Shot 10 entscheidet der Zeitplan, was wann rausgeht.
-- Erzeugt werden sie nicht mehr (plan.ts, weekly.ts); der Bestand wird hier
-- einmalig geschlossen statt einzeln weggeklickt. `skipped` und nicht `done`,
-- damit die Historie ehrlich bleibt — getan hat sie niemand.
UPDATE mp_tasks
   SET status = 'skipped',
       description = TRIM(description || '

Automatisch geschlossen am 09.09.2026: Veröffentlichen steuert seither der Zeitplan des Piloten, nicht mehr die Aufgabenliste.'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE type = 'publish'
   AND status IN ('todo', 'in_progress')
   -- Nur Kanäle, die der Zeitplan wirklich bedient. Verzeichnisse, Reddit,
   -- Foren und Newsletter haben keinen Zeitplan — dort bleibt die Aufgabe der
   -- einzige Weg und damit stehen.
   AND (
        LOWER(channel) LIKE '%instagram%' OR LOWER(channel) LIKE '%facebook%' OR LOWER(channel) LIKE '%threads%'
     OR LOWER(channel) LIKE '%pinterest%' OR LOWER(channel) LIKE '%bluesky%' OR LOWER(channel) LIKE '%mastodon%'
     OR LOWER(channel) LIKE '%telegram%' OR LOWER(title) LIKE '%reel%'
   );
