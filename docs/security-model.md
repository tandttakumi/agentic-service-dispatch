# Security Model

## Security objective

An agent may prepare a dispatch but cannot obtain general write authority. A human approval creates a capability for one immutable draft, for 120 seconds, for one use. The capability must cease to exist after success, expiry, mutation, reset, cleanup, or registration failure.

This is a local competition prototype, not a production authorization service. Its value is the enforceable shape of the interaction.

## Threat model

| Threat | Control |
| --- | --- |
| Agent attempts to commit before approval | Commit tool is not registered at all. Domain phase also rejects commit. |
| Agent changes provider, price, slot, vehicle, scope, or rationale | Commit accepts only `approval_id`; approved fields are loaded from the store. |
| Wrong or guessed approval ID | Runtime schema fixes the current ID with `const`; domain validation repeats the equality check. |
| Draft changes after approval | SHA-256 of canonical full draft is recomputed; mutation invalidates approval and revokes the tool. |
| Replay or double click | Approval status, one-time nonce, idempotency key, committed state, and serialized registry operations reject reuse. |
| Delayed or stale invocation | 120-second TTL and approval generation are checked at execution time. |
| Stale React callback | Tools call a stable domain store rather than captured component state. |
| Reset races registration | Generation invalidation plus queued reconciliation prevents a stale temporary tool from surviving reset. |
| Tool registration silently fails | Registration is read back with `getTools()`; failure invalidates the approval and is surfaced. |
| Unsupported browser appears supported | Production has no fake fallback and displays the exact unsupported message. |
| Duplicate/unexpected browser tool | Registry verification compares exact expected names and fails closed. |

## Read versus write capabilities

The vehicle, history, provider search, and availability tools declare `readOnlyHint: true`. `create_dispatch_draft` intentionally lacks that annotation because it mutates local UI/domain state, although it performs no external submission. The real-world write analogue, `commit_approved_dispatch`, is absent until approval.

This distinction avoids describing a local draft mutation as read-only while preserving a hard boundary around external-action authority.

## Human approval and exact binding

The approval button is a human UI action, not a WebMCP tool. It binds the complete proposed dispatch—vehicle, provider, slot, price, scope, and rationale—to a stable canonical JSON hash. The resulting tool does not accept those fields, so an agent cannot widen or redirect the authorization.

Approval metadata includes `approval_id`, `draft_id`, `draft_hash`, `approved_at`, `expires_at`, `one_time_nonce`, `idempotency_key`, `used_at`, status, and generation. Secure UUID generation fails closed if unavailable.

## One-time execution, expiry, and revocation

Execution atomically validates and consumes the approval. After the successful result settles across the native `executeTool()` boundary, the temporary AbortController is aborted on the next task and the registry confirms the tool is absent. This narrow settlement delay avoids a Chrome `UnknownError` without extending usable authority: the domain approval and idempotency key are already consumed. TTL expiry, draft change, reset, unmount, and failed reconciliation revoke directly.

The timer improves promptness but is not the security boundary: expiry is rechecked synchronously inside commit logic.

## Browser confirmation is complementary

A browser or agent may show its own confirmation before invoking a tool. That protects a user at the invocation surface, while this application's approval protects the business object and capability lifecycle. Browser confirmation alone would not bind the final fields, prevent a permanently available write tool, enforce the application's TTL, or consume authority after one success.

## Reliability review

- Strict Mode start/stop/start and controller cleanup are tested.
- Soak tests cover 100 complete lifecycles, 100 consecutive resets, 100 start/cleanup cycles, and a seeded 256-action ordering.
- Approval creation is guarded against concurrent calls and revision changes during hashing.
- Registry mutations are serialized; reset is repeatable.
- JSON schemas reject additional properties and bind all fixed demo inputs.
- Error codes are explicit and surfaced without unsafe HTML.
- The UI uses React text rendering only; there is no `dangerouslySetInnerHTML`.
- No secrets, environment variables, customer data, external APIs, logos, stock assets, or real trademarks are used.

## Limitations

- State and replay protection are in memory. A production deployment would need server-side transactional storage and authenticated human identity.
- The prototype does not model cross-tab or multi-device approvals.
- Browser-origin and top-level browsing context policy are delegated to the native WebMCP implementation.
- The deterministic Playwright adapter validates application integration, not browser-engine conformance.
- Native Chrome 151.0.7922.174 completed the public deployment's Run → Approve → Commit → Reset verification on 2026-08-27 with visible 5 → 6 → 5, two Resets, four screenshots, and zero captured error logs. Because the API is experimental, repeat the manual checklist if the browser or deployed artifact changes.
