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
