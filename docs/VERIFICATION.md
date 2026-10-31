# RIVET v2.0.0 — Public verification

**Deployment tested:** [https://rivet-career-lab.replit.app](https://rivet-career-lab.replit.app)  
**Version:** 2.0.0  
**Deployment type:** public, server-backed Replit Reserved VM  
**Acceptance run:** October 31, 2026

The workflow and browser checks below were run against the public deployment. The unit/integration suite was tested separately from production. The scenario and experience text were explicitly illustrative. Production run identifiers and source text are intentionally not included in this report's text; the screenshot gallery shows only the illustrative sample.

## Results

| Check | Result | Observed |
|---|---:|---|
| HTTP and anonymous access | PASS | Public URL returned HTTP 200; no sign-in required. `/api/health` reported version 2.0.0. |
| End-to-end illustrative analysis | PASS | Six requirements classified as 2 Direct, 1 Transferable, 2 Missing, and 1 Needs Clarification. |
| Source-backed Career Transition Brief | PASS | Three source-worded resume drafts, five interview talking points, and three practical next steps appeared after review. |
| Recorded workflow | PASS | 24 persisted events across 13 phases; timestamps, outcomes, and measured durations were visible, including PostgreSQL save operations. |
| Replay at all speeds | PASS | 0.5×, 1×, and 2× replayed the stored event set without a second analysis request. |
| Failure and retry | PASS | Simulated extraction failure was visibly stored with a measured 23 ms failed step; retry created a successful run without losing submitted input. |
| Refresh and compute restart | PASS | Saved runs and a reviewed correction remained in production PostgreSQL after a published compute restart. |
| Session privacy | PASS | A separate anonymous browser session could not read the first session's private run. |
| Different-input analysis | PASS | A second analysis with software-engineering input produced different requirements from the facilities scenario. |
| Desktop and mobile | PASS | Desktop views inspected; at 390 × 844, the workspace, evidence bridge, brief, and observatory had no horizontal overflow. |
| Browser console | PASS | No browser JavaScript errors during the public browser suite. |
| Automated unit/integration tests | PASS | 10 of 10 tests passed, including PostgreSQL persistence across server restart and session isolation. |
| Public browser acceptance suite | PASS | 11 of 11 checks passed. |
| Public final demonstration | PASS | 7 of 7 demonstration checks passed. |

## Repository packaging recheck

The exact GitHub source snapshot was tested with a newly initialized, disposable local PostgreSQL database, using `db/schema.sql` to create its empty schema. The full `npm test` suite passed: **10 tests, 10 passed, 0 failed, 0 skipped**, in **2,127.692372 ms**. This also verifies that the schema bootstrap supports the integration flow. Existing installed dependencies were used.

This packaging check did not connect to or write to the production database, restart the deployed application, or re-run public sample analyses. The public acceptance results above describe the earlier release-validation run.

### Measured replay timings

One 24-event public run was replayed at each speed. The browser measured:

| Replay speed | Measured replay time |
|---:|---:|
| 0.5× | 9,455 ms |
| 1× | 8,370 ms |
| 2× | 7,768 ms |

Exactly one analysis request was made to create that run; replay did not execute a new analysis.

## Limitations

- Requirement extraction and evidence matching are deterministic keyword/alias processing, not an AI model or hiring prediction.
- A successful fetch from a live third-party job board was not demonstrated in this acceptance run. Pasted job-description text was used; public sites may block fetching.
- The execution worker and live event registry are single-process. Multi-instance Autoscale is not supported without distributed work ownership and event delivery.
- Session privacy is browser-session scoped; the application does not provide account recovery or cross-device run access.
