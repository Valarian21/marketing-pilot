import { useState, type FormEvent } from "react";
import { useHost } from "../host.js";
import { Button, Card, Notice } from "../components/ui.js";

export function LoginPage() {
  const { info, login } = useHost();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (info?.mode === "dashboard") {
    return (
      <div className="mp-login-wrap">
        <Card className="mp-login">
          <h1 className="mp-h1">Nicht angemeldet</h1>
          <p>Marketing Pilot nutzt die Anmeldung des Dashboards. Bitte dort einloggen und dann zurückkehren.</p>
          <a className="mp-btn mp-btn--primary" href={info.backLink ?? "/"}>Zum Dashboard-Login</a>
        </Card>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(user, password); }
    catch (err) { setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen."); }
    finally { setBusy(false); }
  };

  return (
    <div className="mp-login-wrap">
      <Card className="mp-login">
        <div className="mp-label">Marketing Pilot</div>
        <h1 className="mp-h1">Anmelden</h1>
        <form onSubmit={(e) => void submit(e)} className="mp-form">
          <label className="mp-field"><span>Benutzer</span><input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" required /></label>
          <label className="mp-field"><span>Passwort</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          {error && <Notice kind="bad">{error}</Notice>}
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "…" : "Anmelden"}</Button>
        </form>
      </Card>
    </div>
  );
}
