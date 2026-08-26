/**
 * AI-provenance marking for generated PNGs. c2pa-node needs a native Rust build
 * that does not fit this VPS setup (see DECISIONS.md), so we write the fallback
 * the plan allows: text chunks `AI-generated: true` + XMP-style metadata, and
 * note it in the asset meta / review queue.
 */
import fs from "node:fs";
import zlib from "node:zlib";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf: Buffer): number {
  let c = ~0 >>> 0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export interface ProvenanceInfo { aiGenerated: boolean; generator: string; model?: string; createdAt?: string }

/** Insert tEXt/iTXt chunks right after IHDR. Idempotent: existing marks are replaced. */
export function markPng(file: string, info: ProvenanceInfo): void {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error("Keine PNG-Datei: " + file);
  const out: Buffer[] = [SIG];
  let pos = 8;
  let inserted = false;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const whole = buf.subarray(pos, pos + 12 + len);
    const isOurs = (type === "tEXt" || type === "iTXt") && /^(AI-generated|Software|XML:com\.adobe\.xmp)\0/.test(buf.toString("latin1", pos + 8, pos + 8 + Math.min(len, 40)));
    if (!isOurs) out.push(whole);
    pos += 12 + len;
    if (type === "IHDR" && !inserted) {
      inserted = true;
      out.push(chunk("tEXt", Buffer.from(`AI-generated\0${info.aiGenerated ? "true" : "false"}`, "latin1")));
      out.push(chunk("tEXt", Buffer.from(`Software\0${info.generator}${info.model ? ` (${info.model})` : ""}`, "latin1")));
      const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"><xmp:CreatorTool>${info.generator}</xmp:CreatorTool><Iptc4xmpExt:DigitalSourceType>${info.aiGenerated ? "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" : "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture"}</Iptc4xmpExt:DigitalSourceType><dc:description>AI-generated: ${info.aiGenerated}</dc:description></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
      // iTXt: keyword\0 compression flag(1=compressed) method(0) lang\0 translated\0 data
      const data = Buffer.concat([Buffer.from("XML:com.adobe.xmp\0", "latin1"), Buffer.from([1, 0]), Buffer.from("\0\0", "latin1"), zlib.deflateSync(Buffer.from(xmp, "utf8"))]);
      out.push(chunk("iTXt", data));
    }
  }
  fs.writeFileSync(file, Buffer.concat(out));
}

export function readPngTextChunks(file: string): Record<string, string> {
  const buf = fs.readFileSync(file);
  const out: Record<string, string> = {};
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    if (type === "tEXt") {
      const data = buf.toString("latin1", pos + 8, pos + 8 + len);
      const i = data.indexOf("\0");
      if (i > 0) out[data.slice(0, i)] = data.slice(i + 1);
    }
    pos += 12 + len;
  }
  return out;
}

export function pngSize(file: string): { width: number; height: number } | null {
  try {
    const fd = fs.openSync(file, "r");
    const head = Buffer.alloc(24); fs.readSync(fd, head, 0, 24, 0); fs.closeSync(fd);
    if (!head.subarray(0, 8).equals(SIG)) return null;
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } catch { return null; }
}
