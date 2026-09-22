/**
 * Publikum — wie viele uns folgen und wie viele davon neu sind.
 *
 * Die Frage stand bis zum 22.09.2026 nur als eine Kachel unter acht anderen da,
 * und der Zuwachs fehlte ganz. Hier bekommt sie den Platz, den sie verdient:
 * eine große Zahl, daneben der Zuwachs im Zeitraum, darunter die Aufteilung auf
 * die Kanäle.
 *
 * Zwei Regeln, die den Unterschied zwischen richtig und plausibel ausmachen:
 *
 * - **Follower sind ein Bestand.** Zwischen zwei Messungen gilt der letzte Wert
 *   weiter, sonst hätte die Linie Löcher, wo nur niemand gemessen hat.
 * - **Kein Zuwachs aus dem Nichts.** Ein Kanal, dessen Followerzahl zum ersten
 *   Mal innerhalb des Zeitraums gemessen wurde, zählt ab diesem Messtag und
 *   nicht ab null — sonst sähe die erste Messung wie ein Ansturm aus. Das
 *   Datum steht in der Zeile, und unter der Tabelle steht, wen es betrifft.
 */
import { Link } from "react-router";
import type { CockpitKanal } from "../../shared/schemas.js";
import { Card } from "./ui.js";
import { Sparkline, kanalFarbe, prozent, tagKurz, zahl, type Punkt } from "./charts.js";

/** Bestandslinie ohne Löcher: fehlt ein Tag, gilt der letzte bekannte Wert. */
function fortgeschrieben(punkte: Punkt[], start: number | null): Punkt[] {
  let letzter = start;
  return punkte.map((p) => {
    if (typeof p.wert === "number") letzter = p.wert;
    return { tag: p.tag, wert: letzter };
  });
}

export function Publikum({ projectId, kanaele, tage }: { projectId: string; kanaele: CockpitKanal[]; tage: number }) {
  // Nur Kanäle, die überhaupt eine Followerzahl nennen — eine Zeile mit „–" in
  // jeder Spalte sagt nichts und kostet eine Zeile Aufmerksamkeit.
  const mit = kanaele.filter((k) => k.follower !== null).sort((a, b) => (b.follower ?? 0) - (a.follower ?? 0));
  if (mit.length === 0) return null;

  const gesamt = mit.reduce((n, k) => n + (k.follower ?? 0), 0);
  const zuwachsKanaele = mit.filter((k) => k.neueFollower !== null);
  const zuwachs = zuwachsKanaele.length ? zuwachsKanaele.reduce((n, k) => n + (k.neueFollower ?? 0), 0) : null;
  // Kanäle, deren Zuwachs erst ab ihrem ersten Messtag zählt — die Summe ist
  // dann eher zu klein, und das muss dastehen.
  const spaeterGestartet = mit.filter((k) => k.neueFollower !== null && !k.followerExakt);
  const vorher = zuwachs !== null ? gesamt - zuwachs : null;
  const quote = vorher && vorher > 0 && zuwachs !== null ? zuwachs / vorher : null;

  return (
    <Card className="mp-publikum-karte">
      <div className="mp-card-head">
        <h2>Publikum <span className="mp-muted mp-small">Follower über alle Kanäle</span></h2>
        <Link className="mp-small" to={`/projects/${projectId}/channels`}>Kanäle einrichten</Link>
      </div>

      <div className="mp-publikum">
        <div className="mp-publikum-hero">
          <div className="mp-label">Follower gesamt</div>
          <div className="mp-hero-num">{zahl(gesamt)}</div>
          <div className="mp-hero-fuss">
            {zuwachs === null
              ? <span className="mp-muted mp-small">Noch kein Vergleichswert — der Zuwachs steht ab dem nächsten Zeitraum hier.</span>
              : <>
                <span className={`mp-delta ${zuwachs > 0 ? "is-auf" : zuwachs < 0 ? "is-ab" : ""}`}>
                  {zuwachs > 0 ? "▲" : zuwachs < 0 ? "▼" : "→"} {spaeterGestartet.length > 0 && "mind. "}{zuwachs > 0 ? "+" : ""}{zahl(zuwachs)} neu
                </span>
                <span className="mp-muted mp-small"> in {tage} Tagen{quote !== null && ` · ${prozent(quote, 0)}`}</span>
              </>}
          </div>
        </div>

        <div className="mp-publikum-anteil">
          <div className="mp-label">Woher sie kommen</div>
          {/* Gestapelter Anteilsbalken mit 2 px Fuge: ohne die Fuge verschmelzen
              zwei benachbarte Segmente zu einem, sobald sie ähnlich hell sind. */}
          <div className="mp-stapel" role="img" aria-label={mit.map((k) => `${k.label} ${k.follower}`).join(", ")}>
            {gesamt > 0
              ? mit.filter((k) => (k.follower ?? 0) > 0).map((k) => (
                <span key={k.platform} className="mp-stapel-teil"
                  style={{ flexGrow: k.follower ?? 0, background: kanalFarbe(k.platform) }}
                  title={`${k.label}: ${k.follower} Follower`} />
              ))
              : <span className="mp-stapel-leer" />}
          </div>
          <ul className="mp-legende">
            {mit.map((k) => (
              <li key={k.platform}>
                <span className="mp-chart-key" style={{ background: kanalFarbe(k.platform) }} aria-hidden="true" />
                {k.label} <span className="mp-num-cell">{zahl(k.follower)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mp-table-wrap">
        <table className="mp-table mp-table--publikum">
          <thead>
            <tr>
              <th>Kanal</th>
              <th className="mp-num-cell">Follower</th>
              <th className="mp-num-cell">Neu</th>
              <th className="mp-num-cell">Anteil</th>
              <th>Verlauf</th>
            </tr>
          </thead>
          <tbody>
            {mit.map((k) => (
              <tr key={k.platform}>
                <td>
                  <span className="mp-chart-key" style={{ background: kanalFarbe(k.platform) }} aria-hidden="true" />{" "}
                  {k.profilUrl ? <a href={k.profilUrl} target="_blank" rel="noreferrer">{k.label}</a> : k.label}
                </td>
                <td className="mp-num-cell">{zahl(k.follower)}</td>
                <td className="mp-num-cell">
                  {k.neueFollower === null
                    ? <span className="mp-muted" title="Noch keine zweite Messung">–</span>
                    : <>
                      <span className={k.neueFollower > 0 ? "mp-delta is-auf" : k.neueFollower < 0 ? "mp-delta is-ab" : "mp-muted"}>
                        {k.neueFollower > 0 ? "+" : ""}{zahl(k.neueFollower)}
                      </span>
                      {!k.followerExakt && k.followerStartTag && (
                        <span className="mp-publikum-ab" title={`Dieser Kanal wird erst seit ${tagKurz(k.followerStartTag)} gemessen — davor ist nichts bekannt.`}>
                          ab {tagKurz(k.followerStartTag)}
                        </span>
                      )}
                    </>}
                </td>
                <td className="mp-num-cell">{gesamt > 0 ? prozent((k.follower ?? 0) / gesamt, 0) : "–"}</td>
                <td className="mp-publikum-spark">
                  <Sparkline
                    punkte={fortgeschrieben(k.verlauf.map((v) => ({ tag: v.tag, wert: v.follower })), k.followerDavor)}
                    farbe={kanalFarbe(k.platform)} breite={160} hoehe={28} basis="spanne" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {spaeterGestartet.length > 0 && (
        <p className="mp-small mp-muted mp-publikum-fuss">
          Der Zuwachs ist eher zu klein als zu groß:{" "}
          {spaeterGestartet.map((k) => `${k.label} wird erst seit ${k.followerStartTag ? tagKurz(k.followerStartTag) : "kurzem"} gemessen`).join(", ")}
          {" "}— was davor passiert ist, weiß niemand.
        </p>
      )}
    </Card>
  );
}
