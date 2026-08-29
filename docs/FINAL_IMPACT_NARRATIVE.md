# Final Potential-Impact Narrative

## One grounded problem

The entrant operates an automotive and service business and has firsthand experience coordinating vehicle context, prior service history, provider qualifications, price, availability, constraints, selection, and a final request. The demo abstracts that workflow without disclosing any commercial system or customer data. It is explicitly frozen to an Aug 27, 2026 scenario; every company, vehicle, provider, history record, price, slot, draft, and commit in the prototype is fictional.

A service coordinator often has to cross several sources to answer one practical request:

1. Which asset is active?
2. What prior work changes the decision?
3. Which providers offer the required service?
4. Which are qualified?
5. Which fit the budget?
6. Which can complete before the deadline?
7. Why were alternatives excluded?
8. What exact provider, slot, price, scope, and rationale should be submitted?
9. Who has authority to make that final action?

The consequential risk is not only selecting the wrong provider. It is also giving an agent broad, always-available commit authority when most of its work is preparation.

## Before

The coordinator manually crosses asset context, service history, qualification, price, availability, constraints, comparison, re-entry, and a final system. A prompt such as “don't submit until I approve” communicates intent, but prompt text itself does not remove a browser capability.

## After demonstrated by this prototype

- Five page-owned structured tools let an agent or deterministic runner prepare the decision.
- The page records the same fictional context, exclusions, candidate, and exact unsubmitted draft the human reviews.
- The commit tool is absent from the observed registry during preparation.
- Human approval binds the canonical draft, approval ID, nonce, idempotency key, generation, and TTL.
- Approval creates one temporary sixth tool whose input accepts only that approval ID.
- One successful use consumes the approval.
- The result settles, then the page aborts the temporary registration controller.
- The visible registry returns from six tools to the five preparation tools.
- An audit trace records preparation, approval, registration, commit, and revoke.

The demonstration is therefore not “an agent remembered to wait.” It is “the page did not expose the consequential capability until the person approved one exact object.”

## Potential value, stated as hypotheses

This pattern could reduce fragmented coordination by letting structured page tools prepare one reviewable object. It could reduce missed constraints by making exclusion reasons and the selected evidence visible together. It could avoid continuously exposing broad commit authority. It could make human authority inspectable because the page, draft, registry, and audit lifecycle are in one state surface.

Those are hypotheses, not measured outcomes. This project has no production users, field trial, external integration, saved-time result, error-rate result, revenue result, or willingness-to-adopt result.

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

## Primary customer and adjacent transfer

The primary story remains field-service coordination. The underlying prepare/review/authorize/revoke pattern may transfer to maintenance, repair, inspection, installation, or procurement where an agent can gather and compare evidence but a person must grant one narrow consequential action. These are transfer hypotheses, not implemented verticals or market claims.

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

- Public v1 was verified by a human in native Chrome on 2026-08-27; exact final candidate source `ef35cfc` passed its separate human-operated native gate on 2026-08-30.
- The final candidate has automated domain, adapter, registry, UI, and headless Playwright evidence plus the separate 2026-08-30 human native-Chrome release gate.
- Final-candidate Playwright screenshots visibly use the WebMCP test adapter and are not native conformance evidence; the separate candidate-native result is a scoped human implementation check.
- The deterministic runner invokes registered tools but is not an AI-agent evaluation.
- Commit changes an in-memory fictional store only; there is no authenticated approver, database, external business write, or cross-tab guarantee.

## Impact score

Strict current score: **17 / 25**. The project earns credit for a concrete operator-derived problem, a transferable authority pattern, and an honest measurement plan. It does not earn credit for outcomes that have not been observed. Candidate-native completion can improve WebMCP and Execution evidence, but it does not by itself raise Potential Impact.
