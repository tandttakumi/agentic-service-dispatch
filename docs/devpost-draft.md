# Devpost Submission Draft

## Project title

**Agentic Service Dispatch**

## Tagline

**Human approval creates one exact WebMCP capability—and consumes it after one action.**

## Short description

Five native page-owned WebMCP tools inspect a fictional service request and prepare a visible dispatch draft. The final commit tool is absent until a person approves that exact canonical draft. Approval registers a 120-second, hash-bound, one-time sixth tool that accepts only the approval ID. One successful invocation consumes the authority, unregisters the tool, and returns the live browser capability surface from six capabilities to five.

## Inspiration

Service coordinators move between asset records, previous work, provider qualifications, calendars, prices, deadlines, and a final dispatch system. Agents can reduce that coordination burden, but prompt text such as “don't submit until I approve” is only an instruction. It does not change the agent's actual authority.

We wanted to test a stronger idea: human approval should create a narrow capability for one reviewed object, and that capability should cease to exist after use.

## What it does

A single request asks for a qualified fictional automotive detailer before Friday under ¥60,000, with previous service history checked. Five WebMCP tools:

1. retrieve the active vehicle and constraints;
2. review service history;
3. compare all three providers and explain exclusions;
4. check availability against the deadline; and
5. create a local **DRAFT — NOT SUBMITTED**.

The human reviews the provider, slot, price, work scope, rationale, and exact draft binding. Only then does commit_approved_dispatch appear as tool 06. It can be invoked once. After the successful result crosses the native boundary, its AbortSignal unregisters it on the next task and getTools confirms the surface is back to five.

Reset clears local state and verifies the exact five-tool baseline. All names, records, companies, prices, dates, and results are fictional; commit writes only to in-memory demo state.

## Why WebMCP

This interaction depends on a shared live page. The person sees the exact draft, capability count, countdown, and audit trace while an agent sees the same page-owned structured tools.

The implementation uses the imperative document.modelContext API:

- registerTool publishes five baseline tools and the approval-only temporary tool;
- getTools drives the visible capability panel and verifies appearance/revocation;
- executeTool invokes the deterministic proof sequence and one-time commit;
- toolchange refreshes the browser-truth display; and
- AbortSignal defines registration lifetime.

This would be weaker as ordinary UI automation: clicking a confirmation does not prove the agent's write capability was absent before approval or gone after use. It would also be weaker as a permanently available remote endpoint: the core product moment is a page-bound authority transition the human and agent can inspect together.

## Human-in-the-loop safety

Approval canonicalizes and hashes the complete draft with SHA-256. The record carries:

- approval and draft IDs;
- exact draft hash;
- approved and expiry timestamps;
- one-time nonce;
- idempotency key;
- used status; and
- registration generation.

The temporary schema accepts only the current approval ID. Vehicle, provider, slot, price, scope, and rationale cannot be supplied by the caller. Execution revalidates live status, TTL, full current hash, generation, unused idempotency key, and uncommitted state. Mutation, expiry, reset, cleanup, or registration failure revokes or invalidates authority.

## How we built it

The app is a one-screen Next.js 16 and React 19 control surface over a deterministic TypeScript domain store. React subscribes with useSyncExternalStore so WebMCP callbacks never rely on stale component state. Registry changes are serialized, and capability reads use a monotonic generation so an older getTools promise cannot overwrite newer browser truth.

The production bundle has one native adapter and no fake fallback. If document.modelContext is missing, the page says native WebMCP is unavailable and registers no simulated tools. The deterministic Playwright harness is visibly labeled and exists only for application-level automation.

## Challenges

The hardest browser issue was settlement-safe revocation. Unregistering the commit tool before its successful callback result crossed the current Chrome native boundary produced an UnknownError even though the domain commit had succeeded. The final implementation consumes authority synchronously, returns success, then unregisters on the next task and verifies absence with getTools.

Other adversarial cases include Strict Mode remounts, duplicate registration, out-of-order getTools reads, concurrent approve/commit, same-tick UI actions, expiry, draft mutation, Reset during commit, registration failure, and repeated cleanup.

## Accomplishments

- Human approval creates an inspectable temporary WebMCP capability instead of changing prompt text.
- Authority is bound to one immutable draft and cannot be widened by tool arguments.
- One successful action consumes the approval and unregisters the capability.
- The actual browser registry is the main visual evidence.
- Native Chrome completed one human Run → Approve → Commit → Reset lifecycle on 2026-08-27 with 5 → 6 → 5 and no runtime error.
- 65 automated tests pass across 9 unit/component/lifecycle files.
- Soak coverage includes 100 complete lifecycles, 100 consecutive resets, 100 start/cleanup cycles, and a seeded 256-action ordering.
- Four browser flows cover desktop, compact desktop, mobile, unsupported fallback, accessibility, overflow, and runtime-error collection.

## What we learned

Tool design is authorization design. Structured inputs improve agent accuracy, but real operational trust also depends on capability absence, exact object binding, lifetime, revocation, and evidence. WebMCP's page-owned registry makes those decisions visible at the interface where the human reviews the work.

## Potential impact

The reference pattern applies wherever an agent prepares and a person authorizes:

- procurement and purchase orders;
- refund release;
- field-service work orders;
- travel booking;
- administrative scheduling;
- insurance operations;
- IT change execution; and
- publishing one reviewed version.

The current project does not claim production users, saved time, revenue, or integrations. It is a technically complete, testable control primitive for future validation.

## What's next

A production version would store approval and idempotency transactionally, authenticate the approving person, enforce role and policy rules, support cross-device revocation, connect only to sandboxed operational systems, and continuously test native behavior as WebMCP evolves.

## Built with

- Next.js App Router 16
- React 19
- TypeScript strict mode
- Tailwind CSS 4 and custom CSS
- Native imperative WebMCP
- Web Crypto SHA-256 and secure UUIDs
- Vitest, React Testing Library, and Playwright
- ESLint

## Evidence boundary for reviewers

- Native evidence: the public deployment completed a Chrome 151.0.7922.174 lifecycle on 2026-08-27 with visible 5 → 6 → 5, two Resets, four committed screenshots, and no captured error logs.
- Automated screenshots: visibly labeled Playwright harness; not browser-engine conformance.
- Public artifacts: [source repository](https://github.com/tandttakumi/agentic-service-dispatch) and [live app](https://agentic-service-dispatch.vercel.app).
- Remaining external artifacts: publicly visible YouTube video URL and completed Devpost entry.
