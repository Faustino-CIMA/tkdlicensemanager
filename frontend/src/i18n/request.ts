import { getRequestConfig } from "next-intl/server";

const supportedLocales = ["en", "lb"] as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) ?? "en";
  const safeLocale = supportedLocales.includes(locale as (typeof supportedLocales)[number])
    ? locale
    : "en";

  return {
    locale: safeLocale,
    messages: (await import(`../messages/${safeLocale}.json`)).default,
  };
});
