import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const supportedLocales = new Set(["en", "lb"]);

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CheckoutSuccessRedirect({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("NEXT_LOCALE")?.value ?? "";
  const locale = supportedLocales.has(localeCookie) ? localeCookie : "en";
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item) {
          query.append(key, item);
        }
      }
    } else if (value) {
      query.set(key, value);
    }
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  redirect(`/${locale}/checkout/success${suffix}`);
}
