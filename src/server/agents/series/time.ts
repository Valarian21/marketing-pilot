/**
 * Zeitrechnung für Serien — konsequent in **Europe/Berlin**.
 *
 * Der Rest des Piloten rechnet in UTC, und das ist auch richtig für Zeitstempel.
 * Ein Slot dagegen ist eine Verabredung mit Marcel: „montags um 9" heißt neun
 * Uhr in Berlin, im Sommer wie im Winter. In UTC gerechnet würde der Beitrag
 * zweimal im Jahr um eine Stunde wandern.
 */
import type { SeriesCadence, Weekday } from "../../../shared/schemas.js";

const ORDER: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const SHORT: Record<string, Weekday> = { Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat" };

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Mo", tue: "Di", wed: "Mi", thu: "Do", fri: "Fr", sat: "Sa", sun: "So",
};

const FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", hourCycle: "h23", weekday: "short",
});

/** Wochentag, Stunde und Datum (YYYY-MM-DD) eines Zeitpunkts in Berlin. */
export function berlinParts(at: Date): { day: Weekday; hour: number; date: string } {
  const p = Object.fromEntries(FMT.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    day: SHORT[p["weekday"] ?? "Mon"] ?? "mon",
    hour: Number(p["hour"] ?? "0"),
    date: `${p["year"]}-${p["month"]}-${p["day"]}`,
  };
}

/** Verschiebung Berlins gegen UTC in Minuten zum gegebenen Zeitpunkt (60 oder 120). */
function offsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", timeZoneName: "longOffset" })
    .formatToParts(at).find((x) => x.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/**
 * Der UTC-Zeitpunkt, an dem in Berlin `date` um `hour` Uhr ist.
 * (Die zweideutige Stunde der Zeitumstellung bleibt unbehandelt — ein Slot um
 * 2 Uhr nachts an genau diesen zwei Tagen im Jahr kann eine Stunde daneben
 * liegen. Für Redaktionsslots am Vormittag ist das ohne Belang.)
 */
export function berlinInstant(date: string, hour: number): Date {
  const guess = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  return new Date(guess.getTime() - offsetMinutes(guess) * 60_000);
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Der nächste fällige Zeitpunkt der Kadenz nach `from` (immer in der Zukunft). */
export function nextRunAt(cadence: SeriesCadence, from = new Date()): Date | null {
  if (!cadence.days.length) return null;
  const want = new Set<Weekday>(cadence.days);
  for (let i = 0; i <= 8; i++) {
    const probe = addDays(from, i);
    const parts = berlinParts(probe);
    if (!want.has(parts.day)) continue;
    const at = berlinInstant(parts.date, cadence.hour);
    if (at.getTime() > from.getTime()) return at;
  }
  return null;
}

/**
 * Ist die Serie jetzt dran? Genau dann, wenn heute (Berliner Datum) ein
 * Kadenztag ist, die Stunde erreicht wurde — und sie heute noch nicht lief.
 * Der Tagesvergleich ist der Doppellauf-Schutz: er überlebt jeden Neustart,
 * ohne dass wir Minuten zählen müssen.
 */
export function isDue(cadence: SeriesCadence, lastRunAt: string | null, now = new Date()): boolean {
  const parts = berlinParts(now);
  if (!cadence.days.includes(parts.day)) return false;
  if (parts.hour < cadence.hour) return false;
  if (!lastRunAt) return true;
  return berlinParts(new Date(lastRunAt)).date !== parts.date;
}

export { ORDER as WEEKDAY_ORDER };
