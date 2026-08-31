# Browser artifacts

## Real-agent evidence — 2026-08-31

**CODEX + OFFICIAL CHROME DEVTOOLS FOR AGENTS.** The real model selected and executed `get_active_vehicle` → `get_service_history` → `search_qualified_providers` → `check_provider_availability` → `create_dispatch_draft` → **human exact-draft approval** → `commit_approved_dispatch` on the public page. Recorded model-issued registry checks confirmed **5 → 6 → 5**. The runner and test adapter were not used. Reset was not verified through this route.

The [verification record](../docs/real-agent-verification.md) supplies prompt, tool arguments, dates, versions, registry results, and limitations. Original page-only captures are in `real-agent-2026-08-31/`:

- `draft-five.png`: model-created unsubmitted draft; five tools.
- `human-approved-six.png`: human approval between draft and commit; only `commit_approved_dispatch` added.
- `committed-five.png`: Codex executed the approved tool once; capability revoked; five tools.

The visible app runner controls were not used in this run. Screenshots show page state; the recorded model activity establishes who executed the tools. These are edited-selection stills, not an uninterrupted recording. No AI-generated imagery was used.

## Native Chrome evidence

These four PNGs were captured on 2026-08-27 from the [public deployment](https://agentic-service-dispatch.vercel.app) in Chrome **151.0.7922.174** with WebMCP testing enabled. The page badge reads **Native WebMCP available** and the capability panel displays the live `getTools()` result.

- `native-chrome-initial.png` — five baseline tools; commit capability absent.
- `native-chrome-approved.png` — approval-created tool 06; six live tools.
- `native-chrome-committed.png` — one exact commit; tool 06 revoked; five live tools.
- `native-chrome-reset.png` — exact five-tool baseline restored after Reset.

The same session completed two consecutive Resets and captured no Chrome error-level log entries. These screenshots are native implementation evidence, not a claim of general browser conformance.

## Final candidate — human native record

Exact candidate source `ef35cfc` passed a separate uninterrupted human-operated Chrome 151.0.7922.174 **5 → 5 → 6 → 5 → Reset → 5** gate on 2026-08-30. Its written [identity and evidence boundary](../docs/final-candidate-native-evidence.md) is separate from the immutable public-v1 native stills, the 2026-08-31 real-agent captures above, and the automated final-candidate images below. No screenshot from the August 30 manual gate is committed here; the later real-agent captures do not replace that gate or prove its Reset path.

## Historical public-v1 application evidence — archive record

Public v1 generated five `desktop-*` / `mobile.png` files with the visibly labeled Playwright WebMCP test harness. They exercised the shared adapter contract and domain lifecycle without claiming the production native adapter or browser-engine verification. Their hashes remain in the historical [verification evidence](../docs/verification-evidence.md).

Those five old application screenshots are excluded from this release. This paragraph is a historical hash pointer rather than an index of shipped files. The eight source-labeled final-candidate images below replace them as current application evidence; the four native public-v1 files above remain the separate engine record.

Playwright fixes its test-only clock at 2026-08-27 10:00 JST, before the selected fictional 13:00 slot, before navigation. Content and layout are deterministic, but byte-identical PNG output is not assumed across separate capture processes because screenshot timing and font rasterization can differ. Every intentional evidence refresh therefore requires a fresh visual inspection and hash update.

## Final candidate — automated application evidence

`final-candidate/playwright/` contains eight screenshots from the dedicated headless Playwright profile against a production build at the isolated local test URL. Every page is visibly labeled **WebMCP test adapter**, and the capability panel identifies its source as the injected test harness via `getTools()`. These files prove application behavior, layout, and the injected registry lifecycle; they do not prove the final candidate in native Chrome. Production-mode capture also keeps Next.js development chrome out of the evidence.

| File | SHA-256 |
| --- | --- |
| `desktop-initial.png` | `0095d3e916cba414a2b916aedc5bbc0b5b916b9e47d28e1c5a227cd13534a374` |
| `desktop-draft.png` | `3726d4587ac13025303cb8e108a552104a0a8b4daa84d7e110bb1c1b07ef4bcf` |
| `desktop-approved.png` | `f2965d9641bdcb1b0c44d0a00cfa71586c680f7af0f2fc140bafa38b49e7513f` |
| `desktop-committed.png` | `53be6d27666defb66ac516f2c0f891baf29b36484cb819ee1365cfe9d30340ad` |
| `desktop-reset.png` | `e1aed2498058dd3908a1b8b91e7a5c55d65a11b62fc14ab3d0e768f7aec58c4c` |
| `desktop-1280-draft.png` | `c5e04c5d38fc3d49b5cdfba70de8efac89ca84adaaac811e11a85fae6590bfd2` |
| `mobile.png` | `9b48b63de28a6fd18d3dd9abd80949af43509011b196fdc0162630a335944b05` |
| `mobile-320-draft.png` | `f90c10090a61bdc9629b42d04f3a88b20d5e8c5fae0d14ce419b33e2e29250f8` |

On the 390px and 320px captures, the actual registry count and tool names are now inside the first viewport. Any later final-candidate native screenshots must use a separate name and label; never overwrite public-v1 native evidence.
