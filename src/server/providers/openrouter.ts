/**
 * OpenRouter chat completions. Cost comes straight from the response
 * (`usage.cost`, requested via `usage: { include: true }`), so mp_agent_runs
 * never has to guess prices.
 */
import type { LlmMessage, LlmProvider, LlmResult } from "./index.js";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

interface OpenRouterResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string; code?: number };
}

export class OpenRouterProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly opts: { referer?: string; title?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
  ) {}

  async chat(model: string, messages: LlmMessage[], opts: { temperature?: number; json?: boolean; maxTokens?: number } = {}): Promise<LlmResult> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: opts.temperature ?? 0.2,
      usage: { include: true },
    };
    if (opts.maxTokens) body["max_tokens"] = opts.maxTokens;
    if (opts.json) body["response_format"] = { type: "json_object" };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": this.opts.referer ?? "https://agi-empire.com/mp/",
            "X-Title": this.opts.title ?? "Marketing Pilot",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 600_000),
        });
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
        continue;
      }
      const data = (await res.json()) as OpenRouterResponse;
      if (!res.ok || data.error) {
        throw new Error(`OpenRouter ${res.status}: ${data.error?.message ?? "unbekannter Fehler"}`);
      }
      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) {
        lastError = new Error(`OpenRouter: leere Antwort von ${model} (finish_reason=${data.choices?.[0]?.finish_reason ?? "?"})`);
        continue;
      }
      return {
        text,
        model: data.model ?? model,
        usage: {
          tokensIn: data.usage?.prompt_tokens ?? 0,
          tokensOut: data.usage?.completion_tokens ?? 0,
          costUsd: data.usage?.cost ?? 0,
        },
      };
    }
    throw lastError ?? new Error("OpenRouter: Anfrage fehlgeschlagen");
  }
}
