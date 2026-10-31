# RIVET — Release checklist

This checklist distinguishes verified development behavior from public-release verification. It is not evidence that publication has happened.

## Workspace and data
- [x] Run `npm test` and review actual pass/fail output.
- [x] Start `npm start` and verify `/api/health` and the RIVET preview.
- [x] Confirm run history and event logs use Replit managed PostgreSQL, with no startup DDL.
- [x] Confirm run and event reads remain scoped to their anonymous-session owner.
- [x] Verify source inputs, reviewed evidence map, brief, and event log survive refresh and server restart.

## End-to-end analysis
- [x] Run the requested illustrative manufacturing experience and pasted critical-facilities posting scenario.
- [x] Verify receive, validate, retrieve, extract, normalize, link, classify, brief, and save are recorded server operations with timestamps, outcomes, details, and measured durations where performed.
- [x] Confirm pasted job text records external retrieval as skipped, not as a successful network fetch.
- [x] Inspect the exact experience and posting excerpts for each supported requirement.
- [x] Verify Direct Evidence, Transferable Evidence, Missing Evidence, and Needs Clarification are distinguished.
- [x] Confirm no resume or interview statements appear before explicit human review.
- [x] Verify resume suggestions quote source text and transferable experience is not described as a direct qualification.
- [x] Download and inspect the Career Transition Brief.
- [x] Run a second analysis with different inputs and confirm the evidence map changes.

## Failure, retry, replay, and mobile
- [x] Submit the explicitly labeled simulated extraction failure and confirm the failed event, measured duration, and retained input.
- [x] Retry the failed run with simulation disabled and finish human review.
- [x] Select a persisted run and replay its actual event history at 0.5×, 1×, and 2×; pause and step through event details.
- [x] Refresh during review and after completion; verify the run and review gate restore from PostgreSQL.
- [x] Inspect the responsive interface at phone width and check that inputs, evidence review, brief, and replay controls remain usable.

## Preview approval and publication
- [x] Show the final working RIVET preview to the user and obtain explicit approval before publishing.
- [x] Configure **Reserved VM** for the single-process Node execution worker and PostgreSQL application; never static hosting.
- [x] Publish and copy the actual public Replit URL: https://rivet-career-lab.replit.app
- [x] Verify the public URL in fresh anonymous browsers and at phone width.
- [x] Repeat successful analysis, human review, brief generation, simulated failure, retry, replay, and refresh on the published version.
- [x] Verify production PostgreSQL run, event, and reviewed-correction persistence after the published compute restart.
- [x] Report the public URL and only the tests actually run on that public version.
