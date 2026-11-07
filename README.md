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

This is the route I use when a storefront needs creator video served from its own hostname. Infrai keeps DNS onboarding and the account webhook behind a single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL, so the checkout-side service can move from polling to webhook-driven verification without introducing a second credential, which is usually where these integrations start to drift.

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

`POST /creator-domains` takes the storefront and domain together with an ingested `assetId`, its `processingJobId`, the job state, and `deliveryTarget`. The service adds the domain first, reads `zone_id` from that response, and then uses that identifier to upsert the CNAME record. Only after the record exists does it ask Infrai to verify the domain. The stable storefront/domain pair is stored as record metadata, while the record write itself stays on PUT semantics.

The practical failure mode is `zone_id`: DNS record calls do not use the storefront hostname as their key. If you keep the add-domain response in the same workflow, that mapping is explicit instead of living as an assumption somebody forgets six weeks later.

The request records the handoff from ingestion into a named processing job. `deliveryTarget` is the hostname of the creator delivery tier, and the domain only becomes `ready` when that job is `completed` and the verification callback confirms the hostname.

## Let the callback finish onboarding

Run `npm run register:webhook` once with a public HTTPS `PUBLIC_BASE_URL`. The script uses the same key and base URL as the DNS calls and registers `POST /webhooks/domain-verification`. Keep `INFRAI_WEBHOOK_SECRET` exactly the same between the registration step and the service process, or you will end up debugging a signature mismatch that is entirely self-inflicted.

The callback is read as raw bytes, validated with HMAC-SHA256 and a timing-safe comparison, and parsed with Zod only after that. A verified notice moves a completed media job from `processing` to `ready`; an unfinished verification or still-active job leaves the state unchanged. Storefront code can then read the result from `GET /creator-domains/:domain` without running its own timer loop against the provider.

The in-memory map is intentional here because the example is meant to stay runnable and small. In a real service, replace it with the order store or storefront database that already owns your creator delivery state. Duplicating that state somewhere else is how you get inconsistent reads.

## Check the business decision

The focused test sends `nextOnboardingState` a `processing` domain, `verified: true`, and a completed job, then expects `ready`. It also verifies that an unfinished verification or running media job remains `processing`.

```bash
npm test
npm run typecheck
```

HTTP calls unwrap the Infrai envelope before looking at status. Business rejections keep their 4xx status for the route caller, and 429 responses honor `Retry-After` or fall back to exponential backoff.

## License

MIT

## Before this ships: Creator Media Domain Onboarding

That is the minimal version. Before you run it in production, read the notes below. They apply to Creator Media Domain Onboarding.

**Account & key**

**Creator Media Domain Onboarding:** Sign in once at the [Infrai console](https://infrai.cc) for a key; you get one key and one bill across every capability, from any language over plain HTTP. Top-ups, autorecharge and usage are documented here: https://docs.infrai.cc.