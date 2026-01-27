import Link from "next/link";
import { getTranslations } from "next-intl/server";

type HomePageProps = {
  params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Home" });

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="max-w-3xl rounded-3xl bg-white p-10 shadow-sm">
        <h1 className="text-3xl font-semibold text-zinc-900">{t("title")}</h1>
        <p className="mt-4 text-lg text-zinc-600">{t("subtitle")}</p>

        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href={`/${locale}/login`}
            className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white"
          >
            {t("signIn")}
          </Link>
          <Link
            href={`/${locale}/register`}
            className="rounded-full border border-zinc-200 px-5 py-2 text-sm font-medium text-zinc-900"
          >
            {t("createAccount")}
          </Link>
        </div>
      </div>
    </main>
  );
}
