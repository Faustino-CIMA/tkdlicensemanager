"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

type LtfFinanceLayoutProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export function LtfFinanceLayout({ title, subtitle, children }: LtfFinanceLayoutProps) {
  const t = useTranslations("LtfFinance");
  const pathname = usePathname();
  const locale = pathname?.split("/")[1] || "en";

  const navItems = [
    { href: `/${locale}/dashboard/ltf-finance/orders`, label: t("navOrders") },
    { href: `/${locale}/dashboard/ltf-finance/invoices`, label: t("navInvoices") },
    { href: `/${locale}/dashboard/ltf-finance/payments`, label: t("navPayments") },
    { href: `/${locale}/dashboard/ltf-finance/audit-log`, label: t("navAuditLog") },
  ];

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-3xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-zinc-900">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm text-zinc-500">{subtitle}</p> : null}
          <nav className="mt-6 flex flex-wrap gap-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-4 py-2 text-sm font-medium ${
                    isActive
                      ? "bg-zinc-900 text-white"
                      : "border border-zinc-200 text-zinc-700"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
        {children}
      </div>
    </main>
  );
}
