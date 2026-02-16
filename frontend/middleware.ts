import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";

const intlMiddleware = createMiddleware({
  locales: ["en", "lb"],
  defaultLocale: "en",
});

export default function middleware(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const frontendBase = (process.env.FRONTEND_BASE_URL || "").trim();
  const forwardedHost = request.headers.get("x-forwarded-host") ?? "";
  const hostHeader = request.headers.get("host") ?? "";
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "";
  const publicHost = forwardedHost || hostHeader || requestUrl.host;
  const publicProto = forwardedProto || requestUrl.protocol.replace(":", "");
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
    const backendBase = (process.env.NEXT_PUBLIC_API_URL || "").trim();
    if (backendBase) {
      const adminTarget = new URL(requestUrl.pathname + requestUrl.search, backendBase).toString();
      return NextResponse.redirect(adminTarget, { status: 307 });
    }

    return NextResponse.next();
  }

  const response = intlMiddleware(request);

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
          if (frontendBase) {
            normalizedLocation = new URL(
              `${parsed.pathname}${parsed.search}${parsed.hash}`,
              frontendBase
            ).toString();
          } else {
            normalizedLocation = `${publicProto}://${publicHost}${parsed.pathname}${parsed.search}${parsed.hash}`;
          }
        }
      } catch {
        normalizedLocation = location;
      }
      if (normalizedLocation !== location) {
        response.headers.set("location", normalizedLocation);
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
