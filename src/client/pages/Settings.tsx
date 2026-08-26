import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Card, Notice, PageHeader, Pill } from "../components/ui.js";

interface Status {
  mode: string; dataDir: string; publicBase: string;
  providers: { openrouter: boolean; elevenlabs: boolean; search: string; publish: string; postiz: boolean };
  models: { strong: string; cheap: string; image: string; geo: string[] };
  demo: { testProjectUrl: string | null; demoBaseUrl: string | null };
}

const yes = (v: boolean) => <Pill kind={v ? "done" : "review"}>{v ? "konfiguriert" : "fehlt"}</Pill>;

export function SettingsPage() {
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Status>("/settings/status").then(setS).catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler")); }, []);

  return (
    <>
      <PageHeader label="Konfiguration" title="Einstellungen" />
      {error && <Notice kind="bad">{error}</Notice>}
      {s && (
        <div className="mp-two-col">
          <Card>
            <h2>Betrieb</h2>
            <dl className="mp-dl">
              <dt>Modus</dt><dd>{s.mode}</dd>
              <dt>Datenverzeichnis</dt><dd><code className="mp-code">{s.dataDir}</code></dd>
              <dt>Öffentliche Basis-URL</dt><dd>{s.publicBase}</dd>
              <dt>Test-Projekt-URL</dt><dd>{s.demo.testProjectUrl ?? "–"}</dd>
              <dt>Demo-Instanz (Video)</dt><dd>{s.demo.demoBaseUrl ?? "–"}</dd>
            </dl>
            <p className="mp-muted">Werte kommen aus <code className="mp-code">.env</code> – Schlüssel werden nie angezeigt.</p>
          </Card>
          <Card>
            <h2>Provider</h2>
            <dl className="mp-dl">
              <dt>OpenRouter</dt><dd>{yes(s.providers.openrouter)}</dd>
              <dt>ElevenLabs</dt><dd>{yes(s.providers.elevenlabs)}</dd>
              <dt>Websuche</dt><dd>{s.providers.search}</dd>
              <dt>Veröffentlichung</dt><dd>{s.providers.publish}{s.providers.publish === "postiz" && <> {yes(s.providers.postiz)}</>}</dd>
            </dl>
            <h2>Modelle</h2>
            <dl className="mp-dl">
              <dt>Analyse / Strategie</dt><dd><code className="mp-code">{s.models.strong}</code></dd>
              <dt>Massen-Content</dt><dd><code className="mp-code">{s.models.cheap}</code></dd>
              <dt>Bilder</dt><dd><code className="mp-code">{s.models.image}</code></dd>
              <dt>GEO-Engines</dt><dd>{s.models.geo.map((m) => <code key={m} className="mp-code mp-code--list">{m}</code>)}</dd>
            </dl>
          </Card>
        </div>
      )}
    </>
  );
}
