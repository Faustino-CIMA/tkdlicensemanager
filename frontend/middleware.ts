import createMiddleware from "next-intl/middleware";

export default createMiddleware({
  locales: ["en", "lb"],
  defaultLocale: "en",
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
