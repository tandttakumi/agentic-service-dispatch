# Final Native WebMCP Risk Report

## Release status

**Automated application status: PASS. Candidate-native status: PASS on 2026-08-30. Public replacement native gate: PASS.**

Public v1 at public commit `028bba449a1e77cee4cddd7c92592bc126f06412` retains its separate 2026-08-27 native-Chrome evidence. Final candidate source `ef35cfce59a8d1ccd1374de43b36e34a1a14097e` passed its own human-operated native gate on 2026-08-30 in Chrome 151.0.7922.174. No screenshot, Playwright flow, fake adapter, or string-bridge simulation is relabeled as candidate-native evidence; the distinct written record is [final-candidate-native-evidence.md](final-candidate-native-evidence.md).

## Native-sensitive surface

| Risk | Candidate behavior | Automated evidence | Native gate |
| --- | --- | --- | --- |
| `document.modelContext` getter/method differences | Catch getter failure; require register/get/execute/add/remove-listener methods; use the registration `AbortSignal` for unregistration | Native-adapter unit tests | Open candidate in experimental Chrome |
| Chrome exposes schema as JSON string | Detect the discovered string schema and serialize `executeTool()` input as a DOMString; preserve object input for the standard path | Full simulated `5 -> 6 -> 5` string-schema integration | Run real five-tool sequence |
| Malformed JSON before callback | Browser parser owns rejection | Not automatable inside page callback | Confirm no callback/runtime crash |
| `getTools()` returns malformed data | Validate array, record, and name | Unit tests | Observe actual count and names |
| `getTools()` never settles | One-second adapter bound | Unit test | Confirm no transient/timeout error |
| `registerTool()` never settles | A stop/unmount registration signal releases the page wait, but no automatic timeout can prove what a broken engine later registered | Paused-registration cancellation tests bound application ownership, not the engine Promise | Any stuck startup fails the gate |
| Outer `executeTool()` Promise never settles | Do not invent success or apply a timeout that could misreport a callback which already consumed the one-time approval; retain visible domain/registry truth if it changed | Callback/settlement ordering tests, not native host settlement proof | Any stuck Run or Commit fails the gate |
| Timed-out or canceled engine read remains pending | Application rejects after one second; WebMCP exposes no `getTools()` cancellation input. Registration/execution cancellation suppresses follow-up verifier retries, but cannot stop the one engine-owned read already issued | Timeout, abort-aware verifier, and UI single-flight tests bound application work, not host promise lifetime | Treat repeated native timeout/toolchange as engine failure; stop the gate |
| Tool registration visibility lag | Read-back with 25/50 ms retry | Fake-adapter stale-snapshot tests | Confirm tool 06 appears once |
| Callback arrives before registration proof | Registration latch blocks domain commit | Paused-registration tests | Commit immediately after Approve |
| Callback registry contamination | Fresh exact-six read before domain entry | Direct-callback foreign-tool test | No practical foreign injection required for release gate |
| Result settles before physical revoke | Revoke on next task, then verify exact five | Settlement-order unit test | Observe successful result, then revoke |
| Reset during registration/revocation/read-back | Invalidate domain generation and registry epoch synchronously; abort an active old-epoch revocation proof before current cleanup; discard old completion/error while its already-issued engine read settles ignored | Paused registration plus successful/failed pre-Reset revocation tests and no-obsolete-retry regression | Complete primary flow through settled Reset; optional edge stress |
| Full stop during an established-tool revocation read-back | Preserve the in-flight bounded proof so an immediate Strict Mode restart does not discard settlement evidence; a complete stop can therefore wait for at most the same three one-second reads plus 25/50 ms delays. Reset, unlike stop, supersedes and cancels old-epoch proof | Stop/remount recovery and bounded-verifier tests; no native host timing claim | Optional stop/remount stress; a stuck stop fails the native gate |
| Missing or bursty `toolchange` | UI discovery holds one wrapper read in flight plus at most one coalesced trailing read; successful startup/Reset trigger a fresh actual adapter read without synthesizing tools | 100-event storm, paused-unmount, delayed silent-startup, and exhausted-read Reset tests | Watch for stuck count or repeated runtime errors |
| Stop/unmount during delivered callback | Combine the page-owned registration signal with the host invocation signal through exact-surface verification and the post-digest domain check; preserve unused approval on cleanup | A digest-paused captured-callback regression proves cancellation even without a host abort; physical removal/outer settlement remain non-native evidence | Optional engine-specific stress |

## Known non-atomic boundary

The callback observes an exact six-tool surface before entering domain commit. That observation is not an atomic lock across the subsequent asynchronous SHA-256 digest. A foreign registration could theoretically occur after the read and before consumption. The domain still binds the exact draft, approval ID, nonce, idempotency key, generation, TTL, and one-use state; however, the browser registry itself is only last-observed exact six, not continuously locked exact six.

Public wording must say: **“The callback verifies the observed six-tool surface before domain execution.”** It must not claim continuous or atomic registry binding.

## Bounded read timing

The native adapter bounds each `getTools()` read at one second. The exact-name verifier permits two visibility-lag retries after the first attempt (25 ms and 50 ms). A callback path can therefore remain in pre-domain verification for roughly **3.075 seconds plus scheduling overhead** if all reads reach their timeout. During that interval the approval is not consumed.

This bound is a safety/availability tradeoff. It prevents a permanently hanging browser read from holding application work forever, but callback re-entry and host timeout behavior require native observation.

The timeout does not cancel the underlying engine-owned Promise because the current `getTools()` surface accepts no AbortSignal. Registration and commit verifiers race that read against their own signal, then suppress every not-yet-started retry and retry delay after cancellation. The one engine read already issued can still settle later and is ignored. UI single-flight separately prevents page-side fan-out while one wrapper read is active, but a persistently broken engine can retain timed-out native work. This is an engine/resource limitation, not evidence of a usable stale capability; the page clears proof and disables authority actions.

## Stop, unmount, and host invocation signal

The callback now combines the page-owned registration signal with the host invocation signal and retains it through the domain's post-digest cancellation check. Consequently, stop/unmount during asynchronous validation preserves the existing approval as unused even if the host does not separately abort its invocation signal. The engine still owns physical tool removal and the outer `executeTool()` settlement, and unmount alone remains cleanup rather than authenticated revocation.

Residual stress: begin Commit and immediately Reset; then repeat around unmount/remount if the testing setup permits. A failure must remain replay-safe and must not surface a sixth tool after settled Reset. This engine-specific stress is useful follow-up evidence, but it does not replace the uninterrupted primary release gate.

## Candidate-native release gate

Use the dedicated Chrome environment only after human approval. Do not use the normal Chrome profile. Build the exact final commit, serve that production build on the isolated local port, and run one uninterrupted sequence:

1. Initial actual `getTools()` lists exactly the five baseline names.
2. Run the deterministic five-tool sequence; a draft appears; commit tool is absent.
3. Approve the exact draft; actual registry lists exactly six names and one `commit_approved_dispatch`.
4. Invoke Commit; the result succeeds once.
5. After result settlement, actual registry returns to exactly the five baseline names.
6. Reset and wait for cleanup; exact five remains, with no `RUNTIME_ERROR`, console error, uncaught exception, hydration warning, duplicate tool, or stuck pending state.

All six passed in one uninterrupted session on 2026-08-30: **5 → 5 → 6 → 5 → Reset → 5**, with only `commit_approved_dispatch` added and no observed error, duplicate, stopped transition, or stuck state. Commit-near-Reset and stop/remount remain optional engine-specific stresses rather than prerequisites for the primary release proof.
