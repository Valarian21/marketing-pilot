/**
 * Minimaler ZIP-Schreiber (nur „stored", ohne Kompression).
 *
 * Warum keine Bibliothek: die Dateien im Social-Kit sind PNGs, also bereits
 * komprimiert — Deflate würde sie um Promille schrumpfen und uns eine
 * Abhängigkeit einbringen. Ein ZIP ohne Kompression ist knapp hundert Zeilen
 * und von jedem Betriebssystem lesbar.
 */
import crypto from "node:crypto";

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0 ^ -1;
  for (const b of buf) c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xff]!;
  return (c ^ -1) >>> 0;
}

/** MS-DOS-Zeitstempel, wie das ZIP-Format ihn erwartet. */
function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipEntry { name: string; data: Buffer }

export function buildZip(entries: ZipEntry[], now = new Date()): Buffer {
  const { time, date } = dosTime(now);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // Signatur
    local.writeUInt16LE(20, 4);           // benoetigte Version
    local.writeUInt16LE(0x0800, 6);       // Flag: Namen sind UTF-8
    local.writeUInt16LE(0, 8);            // Methode 0 = stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, e.data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(e.data.length, 20);
    dir.writeUInt32LE(e.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(0, 38);             // externe Attribute
    dir.writeUInt32LE(offset, 42);        // Position des lokalen Kopfes
    central.push(dir, name);

    offset += 30 + name.length + e.data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/**
 * Ein Dateiname, der auf jedem System funktioniert.
 *
 * Umlaute werden deutsch umschrieben, nicht zerlegt: aus „Süß" wird „Suess",
 * nicht „Su" — die Datei landet schließlich in Marcels Downloads-Ordner.
 */
const UMLAUTE: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss" };

export const safeName = (s: string): string =>
  s.replace(/[äöüÄÖÜß]/g, (c) => UMLAUTE[c] ?? c)
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)
  || crypto.randomBytes(4).toString("hex");
