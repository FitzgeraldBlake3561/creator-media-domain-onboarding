import { createHmac, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import {
  nextOnboardingState,
  type OnboardingState,
  type ProcessingJobState
} from "./onboarding_state.js";

const onboardingRequest = z.object({
  storefrontId: z.string().min(1),
  domain: z.string().min(3),
  deliveryTarget: z.string().min(1),
  assetId: z.string().min(1),
  processingJobId: z.string().min(1),
  processingJobState: z.enum(["queued", "running", "completed"])
}).strict();

const verificationNotice = z.object({
  event: z.literal("dns.domain.verify"),
  data: z.object({
    domain: z.string().min(3),
    verified: z.boolean()
  }).strict()
}).strict();

const apiKey = requireEnv("INFRAI_API_KEY");
const webhookSecret = requireEnv("INFRAI_WEBHOOK_SECRET");
const infrai = new InfraiClient(apiKey);
type DeliveryRecord = {
  state: OnboardingState;
  assetId: string;
  processingJobId: string;
  processingJobState: ProcessingJobState;
};

const deliveries = new Map<string, DeliveryRecord>();
const app = express();

app.post("/webhooks/domain-verification", express.raw({ type: "application/json" }), (req, res) => {
  const body = req.body as Buffer;
  const signature = z.string().min(1).parse(req.header("x-infrai-signature"));
  if (!validSignature(body, signature, webhookSecret)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const notice = verificationNotice.parse(JSON.parse(body.toString("utf8")));
  const delivery = deliveries.get(notice.data.domain);
  if (!delivery) {
    res.status(404).json({ error: "Onboarding not found" });
    return;
  }
  const state = nextOnboardingState(
    delivery.state,
    notice.data,
    delivery.processingJobState
  );
  deliveries.set(notice.data.domain, { ...delivery, state });
  res.status(200).json({ domain: notice.data.domain, state });
});

app.use(express.json());

app.post("/creator-domains", async (req, res, next) => {
  try {
    const input = onboardingRequest.parse(req.body);
    const onboardingId = `${input.storefrontId}:${input.domain}`;
    const { zone_id } = await infrai.addDomain({
      domain: input.domain,
      metadata: { onboarding_id: onboardingId, storefront_id: input.storefrontId }
    });

    await infrai.upsertRecord({
      zone_id,
      record_type: "CNAME",
      name: input.domain,
      content: input.deliveryTarget,
      ttl: 300,
      proxied: true,
      metadata: { onboarding_id: onboardingId }
    });
    await infrai.verifyDomain(input.domain);

    deliveries.set(input.domain, {
      state: "processing",
      assetId: input.assetId,
      processingJobId: input.processingJobId,
      processingJobState: input.processingJobState
    });
    res.status(202).json({
      domain: input.domain,
      zone_id,
      state: "processing",
      asset: { id: input.assetId, ingestionState: "ingested" },
      processingJob: { id: input.processingJobId, state: input.processingJobState },
      statusUrl: `/creator-domains/${encodeURIComponent(input.domain)}`
    });
  } catch (error) {
    next(error);
  }
});

app.get("/creator-domains/:domain", (req, res) => {
  const domain = z.string().min(3).parse(req.params.domain);
  const delivery = deliveries.get(domain);
  if (!delivery) {
    res.status(404).json({ error: "Onboarding not found" });
    return;
  }
  res.status(200).json({ domain, ...delivery });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid request", issues: error.issues });
    return;
  }
  if (error instanceof InfraiError) {
    const status = error.status >= 400 && error.status < 500 ? error.status : 502;
    res.status(status).json({ error: error.code, details: error.details });
    return;
  }
  res.status(502).json({ error: "Upstream request failed" });
});

const port = Number(process.env.PORT ?? "3000");
app.listen(port, () => console.log(`Creator delivery service listening on ${port}`));

function validSignature(body: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const supplied = Buffer.from(signature, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return supplied.length === expectedBytes.length && timingSafeEqual(supplied, expectedBytes);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
