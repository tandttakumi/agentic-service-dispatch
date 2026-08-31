# Devpost Submission Draft

## Project title

**Agentic Service Dispatch**

## Tagline

**Five prepare. Human approval creates tool 6; use removes it.**

## One-sentence pitch

A prompt can ask an agent to wait; Agentic Service Dispatch instead keeps commit authority absent until a human approves one exact fictional service draft.

## Short description

Five page-owned WebMCP tools prepare; human approval creates one exact sixth tool; use removes it: **5 PREPARE → 6 APPROVE → 5 CONSUME**. The temporary tool is hash-bound, lasts 120 seconds, and accepts no dispatch fields.

## Inspiration

Service coordinators cross asset records, prior work, provider qualifications, calendars, prices, deadlines, and a final dispatch system. Agents can prepare that work, but “don't submit until I approve” is only an instruction; it does not change authority.

The entrant is a founder/operator of an automotive and service business. This fictional workflow is abstracted from firsthand work coordinating vehicle context, prior service history, provider qualifications, pricing, availability, constraints, selection, and final request authority. It tests a stronger boundary: human approval creates one narrow capability for one reviewed object, then use removes it.

## What it does

A single request asks for a qualified fictional automotive detailer before Friday under ¥60,000, with history checked. Five WebMCP tools retrieve the vehicle, review history, compare three providers with exclusion reasons, check deadline availability, and create **DRAFT — NOT SUBMITTED**.

The human reviews provider, slot, price, scope, rationale, and binding. Only then does `commit_approved_dispatch` appear as tool 06. One use commits the in-memory draft; after the result crosses the caller boundary, the registration aborts on the next task and `getTools()` confirms five again. Both public v1 and exact final candidate source `ef35cfc` separately verified that settlement timing in native Chrome. Reset returns to the exact five-tool baseline.

## Real-agent verification

On **2026-08-31 (JST)**, **Codex + official Chrome DevTools for agents** selected and executed the public page's registered WebMCP tools from a natural-language business request, without page-tool names or an execution order in the prompt.

Actual order: `get_active_vehicle` → `get_service_history` → `search_qualified_providers` → `check_provider_availability` → `create_dispatch_draft` → **human approval of the exact draft** → `commit_approved_dispatch`.

The five preparation tools produced **DRAFT — NOT SUBMITTED**. After human approval, the only added tool was `commit_approved_dispatch`. Codex rediscovered it with `list_webmcp_tools`, executed it once through `execute_webmcp_tool`, and verified revocation: **5 → 6 → 5**. All six page-tool executions completed.

This is separate evidence from the on-page deterministic runner and the Playwright test adapter; neither was used in this real-agent run. It is **not ChatGPT Site tools**. **Reset Demo was not verified through this agent route**; the separate human-operated native Chrome Reset check remains labeled as such. The fixed, fictional scenario demonstrates model-selected tool execution, not unrestricted planning or a real commercial booking.

Environment: Chrome **151.0.7922.174**, official Chrome DevTools MCP **1.8.0**, Codex **0.151.0-alpha.7.2**, using an isolated Chrome profile. [Recorded tool arguments, registry observations, and page screenshots](https://github.com/tandttakumi/agentic-service-dispatch/blob/main/docs/real-agent-verification.md).

## How it works

The deterministic runner discovers and invokes the five registered preparation tools in order; it is a verification aid, not a simulated AI. Visible approval binds the canonical draft hash and creates tool 06 for 120 seconds and one use. Commit accepts only the bound approval ID, consumes in-memory authority, settles, unregisters tool 06, and proves the exact five-name baseline through `getTools()`.

## Why WebMCP

The person sees the exact draft, count, countdown, and audit trace while an agent sees the same page-owned tools. The imperative `document.modelContext` API is the product mechanism:

- registerTool publishes five baseline tools and the approval-only temporary tool;
- getTools drives the visible capability panel and verifies appearance/revocation;
- executeTool invokes the deterministic proof sequence and one-time commit;
- toolchange refreshes the browser-truth display; and
- AbortSignal defines registration lifetime.

Ordinary UI confirmation cannot prove the agent's commit capability was absent before approval or gone after use. A permanently available endpoint also misses the page-bound authority transition that human and agent inspect together.

## Human-in-the-loop safety

Approval hashes the complete canonical draft with SHA-256 and binds IDs, lifetime, one-time nonce, idempotency, used state, and registration generation. Tool 06 accepts only the current approval ID; callers cannot alter vehicle, provider, slot, price, scope, or rationale.

Before domain execution, the callback observes exact six and revalidates approval integrity, TTL, hash, generation, idempotency, and uncommitted state. Combined invocation/registration signals also protect asynchronous validation. Mutation, expiry, Reset, cancellation, malformed input, read failure, or stale work fails closed. Unmount makes no immediate physical-removal claim; remount re-verifies. The technical docs retain the full checks and non-atomic registry limitation.

## How we built it

This is a one-screen Next.js 16 / React 19 app over a deterministic TypeScript store. `useSyncExternalStore` avoids stale component callbacks; registry work is serialized; UI reads are bounded, generation-safe, and single-flight; Reset epochs discard older lifecycle work.

Production has one native adapter and no fake fallback. Missing `document.modelContext` yields an honest unsupported state. The visibly labeled Playwright harness exists only for application automation.

## Challenges

Public v1 exposed the hardest browser issue: revoking tool 06 before its successful callback crossed the tested Chrome boundary produced `UnknownError` after a domain commit. After asynchronous validation, authority is consumed before the success result returns; next-task revocation is then verified with `getTools()`. Tests also attack remounts, duplicate/stale reads, concurrency, expiry, mutation, Reset, registration failure, and cleanup.

## Accomplishments

- Approval creates an inspectable capability rather than changing prompt text.
- Exact-draft authority cannot be widened by arguments; one success consumes it.
- The actual registry is the visual proof.
- Public v1 completed human-native **5 → 6 → 5** on 2026-08-27 without runtime error.
- Exact final candidate source `ef35cfc` completed human-native **5 → 5 → 6 → 5 → Reset → 5** on 2026-08-30; tool 06 was only `commit_approved_dispatch`, with no observed error, duplicate, stopped transition, or stuck state.
- Candidate automation is 290 automated tests, 10 E2E browser flows across 320–1920px, and 96.02/93.67/98.64/96.82% executable-source statement/branch/function/line coverage. It includes hostile inputs, hash races, cancellation, native-string/schema-runner compatibility, accessibility, and soak work—but the automated harness is not native conformance.

## What we learned

Tool design is authorization design. Inputs constrain arguments; trust also needs capability absence, exact-object binding, lifetime, revocation, and evidence. WebMCP makes those decisions visible where the human reviews the work.

## Potential impact

### Customer

Service coordinators in automotive, field service, maintenance, repair, inspection, installation, and similar operational businesses.

### Pain

A coordinator may have to manually cross asset or vehicle context, previous service history, provider qualification, pricing, availability, multiple constraints, exclusion reasons, repeated data entry, and final submission authority before one consequential request can be released.

### Value

The agent prepares one structured decision through page-owned WebMCP tools. The human reviews one exact draft. Approval creates one exact, temporary write capability. One approved action consumes that capability. It then disappears, while the reviewed object, capability lifecycle, and audit trace remain visible on the shared page.

### Practical impact

The design targets fewer dropped operational constraints, visible reasons for excluding unsuitable providers, less fragmented coordination and re-entry, no permanently exposed broad commit capability, exact-object human approval, inspectable authority, and a shared operational state for the human and agent.

Built from firsthand experience coordinating real automotive and service operations, Agentic Service Dispatch turns one concrete vehicle-service workflow into a reusable authority pattern: the agent prepares the operational decision, but consequential authority exists only for the exact action a human reviewed and approved.

The pattern can be tested in field service, maintenance, repair, inspection, installation, procurement, and similar prepare/review/authorize workflows. These are transfer paths for pilots, not claims of existing multi-industry use. No production users, measured time savings, financial impact, market size, or external reviewer result is claimed. A pilot should measure draft time, re-entry, constraint misses, corrections, capability exposure, rejected stale/replay attempts, and operator comprehension.

## What's next

A production version needs transactional approval/idempotency, authenticated approvers, role policy, cross-device revocation, sandboxed integrations, and continuous native testing.

## Built with

- Next.js App Router 16
- React 19
- TypeScript strict mode
- Tailwind CSS 4 and custom CSS
- Native imperative WebMCP
- Web Crypto SHA-256 and secure UUIDs
- Vitest, React Testing Library, and Playwright
- ESLint

## Test instructions

```bash
npm ci
WEBMCP_DEV_PORT=3100
npm run dev -- --hostname 127.0.0.1 --port "$WEBMCP_DEV_PORT"
```

Open the URL printed by the command. For automated verification, run `npm run verify`; Playwright is visibly labeled **WebMCP test adapter** and is not native evidence. For a native-capable browser, follow `docs/manual-native-webmcp-test.md`. The final-candidate publication gate is recorded in `docs/final-candidate-native-evidence.md`.

## Fictional data notice

This is a frozen Aug 27, 2026 scenario. Every vehicle, customer, provider, service record, certification, price, time slot, dispatch, and result is fictional. The prototype has no database, authentication, external business integration, or real operational write.

## AI-use disclosure

Codex assisted with implementation review, adversarial tests, copy, docs, local verification, and demo-production support. The entrant directed the product and evidence boundaries. AI-generated narration was used for the demo video and is disclosed on YouTube. No AI-generated images were used. The current 2:12 public-v2 video shows final-candidate native Chrome footage with a clearly labeled deterministic runner; it is not the separate Codex real-agent run. Historical test-adapter images remain explicitly labeled as application evidence, not native or real-agent evidence. Every displayed customer and provider identity is a fictional fixture; no real customer/provider identity or outcome is shown.

## Evidence boundary for reviewers

- Native evidence: public v1 (public commit `028bba44`) completed Chrome 151.0.7922.174 **5 → 6 → 5** on 2026-08-27, with two Resets, four screenshots, and no captured errors; its verification record identifies the byte-identical tested runtime source.
- Final-candidate native evidence: exact source `ef35cfc` completed Chrome 151.0.7922.174 **5 → 5 → 6 → 5 → Reset → 5** on 2026-08-30; tool 06 was only `commit_approved_dispatch`, with no observed error, duplicate, stopped transition, or stuck state.
- Automated candidate evidence: visibly labeled Vitest/Playwright harness; not browser-engine conformance.
- Current public release: [source repository](https://github.com/tandttakumi/agentic-service-dispatch) and [live app](https://agentic-service-dispatch.vercel.app) publish the byte-identical final-candidate runtime from source `ef35cfc`; later public commits change documentation only.
- CI: the tracked [GitHub Actions release gate](https://github.com/tandttakumi/agentic-service-dispatch/actions) independently verifies every public commit.
- Video: the verified public-v2 [2:12 YouTube demo](https://youtu.be/N8LuuoV7zKI) records one final-candidate native WebMCP session in Chrome 151; it uses disclosed AI-generated narration, exact English subtitles, no AI-generated images, comments disabled, and persistent source labels for the deterministic runner and native footage.
