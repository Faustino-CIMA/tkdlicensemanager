# Frontend (LTF License Manager)

Next.js 16 App Router frontend for the LTF License Manager.

For complete project setup (Docker-first), environment variables, deployment notes, and troubleshooting, see the root `README.md`.

## Local frontend-only development

```bash
cd frontend
npm install
npm run dev
```

App URL: `http://localhost:3000`

Notes:
- Keep frontend and backend on the same host (`localhost` or `127.0.0.1`) to avoid CORS mismatch.
- CI validates this package with `npm run lint` and `npm run build`.

## License Card UI Runbook

LTF Admin pages:
- Template manager: `/{locale}/dashboard/ltf/license-cards`
- Designer: `/{locale}/dashboard/ltf/license-cards/{templateId}/designer`
- Print jobs: `/{locale}/dashboard/ltf/license-cards/print-jobs`

Club Admin pages:
- Print jobs history: `/{locale}/dashboard/club/print-jobs`
- Quick print: `/{locale}/dashboard/club/print-jobs/quick-print`

Quick print entry points:
- Members page stores selected member IDs and opens quick print:
  - `/{locale}/dashboard/club/members`
- Licenses page stores selected license IDs and opens quick print:
  - `/{locale}/dashboard/club/licenses`

The quick print page creates and executes a print job in one flow using:
- `POST /api/print-jobs/`
- `POST /api/print-jobs/{id}/execute/`

Print jobs pages support:
- status filtering/search,
- execute/retry/cancel actions,
- PDF download when status is `succeeded`.

License Card v2 designer capabilities:
- Dual-side editing (`front` / `back`) with side switch, flip side, and copy side actions.
- Side-aware preview requests (`preview-data`, card/sheet PDF, and live simulation HTML).
- Live print simulation toggle and manual refresh from the designer preview panel.
- Undo/redo history stack and precision layout tools (align, duplicate, nudge with keyboard shortcuts).
- Publish flow now protects unsaved changes by persisting draft payload before publish (v0.3.2 stabilization).
- Asset upload flow supports reliable same-file reselect behavior in the designer asset library.

Relevant frontend API client helpers (`src/lib/license-card-api.ts`):
- `getCardTemplateVersionPreviewData()`
- `getCardTemplateVersionCardPreviewPdf()`
- `getCardTemplateVersionSheetPreviewPdf()`
- `getCardTemplateVersionCardPreviewHtml()`
- `createPrintJob()`, `executePrintJob()`, `retryPrintJob()`, `cancelPrintJob()`, `downloadPrintJobPdf()`
