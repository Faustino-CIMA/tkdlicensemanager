import createMiddleware from "next-intl/middleware";

const intlMiddleware = createMiddleware({
  locales: ["en", "lb"],
  defaultLocale: "en",
});

export default function middleware(request: Request) {
  const response = intlMiddleware(request);
  return response;
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
