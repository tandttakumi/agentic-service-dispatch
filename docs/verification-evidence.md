# Verification Evidence — 2026-08-27

Verified application source commit:

**cce6f26aab8b43b45b0dd8706e959a13f13a1d59**

The publication commit adds current external evidence and regenerated screenshots after that source baseline; it does not change product runtime code.

## Fresh-build method

1. Export the committed HEAD with git archive into a temporary directory inside the workspace.
2. Run npm ci from the committed package-lock.
3. Run coverage and the complete verify pipeline.
4. Start the production build on localhost port 3001.
5. Check HTTP and a stock headless Chromium page.
6. Stop only the temporary production server.
7. Delete the generated audit directory.

The persistent development server on port 3000 was not stopped or reused as the production server.

## Final command results

| Check | Result |
| --- | --- |
| npm ci | Passed; 468 packages installed from lockfile. |
| npm run lint | Passed. |
| npm run typecheck | Passed. |
| npm test | 65/65 passed across 9 files. |
| npm run test:coverage | 65/65 passed; all configured thresholds passed. |
| npm run test:e2e | 4/4 Chromium flows passed. |
| npm run build | Passed; root, not-found, and icon routes statically prerendered. |
| npm run verify | Passed end to end. |
| npm audit | 0 vulnerabilities. |
| git diff --check | Passed. |
| npm run start | Ready on 127.0.0.1:3001; HTTP 200. |
| Production browser check | Correct title/heading and unsupported fallback; Run disabled; console, page, uncaught, and hydration errors: 0. |

The Playwright NO_COLOR/FORCE_COLOR line is a Node test-runner environment warning, not a browser console event.

## Coverage

| Metric | Coverage |
| --- | ---: |
| Statements | 93.51% — 404/432 |
| Branches | 91.09% — 266/292 |
| Functions | 97.95% — 96/98 |
| Lines | 93.57% — 393/420 |

## Soak and race evidence

- 100 complete Run → Approve → Commit → Reset lifecycles.
- 100 consecutive Reset calls.
- 100 start/cleanup cycles.
- Seeded 256-action lifecycle ordering.
- Concurrent double commit.
- Same-tick double UI action.
- Reset during paused commit validation.
- Strict Mode-style start/stop/start.
- Out-of-order getTools response.
- Registration failure, expiry, draft mutation, wrong approval, missing capability, and contaminated baseline.

These are deterministic adapter/application tests, not native browser conformance.

## E2E evidence

- 1440×900 full lifecycle.
- 1280×720 compact desktop.
- 390×844 mobile.
- Honest unsupported-browser fallback.
- Actual harness getTools list for 5 → 6 → 5.
- Focus visibility and reduced motion.
- No horizontal overflow.
- Console errors, uncaught exceptions, page errors, and hydration warnings rejected.

## Public deployment evidence

- Production URL: [https://agentic-service-dispatch.vercel.app](https://agentic-service-dispatch.vercel.app)
- Vercel state: READY; target `production`; deployed 2026-08-27.
- HTTP: 200; `x-nextjs-prerender: 1`; `x-vercel-cache: PRERENDER`.
- Build: Next.js 16.3.3 production build passed and emitted the root, not-found, and icon routes.
- Post-deploy scan: no Vercel error logs found in the first-hour window.

## Screenshot hashes

| Artifact | SHA-256 |
| --- | --- |
| desktop-initial.png | 0e30075f08226f79cc472b976b52a5316d1541f7734439498f4e8a7d414ac635 |
| desktop-approved.png | 713e5884e85af38da6c31694e3055d9801f741481efeac12b3a040ae65fb7431 |
| desktop-committed.png | 0bd2fee045e5b53e08ddf0e616848fecbab19a8eed4f929550b05239169711d4 |
| desktop-reset.png | a1166ce2a4dc67c51bcbb31c544ffa988aa7664613afb4947cea7ba49bae4b28 |
| mobile.png | 1c25c1f8e8f7f482d796ad79dff74ef38997f6f528d33364e4dc0ca888d45475 |
| native-chrome-initial.png | a4cccac88e899603ae07ca5dcfb41dc8c58fc8eeeb9f3a6a754519ea932d3347 |
| native-chrome-approved.png | 58b1be049a79d4710302131ccab1449ea2d7bb8c00079cc4767248684163c4c2 |
| native-chrome-committed.png | c225a550e721ee29b3bc6d1797669b8b024eed5f0cd2e90e4fbb4e3e81fc8618 |
| native-chrome-reset.png | 9664c9893a9d06142366d714406af4f5443a0a471fd352153cc0bf3cc90266ae |

All nine were opened and inspected after final generation.

## Seven-view red team

| View | Outcome | Residual |
| --- | --- | --- |
| Official rules | English, license, build-window, public source, live URL, public YouTube video, and description evidence pass. | The Devpost entry remains the external blocker. |
| WebMCP leverage | Native imperative API, dynamic registration, getTools truth, toolchange, execution, and AbortSignal revocation are core. | Repeat native final recording because the standard is experimental. |
| Security and race | Exact hash, const input, TTL, generation, idempotency, one-time use, serialized lifecycle, and soak pass. | In-memory prototype is not authenticated production authorization. |
| React and Next.js | Stable external store, cleanup, stale-read guard, hydration collectors, current local docs, scoped Turbopack root, production build, and public deployment pass. | No deployed field-performance data. |
| UX and accessibility | Five views inspected; hierarchy, contrast, focus, reduced motion, mobile flow, and overflow pass. | Dense technical UI still depends on a crisp video crop. |
| Product and impact | Persona, cost chain, adjacent markets, and 30-second case are explicit. | No user interviews, usage, or measured value. |
| Public repository | Public URL, clean snapshot history, MIT license, README, source, screenshots, and setup are present; secrets, personal paths, internal worklogs, production fake imports, external runtime calls, and large tracked media are absent. | Final GitHub rendering is checked after each publication push. |

## Native versus automated evidence

- **Native browser evidence:** on 2026-08-27, Chrome 151.0.7922.174 with WebMCP testing enabled ran the public URL through Run → Approve → Commit → Reset with visible 5 → 6 → 5, two Resets, four screenshots, and zero captured error-level logs.
- **Native evidence boundary:** the operating-system build and a raw `toolchange` array were not recorded; the page's capability panel is the visible `getTools()` evidence.
- **Automated evidence:** Playwright and Vitest prove application integration and invariants using clearly labeled deterministic test surfaces.

## Final risk statement

No critical or moderate implementation or deployment issue remained after the final red team. Public source, the working live URL, and the [verified public video](https://youtu.be/ppIc0-dbmKA) are complete. The submission as a whole is **not Stage 1 ready** until the Devpost entry is completed.
