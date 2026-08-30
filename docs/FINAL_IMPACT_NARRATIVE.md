# Final Potential-Impact Narrative

## Customer

Service coordinators in automotive, field service, maintenance, repair, inspection, installation, and similar operational businesses.

The entrant is a founder/operator of an automotive and service business. The workflow comes from firsthand work coordinating vehicle context, prior service history, provider qualifications, price, availability, operational constraints, provider selection, and final request authority. The public demo abstracts that experience without exposing a commercial system or customer data. Every company, vehicle, provider, history record, price, slot, draft, and commit in its frozen Aug 27, 2026 scenario is fictional.

## Pain

One service request can require a coordinator to cross:

- asset or vehicle context;
- previous service history;
- provider qualification;
- pricing;
- availability;
- multiple constraints and deadlines;
- reasons for excluding unsuitable providers;
- repeated data entry between systems; and
- final submission authority.

The operational risk is not only choosing an unsuitable provider or dropping a constraint. It is also exposing broad, always-available commit authority when most agent work is preparation. A prompt such as “don't submit until I approve” communicates intent, but prompt text itself does not remove a browser capability.

## Value

The agent prepares one structured decision through five page-owned WebMCP tools. The human reviews one exact draft containing the selected provider, slot, price, scope, rationale, and binding. Approval creates one exact, temporary write capability. One approved action consumes that capability. It then disappears, while the reviewed object, capability lifecycle, and audit trace remain visible on the shared page.

The demonstration is therefore not “an agent remembered to wait.” The page withheld consequential authority until a person approved one exact object, exposed it for one bound action, and removed it after use.

## Practical impact

The design targets practical improvements that a pilot can test:

- fewer dropped operational constraints;
- visible reasons for excluding unsuitable providers;
- less fragmented coordination and re-entry;
- no permanently exposed broad commit capability;
- exact-object human approval;
- inspectable authority and audit trail; and
- one page-owned operational state shared by the human and agent.

Built from firsthand experience coordinating real automotive and service operations, Agentic Service Dispatch turns one concrete vehicle-service workflow into a reusable authority pattern: the agent prepares the operational decision, but consequential authority exists only for the exact action a human reviewed and approved.

## Why WebMCP matters

A modal can ask for confirmation while the underlying tool remains callable. This prototype uses the page-owned WebMCP registry itself as part of the boundary:

```text
five preparation tools
        ↓ exact draft
human approval
        ↓ actual registerTool
six tools, including one exact commit capability
        ↓ one successful use
five preparation tools
```

The page does not render the sixth row from domain phase alone. It re-reads `document.modelContext.getTools()` and hides authority actions when the observed surface is missing, stale, contaminated, or unavailable.

## Reusable pattern beyond the example

The automotive dispatch is one concrete example, not an industry boundary. The prepare/review/authorize/revoke pattern can be tested in field service, maintenance, repair, inspection, installation, procurement, and similar workflows where an agent gathers and compares evidence but a person must grant one narrow consequential action. These are transfer paths for future pilots, not claims that the prototype is already deployed across industries.

## Honest pilot design

A real pilot should compare the current coordinator workflow with an integrated version of this pattern. It should define a sample, baseline, success threshold, and stop condition before collecting results.

Measure:

- elapsed time from request to reviewed draft;
- systems or pages opened per request;
- fields re-entered by the operator;
- constraint misses caught before submission;
- post-approval corrections and rejected submissions;
- duration of consequential capability exposure;
- wrong-object, stale, expired, and replay attempts;
- whether operators can explain when commit authority exists;
- operator trust and willingness to use the workflow again.

The pilot should also compare a standard confirmation modal against actual capability absence. The important product question is whether people understand and trust the authority boundary—not merely whether the animation is memorable.

## Current evidence boundary

- Public v1 was verified by a human in native Chrome on 2026-08-27.
- Exact final candidate source `ef35cfc` completed a separate uninterrupted human-operated native Chrome **5 → 5 → 6 → 5 → Reset → 5** gate on 2026-08-30.
- The current public release preserves that candidate runtime and separately has automated domain, adapter, registry, UI, and Playwright evidence.
- Final-candidate Playwright screenshots visibly use the WebMCP test adapter and are not native conformance evidence.
- The deterministic runner invokes registered tools but is not an AI-agent evaluation.
- Commit changes an in-memory fictional store only; there is no authenticated approver, database, external business write, or cross-tab guarantee.
- There are no production users, external reviewers, field-trial outcomes, measured time savings, financial results, market-size claims, or multi-industry adoption claims.
