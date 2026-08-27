# Public WebMCP Competition Landscape

Research checked on 2026-08-27. The Devpost [project gallery](https://webmcp.devpost.com/project-gallery) currently says projects have not been published, so no entrant claims can be verified yet. The comparison set therefore uses 10 OpenAI Showcase apps, 15 Chrome Labs demos, and 5 additional public examples listed by the W3C/Chrome community. It is a product-positioning survey, not a claim that these projects are challenge entrants.

Sources:

- [OpenAI WebMCP Showcase](https://developers.openai.com/showcase?view=webmcp-apps)
- [GoogleChromeLabs WebMCP tools and demos](https://github.com/GoogleChromeLabs/webmcp-tools)
- [GoogleChromeLabs Awesome WebMCP list](https://github.com/GoogleChromeLabs/webmcp-tools/blob/main/AWESOME_WEBMCP.md)
- [W3C community Awesome WebMCP list](https://github.com/webmachinelearning/awesome-webmcp)

Where a source does not publish tool count, schema, write semantics, or approval behavior, the table says not published rather than guessing.

## Thirty public examples

| # | Project | Use case and tool pattern | Interaction, R/W, sync | Approval | Visual / novelty | Likely strength | Visible weakness | Overlap with this project |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [Codex Modeling Studio](https://developers.openai.com/showcase/codex-modeling-studio) | Browser 3D modeling; 3 capabilities for scene inspection and change. | Shared 3D viewport; read + write implied; live scene sync. | Not documented. | WebGPU/WebAssembly creation surface. | High visual spectacle and agent collaboration. | Authority lifetime and destructive edit controls are not described. | Shared page and agent-visible change; no capability-gating overlap documented. |
| 2 | [Margin Editor](https://developers.openai.com/showcase/margin-editor) | Local notes; 10 tools, 3 read and 7 write. | Human and agent edit/comment in one document; explicit identity separation. | Not documented. | Agent comments under its own identity. | Clear collaboration model and strong tool breadth. | Permanent write surface appears broader than this project's narrow authority story. | Shared auditability and visible state. |
| 3 | [Crossword Desk](https://developers.openai.com/showcase/crossword-desk) | Crossword construction; 5 tools, 1 read and 4 write. | Agent builds grid and clues while human edits/solves. | Not documented. | Structured creative co-authoring. | Compact tool set with visible outcomes. | Lower operational consequence; approval lifecycle not described. | Five baseline tools and one-screen proof, but different authority model. |
| 4 | [Fieldwork // 12](https://developers.openai.com/showcase/ko-field-beat-machine) | Beat sequencer; 3 capabilities covering composition, groove, and sound shaping. | Shared audible/visual sequencer; write-heavy live sync. | Not documented. | Music creation and immediate playback. | Strong sensory hero moment. | Tool-level trust and irreversible action are less central. | Deterministic visible state transition only. |
| 5 | [WanderNote](https://developers.openai.com/showcase/wandernote) | Travel itinerary; 11 tools. | Agent imports context, edits itinerary/map, reads comments; read + write. | Human suggestions/comments, but capability approval not documented. | Map plus hourly plan. | Familiar useful workflow and rich shared state. | Broad planning category is crowded. | Booking/coordination adjacency and shared review. |
| 6 | [Webroom](https://developers.openai.com/showcase/webroom) | Photo editing; 28 tools, 4 read and 24 write. | Agent and human adjust one image with live visual sync. | Not documented. | Tool-rich browser-native editor. | Immediate visual payoff and breadth. | Large write catalog can dilute a single memorable protocol idea. | Shared canvas only; this project is deliberately narrower. |
| 7 | [Sunday Table](https://developers.openai.com/showcase/sunday-table) | Meal, recipe, grocery, and preference sync; count not published. | Shared plan/list editing; read + write implied. | Preserves human edits; capability approval not documented. | Multiple linked household artifacts. | Everyday impact and coherent sync. | No published authority or side-effect boundary. | Coordination and cross-record state. |
| 8 | [Cubecade](https://developers.openai.com/showcase/cubecade-rubiks) | 3D cube; 2 capabilities for state and move sequence. | Read cube, write queued moves, animate shared state. | Not documented. | Agent solves a manipulable 3D puzzle. | Extremely clear agent reasoning-to-action loop. | Game impact is narrow. | Small tool set and visible execution, not approval. |
| 9 | [Paperie](https://developers.openai.com/showcase/paperie) | Greeting-card canvas; 13 tools. | Agent supplies text/art and edits shared card; write-heavy. | Not documented. | Personalized creative canvas and preview. | Polished, emotional, highly visual. | Common co-creation pattern; authority semantics are secondary. | Shared review before an eventual action. |
| 10 | [Verdant Market](https://developers.openai.com/showcase/verdant-market) | Grocery catalog/cart; 9 tools. | Search/read products and mutate shared cart. | Checkout preview; commit approval not documented. | Dense realistic storefront. | Familiar commerce value and visible cart sync. | Search/cart demos are common and final purchase is intentionally avoided. | Provider search, constraints, local draft, staged final action. |
| 11 | React Flight Search | Flight search and selection; count/schema not published in the Chrome Labs index. | Structured search plus visible results; read + selection write implied. | Not published. | Travel result comparison. | Demonstrates reliability over DOM actuation. | Crowded booking-demo category. | Constraint search and provider/slot comparison. |
| 12 | Le Petit Bistro | Restaurant browsing/ordering; count not published. | Menu read plus order/cart state implied. | Not published. | Branded restaurant surface. | Direct consumer task completion. | Commerce CRUD pattern; authority lifetime not highlighted. | Draft-versus-commit adjacency. |
| 13 | zaMaker | Pizza configuration/order; count not published. | Configurator writes visible product state. | Not published. | Playful product builder. | Easy-to-understand multi-constraint task. | Final authority may look like a conventional checkout. | Constrained selection and staged action. |
| 14 | Mystery Doors | Choice-driven interactive story; count not published. | Agent inspects and changes game state. | Not published. | Narrative/game reveal. | Memorable interaction. | Limited operational impact. | State-machine clarity only. |
| 15 | WebMCP Maze | Maze navigation; count not published. | Agent reads maze state and issues moves. | Not published. | Spatial reasoning visualization. | Clear proof that structured tools beat clicking. | Primarily a protocol toy. | Deterministic auditability. |
| 16 | CineFlow | Movie discovery/selection; count not published. | Search/filter/read with saved selection implied. | Not published. | Media browsing surface. | Familiar recommendation workflow. | Recommendations can look like ordinary search. | Provider comparison only. |
| 17 | Order Tracking | Order status/support workflow; count not published. | Read-heavy lookup and support action implied. | Not published. | Operational timeline. | Real business relevance and structured state. | Less dramatic visual hero moment. | Service operations and audit trace. |
| 18 | L'Atelier Hotel | Hotel discovery/booking; count not published. | Search, room selection, booking state implied. | Not published. | Premium hospitality UI. | High-value multi-step consumer flow. | Another booking surface unless authorization is distinctive. | Availability, constraints, draft booking. |
| 19 | WebMCP Sports | Sports data/task demo; count not published. | Read-heavy structured retrieval; exact writes not published. | Not published. | Dashboard/data visualization. | Fast agent discovery and structured output. | Weaker human-in-the-loop story. | Evidence panel aesthetic only. |
| 20 | The Morning Ritual | Routine/content workflow; count not published. | Read and personalization writes implied. | Not published. | Lifestyle sequence. | Relatable daily automation. | Low-consequence actions weaken trust narrative. | Multi-tool sequence. |
| 21 | UrbanEstates | Real-estate search; count not published. | Filter/read listings and saved state implied. | Not published. | Map/listing comparison. | High-value complex search. | Search is common and transaction may remain outside the demo. | Hard constraints and ranked providers. |
| 22 | Luxe Leather | Product catalog/configuration; count not published. | Read products and cart/config writes implied. | Not published. | Rich commerce visuals. | Product polish. | Conventional storefront toolization. | Staged selection only. |
| 23 | Smart Home | Device state/control; count not published. | Read device state and issue visible control writes. | Not published. | Immediate physical-world analogue. | Strong consequence and state sync. | Safety depends on confirmation/authorization details not summarized. | High-consequence write boundary; closest conceptual adjacency. |
| 24 | Page Agent | General page-agent operations; count/schema not published. | Broad page interaction; R/W specifics not published. | Not published. | Generality rather than one vertical. | Demonstrates broad WebMCP applicability. | Breadth may reduce a single judge-memory hook. | Agent discoverability. |
| 25 | Explainer mini-site | WebMCP teaching/demo surface; count/schema not published. | Form/tool examples; state scope not published. | Not published. | Educational protocol transparency. | Low barrier to understanding the standard. | Not a strong end-user product story. | Protocol evidence and live registry explanation. |
| 26 | Shoe Store | Commerce catalog/cart example from the public awesome list; count not published. | Product read and cart writes implied. | Not published. | Storefront. | Simple discoverable task. | Commodity commerce pattern. | Search, budget, staged action. |
| 27 | Animal Viewer | Structured animal exploration; count not published. | Primarily read/navigation state. | Not published. | Visual learning surface. | Clear structured discovery. | Low side-effect stakes. | Little overlap beyond page tools. |
| 28 | React Chess | Chess state and moves; count not published. | Read board and write moves with shared state. | Not published. | Familiar strategic board. | Strong reasoning loop and visible correctness. | Game impact and authority are narrow. | One-time action validation only. |
| 29 | AI Audit | Page/audit workflow; count not published. | Read/analyze with report state; writes not published. | Not published. | Diagnostic evidence. | Trust and explainability. | May resemble a report generator more than shared action. | Audit-log orientation. |
| 30 | WebMCP × Excalidraw | Shared diagram canvas; count not published. | Read/write canvas operations and live visual sync. | Not published. | Freeform spatial co-creation. | Highly visual and flexible. | Broad canvas operations can obscure authorization semantics. | Shared human-agent surface, not capability lifetime. |

Items 11–25 are documented in the [GoogleChromeLabs repository](https://github.com/GoogleChromeLabs/webmcp-tools); items 26–30 are documented in its [public awesome list](https://github.com/GoogleChromeLabs/webmcp-tools/blob/main/AWESOME_WEBMCP.md) and the [W3C community list](https://github.com/webmachinelearning/awesome-webmcp).

## Common patterns

1. **Toolize familiar CRUD and search.** Catalogs, carts, bookings, itineraries, and editors dominate.
2. **Share a visible artifact.** Strong examples let the human and agent edit the same image, document, schedule, puzzle, or cart.
3. **Keep a broad stable tool catalog.** Public summaries emphasize what tools can do, not changes to whether authority exists.
4. **Use visual output as the hero.** 3D, images, audio, maps, and rich commerce create immediate spectacle.
5. **Treat approval as UI confirmation, when mentioned.** None of the reviewed public summaries documents approval dynamically registering a draft-bound one-time tool and then revoking it.

The final point is deliberately limited to published descriptions; it does not claim private implementation details.

## Crowded areas

- Travel, hospitality, commerce, carts, menus, and booking.
- Shared creative canvases.
- Search/filter/read plus conventional mutation tools.
- General “agent can use this UI” demonstrations.
- Large permanent catalogs of write tools.

## Underserved area

The clearest white space is **authority lifecycle as a first-class shared page object**:

- before approval, no commit capability exists;
- the human reviews one immutable object;
- approval changes the browser registry itself;
- the temporary schema cannot redirect the action;
- the capability expires or is consumed;
- the registry visibly returns from six tools to five.

## Where Agentic Service Dispatch overlaps

- A fixed, polished demo fixture rather than a production integration.
- Search, constraint checking, availability, and a staged operational action.
- A single-page shared state surface.
- A deterministic manual runner for repeatable proof.
- Visual evidence of tool execution and an audit log.

## Where it must remain decisively different

- Lead with **capability absence/presence/revocation**, not dispatch logistics.
- Show the actual getTools result continuously; never infer it from UI phase.
- Keep approval as a human-only action that creates authority, not another tool call.
- Bind the one-time tool to the exact draft hash and accept only the approval ID.
- Make 5 → 6 → 5 happen without a cut in the first minute of the video.
- Be honest that the runner is deterministic and that Playwright is not native conformance.

## Competitive conclusion

This project will not out-spectacle Webroom, Paperie, a 3D modeler, or a music sequencer. Its best Top 10 argument is narrower: it turns WebMCP from a convenient structured control layer into a visible, object-bound authorization mechanism. The submission wins only if judges understand that distinction in the first 30 seconds.
