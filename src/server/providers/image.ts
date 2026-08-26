/** Image generation via an OpenRouter image-capable model (behind ImageProvider). */
import fs from "node:fs";
import path from "node:path";
import type { ImageProvider, ImageRequest, ImageResult } from "./index.js";
import { markPng } from "../util/png.js";

interface ImgResponse {
  model?: string;
  choices?: { message?: { content?: string | null; images?: { image_url?: { url?: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string };
}

export class OpenRouterImageProvider implements ImageProvider {
  constructor(private readonly apiKey: string, private readonly model: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async generate(req: ImageRequest, outDir: string): Promise<ImageResult> {
    const res = await this.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://agi-empire.com/mp/", "X-Title": "Marketing Pilot" },
      body: JSON.stringify({ model: this.model, messages: [{ role: "user", content: `${req.prompt} Aspect ratio ${req.width}:${req.height}.` }], modalities: ["image", "text"], usage: { include: true } }),
      signal: AbortSignal.timeout(180_000),
    });
    const data = (await res.json()) as ImgResponse;
    if (!res.ok || data.error) throw new Error(`Bildmodell ${this.model}: ${data.error?.message ?? res.status}`);
    const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url?.startsWith("data:image")) throw new Error(`Bildmodell ${this.model} hat kein Bild geliefert.`);
    const m = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(url);
    if (!m) throw new Error("Unbekanntes Bildformat");
    const ext = m[1] === "image/png" ? "png" : m[1] === "image/jpeg" ? "jpg" : "webp";
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `image-${Date.now()}.${ext}`);
    fs.writeFileSync(file, Buffer.from(m[2] ?? "", "base64"));
    if (ext === "png") markPng(file, { aiGenerated: true, generator: "Marketing Pilot", model: this.model });
    return { path: file, model: data.model ?? this.model, usage: { tokensIn: data.usage?.prompt_tokens ?? 0, tokensOut: data.usage?.completion_tokens ?? 0, costUsd: data.usage?.cost ?? 0 } };
  }
}
