import createMiddleware from "next-intl/middleware";

const intlMiddleware = createMiddleware({
  locales: ["en", "lb"],
  defaultLocale: "en",
});

export default function middleware(request: Request) {
  const requestUrl = new URL(request.url);
  // #region agent log
  fetch("http://127.0.0.1:7242/ingest/8fff0ab0-a0ae-4efd-a694-181dff4f138a", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: "admin-redirect",
      hypothesisId: "H1_H2_H3",
      location: "frontend/middleware.ts:entry",
      message: "Middleware received request",
      data: {
        pathname: requestUrl.pathname,
        host: requestUrl.host,
        protocol: requestUrl.protocol,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const response = intlMiddleware(request);
  // #region agent log
  fetch("http://127.0.0.1:7242/ingest/8fff0ab0-a0ae-4efd-a694-181dff4f138a", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: "admin-redirect",
      hypothesisId: "H1",
      location: "frontend/middleware.ts:exit",
      message: "Middleware produced response",
      data: {
        pathname: requestUrl.pathname,
        status: response.status,
        redirectLocation: response.headers.get("location") ?? "",
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  return response;
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
