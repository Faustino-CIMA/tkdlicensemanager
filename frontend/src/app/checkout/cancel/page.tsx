import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const supportedLocales = new Set(["en", "lb"]);

export default async function CheckoutCancelRedirect() {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("NEXT_LOCALE")?.value ?? "";
  const locale = supportedLocales.has(localeCookie) ? localeCookie : "en";
  redirect(`/${locale}/checkout/cancel`);
}
