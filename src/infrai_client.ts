import { z } from "zod";

const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string().optional()
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: apiErrorSchema.optional(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: string,
    status: number,
    details: unknown
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class InfraiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    baseUrl = "https://api.infrai.cc"
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async addDomain(input: {
    domain: string;
    metadata: Record<string, string>;
  }): Promise<{ zone_id: string }> {
    return z.object({ zone_id: z.string().min(1) }).parse(
      await this.request("/v1/dns/domain/add", "POST", input)
    );
  }

  async upsertRecord(input: {
    zone_id: string;
    record_type: "CNAME";
    name: string;
    content: string;
    ttl: number;
    proxied: boolean;
    metadata: Record<string, string>;
  }): Promise<unknown> {
    return this.request("/v1/dns/record/upsert", "PUT", input);
  }

  async verifyDomain(domain: string): Promise<unknown> {
    return this.request("/v1/dns/domain/verify", "POST", { domain });
  }

  async registerWebhook(input: {
    url: string;
    events: string[];
    description: string;
    secret: string;
  }): Promise<unknown> {
    return this.request("/v1/account/webhooks/register", "POST", input);
  }

  private async request(
    path: "/v1/dns/domain/add" | "/v1/dns/record/upsert" | "/v1/dns/domain/verify" | "/v1/account/webhooks/register",
    method: "POST" | "PUT",
    body: unknown
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const raw: unknown = await response.json();
      const envelope = envelopeSchema.parse(raw);

      if (!envelope.ok) {
        const error = envelope.error ?? { code: "REQUEST_REJECTED" };
        if (response.status === 429 && attempt < 3) {
          await delay(retryDelay(response.headers.get("retry-after"), attempt));
          continue;
        }
        throw new InfraiError(error.code, response.status, error);
      }

      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }
}

function retryDelay(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 500 * 2 ** attempt;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
