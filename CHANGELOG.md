# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.5.0] - 2026-08-20

### User-facing
- **LTF lists:** Club Members chrome (filters, toolbars, pagination, expandable tables) now applies across LTF Admin and LTF Finance lists and forms.
- **Pending licenses:** Pending licenses are shown as current licenses, with history, member badges, and clearer order-license copy.
- **License availability:** License types can show an availability countdown. Types that are not sold for a year (for example Annual Standard in 2026) are marked unavailable.
- **Finance books:** LTF Finance can record expenses, set a year opening, and open year-end books (income statement and a simplified balance sheet), with Excel export for annual meetings.
- **LTF ID prefix:** LTF Admin can rewrite `LUX-` to `LTF-` on the LTF license ID during member import, and bulk-update existing LTF IDs. WT IDs stay unchanged. Club admins are told whether the rewrite is on.
- **LTF ID length:** New LTF license IDs use 4 digits (for example `LTF-0001`) and grow automatically when the number needs more digits.
- **What's new:** Sidebar version link opens `/{locale}/about` with the user-facing history from 0.5.0 back to 0.1.0, plus a GitHub releases link.

### Technical
- Expense ledger (`ExpenseCategory`, `Expense`) and `FinanceYearOpening`; accrual P&L and cash/AR/AP snapshot in `licenses/finance_reports.py` (Excel via openpyxl).
- `FederationProfile.rewrite_lux_prefix_on_member_import` and `POST /api/members/ltf-license-prefix-rewrite/`.
- `format_ltf_license_id` / `_next_available_ltf_license_id` use a 4-digit minimum and skip serials already stored as 6-digit IDs.
- Frontend `APP_VERSION` / `APP_RELEASES` drive the about page (`en` + `lb`).

## [0.4.0] - 2026-08-17

### User-facing
- **Visual refresh:** Softer athletic-fintech chrome — brand cyan, canvas/card contrast, and a radius scale (12px controls, 18px cards, pill chips) instead of 2px sharp boxes.
- **App shell:** Role dashboards use a left sidebar with icons and a quiet sticky top bar (title, club switcher, user, language). Tab strips are gone.
- **Overview cards:** Tinted KPI tiles with icons, a clearer action queue, and bar breakdowns for license/invoice/order mixes.
- **Login and home:** Split branded login and a lighter marketing home. Public pages use a slim header.
- **Members filters:** Status filters are pill buttons with live counts (HeroUI RadioGroup removed).
- **Import confirm:** “Only rows with action set to create…” is a yellow notice, not an alert.
- **Import wizard:** Step back button now shows “Previous” instead of the raw key `Common.previousPage`.
- **Home:** A signed-in visit to `/{locale}` shows role-based navigation instead of the public Sign in landing.
- **Club Members:** Active status controls are green; inactive stays the previous neutral tone.
- **Profile photo:** Use camera opens the device webcam via the browser camera permission, then lets the user take a photo. Choose file still opens the file picker.
- **Member grades:** Belt rank is no longer a free-text field on member create/edit. Grades are changed only from the Grades section, using the official Kup/Poom/Dan dropdown. Custom values such as “DAN 1” no longer appear in that list. A selected grade promotion can now be deleted; the member’s current belt rank is updated to the latest remaining official grade.
- **Page loading:** Fetching dashboard page data now shows a brand spinner above the existing “loading” message.
- **Club header switcher:** Club Admin (and Coach) always see one of their assigned clubs in the header dropdown. A leftover or invalid stored club ID no longer leaves the field blank.
- **LTF club filter:** The header club dropdown is hidden on LTF Overview, License cards, Print jobs, License types, Printer profiles, and Settings. On the remaining LTF pages it filters the listed data, with an **All clubs** option. **All clubs** is the default on LTF Admin pages.
- **Club Members filters:** Status pills show the count next to the title (e.g. All 34) instead of a second line of text.
- **Club Members toolbar:** Members and Actions sit on the same row as pagination. Actions is disabled until a row is selected. The batch-action hint is behind an exclamation icon (hover or click).
- **Club Members table:** The row pencil was removed. Open a member by clicking the row, then edit from the detail page. The row still has delete.
- **Club Licenses:** Toolbar, status pills, pagination, and table styling now match Club Members. Actions stays disabled until a license is selected.
- **Club Orders and Invoices:** Filter card, status pills with counts, page-size options, and pagination now match Club Members / Licenses.
- **Club IBAN bank lookup:** Luxembourg IBANs now use the official 3-digit bank code, so older accounts (especially Spuerkeess numbers starting with 9) are no longer mistaken for POST.
- **Club and LTF Settings logos:** Upload starts with a drop well and preview. Purpose (General, Invoice, Print, Digital) is explained, the selected-logo checkbox is shown once, and uploaded logos are grouped by purpose with a larger preview and a delete confirm.
- **License card designer:** The LTF designer is now a full-height design workspace (no sidebar). Tools, canvas, and inspector stay on screen. Preview/print controls open as a panel. Built-in print fonts (Inter, Source Sans 3, Source Serif 4, IBM Plex Mono, Barlow Condensed) are seeded as embeddable TTF assets. Designer chrome uses the same light surface, border, and muted icon tokens as the rest of the app. The top bar is grouped into document / side / history / save clusters. Preview & print is a full-screen panel with a **Back to designer** button. Spaces can be typed normally in Text controls.
- **LTF Finance club filter:** The header club dropdown is hidden on Finance Overview, Audit log, and License settings. Orders, Invoices, and Payments keep it as a club filter, including **All clubs**.

### Technical
- Design tokens live in `ltf_theme.css` / `globals.css` (`--radius-control`, `--radius-card`, `--shadow-card`, type scale).
- Shared `AppShell` + `AppChrome`; Club / LTF / Finance / Member layouts are thin nav adapters.
- Removed `@heroui/react` (only RadioGroup + RouterProvider were in use).
- Grade promotions now validate against the official belt-rank list. `DELETE /api/members/{id}/grade-history/{history_id}/` removes a promotion (bypassing the append-only model guard) and resyncs `member.belt_rank`.
- Shared `Spinner` for page-data loading; `EmptyState` accepts `loading` to show it above the existing message.
- Club header selection now validates the stored club ID against clubs returned for the current user and falls back to the first assigned club.
- LTF Admin header club control is route-aware (hidden on federation-wide pages) and treats `null` as “All clubs” on filter pages.
- Luxembourg IBAN bank lookup uses the official 3-digit bank code first. Existing club and federation `bank_name` values are re-derived in `clubs.0005_rederive_luxembourg_bank_names`.
- Club and LTF Settings share `BrandingLogosManager` for logo upload, purpose grouping, and delete confirm.
- Card designer workspace chrome lives in `AppShell` `variant="workspace"`. Built-in print faces are seeded by `manage.py seed_card_print_fonts` from `licenses/print_fonts/*.ttf`. The millimetre render/PDF path is unchanged.

## [0.3.9] - 2026-03-28

### User-facing
- **HeroUI v3.0.1:** The dashboard shell adopts HeroUI v3 with the existing LTF theme tokens, giving a cleaner, more consistent control surface without changing protected print or designer flows.
- **Sticky top bar:** The main top bar stays visible while scrolling so navigation and context remain at hand on long pages.
- **Stable tab navigation:** Club / LTF / Finance dashboard tabs no longer reorder or swap labels when switching sections.
- **Club Members page overhaul:** Status filtering uses a horizontal **RadioGroup** card control with **live total counts** (All / Active / Inactive). **Members** and **Actions** menus are clearer; toggling a member’s active status from the table asks for **confirmation** before applying. **Rows per page** options are **50**, **150**, **300**, and **All** (capped by the API’s maximum page size). Touch targets and card radii follow the sharp theme (`--radius-card`) and ~44px minimum hit areas where this pass touched the UI.
- **Member Import Step 3 UX improvement:** Orange **Review** status for invalid or non-matching license roles, inline dropdowns to fix **primary** and **secondary** roles, empty `secondary_license_role` treated as valid, same-role validation with a clear error message, and a confirmation dialogue before applying role changes.

### Technical
- Frontend: `@heroui/react` v3.0.1 integration with `HeroUIProvider`, theme alignment to `ltf_theme.css`, and incremental UI consistency (radii, spacing, focus rings) on updated surfaces.
- Club Members: server-backed facet counts for filter subtitles; persisted filter preference in `sessionStorage` with migration from legacy dual-switch storage; pagination helper respects `API_PAGINATION_MAX_PAGE_SIZE` for numeric and “All” page sizes.
- Navigation: layout/tab state fixes to prevent label flicker or order changes across dashboard variants.
- Import: `row_overrides` support in the member import confirm flow so Step 3 role corrections are applied on final import.

## [0.3.6] - 2026-03-14

### User-facing
- **Printer profiles (user-owned):** Club Admins can select their own printer profile when creating quick-print jobs (members, licenses, and quick-print page) and have a dedicated **Printer profiles** nav link and CRUD page at **Dashboard (club) → Printer profiles**. LTF Admins can create, edit, and delete their own printer profiles at **Dashboard (LTF) → Printer profiles**. Offsets (X/Y mm) are applied only in the final PDF output; designer canvas and live simulation are unchanged.
- Fixed member photo uploads that previously failed with generic errors.
- Fixed cases where a photo saved successfully but did not display afterward.
- Improved upload failure messages, including clearer feedback for server and size-related failures.

### Technical
- Backend: PrinterProfile model with `created_by` ownership; owner-scoped list/retrieve/update/delete and create; print job creation accepts only the caller’s profiles. Render offset applied in final PDF path only (`_apply_printer_offset_to_pdf`).
- Frontend: Printer profile API helpers and selection in Club Admin quick-print flows; LTF Admin CRUD page at `/dashboard/ltf/printer-profiles` and Club Admin CRUD page at `/dashboard/club/printer-profiles` (nav link shown only for Club Admin role), with create/edit/delete modals.
- Hardened backend photo processing and storage flow to tolerate partial derivative write failures while preserving required processed image saves.
- Increased upload-size limits and made frontend multipart uploads size-aware by skipping oversized optional original files.
- Added authenticated API endpoints for processed and thumbnail profile images to avoid reliance on direct `/media` routing.
- Improved container startup permission handling for media, static, and Celery beat storage paths in Docker Compose deployments.

## [0.3.5] - 2026-03-11

### User-facing
- Finalized SVG logo rendering reliability so uploaded SVG assets now appear consistently in the designer simulation and generated PDFs.
- Preserved simulation/PDF visual parity for typography and element placement to match print output more closely.
- Added support for the `current_grade` merge field in card templates and preview/print rendering.
- Reconfirmed LP798 geometry precision (85.00 x 55.00 mm card canvas and exact sheet placement contract) after the recovery/fix cycle.

### Technical
- Hardened SVG data-URI normalization and render-path embedding across preview, simulation, and PDF generation.
- Stabilized simulation refresh behavior to avoid stale iframe payloads after image/source updates.
- Extended regression coverage for real uploaded SVG assets and merge-field rendering consistency.
- Completed patch-release readiness for Card v2.1 + recovery closure on `v0.3.5`.

## [0.3.4] - 2026-03-07

### User-facing
- Card v2.1 Recovery Step 4 final gate is complete and release-ready.
- LP798 geometry placement and multi-image asset behavior were revalidated end-to-end (including SVG assets).
- Designer ruler/snap controls and simulation/PDF parity remain stable after recovery fixes.

### Technical
- Added final recovery UAT report with full matrix coverage in `docs/license-card-v2-1-recovery-step4-uat.md` (`23 PASS`, `0 FAIL`).
- Re-ran backend card regression suite (`licenses.test_cards`), runtime preview/simulation/PDF assertions, and print execution/duplicate-guard checks.
- Refreshed release runbooks and project memory for patch release rollout (`README.md`, `PROJECT_CONTEXT.md`, `docs/license-card-rollout-rollback-checklists.md`).

## [0.3.3] - 2026-03-06

### User-facing
- Card v2.1 precision/stability closure is complete with exact LP798 geometry parity across preview and print.
- Multi-image card designs now resolve selected uploaded image assets reliably (including SVG) across simulation/PDF/print.
- Designer merge fields now include `primary_license_role` and `secondary_license_role`, with locked date formatting applied consistently.

### Technical
- Enforced deterministic simulation refresh behavior and validated simulation/PDF font-size parity in regression coverage.
- Added/extended runtime and backend regression checks for LP798 slot geometry, role/date merge context, and print pipeline stability.
- Fixed multipart asset upload activation defaults by forcing omitted `is_active` to `true` on create and sending explicit `is_active: true` from the designer upload flow.
- Finalized v2.1 UAT gate documentation and rollout checklist updates for release `v0.3.3`.

## [0.3.2] - 2026-03-05

### User-facing
- License Card Designer v2 stability gate passed after remediation sprint and full regression/UAT rerun.
- Publishing a draft now protects unsaved in-memory edits before publish.
- Asset library upload flow is stable for repeated file-picker usage.

### Technical
- Closed P1 findings from deep review: dual-side print selection, enqueue failure stranding, duplicate execution guard, and preview/print parity hardening.
- Added/expanded print pipeline and preview regression coverage in `licenses.test_cards`.
- Enforced and documented SVG sanitize-and-accept policy with strict stripping of dangerous constructs before storage/render.
- Finalized v0.3.2 rollout and rollback runbooks for production operations.
