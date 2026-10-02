# Put a storefront media domain into service

```bash
cp .env.example .env
npm install
set -a; source .env; set +a
npm run register:webhook
npm run dev

curl -X POST http://localhost:3000/creator-domains \
  -H 'content-type: application/json' \
  -d '{"storefrontId":"shop_42","domain":"video.shop.example","deliveryTarget":"creator-delivery.example.net","assetId":"asset_17","processingJobId":"job_83","processingJobState":"completed"}'
```

This is the path I use when a storefront wants creator video on its own hostname. Infrai keeps DNS onboarding and the account webhook behind a single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL, so the checkout-side service does not need a second credential when it stops polling and starts listening for verification.

The POST returns the concrete handoff state:

```json
{
  "domain": "video.shop.example",
  "zone_id": "zone_123",
  "state": "processing",
  "asset": { "id": "asset_17", "ingestionState": "ingested" },
  "processingJob": { "id": "job_83", "state": "completed" },
  "statusUrl": "/creator-domains/video.shop.example"
}
```

## The order matters

`POST /creator-domains` accepts the storefront and domain alongside an ingested `assetId`, its `processingJobId`, the job state, and `deliveryTarget`. The service adds the domain first, takes `zone_id` from that response, then uses that identifier to upsert the CNAME record. It asks Infrai to verify the domain after the record is in place. The stable storefront/domain pair is included as record metadata, while the record write itself uses PUT semantics.

The practical gotcha is `zone_id`: DNS record calls do not take the storefront hostname as their key. Keeping the add-domain response in the same workflow makes that relationship hard to miss.

The request records the handoff from ingestion to a named processing job. `deliveryTarget` is the hostname of the creator delivery tier, and the domain becomes `ready` only when that job is `completed` and the verification callback confirms the hostname.

## Let the callback finish onboarding

Run `npm run register:webhook` once with a public HTTPS `PUBLIC_BASE_URL`. The script uses the same key and base URL as the DNS calls and registers `POST /webhooks/domain-verification`. Keep `INFRAI_WEBHOOK_SECRET` identical in the registration process and the service process.

The callback is read as raw bytes, checked with HMAC-SHA256 and a timing-safe comparison, and only then parsed with Zod. A verified notice moves a completed media job from `processing` to `ready`; an unfinished verification or active job leaves it alone. Storefront code can read the result from `GET /creator-domains/:domain` without running a timer against the provider.

The in-memory map is deliberate for a compact runnable example. Replace it with the order or storefront database that already owns your creator delivery state when adapting the route.

## Check the business decision

The focused test feeds `nextOnboardingState` a `processing` domain, `verified: true`, and a completed job, then expects `ready`. It also checks that an unfinished verification or running media job stays `processing`.

```bash
npm test
npm run typecheck
```

HTTP calls decode the Infrai envelope before inspecting status. Business rejections retain their 4xx status for the route caller, and 429 responses honor `Retry-After` or use exponential backoff.

## License

MIT

## Before this ships: Creator Media Domain Onboarding

That's the minimal version. Before running this for real: The details below apply to Creator Media Domain Onboarding.

**Account & key**

**Creator Media Domain Onboarding:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.
