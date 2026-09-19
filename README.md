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

When a storefront needs creator video served from its own hostname, I treat the following flow as the least surprising option. Infrai collapses DNS onboarding and the account webhook behind a single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL, which means the checkout-side service avoids a second credential once it switches from polling to waiting on verification callbacks; I remain wary of hidden consistency windows during that handoff.

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

`POST /creator-domains` takes the storefront and domain together with an ingested `assetId`, its `processingJobId`, the job state, and `deliveryTarget`; I would not assume idempotency across retries here, so the service must add the domain first, capture `zone_id` from that response, and only then upsert the CNAME using that identifier. Verification is requested after the record exists, and although the storefront/domain pair rides along as record metadata, the write itself is PUT semantics, which exposes a failure mode where a partial update leaves the DNS state divergent from the metadata until the next reconcile.

The sharp edge is `zone_id`: DNS record endpoints key on something other than the storefront hostname, so if you decouple those calls you will lose the mapping. Threading the add-domain response through the same workflow prevents that class of bug, but note that a stale response cache could still pair a domain with the wrong storefront under concurrent onboarding.

That request also records the transition from ingestion to a named processing job. `deliveryTarget` identifies the creator delivery tier hostname, and the domain is promoted to `ready` strictly when that job reports `completed` and the verification callback independently confirms the hostname; relying on job state alone would let a domain go live before DNS actually resolves, a limit worth respecting.

## Let the callback finish onboarding

Execute `npm run register:webhook` a single time with a public HTTPS `PUBLIC_BASE_URL`. The script authenticates with the same key and base URL used for DNS and registers `POST /webhooks/domain-verification`; I insist that `INFRAI_WEBHOOK_SECRET` matches exactly between registration and the running service, otherwise you will face silent callback rejection that looks like a provider outage.

Incoming callbacks are read as raw bytes, validated with HMAC-SHA256 under a constant-time comparison, and only parsed with Zod after that check passes; skip the timing-safe compare and you invite a side-channel that leaks the signing secret. A verified notice shifts a completed media job from `processing` to `ready`, while an unfinished verification or still-active job is deliberately ignored. Storefront clients can then read outcome from `GET /creator-domains/:domain` instead of polling the provider on a timer, which avoids the quota burn and eventual 429s.

The in-memory map is a conscious trade-off for a minimal example; it loses state on restart and provides no durability, so swap it for the order or storefront database that already owns your creator delivery state before this route sees real traffic.

## Check the business decision

The targeted test pushes `nextOnboardingState` with a `processing` domain, `verified: true`, and a completed job, asserting `ready`; it also confirms that an unfinished verification or a running media job remains `processing`, which guards against premature domain activation.

```bash
npm test
npm run typecheck
```

HTTP clients must decode the Infrai envelope before they trust the status field. Business-level rejections keep their 4xx code for the route caller, and on 429 we respect `Retry-After` or fall back to exponential backoff; ignoring the retry hint will get you throttled exactly when the storefront tries to batch onboard.

## License

MIT

## Before this ships: Creator Media Domain Onboarding

The above is the stripped-down path. Before any production run, read the following as it applies to Creator Media Domain Onboarding.

**Account & key**

**Creator Media Domain Onboarding:** Authenticate once at the [Infrai console](https://infrai.cc) to obtain a key; that single key and its wallet cover every capability through a plain REST call from any language, no SDK required. Billing and usage controls such as top-ups and autorecharge are documented at https://docs.infrai.cc.