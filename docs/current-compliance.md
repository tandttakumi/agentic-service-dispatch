# Current Challenge and WebMCP Compliance

Research checked on 2026-08-27. This document separates local implementation readiness from external submission readiness.

## Primary sources

- [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/)
- [Devpost overview](https://webmcp.devpost.com/)
- [Devpost Official Rules](https://webmcp.devpost.com/rules)
- [OpenAI site tools documentation](https://learn.chatgpt.com/docs/webmcp)
- [WebMCP Draft Community Group Report](https://webmachinelearning.github.io/webmcp/)
- [WebMCP proposal repository](https://github.com/webmachinelearning/webmcp)
- [Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp)
- [Chrome imperative API guide](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Chrome MCP comparison](https://developer.chrome.com/docs/ai/webmcp/compare-mcp)
- [Chrome DevTools WebMCP panel](https://developer.chrome.com/docs/devtools/application/webmcp)

## Current official submission requirements

The controlling Devpost rules state:

- Submission closes 2026-09-03 at 1:00 p.m. Pacific Time.
- Judging runs from 2026-09-04 through 2026-09-21.
- The project must be new during the submission period or be a meaningful extension started during it, with pre-existing work disclosed.
- A working live URL must be reachable by ChatGPT's browser or Chrome 149+ with WebMCP testing enabled.
- Source must be in a publicly accessible GitHub, GitLab, or Bitbucket repository with all source, assets, setup instructions, and a detectable open-source license.
- The English description must explain the user experience, why the use case strongly fits WebMCP, what was difficult or impossible before, and how the implementation works.
- The public YouTube video must be shorter than three minutes, show the functioning project, and include audio explaining its WebMCP use.
- Third-party trademarks, copyrighted music, and unlicensed material must not appear.
- Judges are not required to run the app; the description, images, and video may be the entire evaluation surface.
- Stage 2 weights WebMCP Leverage, Execution, Potential Impact, and Creativity & Ambition equally at 25 points. Tie-breaking starts with WebMCP Leverage.
- The submission, public repository, and live app should not be changed during judging.

## Local compliance matrix

| Requirement | Current state | Evidence / action |
| --- | --- | --- |
| Built in the competition window | Pass | First commit is dated 2026-08-26, after the 2026-08-25 opening. |
| English project and submission materials | Pass | Product UI, README, docs, and scripts are English. |
| Detectable open-source license | Pass | Root MIT LICENSE is committed and README links it. |
| Complete source and local instructions | Pass | The [public repository](https://github.com/tandttakumi/agentic-service-dispatch) includes source, assets, Node/npm setup, browser setup, tests, and limitations. |
| Strong WebMCP use | Pass | The native registry is the authority surface: five baseline tools, approval-only sixth tool, one-time revocation. |
| Native browser access | Pass with evidence boundary | Chrome 151.0.7922.174 completed the public deployment's Run → Approve → Commit → Reset lifecycle with native availability, visible 5 → 6 → 5, two Resets, and zero captured error logs. Four native screenshots are committed. |
| Working live URL | Pass | [agentic-service-dispatch.vercel.app](https://agentic-service-dispatch.vercel.app) returns HTTP 200 from a READY production deployment. |
| Public repository URL | Pass | [github.com/tandttakumi/agentic-service-dispatch](https://github.com/tandttakumi/agentic-service-dispatch) is Public and exposes the MIT license. |
| Public video under three minutes | Pass | [The 2:02 public YouTube demo](https://youtu.be/ppIc0-dbmKA) has English audio, completed processing and copyright checks, and comments disabled. |
| Devpost project entry | Missing external requirement | The account is signed in and draft copy exists; challenge registration and the project entry remain incomplete. |
| Original / licensed media | Pass locally | Original inline icon and UI only; no music, stock imagery, or third-party logos. |
| No post-deadline edits | Future operator requirement | Freeze the repo, live site, and submission after the deadline and during judging. |
| Entrant eligibility and account facts | Human verification required | Age, residence, team membership, employer consent, and Devpost account facts are not inferable from this repository. |

The implementation, public source, working live URL, native evidence, and public YouTube video are ready. Submission readiness still requires a completed Devpost entry.

## Current WebMCP alignment

The current proposal and Chrome documentation agree on the central model used here:

- Tools are page-owned and bound to the live browsing context.
- The imperative surface is document.modelContext.
- registerTool publishes structured capabilities.
- getTools reads the actual current tool registry.
- executeTool invokes a registered tool.
- toolchange signals registry changes.
- AbortSignal ends the registration lifetime.
- JSON Schema should be narrow, side effects should be obvious, and returned results should be sufficient to verify the action.

Chrome's current testing build has exposed string-form registered schemas and a DOMString execution input in the native path used during the 2026-08-27 diagnosis. The native adapter therefore serializes input only when the returned registered schema is a string; the standards path remains object input. A native regression test covers this bridge.

## WebMCP versus remote MCP

Remote MCP exposes server capabilities independently of a page and can persist beyond a tab. WebMCP exposes the capabilities of the page the person and agent are currently sharing, with the page's visible state, session, and lifetime. This project depends on that difference: approval changes the live page's capability registry, the change is visible beside the reviewed draft, and closing or resetting the page ends that authority.

Replacing WebMCP with a backend endpoint would preserve a commit API but lose the decisive proof:

- the write capability is absent before approval;
- approval itself creates a page-bound capability;
- the human and agent observe the same reviewed draft and tool count;
- toolchange and getTools expose the authority transition;
- AbortSignal revokes the capability in the tab after one use.

## Known primary-source uncertainty

WebMCP remains a proposed standard and browser behavior is still evolving. OpenAI documentation also notes that site-tool availability can depend on model, workspace, and rollout. The manual checklist must therefore be repeated in the exact browser used for the final recording. Automated harness evidence must never be presented as browser-engine conformance.
