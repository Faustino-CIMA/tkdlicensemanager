import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";

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
  const isRootPath =
    requestUrl.pathname === "/" ||
    requestUrl.pathname === "/en" ||
    requestUrl.pathname === "/en/";

  if (isAdminPath) {
    const entryPayload = {
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
    };
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/8fff0ab0-a0ae-4efd-a694-181dff4f138a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entryPayload),
    }).catch(() => {});
    console.log(JSON.stringify(entryPayload));
    // #endregion

    const bypassResponse = NextResponse.next();
    const bypassPayload = {
      runId: "admin-redirect-v2",
      hypothesisId: "FIX_H1",
      location: "frontend/middleware.ts:bypass",
      message: "Bypassing i18n middleware for admin path",
      data: {
        pathname: requestUrl.pathname,
        status: bypassResponse.status,
        redirectLocation: bypassResponse.headers.get("location") ?? "",
      },
      timestamp: Date.now(),
    };
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/8fff0ab0-a0ae-4efd-a694-181dff4f138a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bypassPayload),
    }).catch(() => {});
    console.log(JSON.stringify(bypassPayload));
    // #endregion
    return bypassResponse;
  }

  const response = intlMiddleware(request);

  if (isAdminPath || isRootPath) {
    const runId = isRootPath ? "frontend-root-route-v1" : "admin-redirect-v2";
    const exitPayload = {
      runId,
      hypothesisId: isRootPath ? "H1_H2_H3_H4" : "H1",
      location: "frontend/middleware.ts:exit",
      message: isRootPath
        ? "Root-path middleware response"
        : "Admin-path middleware response",
      data: {
        pathname: requestUrl.pathname,
        host: requestUrl.host,
        status: response.status,
        redirectLocation: response.headers.get("location") ?? "",
      },
      timestamp: Date.now(),
    };
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/8fff0ab0-a0ae-4efd-a694-181dff4f138a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exitPayload),
    }).catch(() => {});
    console.log(JSON.stringify(exitPayload));
    // #endregion
  }

  if (isRootPath) {
    const location = response.headers.get("location");
    if (location) {
      let normalizedLocation = location;
      try {
        const parsed = new URL(location);
        if (
          parsed.hostname === "localhost" ||
          parsed.hostname === "127.0.0.1" ||
          parsed.hostname === "0.0.0.0"
        ) {
          normalizedLocation = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
      } catch {
        normalizedLocation = location;
      }
      if (normalizedLocation !== location) {
        response.headers.set("location", normalizedLocation);
        const normalizedPayload = {
          runId: "frontend-root-route-v1",
          hypothesisId: "FIX_H4",
          location: "frontend/middleware.ts:normalize",
          message: "Normalized root redirect location away from loopback host",
          data: {
            pathname: requestUrl.pathname,
            originalLocation: location,
            normalizedLocation,
            status: response.status,
          },
          timestamp: Date.now(),
        };
        // #region agent log
        fetch("http://127.0.0.1:7242/ingest/8fff0ab0-a0ae-4efd-a694-181dff4f138a", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalizedPayload),
        }).catch(() => {});
        console.log(JSON.stringify(normalizedPayload));
        // #endregion
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
