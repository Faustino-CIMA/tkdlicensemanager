import createMiddleware from "next-intl/middleware";

const intlMiddleware = createMiddleware({
  locales: ["en", "lb"],
  defaultLocale: "en",
});

export default function middleware(request: Request) {
  const requestUrl = new URL(request.url);
  const isAdminPath =
    requestUrl.pathname === "/admin" ||
    requestUrl.pathname.startsWith("/admin/") ||
    requestUrl.pathname === "/en/admin" ||
    requestUrl.pathname.startsWith("/en/admin/");

  if (isAdminPath) {
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/8fff0ab0-a0ae-4efd-a694-181dff4f138a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "admin-redirect-v2",
        hypothesisId: "H1_H2",
        location: "frontend/middleware.ts:entry",
        message: "Admin-path request reached frontend middleware",
        data: {
          pathname: requestUrl.pathname,
          host: requestUrl.host,
          protocol: requestUrl.protocol,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }

  const response = intlMiddleware(request);

  if (isAdminPath) {
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/8fff0ab0-a0ae-4efd-a694-181dff4f138a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "admin-redirect-v2",
        hypothesisId: "H1",
        location: "frontend/middleware.ts:exit",
        message: "Admin-path middleware response",
        data: {
          pathname: requestUrl.pathname,
          status: response.status,
          redirectLocation: response.headers.get("location") ?? "",
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
