import { getRequestConfig } from "next-intl/server";

const supportedLocales = ["en", "lb"] as const;

async function loadBundled(locale: string) {
  return (await import(`../messages/${locale}.json`)).default;
}

async function loadMergedMessages(locale: string) {
  const bundled = await loadBundled(locale);
  const apiBase = (process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "").replace(
    /\/$/,
    "",
  );
  if (!apiBase) {
    return bundled;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${apiBase}/api/i18n/${locale}/`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!response.ok) {
      return bundled;
    }
    const payload = await response.json();
    if (payload && typeof payload === "object") {
      return payload;
    }
  } catch {
    return bundled;
  }
  return bundled;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) ?? "en";
  const safeLocale = supportedLocales.includes(locale as (typeof supportedLocales)[number])
    ? locale
    : "en";

  return {
    locale: safeLocale,
    messages: await loadMergedMessages(safeLocale),
  };
});
