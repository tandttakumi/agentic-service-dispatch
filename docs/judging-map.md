# Challenge Judging Evidence Map

This file maps each official criterion to evidence a judge can see in the product, video, code, and public docs. The fresh strict score is maintained separately in [judging-scorecard.md](judging-scorecard.md).

## Stage 1 viability

| Requirement | Local evidence | External dependency |
| --- | --- | --- |
| Functional WebMCP app | Public deployment; Chrome 151 native 5 → 6 → 5 lifecycle; 65 tests; four E2E flows. | Keep the live URL unchanged through judging. |
| English description and implementation explanation | README, architecture, security, compliance, and selected Devpost draft. | Paste final copy into Devpost. |
| Public source and license | Public clean source snapshot, README, assets, setup, and MIT license. | Keep the repository unchanged through judging. |
| Public sub-three-minute demo video with audio | Verified 2:02.40 H.264/AAC English-audio master and transcript. | Upload publicly to YouTube and verify the URL. |

See [current-compliance.md](current-compliance.md) for the controlling rules and missing external artifacts.

## WebMCP Leverage — 24/25

### Claim

WebMCP is the authorization surface, not a wrapper around ordinary app logic. The final action cannot be called before approval because its tool is not registered.

### Visible product proof

- Initial actual browser registry count is 5 and says “Write capability absent.”
- The deterministic WebMCP runner calls the five live registered tools.
- The result is visibly “DRAFT — NOT SUBMITTED.”
- Human approval makes commit_approved_dispatch appear as tool 06.
- One commit returns the registry to 5 and shows explicit revoked proof.
- Reset preserves exactly the five baseline tools.

### Code proof

- src/lib/webmcp/native-adapter.ts: native register, discover, execute, event, and input bridge boundary.
- src/lib/webmcp/tool-registry.ts: five definitions, approval-only registration, AbortSignal lifetime, exact baseline checks, settlement-safe revoke.
- src/components/capability-panel.tsx: actual getTools results only.
- src/components/dispatch-demo.tsx: toolchange subscription with stale-read generation guard.

### Why ordinary UI automation or remote MCP is insufficient

A click bot could press an approval button, and a remote API could expose commit, but neither inherently proves that page-bound agent authority was absent, appeared for one reviewed object, and disappeared in the shared tab. The live WebMCP registry makes that state discoverable to the agent and inspectable by the human.

### Remaining point withheld

The live URL and native Chrome evidence exist. The remaining point is withheld until the final YouTube presentation is public and judged as a complete human-agent story.

## Execution — 23/25

### Correctness proof

- Canonical full-draft SHA-256 binding.
- Runtime const schema accepts only the current approval ID.
- 120-second TTL, secure nonce, generation, used status, and idempotency.
- Duplicate approval/commit rejection and atomic consumption.
- Registration failure, expiry, mutation, reset, cleanup, and stale state fail closed.
- Success crosses the native boundary before next-task unregistration.

### Reliability proof

- 65 unit/component/lifecycle tests across 9 files.
- 100 complete 5 → 6 → 5 + Reset cycles.
- 100 consecutive Reset calls.
- 100 start/cleanup cycles.
- Seeded 256-action lifecycle ordering.
- Same-tick UI double-action, concurrent commit, reset-during-commit, Strict Mode start/stop/start, and out-of-order getTools regressions.
- Four browser E2E flows across 1440×900, 1280×720, and 390×844.
- Console, page exception, hydration, overflow, focus, and reduced-motion assertions.

### Repository proof

- MIT license, npm ci setup, no secrets or environment dependency.
- No production fake-adapter import.
- Internal task and worklog files removed from the public tree.
- Public GitHub source and Vercel deployment; no external business write, database, authentication secret, or customer data.

### Remaining points withheld

The browser API is experimental; native evidence covers one recorded public-deployment lifecycle rather than broad browser conformance; authority and replay state are in memory rather than authenticated transactional storage.

## Potential Impact — 18/25

### Primary user

An operations coordinator assembling asset history, provider qualification, availability, budget, deadline, and a final dispatch decision.

### Value hypothesis

- reduce cross-system lookup and re-entry;
- make exclusions and the final proposal auditable;
- reduce misdirected or stale writes;
- avoid leaving broad agent write authority permanently available;
- preserve human control at the exact business-object boundary.

### Adjacent applications

Procurement, refund release, field work, travel booking, administrative healthcare workflows, insurance operations, IT change execution, and content publishing.

### Evidence

[impact-case.md](impact-case.md) traces persona, direct and indirect costs, economic value chain, limits, and adoption path.

### Points withheld

No production users, interviews, integrations, revenue, measured saved time, measured error reduction, or market-size evidence exists.

## Creativity & Ambition — 22/25

### Novel contribution

Approval is represented as a temporary browser capability object rather than prompt text, a permanently registered disabled action, or a conventional modal confirmation. Its visible shape is:

**5 PREPARE → 6 APPROVE → 5 CONSUME**

### Competitive evidence

The [30-example public landscape](competition-landscape.md) is crowded with search, carts, booking, editors, creative canvases, games, and broad stable tool catalogs. None of the reviewed public summaries documents the same approval-created, exact-draft, one-time register/revoke lifecycle.

### Ambition discipline

The implementation pursues one protocol-level idea deeply: exact object binding, runtime schema narrowing, authority expiry, one-time consumption, native settlement, registry truth, race resistance, and visual evidence. It intentionally avoids fake chat, external integrations, authentication theater, and unrelated features.

### Points withheld

The fixture is narrow, local, and fictional, and its visual spectacle is lower than the strongest 3D, audio, or image-editing WebMCP examples.

## Video proof map

| Time | Criterion proof |
| --- | --- |
| 0:00–0:10 | Native Chrome initial state: five live tools; dangerous write tool absent. |
| 0:10–0:44 | Visibly labeled moving test-adapter interaction: request, draft, approval, commit, Reset. |
| 0:44–1:06 | Native Chrome approved state: sixth exact-draft tool and TTL. |
| 1:06–1:28 | Native Chrome committed state: success, revoke, return to five. |
| 1:28–1:46 | Native Chrome Reset state: exact five-tool baseline. |
| 1:46–2:02 | Impact transfer, limitations, and 5 → 6 → 5 closing thesis. |

## Evidence boundary

- Native Chrome: one successful public-deployment lifecycle on 2026-08-27 in version 151.0.7922.174, visible 5 → 6 → 5, two Resets, four screenshots, and no captured error logs.
- Automated application: deterministic test adapter/harness, never described as native conformance.
- External submission: public repo and live URL are complete; public YouTube URL and Devpost entry remain.
