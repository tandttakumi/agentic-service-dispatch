# Impact Case

## Primary persona

The first user is an operations coordinator in a small or mid-sized service organization: field service, vehicle care, facilities, vendor management, or another workflow where one person assembles context and authorizes a third party to act.

This person does not need an AI chat product. They need:

- records gathered from several operational surfaces;
- constraints checked consistently;
- excluded vendors explained;
- a final proposal that is visibly not yet submitted;
- narrow, inspectable control over the moment an agent gains write authority.

## Fragmented information problem

A routine dispatch decision can span:

- asset or customer context;
- prior work and special handling notes;
- provider qualifications;
- live availability;
- price and deadline constraints;
- the final system that creates the job.

The cost is not only the number of clicks. It is the risk that context is dropped while moving between systems, that an agent acts on stale or partial state, or that a broad write integration stays available after the one decision is complete.

## Direct cost

The direct cost hypothesis is coordinator time:

- repeated lookup and copy/paste;
- rechecking certification, deadline, and budget;
- explaining why alternatives were excluded;
- reconstructing the final object for approval;
- auditing who or what initiated the write.

This prototype does not claim a measured time or currency saving. It demonstrates the structure needed to measure those savings later.

## Indirect cost

- delayed service completion;
- rework from using the wrong provider, price, slot, or scope;
- customer dissatisfaction from missed constraints;
- compliance and audit exposure from unclear delegated authority;
- overbroad agent credentials that outlive the approved task;
- loss of trust when the UI says “approved” but the underlying agent capability is unchanged.

## Economic value chain

1. WebMCP gives the agent structured page-owned reads and local draft creation.
2. The human reviews one complete object in the same visible page state.
3. Approval creates only the authority required for that object.
4. Exact hash binding prevents redirection to another provider, amount, slot, asset, or rationale.
5. One successful action consumes the authority and removes the capability.
6. The live registry and audit trace make the transition inspectable.

Potential value comes from reduced coordination time **and** reduced authorization risk. The second half is the differentiator.

## Why the browser page matters

The coordinator and agent share the same signed-in, current page and the same reviewed draft. A remote endpoint can expose a commit method, but it does not inherently show the human that the method is absent, appear only after review, or disappear beside the exact object after use. WebMCP makes the authority boundary part of the operational interface.

## Adjacent verticals

| Vertical | Agent prepares | Human authorizes | Temporary capability consumes |
| --- | --- | --- | --- |
| Procurement | vendor, quote, budget, policy evidence | exact purchase order | submit one PO |
| Refunds | transaction evidence and policy match | exact refund amount/reason | issue one refund |
| Field service | asset history, technician match, slot | exact work order | dispatch one visit |
| Travel | itinerary, fare, traveler constraints | exact booking | book one itinerary |
| Healthcare administration | non-clinical scheduling and eligibility context | exact appointment/referral step | submit one administrative action |
| Insurance operations | claim facts and policy checklist | exact next action | release one bounded workflow transition |
| IT operations | incident evidence and remediation draft | exact runbook step | execute one approved change |
| Content publishing | draft, metadata, checks | exact revision | publish one version |

These are transfer hypotheses. Regulated or safety-critical deployments require authenticated policy enforcement, server-side transactionality, logging, and domain review beyond this prototype.

## Adoption path

1. Start with read-only WebMCP tools and local drafts.
2. Instrument task completion, correction rate, and coordinator time.
3. Add authenticated human approval stored transactionally.
4. Issue short-lived exact-object capabilities for a single sandboxed write.
5. Add policy, role, and dual-control rules where required.
6. Expand only when measured task quality and user trust improve.

## Thirty-second judge explanation

“Service coordinators stitch together history, qualifications, availability, price, and a final dispatch system. Agents can prepare that work, but a prompt saying ‘wait for approval’ does not change their actual authority. This page does. Five WebMCP tools prepare an exact draft; a human approval creates one hash-bound commit capability for 120 seconds; one successful action destroys it. The value is faster coordination without leaving a broad write tool permanently available.”

## Evidence boundary

There are no production users, revenue claims, market-size claims, saved-hours claims, or external integrations in this repository. The impact case is a testable product hypothesis supported by a technically complete reference interaction.
