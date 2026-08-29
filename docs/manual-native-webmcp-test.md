# Manual Native WebMCP Test

## Purpose and evidence boundary

Use this procedure to verify the production adapter against a native WebMCP implementation. The committed Playwright screenshots use a deterministic, visibly labeled test harness and are not native-browser proof.

## Recorded native evidence — 2026-08-27

Public v1 (public commit `028bba44`) ran on the [public production page](https://agentic-service-dispatch.vercel.app) in Chrome **151.0.7922.174** with **WebMCP for testing** enabled and displayed **Native WebMCP available**. **Run → Approve → Commit → Reset** completed; the visible `getTools()` registry changed **5 → 6 → 5**, tool 06 appeared only after approval and was absent after commit, two consecutive Resets restored the five baseline tools, and the captured error-level Chrome log was empty. Four `native-chrome-*` screenshots record the states. The [historical verification record](verification-evidence.md) identifies the tested runtime source; product runtime inputs did not change before the public commit. The operating-system build and raw `toolchange` array were not recorded, so this is scoped historical implementation evidence rather than a browser-conformance claim.

## Recorded final-candidate native evidence — 2026-08-30

Candidate source `ef35cfce59a8d1ccd1374de43b36e34a1a14097e`, with application/toolchain digest `abfc8f4c872cb29445626a9a75904f51a39aadb091cff502ca7baf32c57aa4f7`, ran as a production build in Chrome **151.0.7922.174** with WebMCP testing enabled. In one uninterrupted human-operated pass, the registry completed **5 → 5 → 6 → 5 → Reset → 5**; the sixth tool was only `commit_approved_dispatch`, and the operator observed no runtime error, console error, duplicate, stuck state, or stopped transition. See the separate [final-candidate evidence record](final-candidate-native-evidence.md) for the exact names and evidence boundary.

## Browser requirement

The [Devpost Official Rules](https://webmcp.devpost.com/rules) identify two testing paths: ChatGPT's in-app browser, or Chrome 149 or newer with the WebMCP testing flag enabled. For Chrome:

1. Install Chrome 149 or newer.
2. Open `chrome://flags/#enable-webmcp-testing`.
3. Enable **WebMCP testing**.
4. Relaunch Chrome when prompted.

Do not infer or enable any other flag. Recheck the official rules and the current [WebMCP specification](https://webmachinelearning.github.io/webmcp/) before recording final evidence because the API is experimental.

## Start the application

For the final-candidate publication gate, test the production build made from the exact candidate commit:

```bash
npm ci
npm run build
WEBMCP_LOCAL_PORT=3100
npm run start -- --hostname 127.0.0.1 --port "$WEBMCP_LOCAL_PORT"
```

`npm run dev` is suitable for iteration and Strict Mode stress, but it is not the final publication gate. For the final candidate, open only the local production URL printed by the command; the [public deployment](https://agentic-service-dispatch.vercel.app) is public v1 and can only recheck that historical release. Confirm the badge reads **Native WebMCP available**. If it does not, stop; do not treat a test adapter or screenshot as native evidence.

The vehicle, provider slots, and request are a frozen Aug 27, 2026 fictional scenario, not live availability. The browser clock still governs the separate 120-second approval lifetime during this check.

## Prepare toolchange evidence

Open DevTools Console and run:

```js
globalThis.webMcpToolChanges = [];
globalThis.webMcpToolChangeErrors = [];
document.modelContext.addEventListener("toolchange", async () => {
  try {
    const names = (await document.modelContext.getTools())
      .map((tool) => tool.name)
      .sort();
    globalThis.webMcpToolChanges.push(names);
    console.log("WebMCP toolchange", names);
  } catch (error) {
    globalThis.webMcpToolChangeErrors.push(String(error));
    console.error("WebMCP toolchange read failed", error);
  }
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

Confirm `commit_approved_dispatch` is absent and the UI says **5/5 baseline tools verified** and **Commit capability absent**.

## Run the prompt and create the draft

Use this exact prompt with a compatible agent surface to demonstrate agent discovery, or select **Run live 5-tool sequence** to invoke the discovered native tools deterministically through `document.modelContext.executeTool()`. The on-page runner is a manual verification aid, not a simulated AI agent:

> Find a qualified detailer for this vehicle who can complete the job before Friday for under ¥60,000. Check its previous service history and draft the job. Don't submit anything until I approve.

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
- the row says **Created by human approval · Exact draft · One use**;
- the countdown starts near 2:00;
- the draft shows its SHA-256 binding; and
- the `toolchange` listener records a six-name list.

Inspect the strict schema:

```js
const commitTool = (await document.modelContext.getTools())
  .find((tool) => tool.name === "commit_approved_dispatch");
const rawSchema = commitTool.inputSchema;
typeof rawSchema === "string" ? JSON.parse(rawSchema) : rawSchema;
```

Expected in either representation: one required `approval_id` property, its value fixed by `const`, and `additionalProperties: false`. No vehicle, provider, slot, price, scope, or rationale input is accepted. The object form matches the current specification; the string form is the tested Chrome compatibility surface and is why the native adapter serializes execution input only for that representation.

## Commit, revoke, and verify

Select **Invoke one-time commit tool**. This UI control invokes the discovered native tool with only the schema-bound approval ID.

Expected result:

- one green **One exact action committed** result appears;
- the count returns from 6 to 5;
- the panel states `commit_approved_dispatch revoked`;
- a second `getTools()` call contains only the baseline list; and
- the `toolchange` listener records the five-name list after revocation.

The domain commit is consumed before the result returns. Physical tool revocation occurs on the next task so native Chrome can settle the successful `executeTool()` result before the registration AbortSignal fires.

## Reset

Select **Reset Demo** twice. Expected after each reset:

- no draft, approval, or commit result;
- audit log contains only **Five baseline capabilities verified**;
- exactly five baseline tools;
- no duplicate rows or console errors; and
- the Run button is enabled.

## Final candidate 30-second adoption gate

For any release candidate, use the locally started exact commit at the URL printed by the command above; an older public deployment cannot validate a newer source revision. One normal-speed human pass is the publication gate:

1. Confirm **Native WebMCP available** and exactly five tools.
2. Run the deterministic five-tool sequence and confirm the draft while commit remains absent.
3. Approve and confirm tool 06 plus actual count 6.
4. Commit and wait for the result to settle; confirm no `RUNTIME_ERROR`, count 5, and commit absent.
5. Reset and confirm exactly five tools with no console error, uncaught exception, or hydration warning.

Do not publish the candidate as native-confirmed unless all five steps pass in one session. A later stress pass may race Commit with Reset/remount, but it is not a substitute for this primary flow.

This candidate additionally makes domain Reset immediate while leaving browser unregistration/read-back serialized, coalesces `toolchange` discovery reads, and discards pre-Reset background completion by lifecycle epoch. The same uninterrupted pass is therefore the required compatibility check: click Reset once, wait for it to settle, and verify the physical registry is exact five. A Commit-near-Reset or stop/remount race remains an optional engine-specific stress record, not evidence that can replace the primary flow.

## Expected audit sequence

1. Five baseline capabilities verified
2. Vehicle context retrieved
3. Service history reviewed
4. Three providers evaluated
5. Availability checked against the Friday deadline
6. Dispatch draft created
7. Human approved draft D-1042
8. Temporary commit capability registered
9. Approved dispatch committed through tool
10. Temporary capability revoked after one exact action

## Failure recording

If any step differs, do not describe native verification as passed. Record:

- browser name and full version;
- operating system;
- whether the official flag was enabled and browser relaunched;
- badge text;
- initial and final `getTools()` output;
- `webMcpToolChanges` contents;
- `webMcpToolChangeErrors` contents;
- exact console or page error;
- lifecycle step that failed; and
- a screenshot with private browser data excluded.
