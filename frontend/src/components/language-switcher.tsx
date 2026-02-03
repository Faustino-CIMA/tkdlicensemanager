"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LanguageSwitcher() {
  const t = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const handleLocaleChange = (value: string) => {
    if (value === locale) {
      return;
    }
    const safePath = pathname || "/";
    const segments = safePath.split("/");
    if (segments.length > 1) {
      segments[1] = value;
    } else {
      segments.push(value);
    }
    const nextPath = segments.join("/") || `/${value}`;
    router.push(nextPath);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-zinc-500">{t("languageLabel")}</span>
      <Select value={locale} onValueChange={handleLocaleChange}>
        <SelectTrigger className="w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="en">{t("languageEnglish")}</SelectItem>
          <SelectItem value="lb">{t("languageLux")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
