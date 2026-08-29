# Security Model

## Security objective

An agent may prepare a dispatch but cannot obtain general write authority. A human approval creates a capability for one exact draft record, for 120 seconds, for one use; changing that record invalidates the approval. The page aborts its registration controller after success, expiry, mutation, Reset, unmount, or registration failure; physical removal depends on the native engine honoring that signal and is claimed only where a later `getTools()` read-back proves the expected surface. An otherwise valid unconsumed approval may be reconciled after remount; this is an explicit prototype behavior, not durable server authorization.

This is a local competition prototype, not a production authorization service. Its value is the enforceable shape of the interaction.

## Threat model

| Threat | Control |
| --- | --- |
| Agent attempts to commit before approval | Commit tool is not registered at all. Domain phase also rejects commit. |
| Agent changes provider, price, slot, vehicle, scope, or rationale | Commit accepts only `approval_id`; approved fields are loaded from the store. |
| Wrong or guessed approval ID | Runtime schema fixes the current ID with `const`; domain validation repeats the equality check. |
| Approval metadata is altered before invocation | Canonical approval binding is checked before caller-facing record fields; integrity failure invalidates the active approval and revokes its tool. |
| Draft changes after approval | SHA-256 of canonical full draft is recomputed; mutation invalidates approval and revokes the tool. |
| Draft changes while its hash is being recomputed | Canonical bytes are captured again after the asynchronous digest; any mismatch invalidates approval before commit. |
| Replay or double click | Approval status, one-time nonce, idempotency key, committed state, and serialized registry operations reject reuse. |
| Delayed or stale invocation | 120-second TTL and approval generation are checked at execution time. |
| Stale React callback | Tools call a stable domain store rather than captured component state. |
| Reset races registration, revocation, or a delayed registry read | Domain generation and registry epoch change synchronously; an active old-epoch revocation proof is aborted before queueing current cleanup, and stale completion/error writes are discarded. The already-issued engine read remains non-cancelable and ignored. |
| Tool registration silently fails | Registration is read back with `getTools()`; failure invalidates the approval and is surfaced. |
| Caller invokes tool 06 before registration read-back finishes | The callback waits on the exact six-tool verification gate; failure or cancellation reaches it before domain commit. |
| Reset, expiry, or unmount occurs while tool 06 is still registering | The in-flight registration controller is tracked and aborted immediately; cleanup preserves a still-valid approval for safe remount. |
| Unsupported browser appears supported | Production has no fake fallback and displays the exact unsupported message. |
| Native `getTools()` never settles | The native adapter rejects after one second; stale capability evidence is cleared and existing bounded retry paths take over. |
| Duplicate/unexpected browser tool | Registration and the pre-domain verification compare exact expected names; an observed mismatch or read failure leaves approval unconsumed. |
| Malformed or coercible callback input | Callback guards accept only plain JSON data properties and dense primitive arrays; schema-invalid accessors, hidden/symbol keys, prototypes, and coercion fail before domain execution. |
| Caller mutates returned fixture data | Tool results are serialized once and returned as detached structured data; fixture builders also clone nested values. |
| Slot begins before but ends after deadline | Qualification requires the slot end time to be on or before the deadline. |
| Incomplete or malformed native API looks supported | The adapter checks every required method/event and validates `getTools()` output; UI evidence clears on read failure. |
| Registry briefly returns its previous valid surface | Registration, pre-domain verification, execution lookup, revocation proof, and UI evidence retry over a bounded 25/50ms window while authority remains gated; registration/execution cancellation and Reset supersession prevent follow-up verifier retries, and persistent mismatch or absence fails closed. |
| Caller cancels execution or cleanup wins during validation | The callback combines the native invocation signal with its page-owned registration signal and checks that result before validation and after asynchronous hashing; cancellation leaves approval unconsumed. |

## Read versus write capabilities

The vehicle, history, provider search, and availability tools declare `readOnlyHint: true`. `create_dispatch_draft` declares `readOnlyHint: false` because it mutates local UI/domain state, although it performs no external submission. The real-world write analogue, `commit_approved_dispatch`, is absent until approval.

This distinction avoids describing a local draft mutation as read-only while preserving a hard boundary around external-action authority.

## Human approval and exact binding

The approval button is an explicit UI action, not a WebMCP tool. It binds the complete proposed dispatch—vehicle, provider, slot, price, scope, and rationale—to a stable canonical JSON hash. The resulting tool does not accept those fields, so a caller cannot widen or redirect the authorization. This prototype does not authenticate the actor behind the UI action; that production requirement is listed below.

Approval metadata includes `approval_id`, `draft_id`, `draft_hash`, `approved_at`, `expires_at`, `one_time_nonce`, `idempotency_key`, `used_at`, status, and generation. The idempotency key is derived from the draft ID and one-time nonce and rechecked at execution. The full 120-second window begins only after asynchronous hash binding completes. Secure UUID generation fails closed if unavailable.

## One-time execution, expiry, and revocation

After asynchronous validation, domain execution revalidates and consumes the approval in one synchronous state update. One clock reading is used both for the final lifetime check and `committed_at`, so a successful record cannot be stamped at or after the expiry it just passed. The callback combines host invocation and page registration signals before work and checks that result again after the asynchronous digest without consuming authority on cancellation. After a successful result settles across the `executeTool()` caller boundary, the temporary registration AbortController is aborted on the next task and the registry confirms the tool is absent. Public-v1 native Chrome evidence shows this narrow delay avoids a transient error without extending usable authority: the domain approval and idempotency key are already consumed. TTL expiry or draft change revokes an established temporary tool without the success-settlement delay and verifies exact five; Reset also performs current exact-five proof. A canceled or failed pending registration aborts its controller and stays fail-closed, but UI or a later lifecycle proof must observe physical removal. Unmount cleanup aborts the controller and cancels asynchronous callback validation, but makes no standalone physical-removal claim.

The timer improves promptness but is not the security boundary: expiry is rechecked synchronously inside commit logic.

## Browser confirmation is complementary

A browser or agent may show its own confirmation before invoking a tool. That protects a user at the invocation surface, while this application's approval protects the business object and capability lifecycle. Browser confirmation alone would not bind the final fields, prevent a permanently available write tool, enforce the application's TTL, or consume authority after one success.

## Reliability review

- Strict Mode start/stop/start and controller cleanup are tested.
- Soak tests cover 100 complete lifecycles, 100 consecutive resets, 100 start/cleanup cycles, and a seeded 256-action ordering.
- Approval creation is guarded against concurrent calls and revision changes during hashing.
- Commit rechecks canonical draft bytes after hashing, validates approval integrity before mutable record fields, and honors the combined host-invocation/page-registration cancellation signal on both sides of the digest.
- Baseline and temporary startup abort pending registration signals on Reset, expiry, or unmount; the baseline wait releases from its signal even if the adapter promise ignores abort, and a remount can safely reconcile a still-valid approval.
- Tool 06 cannot enter domain execution until registration has read back the exact six-name surface, then rechecks that surface immediately before entering domain validation and its asynchronous digest; caller cancellation releases either wait, while Reset prevents a waiting invocation from consuming the invalidated generation. Revocation evidence requires the exact five-name baseline, not merely the absence of tool 06.
- Registry mutations are serialized; reset is repeatable.
- Reset invalidates domain authority synchronously, while a registry lifecycle epoch prevents pre-Reset background completion, timer, or error state from contaminating the new idle snapshot.
- Only the registry that recorded a lifecycle failure can hand its token off, and only after its completed stop routine has aborted all registration controllers it owns. That handoff does not itself claim physical browser removal. A later full remount clears the error only after reconciliation plus a fresh exact-five or exact-six read-back, while the registry remains started, the expected approval generation remains unchanged, and the handed-off token is still current. Historical failure audit remains; an unrelated start, interrupted proof, or newer error is never cleared by older recovery.
- UI discovery is single-flight per adapter and coalesces a `toolchange` burst into at most one trailing read; unmount drops the trailing read and removes retry/listener state.
- Revocation audit deduplication retains only a monotonic generation high-water mark rather than every past generation.
- JSON schemas reject additional properties and bind all fixed demo inputs.
- Callback guards independently reject non-JSON/coercible inputs and canonicalization ambiguity.
- Deliberate nonce-binding, deadline, exact-draft hash, and early-revocation mutations are killed by targeted regression tests; no mutation remains in source.
- Coverage includes production components and the native adapter, not only domain/registry code.
- Error codes are explicit and surfaced without unsafe HTML.
- The UI uses React text rendering only; there is no `dangerouslySetInnerHTML`.
- No secrets, runtime `.env` dependency, customer data, external business APIs, real service-company branding, third-party logos, or stock assets are used; environment flags only control local test evidence and framework telemetry.

## Limitations

- State and replay protection are in memory. A production deployment would need server-side transactional storage and authenticated human identity.
- The prototype does not prove user presence or prevent a separate visual-automation system from clicking the approval UI; production approval needs authenticated identity and appropriate browser or application policy.
- The prototype does not model cross-tab or multi-device approvals.
- Browser-origin and top-level browsing context policy are delegated to the native WebMCP implementation.
- Exact-name registry checks detect missing, additional, and duplicate entries; they do not cryptographically authenticate the JavaScript definition behind a name. This prototype has no third-party script and assumes the integrity of code running in the same page. A production design must protect that script/supply-chain boundary rather than treating `getTools()` name equality as proof against a hostile same-page replacement.
- WebMCP does not expose an atomic registry-snapshot-and-consume operation. The callback proves the last read before entering domain validation was exact six; it cannot claim continuous registry binding during the subsequent asynchronous digest. An observed mismatch leaves approval unconsumed.
- The candidate adds up to three native `getTools()` reads inside the commit callback. With the adapter's one-second bound and 25/50ms retry delays, an uncancelled path can take about 3.075 seconds before failing closed; this is why publication required the candidate-native gate completed on 2026-08-30. If registration, Reset, stop, expiry, or the invocation signal cancels that verifier, no later retry is started.
- WebMCP exposes no cancellation input for `getTools()`. Cancellation releases the page-side wait and suppresses follow-up verifier retries, but it cannot cancel the one engine-owned Promise already in flight. The one-second adapter race bounds application waiting, clears UI proof, and limits each uncancelled retry sequence. A broken engine that repeatedly emits `toolchange` while leaving reads pending could still retain host work beyond the application's timeout.
- Native `registerTool()` and the outer `executeTool()` Promise have no automatic application timeout. Stop/unmount can release a page wait on pending registration through its signal, but a broken engine may still settle late. Invocation is not timed out because its callback may already have consumed the one-time approval; converting that ambiguity into a retryable failure would be less safe. Any stuck startup or invocation is a failed native gate, not automated success evidence.
- `stop()` or unmount aborts the page-owned registration controller but deliberately preserves a still-valid domain approval for safe remount. A delivered callback combines that signal with the host invocation signal through its post-digest cancellation check, so cleanup during asynchronous validation leaves approval unused without depending on host cancellation. Physical browser removal and outer native settlement still depend on the engine; Commit concurrent with stop/unmount therefore remains a useful native stress case, not an unbounded domain continuation.
- A Strict Mode stop/start may cancel queued physical cleanup and continue the same registry owner. It is not treated as a full remount proof; settlement-safe revoke work remains live and active lifecycle errors remain until a later complete proof.
- Reset's domain invalidation is synchronous, but browser registration removal and exact-five read-back are asynchronous physical cleanup. UI/native evidence must wait for the returned Reset operation to settle before claiming physical restoration.
- The deterministic Playwright adapter validates application integration, not browser-engine conformance.
- Native Chrome 151.0.7922.174 completed public v1 (public commit `028bba44`) Run → Approve → Commit → Reset verification on 2026-08-27 with visible 5 → 6 → 5, two Resets, four screenshots, and zero captured error logs. Exact final candidate source `ef35cfc` completed a separate uninterrupted human-operated 5 → 5 → 6 → 5 → Reset → 5 gate on 2026-08-30 with only `commit_approved_dispatch` added and no observed error, duplicate, stopped transition, or stuck state. Because the API is experimental, repeat the manual checklist before later adoption or publication changes.
