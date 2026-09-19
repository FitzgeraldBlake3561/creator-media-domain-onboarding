import { z } from "zod";
import { InfraiClient } from "./infrai_client.js";

const environment = z.object({
  INFRAI_API_KEY: z.string().min(1),
  INFRAI_WEBHOOK_SECRET: z.string().min(16),
  PUBLIC_BASE_URL: z.string().url()
}).parse(process.env);

const infrai = new InfraiClient(environment.INFRAI_API_KEY);
const result = await infrai.registerWebhook({
  url: new URL("/webhooks/domain-verification", environment.PUBLIC_BASE_URL).toString(),
  events: ["dns.domain.verify"],
  description: "Creator delivery domain verification",
  secret: environment.INFRAI_WEBHOOK_SECRET
});

console.log(JSON.stringify(result, null, 2));
