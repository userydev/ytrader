# Content + editorial integration

The candidate is wired directly: `server/app.ts` applies content migrations 003/004 and installs authenticated content/editorial routes; `src/App.tsx` keeps authentication and selects the current `ContentReader`, whose root is the editorial briefing. Company, industry, raw-news and legacy reading routes remain accessible. No registration patch is needed. The obsolete patch and temporary editorial migration wrapper are empty and can be omitted when integrating.

## Host checks (not executed by this worker)

```text
npm run typecheck
npm run test:editorial
npm run editorial -- once
npm run editorial -- status
npm run editorial -- once
```

The second unchanged cycle must report no new dispatches or publications. For continuous processing: `npm run editorial -- worker`; SIGINT/SIGTERM stops after the current bounded cycle. The default is at most three new submissions and twelve existing-invocation polls per cycle. The CLI uses the existing host environment/configuration, without loading credential files. `npm run editorial -- migrate` applies 001/003/004.

Browser acceptance is host-owned: root briefing → event → inline exact quote/source version → company → return to event → follow → following. Check current/old/unknown publication labels at mobile width, and source/model/budget failure states. Real gateway invocation and resulting company-specific analysis still require host execution; no live outputs or test results are claimed here.

## Contracts

- Snapshot: existing authenticated `Ycore.contentSnapshot()` → `/ycore/v1/content/snapshot`; import uses the existing exact relevance linker before gathering company context. Selection does not require a handcrafted `news.change`.
- Invocation wire uses only the host-confirmed strict fields: purpose, model_policy, prompt_version=`first-loop-v1`, response_format, input_item_refs (`item_id`, `version`), messages, max_input_tokens, max_output_tokens, thinking_budget=0, pool=auto. Product prompt version remains in the durable fingerprint. UTF-8 serialized messages + 8192 + 1024 determines the input-token upper bound. Output is capped at 4800; requests larger than 65536 bytes are never submitted. Text input is globally bounded and profile financial dumps are not sent.
- No direct model calls. `budget()`/`budgetGate()` and the authoritative core hard caps/reservations remain unchanged. Disabled AI still imports sources. Only confirmed pre-dispatch rate limits are retried, at most three total attempts. Uncertain sends keep the idempotency key and any received invocation ID; only known IDs are polled, never automatically re-POSTed. Status exposes unresolved identities for host reconciliation.
- Paid identity is source versions + relevant compact context + product prompt version, excluding discovery/fetch times. Published history and canonical source versions are durable. Grouping requires the same action identity plus shared item identity or substantial overlapping exact event quotations, with stronger requirements for undated coverage. Same-company/different-action stories stay separate.
- Publication validates JSON structure, exact quotations against the actual canonical excerpt sent, company/business reference associations, and quoted occurrence dates. These checks do not claim semantic verification. Sources are rechecked before sending/publishing and on article/feed/history reads; unavailable/revoked dependencies fail closed.
- URL-less provider excerpts remain URL-less. `src/content/types.ts` is the content-domain type facade, used by content parsers/store/API/UI and extending the original shared types with nullable news URLs. The original `src/content-types.ts` is outside this task's writable scope and is intentionally unchanged. Both JSON import and snapshot paths accept null URLs. The licensed legacy briefing mapper's empty link is normalized back to null before returning it.
- New API prefix: `/api/v1/content/editorial`; GET feed, events/:id, follows, status; PUT follows and events/:id/read. User state is in PostgreSQL under the existing authenticated user/CSRF checks. GET never submits model jobs.
