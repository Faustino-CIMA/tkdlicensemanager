Executive Summary
Static deep review of the backend render/print pipeline found 4 P1 and 4 P2 issues.
No clear P0 (immediate hotfix) was identified.

Highest-risk items are:

print jobs cannot express/render non-front side (dual-side contract gap),
queue enqueue failure can leave jobs stuck in queued,
duplicate task delivery can re-run the same job concurrently,
URL normalization differs between preview and worker rendering, causing preview/print parity breaks for relative media paths.
Findings (Ordered by Severity)
P1-1 — Dual-side print side is not modeled; execution always uses default front
Repro: Create a dual-side template with distinct front/back content; verify back side via preview-card-pdf (side=back); create/execute print job; artifact renders front because print flow never passes side.
Impact/Risk: Wrong-side prints, blank/mismatched artifacts for back-only designs; fails required dual-side consistency.
Suspected root cause: PrintJob has no side field, PrintJobCreateSerializer has no side input, and execute_print_job_now() calls build_preview_data() without side.
File/symbol: backend/licenses/models.py / PrintJob; backend/licenses/card_serializers.py / PrintJobCreateSerializer; backend/licenses/print_jobs.py / execute_print_job_now.

print_jobs.py
Lines 296-305
preview_payloads.append(
    build_preview_data(
        template_version=print_job.template_version,
        member_id=item.member_id,
        license_id=item.license_id,
        club_id=print_job.club_id,
        include_bleed_guide=bool(print_job.include_bleed_guide),
        include_safe_area_guide=bool(print_job.include_safe_area_guide),
        bleed_mm=print_job.bleed_mm,
        safe_area_mm=print_job.safe_area_mm,
    )
)
P1-2 — Enqueue failure can strand jobs in queued
Repro: Induce broker/queue failure (e.g., Redis unavailable), call /execute or /retry; status is already committed to queued, then apply_async fails.
Impact/Risk: Job can become permanently “in progress” from API perspective; repeated execute/retry may noop due guarded transitions.
Suspected root cause: _queue_print_job() commits state transition before task submit and has no exception rollback/recovery path.
File/symbol: backend/licenses/card_views.py / _queue_print_job.

card_views.py
Lines 921-957
if locked_job is not None:
    locked_job.status = PrintJob.Status.QUEUED
    # ...
    locked_job.save(...)
# ...
execute_print_job_task.apply_async(
    args=[locked_job.id, user.id if user is not None else None],
    queue=getattr(settings, "CELERY_PRINT_JOB_QUEUE", "print_jobs"),
)
P1-3 — Duplicate task delivery can re-enter execution for same job
Repro: Trigger duplicate delivery/concurrent invocation of execute_print_job_now() for same print_job_id.
Impact/Risk: Double heavy render work, inflated execution_attempts, noisy audit trail, avoidable race pressure.
Suspected root cause: Start-of-execution guard only exits on cancelled or succeeded+artifact; it does not short-circuit if already running.
File/symbol: backend/licenses/print_jobs.py / execute_print_job_now.
P1-4 — Preview/print URL resolution parity break for relative media paths
Repro: Use image source resolving to relative URL (not embedded data URI), especially merge-driven URLs like club logo; preview works, worker artifact may miss image.
Impact/Risk: Preview and printed artifact differ; production print reliability issue.
Suspected root cause: _normalize_source_url() only absolutizes leading /... when request is present; preview endpoints pass request, worker path calls build_preview_data() without request and renders with FRONTEND_BASE_URL base URL.
File/symbol: backend/licenses/card_rendering.py / _normalize_source_url; backend/licenses/card_views.py / preview_*; backend/licenses/print_jobs.py / execute_print_job_now.

card_rendering.py
Lines 489-517
def _normalize_source_url(source: str, request: HttpRequest | None) -> str:
    # ...
    if parsed_source.scheme:
        if parsed_source.scheme not in {"http", "https"}:
            return ""
        return normalized_source
    if normalized_source.startswith("/") and request is not None:
        return request.build_absolute_uri(normalized_source)
    return normalized_source
P2-1 — Security policy allows arbitrary http/https fetch in render path
Repro: Put external/internal host URL into image source; renderer accepts and fetches during HTML->PDF.
Impact/Risk: SSRF-style network reachability from render worker (bounded by who can author templates, but still a hardening gap).
Suspected root cause: _normalize_source_url() accepts any http/https URL, no host allowlist/protocol hardening beyond basic scheme blocklist.
File/symbol: backend/licenses/card_rendering.py / _normalize_source_url.
P2-2 — Equal-z_index ordering tie-break includes id, risking designer parity drift
Repro: Two elements with same z_index, reorder in designer; backend may reorder by id instead of pure array order.
Impact/Risk: subtle layer ordering mismatch between canvas and rendered output.
Suspected root cause: _sorted_design_elements() sort key (z_index, id, index).
File/symbol: backend/licenses/card_rendering.py / _sorted_design_elements.
P2-3 — PDF download path can 500 on storage desync
Repro: Artifact file removed from storage while DB still points to it; call /print-jobs/{id}/pdf/.
Impact/Risk: endpoint error instead of controlled 404/audit path.
Suspected root cause: print_job.artifact_pdf.open("rb") is not wrapped in storage error handling.
File/symbol: backend/licenses/card_views.py / PrintJobViewSet.pdf.
P2-4 — Large-job performance pressure from repeated per-item render preparation
Repro: Bulk print jobs with many items.
Impact/Risk: DB/query amplification and CPU overhead (per-item payload normalization/validation/context assembly).
Suspected root cause: execute_print_job_now() calls build_preview_data() per item; build_preview_data() redoes validation/entity and asset/context work each call.
File/symbol: backend/licenses/print_jobs.py / execute_print_job_now; backend/licenses/card_rendering.py / build_preview_data.
Mini UAT/Repro Matrix (Step 5 outcome)
Based on code-path analysis + existing tests in backend/licenses/test_cards.py (not re-executed in Ask mode):

Preview parity (data/html/pdf, same payload+side): Mostly pass (shared preview builder, side support validated).
Sheet preview partial slots + invalid/out-of-range: Pass (validation and rejection paths present/tested).
Print create -> execute -> download -> history: Pass in nominal path.
Cancel mid-run + retry: Partial (basic flow covered; enqueue-failure and duplicate-delivery windows not covered).
Dual-side print jobs + selected side consistency: Fail (print side not modeled; defaults front).
Role enforcement (Club Admin vs LTF Admin): Pass for documented endpoints and scope checks.
Test Coverage Gaps
No test for print-job side selection/back-side rendering.
No test for task enqueue failure rollback/recovery.
No test for duplicate task delivery idempotency under concurrent execution.
No test for storage-missing artifact behavior in /pdf/.
No load/perf test for large batch print jobs (memory/query profile).
No security test for remote URL allowlist/blocking policy in render fetches.
Created Report Path
Target path: docs/license-card-v2-step5-review-b.md
Not created because this session is in Ask mode (read-only).
P0 Hotfixes Applied
None (no clear P0 found; Ask mode also prevents code edits).
Proposed Step 6 Remediation Backlog (Small, Testable)
Add side field to PrintJob + PrintJobCreateSerializer, propagate into build_preview_data(), add dual-side print tests.
In _queue_print_job(), wrap apply_async failures; revert state (or mark failed) with audit event + actionable error.
Add RUNNING/QUEUED idempotency guard at start of execute_print_job_now() (or advisory lock keyed by print_job_id).
Unify URL resolution between preview and worker paths (explicit backend media base URL; avoid implicit frontend base for assets).
Introduce render URL allowlist (CARD_RENDER_ALLOWED_HOSTS) and deny internal/private ranges by default.
Adjust layer sort tie-break to preserve insertion order for equal z_index (drop id tie-break), add parity test.
Harden /print-jobs/{id}/pdf/ with storage exception handling and graceful 404 + audit.
Add targeted perf test/benchmark for large jobs; cache invariant template/asset resolution across items per execution.
Validation commands (python manage.py test licenses.test_cards --keepdb --noinput, python manage.py check, targeted lifecycle tests) were not run in Ask mode.

Ready for Step 6 delegation.