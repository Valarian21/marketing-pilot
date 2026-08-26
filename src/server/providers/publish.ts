/** Publish providers: `manual` (default - human posts from the package) and `postiz` (optional scheduling). */
import type { Env } from "../env.js";
import type { PublishProvider, PublishRequest, PublishResult } from "./index.js";

export class ManualPublishProvider implements PublishProvider {
  readonly name = "manual" as const;
  async prepare(_req: PublishRequest): Promise<PublishResult> { return { mode: "manual" }; }
}

export class PostizPublishProvider implements PublishProvider {
  readonly name = "postiz" as const;
  constructor(private readonly apiUrl: string, private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async api<T>(p: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.apiUrl.replace(/\/$/, "")}${p}`, { ...init, headers: { Authorization: this.apiKey, "Content-Type": "application/json", ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Postiz ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  async prepare(req: PublishRequest): Promise<PublishResult> {
    const integrations = await this.api<{ id: string; identifier: string; name: string }[]>("/public/v1/integrations");
    const match = integrations.find((i) => i.identifier.toLowerCase().includes(req.platform.toLowerCase()));
    if (!match) throw new Error(`Postiz: kein verbundener Kanal für „${req.platform}“ (vorhanden: ${integrations.map((i) => i.identifier).join(", ") || "keine"})`);
    const date = req.scheduledAt ?? new Date(Date.now() + 3600_000).toISOString();
    await this.api("/public/v1/posts", {
      method: "POST",
      body: JSON.stringify({ type: "schedule", date, shortLink: false, posts: [{ integration: { id: match.id }, value: [{ content: req.body, image: [] }] }] }),
    });
    return { mode: "postiz", scheduledAt: date };
  }
}

export function createPublishProvider(env: Env): PublishProvider {
  if (env.MP_PUBLISH_PROVIDER === "postiz" && env.POSTIZ_API_URL && env.POSTIZ_API_KEY) return new PostizPublishProvider(env.POSTIZ_API_URL, env.POSTIZ_API_KEY);
  return new ManualPublishProvider();
}
