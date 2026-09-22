/**
 * Datenversorgung — kommen die Zahlen eigentlich von selbst herein?
 *
 * Diese Karte gibt es, weil im September 2026 drei Tage lang niemand merkte,
 * dass TikTok gar nicht mehr gemessen wurde: die Seite zeigte brav die letzten
 * bekannten Zahlen, und dass sie stehengeblieben waren, stand nirgends. Eine
 * Übersicht, die nur Zahlen zeigt, verschweigt ihr eigenes Alter.
 *
 * Eine Zeile je Kanal, und jede beantwortet vier Fragen in dieser Reihenfolge:
 * kommt es automatisch, auf welchem Weg, wie frisch ist es, was fehlt.
 */
import type { CockpitVersorgung } from "../../shared/schemas.js";
import { Card, Pill } from "./ui.js";
import { kanalFarbe, tagKurz } from "./charts.js";

const WEG_TEXT: Record<CockpitVersorgung["weg"], string> = {
  api: "API",
  studio: "Anmelde-Browser",
  export: "Export von Hand",
  keine: "nicht angebunden",
};

/** Der Ampelpunkt sagt den Zustand, das Wort daneben sagt ihn noch einmal — Farbe allein genügt nicht. */
function Ampel({ status }: { status: CockpitVersorgung["status"] }) {
  const text = status === "ok" ? "aktuell" : status === "spaet" ? "hängt" : "keine Zahlen";
  return (
    <span className={`mp-versorgung-ampel mp-versorgung-ampel--${status}`}>
      <span className="mp-versorgung-punkt" aria-hidden="true" />{text}
    </span>
  );
}

export function Versorgung({ zeilen }: { zeilen: CockpitVersorgung[] }) {
  if (zeilen.length === 0) return null;
  const automatisch = zeilen.filter((z) => z.automatisch && z.status !== "fehlt");
  const haengt = zeilen.filter((z) => z.automatisch && z.status === "spaet");
  const offen = zeilen.filter((z) => !z.automatisch);

  return (
    <Card>
      <div className="mp-card-head">
        <h2>Datenversorgung <span className="mp-muted mp-small">woher die Zahlen kommen und wie frisch sie sind</span></h2>
        <span className="mp-small mp-muted">
          {automatisch.length} von {zeilen.length} Kanälen holt der Pilot selbst
          {haengt.length > 0 && ` · ${haengt.length} hängt`}
        </span>
      </div>

      <div className="mp-table-wrap">
        <table className="mp-table mp-table--versorgung">
          <thead>
            <tr>
              <th>Kanal</th>
              <th>Zustand</th>
              <th>Weg</th>
              <th>Takt</th>
              <th>Stand</th>
              <th>Liefert</th>
              <th className="mp-num-cell">Beiträge mit Zahlen</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={z.platform}>
                <td className="mp-nowrap">
                  <span className="mp-chart-key" style={{ background: kanalFarbe(z.platform) }} aria-hidden="true" /> {z.label}
                </td>
                <td><Ampel status={z.status} /></td>
                <td className="mp-small">
                  {WEG_TEXT[z.weg]}
                  {z.weg !== "keine" && (z.automatisch
                    ? <> <Pill kind="done">automatisch</Pill></>
                    : <> <Pill kind="todo">von Hand</Pill></>)}
                </td>
                <td className="mp-small mp-muted">{z.takt}</td>
                <td className="mp-small mp-nowrap">
                  {z.datenBis ? tagKurz(z.datenBis) : "–"}
                  {z.rueckstand !== null && z.rueckstand > 1 && <span className="mp-versorgung-alt"> {z.rueckstand} Tage alt</span>}
                </td>
                <td className="mp-small">
                  {z.liefert.length === 0 ? <span className="mp-muted">nichts</span> : z.liefert.join(", ")}
                  {z.fehlt.length > 0 && <div className="mp-muted">ohne: {z.fehlt.join(", ")}</div>}
                </td>
                <td className="mp-num-cell">
                  {z.beitraegeGesamt === 0
                    ? <span className="mp-muted">–</span>
                    : <span className={z.beitraegeMitZahlen < z.beitraegeGesamt ? "mp-versorgung-luecke" : ""}>{z.beitraegeMitZahlen} / {z.beitraegeGesamt}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mp-small mp-muted mp-versorgung-fuss">
        „Liefert" steht für das, was in den gespeicherten Tagen dieses Kanals wirklich vorkommt — nicht dafür,
        was die Plattform laut Dokumentation könnte.
        {offen.length > 0 && <> Ohne Anbindung: {offen.map((z) => z.label).join(", ")}.</>}
      </p>
    </Card>
  );
}
