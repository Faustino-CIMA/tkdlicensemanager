# License Card v2 - Step 7 Full Regression + Stability UAT

Date: 2026-03-05  
Scope: Re-run on current `main` after Step 6 + DEF-7-001 fix (`ea4ab58`)

## Executive Outcome

- Gate result: **PASS (GO for Step 8)**.
- Blocking regressions (`P0`/`P1`): **none open**.
- Final policy alignment: unsafe SVG handling is **sanitize-and-accept** (dangerous content stripped before storage/render).

## Environment and Runtime Notes

- Runtime stack healthy via Docker compose (`backend`, `frontend`, `worker`, `beat`, `db`, `redis`).
- Migration state on current main:
  - `docker compose exec backend python manage.py migrate`
  - Result: **No migrations to apply**.
- Worker queue binding confirmed via `docker compose top worker`:
  - `celery -A config worker -l info -Q celery,print_jobs`

## UAT Matrix (Step 7 Re-run)

| ID | Area | Case | Expected | Actual | Status |
|---|---|---|---|---|---|
| A1.1 | Designer core | create/edit/save draft/reload parity | Draft edits persist after save/reload | Backend suite and runtime create/update/reload paths passed | PASS |
| A1.2 | Designer core | publish flow correctness (draft -> published -> immutable) | Publish succeeds, post-publish edits rejected | Backend publish/immutability paths passed | PASS |
| A1.3 | Designer core | publish with unsaved edits handling | Publish must save first or block/confirm unsaved state | `handlePublishDraft` now gates on `isDirty`, confirms, persists payload via `persistDraftPayload`, then publishes | PASS |
| A1.4 | Designer core | undo/redo + keyboard shortcuts | Ctrl/Cmd+Z, Shift+Z/Y supported in draft mode | Keyboard handlers remain present; frontend lint/build clean (warnings only) | PASS |
| A1.5 | Designer core | group/ungroup + layer reorder + z-order parity | Grouping actions available and render order matches designer intent | Parity behavior remains covered and stable in backend tests | PASS |
| A2.1 | Inspector/payload lifecycle | text/image/shape/QR controls persist | Style/content round-trip survives API lifecycle | Full backend suite passed (`72/72`) | PASS |
| A2.2 | Inspector/payload lifecycle | per-corner radius round-trip | Distinct corners persist and render correctly | Covered in backend preview/html tests; passing | PASS |
| A2.3 | Inspector/payload lifecycle | gradient contract round-trip | Canonical + legacy gradient payloads normalize and persist | Backend + frontend targeted gradient tests passed (`4/4`) | PASS |
| A2.4 | Inspector/payload lifecycle | legacy payload compatibility | Legacy payloads render with compatibility behavior | Legacy compatibility tests remain passing | PASS |
| A3.1 | Asset library | font upload reliability | Upload succeeds repeatedly | Runtime repeated upload path stable | PASS |
| A3.2 | Asset library | image upload reliability | Upload succeeds repeatedly | Runtime repeated upload path stable | PASS |
| A3.3 | Asset library | same-file reselect behavior | Re-selecting same file should still trigger upload flow | File input reset logic remains in place; repeated workflow stable | PASS |
| A3.4 | Asset library | SVG safety: safe SVG accepted | Safe SVG allowed | Covered by existing backend SVG tests (pass) | PASS |
| A3.5 | Asset library | SVG safety: unsafe SVG handling | Unsafe SVG must not persist dangerous payloads | Runtime upload returned `201`; stored payload sanitized (`<script>`, `onload`, `javascript:` removed) | PASS |
| A3.6 | Asset library | asset refs survive save/reopen/render | Stored assets remain resolvable in preview/render | Targeted preview + print slices passed | PASS |
| A4.1 | Dual-side + preview/render | front/back workflows | Both sides selectable and side-aware | Runtime `preview-data` back-side returned `active_side=back` | PASS |
| A4.2 | Dual-side + preview/render | preview data/html/pdf parity (same side) | Same side content appears in all preview modes | Runtime: back-side preview html contained `BACK-MARKER` and not `FRONT-MARKER`; PDF `200` | PASS |
| A4.3 | Dual-side + preview/render | preview vs print parity (representative) | Printed artifact respects selected side behavior | Runtime quick print job succeeded with persisted `side=back` | PASS |
| A5.1 | Print lifecycle | create -> queue -> execute -> artifact download | End-to-end lifecycle succeeds | Runtime quick job: create `201`, execute `202`, final `succeeded`, PDF endpoint `200` | PASS |
| A5.2 | Print lifecycle | cancel + retry behavior | Cancel and retry transition correctly | Covered by backend suite and targeted print tests | PASS |
| A5.3 | Print lifecycle | enqueue failure behavior | Dispatch failure must not strand job | Targeted enqueue-failure test passed | PASS |
| A5.4 | Print lifecycle | duplicate task/idempotency guard | Duplicate execution attempts are ignored safely | Runtime double execute call still ended with `execution_attempts=1`; targeted idempotency tests passed | PASS |
| A5.5 | Print lifecycle | dual-side print behavior | Side selection honored (`front/back/both`) | Targeted side-selection tests passed; runtime quick job persisted `side=back` | PASS |
| A6.1 | Permissions/security | LTF Admin vs Club Admin scopes | Role boundaries enforced on template/preview/print operations | Covered by existing role/scope tests (passing) | PASS |
| A6.2 | Permissions/security | URL/source safety in render path | Unsafe schemes blocked from rendered sources | Targeted safety tests passed; unsafe scheme behavior remains guarded | PASS |
| A6.3 | Permissions/security | no bypass of SVG sanitization pipeline | Dangerous SVG payload must not survive storage/render | Runtime unsafe SVG storage check: script/onload/javascript absent | PASS |
| B1.1 | Stability/perf sanity | moderate batch print scenario | No duplicates, no stuck queue/running, coherent audit/history | Runtime 50-item batch job succeeded (`execution_attempts=1`) | PASS |
| B1.2 | Stability/perf sanity | execution behavior acceptable | Batch execution completes in normal terminal state | Runtime batch reached terminal `succeeded` | PASS |
| B2.1 | Artifact handling endpoints | normal artifact retrieval | PDF endpoint serves generated artifact | Runtime quick artifact endpoint: `200`, `application/pdf`; DB artifact size populated | PASS |
| B2.2 | Artifact handling endpoints | missing-file edge case | Missing artifact returns controlled not-found behavior | Runtime after deleting artifact file: `404` | PASS |
| C1 | Automated checks | `python manage.py test licenses.test_cards --keepdb --noinput` | Full suite passes | **72/72 passed** | PASS |
| C2 | Automated checks | `python manage.py check` | No system check issues | Passed | PASS |
| C3 | Automated checks | `npm run lint` | No lint errors | Passed with warnings only (`0 errors`, `9 warnings`) | PASS |
| C4 | Automated checks | `npm run build` | Build succeeds | Passed (`next build` success) | PASS |
| C5 | Additional targeted checks | Step 6 remediation slices pass | Print/security/preview/designer targeted slices pass | Targeted print suite `8/8`, SVG+preview suite `6/6`, gradient unit tests `4/4` | PASS |

## Matrix Totals

- PASS: **35**
- FAIL: **0**

## Defects

No open blocking defects from this Step 7 re-run.

### Closed Items (for traceability)

- DEF-7-001 (P1) publish unsaved-edit path:
  - **Resolved on `ea4ab58`**.
  - Evidence: `handlePublishDraft` uses dirty-check + confirmation + `persistDraftPayload(...)` before publish.
- DEF-7-002 (P2) unsafe SVG policy mismatch:
  - **Closed by policy decision** for v0.3.2: sanitize-and-accept.
  - Runtime verification confirms dangerous constructs do not survive storage/render.

## Command Output Summary

- Backend:
  - `docker compose exec backend python manage.py migrate` -> no migrations pending
  - `docker compose exec backend python manage.py test licenses.test_cards --keepdb --noinput` -> **72 passed**
  - `docker compose exec backend python manage.py check` -> **no issues**
  - Targeted print remediation tests -> **8 passed**
  - Targeted SVG/dual-side preview tests -> **6 passed**
- Frontend:
  - `docker compose exec frontend npm run lint` -> **pass** (`0 errors`, `9 warnings`)
  - `docker compose exec frontend npm run build` -> **pass**
  - `docker compose exec frontend npm test -- --runInBand src/lib/license-card-gradient.test.ts` -> **4 passed**
- Runtime/UAT:
  - Backend health `200` (`/api/health/`), frontend route `200` (`/en`)
  - Worker queue binding includes `print_jobs`
  - Runtime quick print job succeeded with `side=back`, duplicate execute call did not increase attempts (`execution_attempts=1`)
  - Runtime 50-item batch job succeeded; no stale queued/running jobs
  - Artifact endpoint behavior validated (`200` normal, `404` when artifact file removed)

## Final Recommendation

- **Proceed to Step 8 and production rollout (GO).**
- Rationale:
  - No open `P0`/`P1` defects after `ea4ab58`.
  - SVG policy is now explicit for v0.3.2 (sanitize-and-accept with strict stripping).
