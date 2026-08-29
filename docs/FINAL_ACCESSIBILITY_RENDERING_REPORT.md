# Final Accessibility, Rendering, and Performance Review

## Result

**Application-level PASS, native/manual caveats retained.** The capability proof is operable with keyboard, responsive from 320 to 1920px, non-color-dependent, and announced as a concise 5 → 6 → 5 live status. The final candidate still needs its own native-Chrome gate and a human screen-reader/video-scale review before publication.

## Checks

| Area | Evidence | Result |
| --- | --- | --- |
| Keyboard-only | Playwright completes Run → Approve → Commit → Reset using Tab/Enter | Pass |
| Tab order | The native DOM order is exercised without a keyboard trap: one Tab moves Run → Approve after draft creation, and keyboard navigation reaches Commit and Reset | Pass |
| Focus visibility | `:focus-visible` uses a 2px cyan outline with 3px offset; E2E inspects it | Pass |
| Accessible names | E2E uses role/name locators for every action; headings label regions | Pass |
| Responsive table semantics | At 320px, Playwright still resolves the comparison as one table with four semantic rows and its Decision column header despite the card-style CSS layout | Pass in headless Chromium |
| Button semantics | Native buttons; disabled state is application-derived and registry-gated | Pass |
| Touch targets | Initial visible `.app-shell` buttons at 320 and 390px, plus draft and approved action states at 320px, are asserted ≥44px | Pass |
| Status semantics | Error is `role=alert`; registry lifecycle uses atomic polite `role=status` | Pass |
| Live registry announcement | One atomic polite region announces five/absent, six/human-created, and five/revoked strings without making the full tool list live | Pass |
| Scrollable audit access | Named Audit Log list is focusable, receives `:focus-visible`, and remains after the decision controls in DOM tab order | Pass |
| Reduced motion | 1280 E2E disables the tool-row animation and verifies `animationName: none` | Pass |
| Forced colors | Dedicated Chromium media-emulation test completes the core proof | Pass in headless Chromium |
| 200% scale | Dedicated Chromium page-scale check retains registry, focus, draft, and no horizontal overflow | Pass as page-scale proxy; human browser zoom remains advisory |
| Color-independent state | Counts, words, borders, tool names, row number 06, and revoke copy accompany color | Pass |
| Contrast | Representative text/background ratios: primary 17.03:1; soft 9.10:1; dim 5.99:1; cyan 8.07:1; amber 6.65:1; green 7.46:1; red 5.70:1; approval label on amber surface 6.65:1 | Pass for tested pairs |
| Advisory axe scan | Existing transitive `axe-core` scanned production-build desktop and 320px initial/draft/approved/committed, plus unsupported desktop/320px, for WCAG 2 A/AA and 2.1 A/AA after repairs | Zero reported violations in all ten state/viewport checks |
| 320 / 360 / 390 | Full lifecycle at 320, focused 390 flow, and eight-width sweep | Pass |
| 768 / 1024 / 1280 / 1440 / 1920 | Eight-width sweep plus dedicated desktop states | Pass |
| First mobile viewport | Actual registry heading and five-tool count are asserted inside 320×800 and 390×844 initial viewports | Pass |
| 1280×720 first viewport | Vehicle context, draft status, actual-registry heading, and the approval action are asserted inside the first viewport after preparation | Pass |
| Long provider/rationale/error | 320px injected long tokens wrap without element clipping or page overflow | Pass |
| Proof-detail readability | Provider exclusion reasons, decision labels, exact-hash binding, the fictional-data notice, the error-dismiss action, and mobile comparison labels were raised selectively without changing the hierarchy; focused desktop/320/390 lifecycle flows still fit and pass | Pass in tested viewports |
| Horizontal overflow | Asserted at every tested width and long-text state | Pass |
| Hydration/runtime | E2E records console errors, page errors, and hydration/uncaught strings | Pass in automated harness |
| Production unsupported boundary | Separate production-server headless load returned HTTP 200, correct English title/heading, unavailable badge, disabled Run, no dev portal, no external request, and no console/page/request failure | Pass without injecting a WebMCP harness |
| Layout stability | Fixed client clock, stable skeleton/state layout, screenshot review, no desktop vertical page growth after draft, and production-build lab input-excluded shift sums of 0.026831 at 1440px / 0.083861 at 320px | Pass for tested states; lab observations, not field CLS |
| Timer/listener/subscription cleanup | Focused unit tests, Strict Mode remount tests, 100 cleanup cycles, Reset races | Pass in application adapters |
| `getTools()` frequency | Event-driven reads with generation cancellation and finite 25/50ms or failure retries | Bounded |
| Long-session growth | 100 lifecycles, 100 resets, 100 start/stop cycles, and 40 fixed-seed sweeps retain exact 5/6 registry invariants | Pass in deterministic adapters |
| Production payload | Latest static build: initial HTML 12,078 bytes raw / 3,854 gzip; route client entries 75,145 raw / 19,237 gzip; CSS 33,092 raw / 7,676 gzip (`zlib.gzipSync`, files compressed separately) | No public source map, external initial-document URL, or static file over 1 MiB |

## Visual inspection

The refreshed desktop initial/draft/approved/committed/reset, 1280 draft, 390 mobile, and 320 mobile screenshots were inspected directly. The approval-created sixth row and post-use revoke are legible in one desktop frame. On both mobile captures, browser-truth capability evidence precedes the decision and context panels.

## Honest limits

- No axe dependency or permanent axe gate was added. One local advisory scan used the already installed transitive package; direct name/role/state/behavior tests remain the reproducible evidence, and neither method is a full WCAG audit.
- Forced-colors and 200% checks are headless Chromium application evidence, not a Windows high-contrast or assistive-technology session.
- Secondary dense table metadata remains intentionally compact; the lifecycle thesis, counts, controls, tool names, exclusion reasons, exact-hash proof, and evidence-boundary notice received priority.
- Payload figures are local production-build artifacts, not field-transfer or Core Web Vitals measurements; shared framework chunks are not attributed to the route-client subtotal.
- No production-user Core Web Vitals, memory profile, or native-engine leak trace exists; the recorded headless shift sums are lab diagnostics only.
