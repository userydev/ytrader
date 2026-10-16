# First loop implementation / host hand-off

## Delivered and verification boundary

A fresh Fastify 5 / PostgreSQL service, durable source consumer and analysis worker, React/Vite Chinese reader, and Capacitor **8.5.3** configuration. No withdrawn application was restored. No example news, seed account, automatic model fallback, frontend service token, localStorage session, or mock-success route exists. Synthetic data lives only in tests.

**Host integration (2026-10-16):** Actual provider output reached persisted event versions, but host semantic review rejected two causal paths for confusing generation supply with power demand. Those versions are withdrawn; current real sample is explicitly facts-only. Automatic model execution remains disabled. This is not a completed explanation-quality acceptance.

**Execution evidence:** dependencies and lockfiles installed; independent loopback PostgreSQL databases initialized; real RSS/document inputs imported through ycore; actual Cloudflare/Gemini calls accounted within the daily/monthly cap. Core boundary checks, source replay checks, app integration tests and builds passed. Generated iOS project builds and runs in the simulator. Simulator login and terminate/relaunch Keychain restore have been exercised; physical iPhone signing/read path remains pending user connection. The exact current evidence and temporary resource identities are in CHECKPOINT.md. This is a local first-loop slice, not a deployment or full-P0 claim.


## Start locally (host runs these commands)

Requirements: Node >=22 (host Node26 is suitable), PostgreSQL, an independent `ytrader` database/role with no ycore DB grants. Create the database/role through host-approved administration. Do not point migrations or tests at ycore. Inject secrets through the host environment, not source files, command arguments or client `VITE_*` variables.

For explicit loopback-only web development, set these non-secret settings in the API/CLI terminal and inject `DATABASE_URL` securely:

```sh
export API_HOST=127.0.0.1
export API_PORT=3001
export WEB_ORIGIN=http://127.0.0.1:5173
export DEV_INSECURE_LOCALHOST=true
export MODEL_ENABLED=false
npm install
npm run migrate
npm run bootstrap-user
npm run dev:api
```

`bootstrap-user` reads a >=16-character password from stdin, with no terminal echo; no password argument/environment variable is supported. It creates the single account only; a second bootstrap fails, rather than replacing the user. Passwords use Node crypto scrypt N32768/r8/p1, random 32-byte salts, 64-byte derived keys. Do not pipe a password literal through shell history. Account recovery/rotation is an operator action, not an exposed HTTP route; revoke all sessions when rotating the account hash.

In a second terminal:

```sh
npm run dev
```

Open **http://127.0.0.1:5173** (not another spelling of localhost). Vite proxies `/api` to loopback:3001 by default; set `YTRADER_API_PROXY` for another local API port (this preview uses4340). No source or model configuration is needed to see the honest unconfigured/empty-history UI. `npm run build` typechecks then builds `dist`; `npm run typecheck` only checks types. `npm start` starts the API, not a static server; keep the full tool installation for this first slice because the server runs through tsx. Serve `dist` using the host's static/TLS ingress; the API is separate.

Production: unset `DEV_INSECURE_LOCALHOST`, set `NODE_ENV=production`, `WEB_ORIGIN=https://<exact-web-host>`, and configure TLS at ingress. Secure cookies are the default; HTTP without the explicit loopback mode fails at startup. Insecure mode refuses a non-loopback API bind, non-loopback web origin or production environment. Web cookie is HttpOnly, Secure, SameSite=Lax, Path=/, `__Host-` prefixed in secure mode. Browser writes require both the exact configured Origin and a session CSRF token. Login also checks exact Origin. Native sessions are distinct bearer sessions; they cannot authenticate through the web cookie path. Server stores only SHA-256 opaque token digests; sessions expire after 7 days idle / 30 days absolute. Logout revokes the current session in PostgreSQL.

`trustProxy=false` intentionally prevents forged forwarding headers. If behind an ingress, add ingress login throttling and review trusted proxy/IP handling rather than enabling arbitrary forwarding trust. App login limit is 10 attempts/IP/15 minutes, atomically counted in PostgreSQL. HTTP failures are envelope-shaped, sanitised, and never include upstream bodies/credentials. Add ingress CSP/security headers and TLS as part of host deployment, not as a claim of this local build.

## ycore adapter — pinned assumptions to reconcile before paid use

Only `server/ycore.ts` interprets ycore HTTP envelopes. Backend-only configuration:

- `YCORE_URL`: service origin/base, **without** `/ycore/v1` suffix. HTTP is allowed only for loopback; otherwise TLS is required.
- `YCORE_TOKEN`: host-injected product credential; never use a `VITE_` prefix.
- `MODEL_ENABLED`: false by default. Set true only after the checks below.
- `YCORE_MODEL_POLICY`: fixed operator-selected allowlisted policy, default `gemini-2.5-flash`. No client model/price/prompt controls.

Pinned shapes:

1. Changes and item-version routes follow CONTRACTS. The host-confirmed model request uses `model_policy=gemini-2.5-flash`, `prompt_version=first-loop-v1`, `input_item_refs:[{item_id,version}]` (not `item_version`) and a single user-role message containing editorial instructions followed by delimited untrusted JSON. Core invocation `output` is an optional JSON **string**, not a provider `choices` envelope. `failed_billed` and `exceeded_bound` normalise to terminal failure; `succeeded` without nonblank output is unavailable, never publishable success. `unknown` remains ambiguous and is never re-POSTed.
2. Core item `source` is an object; `license_scope` is a descriptive string, **not** a permission object. The adapter intersects captured `source.rights` with `source.current_rights` (`discovery`, `store_fulltext`, `ai_input`). Missing current rights deny access. Discovery permits title/URL metadata even without fulltext rights: these items remain unanalysed in history. Internal `store/display` represent permission for the material actually retained, which may be metadata only. Body is stripped unless both captured/current fulltext grants permit it. Model additionally requires both AI grants and an actual text body. Core `text/metadata/tombstone` normalise to `full/none/none`; `retracted` maps to unavailable. Publication time is retained as its own field, never replaced with first-seen/fetch/generation time.
3. Core `/sources/status` returns `{data:[...]}`. The adapter maps `healthy/error/never_ingested/stale/disabled` to product status, preserving last-success timestamps and explicitly observed-only coverage. All disabled/absent is not_configured; no working source is unavailable/stale as appropriate; mixed working and failing coverage is partial. No status path fabricates `empty` or complete coverage.
4. Core budget decimal USD values are display fields only. Enforcement and the normalised API use **integer micro-USD**, explicitly marked `unit=micro_usd`: day limit <=1,000,000 ($1); month <=10,000,000 ($10). Values come directly from `day/month.micro_usd` and `unknown_reserved_micro_usd`, with safe-integer validation; there is no cents conversion or rounding. Unknown reservations are already included, never added twice. Core timezone and shared-hard-cap/carry-all-unsettled policy literals are validated. A larger policy, other currency or unrecognised shape blocks dispatch. Only ycore can atomically reserve each call's upper bound and enforce the global authorisation. Host must verify debug/automatic/manual calls share this product budget and bounded provider policy. No direct provider path exists.
5. `item_type` is preserved, including `news` for primary publishers. Primary eligibility comes from the separate normalised `source_classification`, copied from core `source.classification`, not from the article type/name. Independent corroboration/conflict uses `source.origin_group` (normalised as `independence_key`), **not** feed ID/name or the feed-specific top-level independence value. Quotations must still support the actual claim; primary classification is not automatic semantic proof.
6. Core responses contain no trusted company mapping. The adapter **never fabricates or copies company metadata from arbitrary payload fields**. For `company_profile`/`document`, the host may explicitly inject a reviewed product mapping into the optional second `Ycore` constructor argument: `{item_id,item_version,company_id,company_name,reviewed:true}`. `withCompanyMapping` validates exact immutable ItemRef/type/identity before adding internal metadata. Default API/CLI construction supplies no mappings, so company exposure safely stops until the host wires its curated mapping into the sync client. No mapping-file loader or new workflow is added in this narrow patch.

All source/model I/O uses fixed ycore paths with timeouts and redirects disabled. No article URLs are fetched by this service; public original links are reader actions only. `server/model-request.ts` measures actual nested UTF-8 request JSON, trims only source-text prefixes until the wire body is <=64,000 bytes (below core's 65,536-byte cap), and sets `max_input_tokens` to serialized-message bytes + an 8,192-byte conservative gateway fixed-prompt allowance + 1,024 bytes. Host must verify its fixed prompt fits that allowance or increase it. Metadata/schema that cannot fit causes a pre-dispatch failure, not an oversized paid request. Restart polling validates quotes against the persisted **sent prefixes**, not unsent full text.

## Source consumption, analysis and recovery

After host adds real source items to ycore:

```sh
npm run sync
# After the host has verified real model credentials and the caps above:
export MODEL_ENABLED=true
npm run analyze
# Repeat analyze to poll, or run the persistent polling/sync loop:
npm run worker
```

`sync` persists up to 20 pages per invocation and explicitly reports remaining backlog; worker continues it. Worker sync interval is 5 minutes (faster while backlogged), and one analysis step is processed every 30 seconds. `analyze` processes one durable step, not a synchronous promise of completed analysis. No GET creates analysis jobs or calls a model; even “重新读取” is a database read. GET digest does save a reading snapshot, but cannot spend model money.

A page's source versions/current refs, event safety invalidation, jobs, source coverage and cursor commit together under a PostgreSQL advisory transaction lock. Cursor comparison rejects a stale consumer. Replays deduplicate by source ref and deterministic input fingerprint. New versions conservatively withdraw **the whole dependent explanation**, including company exposure, in the same transaction; previously valid history/snapshots are safety-overlaid on every read. A fresh facts-only correction version is published immediately. Failed or budget-blocked recomputation never restores old reasoning. Rights removal purges retained text/title, saved prompts and dependent event payloads (the explicit legal exception to immutable content); reference/version metadata remains. Same-version content mutation is quarantined instead of legitimised. ycore must also enforce current rights immediately before its actual model dispatch and handle deletion of its own invocation material.

Events are intentionally conservative: **one source item's evolving original matter = one event**. No automatic topic/name/date clustering, cross-source merge or company-membership inference is implemented. This avoids false merges, but a real matter may have duplicate cards until host supplies stronger identity/aggregation rules. With the default one-event-source input, independent corroboration is unavailable; ordinary news often stays unverified/watch/excluded. Use genuine original evidence, not relabelled news. An ambiguous source item that is reused for unrelated stories violates this adapter's identity assumption and must be corrected upstream.

Analysis stores prompt version, exact dispatch request, durable key and dispatched step **before** HTTP. A receipt persists its invocation ID; restarts poll that ID. Model jobs have a PostgreSQL lease, fencing token and concurrency one. A crash/timeout after dispatch intent but before receipt becomes `outcome_unknown`, never a second POST; even a crash immediately before sending may therefore need operator reconciliation. Unknown invocations with IDs can be polled again. Confirmed gateway HTTP400 validation rejection becomes failed/rejected; confirmed HTTP429 pre-dispatch throttling becomes blocked/prepare and may retry the same deterministic key. Neither is misclassified as an ambiguous paid call. Transport failures, uncertain 5xx or lost receipts remain outcome_unknown with no automatic POST repeat. An invalid output is terminal for that fingerprint, not an automatic paid retry. New evidence sets are distinct deliberate analyses and still share the same budget.

If a dispatched job has no receipt, the host may reconcile using its saved idempotency key/request with ycore's ledger. Only after verifying the original receipt should the operator attach that invocation ID and move the existing job to polling. **Do not delete/reset its key, manufacture an invocation ID, or requeue it to bypass unknown cost.** No unsafe reconciliation CLI is exposed.

### Explicit company evidence (no broad company module)

Have the host inject the explicit reviewed ItemRef-to-company product mapping described above into the sync client's constructor, and sync the immutable company documents first. Core import-document alone does not invent that product identity mapping. Then select an event ID from `/api/v1/events` / the history UI and supply exact refs:

```sh
npm run analyze -- --event evt_<id> --company-ref <company-item-id>@1
# Repeat --company-ref for up to five company documents.
```

Refs must already exist locally, be current, permitted and reviewed. Their exact versions join the durable input fingerprint; the API never accepts arbitrary user prompts. An un-dispatched bare automatic job may be superseded by this richer input set. An already dispatched/unknown job is not cancelled to pretend it was free. Prefer supplying company evidence **before** starting the automatic worker if cost matters.

Output must have company ID/name matching the curated metadata, exact business quotations, a valid event mechanism path/claim dependency, conditional connecting explanation, conditions and counterforces. Otherwise publication fails; without suitable company inputs the schema only permits an empty exposure list. Detail inlines the exposure and source evidence, not an inert company page. Company source changes invalidate all dependent explanations/versions and create a correction notice before any new analysis. A new company ref must be explicitly supplied to request enriched re-analysis; the worker never guesses a replacement business mapping.

### Publication safety and deliberate limits

`server/output-schema.ts` sends a simplified provider-compatible JSON Schema (explicit enum types, reduced optional grammar bounds), while the full prompt/local contract remains strict; `analysis-schema.ts` validates shape, exact input IDs/versions, quote substrings, rights, core-claim identity, claim/path dependencies, common numeric/unit literals, conservative evidence routing, and explicit company-business links. Summary equals the core claim. Main/watch/refuted routing comes only from that claim, never the strongest unrelated claim. Importance requires a reason; mechanisms require conditions/counterforces. Non-citable occurrence timestamps are rejected (prefer null, not publication/fetch time). The prompt treats all source text as untrusted data, gives no tools, prohibits instruction execution, company guessing, target prices and trade advice.

These are **structural and literal checks, not proof of semantic truth**. They cannot automatically prove that a quotation entails a claim, that a direction is justified, or that a company connection is economically material. Host must freeze real evidence samples before evaluating outputs. Old news should be excluded by the editorial prompt, but general novelty/duplicate identification beyond source versions remains conservative and requires sample validation. Facts-only pending entries remain in history and are not promoted to qualified main-list events.

**Cursor expiration is fail-closed, not automatic full recovery.** A ycore 410 sets integrity unverified, blocks dispatch, removes dependent explanations from usable reads, and shows recovery-required status. Fixed-watermark snapshot/referenced-version rebuilding from CONTRACTS is not implemented in this small slice. Host must implement/verify it before long-running operation; never reset the cursor to null while continuing to claim continuity. A clean disposable local DB can be rebuilt for initial integration, but that is not a production recovery procedure.

## HTTP and reading behaviour

Implemented `/api/v1`: login/session/logout; digest + stable more pages; event history/search; current or specific event version; version list; read-state; updates; saved digest listing; system/status. All except login require auth. `PUT /read-state/:id` only accepts an existing published version and atomically stores `GREATEST`, so stale devices cannot lower it. The UI records reads only after an event response succeeds, and surfaces read-write failure.

Digest uses a rolling 24h substantive-version window with an additional mandatory known source-publication-within24h gate for main/watch entries. Old, unknown or future source publication times cannot be promoted by current import/model timestamps. A later correction to an already-read old event may appear in corrections using its correction-version timestamp; it does not become today's new story. Source publication, occurrence, verification and generation times remain separate, and unknown publication is explicitly shown in history. Limits are max10 main/max3 watch, major before notable, then newest substantive time and stable ID. Overflow and history use persisted, user-bound snapshots with opaque cursors (24h cursor lifetime); subsequent pages cannot reorder that snapshot, and withdrawals are overlaid. No minimum/fake filler. History search is local literal summary search, not full-market/company discovery. Ingestion/analysis publication time still defines substantive-version time, but can no longer bypass the independent known-publication freshness gate. Full economic novelty classification and minor-text-only version suppression remain unimplemented, so sample validation must still reject redundant facts. `/digests` is a small recent saved-snapshot index, not complete historical digest browsing. `/events/:id/versions` uses a `before` version cursor, not the general list cursor; current UI supports it. Company search/fundamental analysis, merge/split aliases, report refresh endpoints, broad lifecycle automation and notifications are deliberately deferred; no inert navigation pretends otherwise.

System status is cached source/budget state, not a fresh provider probe. Source success older than 15 minutes is labelled stale, coverage failures are distinct from no qualifying events, and budget verification time is displayed. Unchecked/model-disabled/blocked/pending/unknown states never become fake success. There is no persisted offline article cache; open content can remain in memory with an explicit offline/failed-refresh warning and last verification time. This deliberately avoids persisting withdrawn or permission-sensitive content on devices.

## iOS / secure storage / original links (host integration)

Capacitor core/cli/ios are pinned **8.5.3**. Minimum environment from the task: Node22+, **Xcode26+**; host Node26/Xcode26.6 are suitable assumptions, not a build result. No signing profile, entitlement, Apple account or iPhone result is claimed.

Primary session vault is the architect-approved MIT **@aparajita/capacitor-secure-storage 8.0.1**, supporting Capacitor8/SPM. `src/vault.ts` guards **`Capacitor.getPlatform()==='ios'` before any import/use**, sets prefix `ytrader_`, disables synchronisation, and uses exactly `get('session',false,false)`, `set('session',token,false,false)`, `remove('session',false)`. Its web fallback is unencrypted localStorage and is **never invoked on web**. Web has only HttpOnly cookies. Native transport uses CapacitorHttp with opaque bearer session, no bundled backend credential. Native token is held in memory while used; failure of Keychain is a visible memory-only-session warning, never silent web-storage downgrade. Logout/401 clears the in-memory token and attempts Keychain removal; server invalidation remains authoritative. A failed network logout does not falsely claim server logout.

Host setup, after npm installation:

```sh
VITE_API_BASE=https://<real-tls-api-origin> npm run build
npx cap add ios
npx cap sync ios
npx cap open ios
```

Use a TLS API accessible from the simulator/device, `NATIVE_ORIGIN=capacitor://localhost`, and configure normal app identity/signing in Xcode. No cleartext ATS exceptions or live remote development server are configured. Vite web normally uses relative `/api`; native's `VITE_API_BASE` is a public address, never a secret. Verify generated SPM/plugin linkage after sync. `@capacitor/browser` opens originals in the native browser sheet; closing returns to the unchanged reading WebView. Web opens a separate tab. Both paths retain the article/expanded evidence DOM and scroll position. Native app kill/relaunch restores only the session through Keychain, not sensitive article caches.

`native/SessionVaultPlugin.swift` is a **dormant optional custom alternative**, delivered for the original task contract; the shipped client does not register or call it. Prefer the maintained plugin above. If the host deliberately chooses the custom alternative instead, copy it into the generated App target, register `bridge?.registerPluginInstance(SessionVaultPlugin())` from a CAPBridgeViewController subclass's `capacitorDidLoad()`, and select that controller in the generated project. Replace (do not combine) the TS vault with an iOS-guarded `registerPlugin('SessionVault')` adapter for `load/save/clear`. It uses non-synchronising, device-only Keychain with `WhenUnlockedThisDeviceOnly`; never supply a JS web/localStorage implementation. The generated host project is now in ios/; the optional custom store remains dormant. Do not wire both vaults or leave two independent session copies.

## Tests the host should run

```sh
npm run typecheck
npm run build
npm test
# Inject TEST_DATABASE_URL separately, pointing ONLY to a disposable database whose name contains "test":
npm test
```

Without `TEST_DATABASE_URL`, pure schema/auth/config tests run and PostgreSQL integration is explicitly skipped. Integration truncates all product tables in that test database and runs forward migration; it never falls back to `DATABASE_URL`. Tests cover salted scrypt, CSRF/Origin/logout/session digest, source replay, dispatch idempotency, monotonic concurrent reads, transaction rollback/cursor, immediate historical withdrawal, unknown POST no-repeat versus proved400/429 rejection, discovery-only metadata/fulltext rights, raw core envelopes, exact micro-USD thresholds, source classification/origin-group independence, request byte bounds/sent-prefix replay, publication freshness/corrections, rejected refs/quotes/quantities, and explicit company-proof/correction rules. All test items are explicitly synthetic, not product stories or evidence of semantic quality.

Additional host gates: reconcile adapter with actual ycore responses and deletion semantics; verify real gateway concurrent day/month reservation and unknown-accounting; collect independent real evidence and two sync passes; run one authorised real model round and missing-proof stop; restart during dispatch/poll; inject source/model failures; test desktop/mobile keyboard focus/back/scroll/original links, secure login/logout/expiry and Keychain failure on iOS; build simulator and separately sign/test an iPhone when authorised. Backups/restore, DB maintenance/retention of expired sessions/snapshots, monitoring, deployment TLS and fixed-watermark recovery are not delivered operationally.

## Read-surface finish review / design record

The surface direction is docs/surfaces/reading.md. The host performs the bounded desktop/mobile and native reading pass, then records the finish verdict and DESIGN.md. No raster assets are shipped. This section is not evidence of physical iPhone acceptance.
