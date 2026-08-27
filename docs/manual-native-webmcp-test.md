# Manual Native WebMCP Test

## Purpose and evidence boundary

Use this procedure to verify the production adapter against a native WebMCP implementation. The committed Playwright screenshots use a deterministic, visibly labeled test harness and are not native-browser proof.

## Recorded native evidence — 2026-08-27

The [public production page](https://agentic-service-dispatch.vercel.app) ran in Chrome **151.0.7922.174** with **WebMCP for testing** enabled and displayed **Native WebMCP available**. **Run → Approve → Commit → Reset** completed; the visible `getTools()` registry changed **5 → 6 → 5**, tool 06 appeared only after approval and was absent after commit, two consecutive Resets restored the five baseline tools, and the captured error-level Chrome log was empty. Four `native-chrome-*` screenshots record the states. The operating-system build and raw `toolchange` array were not recorded, so this is scoped implementation evidence rather than a browser-conformance claim.

## Browser requirement

The [Devpost Official Rules](https://webmcp.devpost.com/rules) identify two testing paths: ChatGPT's in-app browser, or Chrome 149 or newer with the WebMCP testing flag enabled. For Chrome:

1. Install Chrome 149 or newer.
2. Open `chrome://flags/#enable-webmcp-testing`.
3. Enable **WebMCP testing**.
4. Relaunch Chrome when prompted.

Do not infer or enable any other flag. Recheck the official rules and the current [WebMCP specification](https://webmachinelearning.github.io/webmcp/) before recording final evidence because the API is experimental.

## Start the application

```bash
npm ci
npm run dev -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000` or the [public deployment](https://agentic-service-dispatch.vercel.app) in the native-capable browser. Confirm the badge reads **Native WebMCP available**. If it does not, stop; do not treat a test adapter or screenshot as native evidence.

## Prepare toolchange evidence

Open DevTools Console and run:

```js
globalThis.webMcpToolChanges = [];
document.modelContext.addEventListener("toolchange", async () => {
  const names = (await document.modelContext.getTools())
    .map((tool) => tool.name)
    .sort();
  globalThis.webMcpToolChanges.push(names);
  console.log("WebMCP toolchange", names);
});
```

## Verify the initial tool list

Run:

```js
(await document.modelContext.getTools()).map((tool) => tool.name).sort();
```

Expected exact list:

```text
check_provider_availability
create_dispatch_draft
get_active_vehicle
get_service_history
search_qualified_providers
```

Confirm `commit_approved_dispatch` is absent and the UI says **5/5 baseline tools verified** and **Write capability absent**.

## Run the prompt and create the draft

Use this exact prompt with a compatible agent surface to demonstrate agent discovery, or select **Run live 5-tool sequence** to invoke the discovered native tools deterministically through `document.modelContext.executeTool()`. The on-page runner is a manual verification aid, not a simulated AI agent:

> Find a qualified detailer for this vehicle, available before Friday, under ¥60,000. Check its previous service history and draft the job. Don't submit anything until I approve.

Expected result:

- service history is marked Reviewed;
- all three providers show a match or exclusion reason;
- Kairo Detail Works is selected for Thursday at ¥58,000;
- the card says **DRAFT — NOT SUBMITTED**; and
- `commit_approved_dispatch` remains absent.

## Approve and inspect the temporary tool

Select **Approve this exact dispatch**. Do not reload.

Expected result:

- tool count changes from 5 to 6;
- `commit_approved_dispatch` appears only after the click;
- the row says **Approved for this exact draft · One-time use**;
- the countdown starts near 2:00;
- the draft shows its SHA-256 binding; and
- the `toolchange` listener records a six-name list.

Inspect the strict schema:

```js
const commitTool = (await document.modelContext.getTools())
  .find((tool) => tool.name === "commit_approved_dispatch");
commitTool.inputSchema;
```

Expected: one required `approval_id` property, its value fixed by `const`, and `additionalProperties: false`. No vehicle, provider, slot, price, scope, or rationale input is accepted.

## Commit, revoke, and verify

Select **Invoke one-time commit tool**. This UI control invokes the discovered native tool with only the schema-bound approval ID.

Expected result:

- one green **Dispatch committed once** result appears;
- the count returns from 6 to 5;
- the panel states `commit_approved_dispatch revoked`;
- a second `getTools()` call contains only the baseline list; and
- the `toolchange` listener records the five-name list after revocation.

The domain commit is consumed before the result returns. Physical tool revocation occurs on the next task so native Chrome can settle the successful `executeTool()` result before the registration AbortSignal fires.

## Reset

Select **Reset Demo** twice. Expected after each reset:

- no draft, approval, or commit result;
- empty audit log;
- exactly five baseline tools;
- no duplicate rows or console errors; and
- the Run button is enabled.

## Expected audit sequence

1. Five baseline capabilities verified
2. Vehicle context retrieved
3. Service history reviewed
4. Three providers evaluated
5. Availability checked against the Friday deadline
6. Dispatch draft created
7. Human approved draft D-1042
8. Temporary commit capability registered
9. Agent committed approved dispatch
10. Temporary capability revoked after one exact action

## Failure recording

If any step differs, do not describe native verification as passed. Record:

- browser name and full version;
- operating system;
- whether the official flag was enabled and browser relaunched;
- badge text;
- initial and final `getTools()` output;
- `webMcpToolChanges` contents;
- exact console or page error;
- lifecycle step that failed; and
- a screenshot with private browser data excluded.
