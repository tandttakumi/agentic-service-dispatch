# Seven Public Judge Lenses

These are cautious evaluation hypotheses based only on public roles and published technical work checked on 2026-08-27. They are not claims about private preferences.

The official [challenge page](https://openai.com/webmcp-challenge/) lists Sarah Drasner, Andrew Galloni, Jude Gao, Ilya Grigorik, Alex Nahas, Sean Roberts, and Justin Rushing. The sources below add public professional context.

## Justin Rushing — browser-agent lens

Public basis: the challenge identifies him as OpenAI's Browser Agent Lead; OpenAI's [ChatGPT agent overview](https://openai.com/index/introducing-chatgpt-agent/) emphasizes coordinated visual browser, text browser, terminal, API tools, user steering, and safe action.

- Likely scrutiny: does a real browser agent discover useful tools, and is WebMCP better than clicking or a remote API?
- Strongest proof: native badge, five actually registered tools, one natural-language prompt, getTools-driven panel, toolchange-driven sixth-tool reveal.
- Likely concern: the on-page runner could be mistaken for a simulated agent.
- Direct response: the UI says **Deterministic WebMCP runner** and **CALLS LIVE TOOLS**; docs separate manual, compatible-agent, Playwright, and native paths.
- Score risk: exact final native browser/version/video evidence is still missing.

## Sarah Drasner — web-platform and human-experience lens

Public basis: her [public site](https://sarah.dev/) and [GitHub profile](https://github.com/sdras) identify her as a Chrome Distinguished Engineer and Area Tech Lead for AI and the Web Ecosystem, with frontend, design, infrastructure, observability, and incident-command experience.

- Likely scrutiny: progressive enhancement, honest unsupported behavior, accessible human/agent coexistence, and instant visual comprehension.
- Strongest proof: production never imports the fake adapter; unsupported browsers say no simulation; responsive one-screen hierarchy, focus, reduced motion, and error collectors are tested.
- Likely concern: dense control-room typography and a technical concept that may take too long to parse.
- Direct response: the thesis, lifecycle cue, live count, unsent-draft label, sixth-tool color, and revoked proof carry the story without narration.
- Score risk: the interface is polished but intentionally less visually spectacular than creative-canvas competitors.

## Andrew Galloni — reliability, security, and open-agentic-web lens

Public basis: Cloudflare lists him as VP Research & Innovation for the challenge. His [Cloudflare author archive](https://blog.cloudflare.com/author/andrew-galloni/) covers web performance, security, Rust, and Workers; the coauthored [Agentic Internet article](https://blog.cloudflare.com/the-agentic-internet/) argues for readable, discoverable, callable web cooperation.

- Likely scrutiny: race behavior, revocation truth, fail-closed registration, and whether the pattern cooperates with the open web rather than hiding in a backend.
- Strongest proof: exact baseline verification, serialized registry lifecycle, stale-read guard, hash/TTL/generation/idempotency validation, registration-failure invalidation, and 100-cycle soak.
- Likely concern: in-memory controls are not production authorization.
- Direct response: the submission calls this a browser-local reference pattern and documents the server-side controls a production system still needs.
- Score risk: no authenticated identity, transactional store, or cross-tab coordination.

## Jude Gao — Next.js and agent-developer-experience lens

Public basis: the [Next.js team page](https://nextjs.org/team) lists Jude; his [Next.js for AI Agents session](https://nextjs.org/conf/session/nextjs-for-ai-agents) and [AGENTS.md eval article](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) focus on current framework truth and measurable agent success.

- Likely scrutiny: React lifecycle correctness, Strict Mode cleanup, hydration, current Next.js 16 practices, reproducible evidence, and repository usability.
- Strongest proof: stable external store, effect cleanup, queued start/stop, no hydration warnings, bundled Next docs followed, npm ci setup, deterministic screenshots, and a cleaned public tree.
- Likely concern: two large state/lifecycle files and a client-heavy single page.
- Direct response: responsibilities are cohesive, tested, and intentionally not split for line-count optics; the page statically prerenders its route shell.
- Score risk: no field performance data or deployed production URL.

## Ilya Grigorik — web-performance, standards, and platform lens

Public basis: his [professional site](https://ilya.grigorik.com/) identifies him as Shopify Distinguished Engineer, former Chrome/Search/Analytics builder, former W3C Web Performance Working Group co-chair, and author of High Performance Browser Networking.

- Likely scrutiny: why a web standard is essential, how behavior is measured, and whether the interaction respects browser/page lifetime.
- Strongest proof: the capability is page-bound, observed through getTools, revoked with AbortSignal, and measured across unit, browser, screenshot, and manual-native evidence tiers.
- Likely concern: the demo has no deployed latency, Core Web Vitals, or scale evidence.
- Direct response: make no performance claim; emphasize fewer ambiguous UI-actuation steps and an observable authority state.
- Score risk: potential impact is architectural inference rather than merchant/user evidence.

## Alex Nahas — WebMCP/MCP semantics lens

Public basis: the challenge calls him Creator of MCP-B. His [GitHub profile](https://github.com/MiguelsPizza) and [MCP-B/WebMCP repository](https://github.com/MiguelsPizza/WebMCP) emphasize browser-native MCP, local-first state, browser sandbox/origin, auditability, and bringing structured tools to existing web apps.

- Likely scrutiny: whether this truly needs WebMCP, schema quality, browser-native semantics, tool discoverability, and lifecycle correctness.
- Strongest proof: dynamic register/get/execute/toolchange/AbortSignal use is the product, not plumbing; exact schema const binding prevents caller-controlled widening.
- Likely concern: the native string-schema bridge could look like implementation-specific debt.
- Direct response: isolate it in one adapter, preserve the object standards path, test both, and document why the bridge exists.
- Score risk: WebMCP is evolving and one human native run is not conformance coverage.

## Sean Roberts — Agent Experience and product-impact lens

Public basis: Netlify identifies him as VP of Applied AI. His [AXIS article](https://www.netlify.com/blog/how-we-measure-netlify-agent-experience/) defines Agent Experience around discovery, reliable calls, recovery, and measurable results; his [MCP article](https://www.netlify.com/blog/mcp-goes-stateless-and-extensible/) focuses on operational simplicity and dependable agent interfaces.

- Likely scrutiny: can an agent discover the right capabilities, recover from errors, and verify success; does the product solve a valuable workflow?
- Strongest proof: narrow descriptions/schemas, explicit errors, structured results, visible audit evidence, deterministic reproduction, and verified revoke/reset.
- Likely concern: one fictional vehicle and no user/market validation.
- Direct response: present a reusable prepare / authorize / consume control primitive, not a claimed production dispatch company.
- Score risk: external impact remains the weakest criterion.

## Cross-judge evidence priorities

1. First 30 seconds: prompt → five real tools → draft not submitted → human approval → sixth tool.
2. No cut: sixth tool → one commit → five tools and revoked proof.
3. Technical credibility: exact draft hash, const-only approval schema, TTL, idempotency, and AbortSignal.
4. Honesty: native, deterministic runner, and Playwright evidence labeled separately.
5. Product discipline: no fake chat, no external integration claims, no feature sprawl.
6. Limitations: in-memory prototype, one fixture, no authenticated production authorization.
