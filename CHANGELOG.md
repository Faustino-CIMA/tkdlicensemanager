# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.8.0] - 2026-09-04

### User-facing
- **Ops console:** Django superusers (`is_superuser`) sign in on the same frontend and land on `/{locale}/dashboard/ops`. Federation roles stay separate. The console shows who is signed in, dependency health, failed logins, lockouts, security alerts, users, a read-only query catalog, a screen-by-screen EN|LB translation editor, Celery/print/billing jobs, and an ops audit log.
- **Ops navigation:** Superusers get an **Ops console** button on federation dashboards and **Open federation dashboard** on ops. Sign out calls the logout API so the session disappears from “who is signed in.”
- **Club admins:** Club Admins can add other admins for their clubs on a rubber-band board (`/{locale}/dashboard/club/admins`). A member can only become admin of the club they belong to. The header club dropdown is hidden on that page; click a club in **Your clubs** to list its members. Coaches do not see this screen. A club must keep at least one admin.

### Technical
- New Django app `ops`: `AuthEvent`, `AuthTokenMeta`, `SecurityAlert`, `TranslationOverride`, `OpsAuditLog`; migration `ops.0001_ops_console`.
- `/api/ops/**` is gated on `IsSuperuser`. Login records success/failure, lockout (10 failures / 15 minutes), and token last-used. `GET /api/i18n/{locale}/` serves bundled messages plus overrides.
- Club Admin may call `admin_assignment`, `add_admin`, and `remove_admin` for clubs they administer, with `require_home_club` and `prevent_last_admin`.
- `docker-compose.yml`: backend, worker, and beat share image `ltf-license-manager-backend`; frontend messages are mounted read-only for the translation editor; `INTERNAL_API_URL` for server-side i18n fetch.

## [0.7.0] - 2026-09-03

### User-facing
- **Club fees:** LTF Finance Settings has a Club fees catalog (name, cadence, amount) and a Billing tab. Finance can invoice active clubs for those fees once, or on a monthly/annual schedule. Club fees are not licenses; paying a club-fee invoice does not create or activate a license.
- **Club status and language:** LTF Finance and LTF Admin can mark a club Active or Inactive. Inactive clubs are not billed. Clubs can set communication language (English or Luxembourgish) for emails.
- **Member pages:** Club and LTF member detail use a tab bar (Overview, Current license, Licenses history, Grades, Club movements).
- **Finance Settings:** Sidebar label is Settings, with tabs for License types, License prices, Club fees, and Billing.
- **Action messages:** Success and error toasts slide in from the top-right so they stay on screen when you are scrolled down.
- **LTF Finance club filter:** After login, Orders, Invoices, and Payments start on **All clubs**.
- **Audit log:** The list shows date, action, and message. Click a row to open a detail page with names, order/invoice links, and readable extra details (no raw IDs).
- **Buttons:** Everyday actions (Save, Create invoice, Add price) use a quiet gray fill. Brand cyan is for Sign in, Pay now, Record payment, and page-level Create.

### Technical
- `ClubFeeType`, `ClubFeePrice`, `ClubFeeBillingSchedule`; migrations `licenses.0034_club_fee_types`, `licenses.0035_club_fee_billing`.
- `Club.is_active`, `Club.communication_language`; migration `clubs.0009_club_active_and_language`.
- `POST /api/club-fee-billings/`, Celery `run_club_fee_billing_schedules`.
- `apply_payment_and_activate` skips order items without a license.
- Finance audit logs expose display names (`actor_name`, `club_name`, `order_number`, `metadata_display`).
- `ActionNotices` / `FloatingNotice`; Button `default` uses `--default`, `primary` is brand cyan.

## [0.6.4] - 2026-08-28

### User-facing
- **Club movement history:** Completed club changes stay with the member. LTF Admins can review frequent movers and clubs with high incoming or outgoing traffic. Members who reach the configured number of completed club changes are flagged as potential club tourists only; they are not restricted.
- **Club-tourist threshold:** LTF Settings controls how many completed club changes trigger the flag (default 3).
- **Order and invoice line items:** Member names on club and LTF Finance order/invoice details come from the license, so transferred members no longer show as Unknown member.

### Technical
- `FederationProfile.club_tourist_transfer_threshold` (migration `0008`).
- `GET /api/member-transfers/movements/` and `GET /api/members/{id}/club-transfers/`.
- Order items include `member_id`, `member_first_name`, `member_last_name`, and `member_ltf_licenseid`.

## [0.6.3] - 2026-08-28

### User-facing
- **Member import:** SimplyCompete `Membership End Date` is an optional helper column. It is not stored. When present, preview can skip members or import them as Active/Inactive by year.
- **License issue date:** Newly activated licenses (including those issued by an LTF admin) now get an issue date. Existing active licenses without one are backfilled.
- **Card preview:** If a member has no profile photo, the club logo is used as a faded photo fallback. Empty photo slots no longer show a dashed “No image” box. Card titles wrap more reliably on iPhone.

### Technical
- Import detects the helper header automatically (`detect_membership_end_date_header`) and does not map it as a member field.
- `License.save()` sets `issued_at` when status becomes ACTIVE; migration `0033_backfill_license_issued_at`.
- Club-logo photo fallback uses contain, light grey background, and 40% opacity. Card simulation sets `-webkit-text-size-adjust: none`.

## [0.6.2] - 2026-08-27

### User-facing
- **License card on member pages:** Club and LTF member Current licenses show the published Standard 3C card (print-accurate, sharp on 1× and retina) above the license table.
- **License roles:** Primary and secondary roles are stored capitalized (`Athlete`, `Coach`, …). Import still accepts mixed CSV casing (`athlete`, `ATHLETE`) and saves the capitalized value.

### Technical
- `GET /api/members/{id}/license-card-preview/` returns the published template simulation for the member's current license.
- Member card preview scales the millimetre canvas to the iframe (no 72/96 letterbox, no CSS-scaled iframe).
- `Member.canonicalize_license_role()` plus migration `0015_capitalize_member_license_roles`.

## [0.6.1] - 2026-08-25

### User-facing
- **Member transfers:** Club Admins can request a member move to another club (rubber-band). The receiving club must accept. Optional fee (0 is free). Club-to-club messages on the request. Active or pending licenses move with the member.
- **Transfer notice:** The receiving Club Admin sees an in-app notice on login, and **Review transfers** scrolls to Requests and messages.
- **First password:** The welcome/reset link prefills the username so a password manager can save both fields. Login is prefilled after Continue to login.
- **LTF:** Pending transfers with a fee appear on the LTF Transfers page and in the overview action queue.

### Technical
- `MemberTransfer` / `MemberTransferMessage` and `/api/member-transfers/`.
- Set-password URL includes `username=` for autocomplete.

## [0.6.0] - 2026-08-25

### User-facing
- **Club admins:** LTF Admin assigns club admins on a search-first board (pick a club or a member, then connect them). The Admins tab on the club detail page is gone.
- **Club email:** Each club can store an email. Invoice mail goes there, or to the club admins if none is set.
- **Welcome email:** New club admins receive a username and a set-password link (Resend in production, Mailpit locally).
- **Lists:** LTF Members, Licenses, and LTF Finance orders, invoices, and payments use the same flattened list chrome as Club Members.
- **Card templates:** License card templates can be exported and imported. Print PDFs no longer draw bleed or slot guides.
- **Checkout return:** After Stripe payment, the success page confirms the session and activates licenses before **Go to dashboard**.
- **Record payment:** LTF Finance records a payment on a full page instead of a modal.
- **Fund inflows:** LTF Finance can record other income (subsidies, donations, sponsoring, grants) on an Income register.

### Technical
- `Club.email`, `notification_emails()`, and `/api/clubs/admin_assignment/` plus capped `/api/clubs/admin_assignment_members/`.
- Mailpit in Compose; Resend when `RESEND_API_KEY` is real, otherwise Django SMTP.
- Card template transfer (`ltkdf.card-template`) and authenticated logo previews on the LTF club page.
- Frontend: Next.js 16.3.2, React 19.2.8, Tailwind 4.3.3 lockfile refresh. CI matches Docker (Python 3.13, PostgreSQL 18, Node 22).
- Millimetre print precision is unchanged.

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
