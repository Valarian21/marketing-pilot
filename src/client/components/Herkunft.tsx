/**
 * Woher die Besucher der Webseite kommen — und wie viele davon ein Konto anlegen.
 *
 * Die Karte beantwortet die zwei Fragen, die vorher zwischen Pilot und Produkt
 * zerfielen: „wie viele Leute waren überhaupt auf der Seite" und „welcher Kanal
 * bringt nicht nur Aufrufe, sondern Kunden".
 *
 * Drei Dinge, die sie bewusst nicht verschweigt:
 * 1. Es sind Seitenaufrufe, keine Köpfe — ohne Cookie ist niemand wiederzuerkennen.
 * 2. Vor `ersterTag` wurde gar nicht gezählt; ein leerer Balken heißt dann
 *    „nicht gemessen", nicht „niemand da".
 * 3. Die Quote setzt Konten eines Kanals ins Verhältnis zu dessen Aufrufen im
 *    selben Zeitraum. Wer heute ein Konto anlegt, war vielleicht letzte Woche da.
 */
import type { CockpitHerkunft } from "../../shared/schemas.js";
import { Card, Notice } from "./ui.js";
import { kanalFarbe, prozent, zahl } from "./charts.js";

/** Reihenfolge und Beschriftung der Gruppen — vom „verdienten" zum „geschenkten" Besuch. */
const ARTEN = {
  social: { label: "Soziale Kanäle", farbe: "var(--mp-serie-1)" },
  suche: { label: "Suchmaschinen", farbe: "var(--mp-serie-3)" },
  ki: { label: "KI-Chats", farbe: "var(--mp-serie-4)" },
  verweis: { label: "Andere Seiten", farbe: "var(--mp-serie-5)" },
  direkt: { label: "Direkt", farbe: "var(--mp-serie-rest)" },
} as const;

const farbeVon = (z: CockpitHerkunft): string =>
  z.platform ? kanalFarbe(z.platform) : ARTEN[z.art].farbe;

export function Herkunft({ besucher, tage }: { besucher: NonNullable<import("../../shared/schemas.js").CockpitView["besucher"]>; tage: number }) {
  if (!besucher.verfuegbar) {
    return (
      <Card>
        <h2>Besucher und Herkunft</h2>
        <p className="mp-muted">{besucher.hinweis}</p>
      </Card>
    );
  }

  const zeilen = besucher.herkunft;
  const max = Math.max(1, ...zeilen.map((z) => z.besuche));
  // Gruppen summieren, damit oben eine Antwort auf „was trägt uns" steht, bevor
  // die Einzelzeilen kommen.
  const gruppen = (Object.keys(ARTEN) as (keyof typeof ARTEN)[])
    .map((art) => ({
      art,
      ...ARTEN[art],
      besuche: zeilen.filter((z) => z.art === art).reduce((n, z) => n + z.besuche, 0),
      konten: zeilen.filter((z) => z.art === art).reduce((n, z) => n + z.konten, 0),
    }))
    .filter((g) => g.besuche > 0 || g.konten > 0);
  const gesamt = Math.max(1, gruppen.reduce((n, g) => n + g.besuche, 0));

  // Konten ohne Herkunft sind kein Messfehler, sondern der Preis dafür, ohne
  // Cookie zu messen: wer den Tab schließt und Tage später wiederkommt, ist „direkt".
  const ohneHerkunft = besucher.kontenGesamt - besucher.kontenMitHerkunft;

  return (
    <Card>
      <div className="mp-card-head">
        {/* Der Hinweis zur Zählweise steht als erste Fußnote unter der Tabelle; hier
            wiederholt, füllte er auf dem Handy vier fette Zeilen. */}
        <h2>Besucher und Herkunft <span className="mp-muted mp-small">letzte {tage} Tage</span></h2>
      </div>

      <div className="mp-herkunft-kopf">
        <div className="mp-ministat">
          <div className="mp-label">Besuche der Seite</div>
          <div className="mp-num">{zahl(besucher.besuche)}</div>
        </div>
        <div className="mp-ministat">
          <div className="mp-label">Neue Konten</div>
          <div className="mp-num">{zahl(besucher.kontenGesamt)}</div>
        </div>
        <div className="mp-ministat mp-ministat--hi">
          <div className="mp-label">Besuch → Konto</div>
          <div className="mp-num">{besucher.quote !== null ? prozent(besucher.quote, 2) : "–"}</div>
        </div>
      </div>

      {/* Ein Band statt fünf Balken: die Verteilung liest man in einer Zeile. */}
      {gruppen.length > 0 && (
        <>
          <div className="mp-band" role="img" aria-label="Verteilung der Besuche auf Kanalgruppen">
            {gruppen.filter((g) => g.besuche > 0).map((g) => (
              <span key={g.art} className="mp-band-teil" style={{ width: `${(g.besuche / gesamt) * 100}%`, background: g.farbe }}
                title={`${g.label}: ${g.besuche} Besuche`} />
            ))}
          </div>
          <div className="mp-band-legende">
            {gruppen.map((g) => (
              <span key={g.art} className="mp-band-key">
                <span className="mp-chart-key" style={{ background: g.farbe }} aria-hidden="true" />
                {g.label} <strong>{zahl(g.besuche)}</strong>
                {g.konten > 0 && <span className="mp-muted"> · {g.konten} Konto{g.konten > 1 ? "s" : ""}</span>}
              </span>
            ))}
          </div>
        </>
      )}

      {zeilen.length === 0 ? (
        <p className="mp-muted">Im Zeitraum wurde kein Besuch gezählt.</p>
      ) : (
        <div className="mp-table-wrap">
          <table className="mp-table">
            <thead>
              <tr>
                <th>Kanal</th>
                <th className="mp-num-cell">Besuche</th>
                <th className="mp-num-cell">Konten</th>
                <th className="mp-num-cell">davon zahlend</th>
                <th className="mp-num-cell">Besuch → Konto</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => (
                <tr key={z.id}>
                  <td>
                    <span className="mp-chart-key" style={{ background: farbeVon(z) }} aria-hidden="true" /> {z.label}
                  </td>
                  <td className="mp-num-cell">
                    <span className="mp-balken-mini" style={{ width: `${Math.max(2, (z.besuche / max) * 100)}%`, background: farbeVon(z) }} />
                    {z.besuche || "–"}
                  </td>
                  <td className="mp-num-cell">{z.konten || "–"}</td>
                  <td className="mp-num-cell">{z.zahlende || "–"}</td>
                  {/* Ohne Besuche dieses Kanals gibt es keinen Nenner — dann steht dort ein
                      Strich, auch wenn Konten da sind (sie kamen vor dem Zeitraum). */}
                  <td className="mp-num-cell">{z.quote !== null && z.besuche > 0 ? prozent(z.quote, 2) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul className="mp-plain-list mp-small mp-muted mp-herkunft-fuss">
        <li>Gezählt werden Seitenaufrufe, keine eindeutigen Besucher — ohne Cookie ist niemand wiederzuerkennen. Folgeseiten desselben Besuchs und erkannte Bots zählen nicht mit.</li>
        {besucher.ersterTag && <li>Gezählt wird erst seit dem {besucher.ersterTag.slice(8, 10)}.{besucher.ersterTag.slice(5, 7)}.{besucher.ersterTag.slice(0, 4)}; frühere Tage im Zeitraum sind unbekannt, nicht null.</li>}
        {besucher.direktSeit && <li>Direktbesuche (getippte Adresse, Lesezeichen, App-Symbol) zählen seit dem {besucher.direktSeit.slice(8, 10)}.{besucher.direktSeit.slice(5, 7)}. mit. Davor fehlten sie ganz — die Quote älterer Tage ist deshalb zu hoch.</li>}
        {ohneHerkunft > 0 && <li>{ohneHerkunft} der {besucher.kontenGesamt} neuen Konten tragen keine Herkunft: sie kamen direkt oder in einem zweiten Besuch, in dem die Quelle nicht mehr bekannt war.</li>}
      </ul>

      {besucher.kontenMitHerkunft === 0 && besucher.kontenGesamt > 0 && (
        <Notice kind="warn">
          Kein einziges neues Konto trägt eine Herkunft. Solange das so bleibt, ist die Spalte „Konten" leer und die Quote nicht zu bilden —
          die Besuchszahlen links stimmen trotzdem.
        </Notice>
      )}
    </Card>
  );
}
