"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { OpsLayout } from "@/components/ops/ops-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionNotices } from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import {
  downloadOpsTranslationExport,
  getOpsTranslationMeta,
  getOpsTranslations,
  saveOpsTranslationBatch,
  type TranslationPageSummary,
  type TranslationRow,
} from "@/lib/ops-api";

type Drafts = Record<string, { en: string; lb: string }>;

function previewHref(path: string | null, locale: string) {
  if (!path) return null;
  return path.replace("{locale}", locale);
}

function groupRows(rows: TranslationRow[]) {
  const groups: Array<{ id: string; label: string; rows: TranslationRow[] }> = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.id === row.section) {
      last.rows.push(row);
    } else {
      groups.push({ id: row.section, label: row.section_label, rows: [row] });
    }
  }
  return groups;
}

function fieldRows(value: string) {
  if (value.includes("\n") || value.length > 90) {
    return 4;
  }
  if (value.length > 48) {
    return 2;
  }
  return 1;
}

export default function OpsTranslationsPage() {
  const t = useTranslations("Ops");
  const locale = useLocale();
  const [pages, setPages] = useState<TranslationPageSummary[]>([]);
  const [namespace, setNamespace] = useState<string>("");
  const [rows, setRows] = useState<TranslationRow[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [query, setQuery] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [readingView, setReadingView] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingPage, setIsLoadingPage] = useState(false);

  const currentPage = pages.find((page) => page.id === namespace) ?? null;
  const screenHref = previewHref(currentPage?.preview_path ?? null, locale);

  const loadMeta = useCallback(async () => {
    const meta = await getOpsTranslationMeta();
    setPages(meta.pages);
    setNamespace((current) => {
      if (current && meta.pages.some((page) => page.id === current)) {
        return current;
      }
      const firstMissing = meta.pages.find((page) => page.missing_lb > 0);
      return firstMissing?.id || meta.pages[0]?.id || "";
    });
  }, []);

  const loadPage = useCallback(
    async (nextNamespace: string) => {
      if (!nextNamespace) return;
      setIsLoadingPage(true);
      setErrorMessage(null);
      try {
        const response = await getOpsTranslations({ namespace: nextNamespace });
        setRows(response.results);
        const nextDrafts: Drafts = {};
        response.results.forEach((row) => {
          nextDrafts[row.key] = { en: row.en, lb: row.lb };
        });
        setDrafts(nextDrafts);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("loadError"));
      } finally {
        setIsLoadingPage(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadMeta().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : t("loadError"));
    });
  }, [loadMeta, t]);

  useEffect(() => {
    if (!namespace) return;
    void loadPage(namespace);
  }, [loadPage, namespace]);

  const dirtyCount = useMemo(() => {
    return rows.filter((row) => {
      const draft = drafts[row.key];
      if (!draft) return false;
      return draft.en !== row.en || draft.lb !== row.lb;
    }).length;
  }, [drafts, rows]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const draft = drafts[row.key] ?? { en: row.en, lb: row.lb };
      if (missingOnly && draft.lb.trim()) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return (
        row.key.toLowerCase().includes(needle) ||
        draft.en.toLowerCase().includes(needle) ||
        draft.lb.toLowerCase().includes(needle)
      );
    });
  }, [drafts, missingOnly, query, rows]);

  const groups = useMemo(() => groupRows(visibleRows), [visibleRows]);

  const changePage = (next: string) => {
    if (next === namespace) return;
    if (dirtyCount > 0 && !window.confirm(t("translationsUnsavedConfirm"))) {
      return;
    }
    setQuery("");
    setMissingOnly(false);
    setReadingView(false);
    setNamespace(next);
  };

  const updateDraft = (key: string, localeKey: "en" | "lb", value: string) => {
    setDrafts((current) => ({
      ...current,
      [key]: {
        en: current[key]?.en ?? "",
        lb: current[key]?.lb ?? "",
        [localeKey]: value,
      },
    }));
  };

  const onSavePage = async () => {
    const changes: Array<{ locale: "en" | "lb"; key: string; value: string }> = [];
    rows.forEach((row) => {
      const draft = drafts[row.key];
      if (!draft) return;
      if (draft.en !== row.en) {
        changes.push({ locale: "en", key: row.key, value: draft.en });
      }
      if (draft.lb !== row.lb) {
        changes.push({ locale: "lb", key: row.key, value: draft.lb });
      }
    });
    if (changes.length === 0) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await saveOpsTranslationBatch(namespace, changes);
      setSuccessMessage(t("translationsSavedPage", { count: changes.length }));
      await Promise.all([loadMeta(), loadPage(namespace)]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("saveError"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <OpsLayout title={t("translationsTitle")} subtitle={t("translationsSubtitle")}>
      <ActionNotices
        error={errorMessage}
        success={successMessage}
        onDismiss={() => {
          setErrorMessage(null);
          setSuccessMessage(null);
        }}
      />

      <div className="grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="app-panel h-fit p-3 xl:sticky xl:top-4">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {t("translationsPages")}
          </p>
          <ul className="flex flex-col gap-1">
            {pages.map((page) => {
              const active = page.id === namespace;
              return (
                <li key={page.id}>
                  <button
                    type="button"
                    onClick={() => changePage(page.id)}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 rounded-[var(--radius-control)] px-3 py-2 text-left text-sm",
                      active ? "bg-secondary font-semibold text-foreground" : "text-muted hover:bg-secondary/60",
                    )}
                  >
                    <span>
                      <span className="block">{page.title}</span>
                      <span className="block text-xs font-normal text-muted">
                        {t("translationsStringCount", { count: page.string_count })}
                      </span>
                    </span>
                    {page.missing_lb > 0 ? (
                      <StatusBadge label={String(page.missing_lb)} tone="danger" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="min-w-0">
          <div className="app-panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-foreground">{currentPage?.title ?? namespace}</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted">{currentPage?.description}</p>
                <p className="mt-2 text-sm text-muted">
                  {t("translationsStringCount", { count: rows.length })}
                  {currentPage && currentPage.missing_lb > 0
                    ? ` · ${t("translationsMissingCount", { count: currentPage.missing_lb })}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {screenHref ? (
                  <Button asChild variant="outline">
                    <a href={screenHref} target="_blank" rel="noreferrer">
                      {t("translationsOpenScreen")}
                    </a>
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => setReadingView((value) => !value)}>
                  {readingView ? t("translationsEditView") : t("translationsReadingView")}
                </Button>
                <Button variant="outline" onClick={() => void downloadOpsTranslationExport("en")}>
                  {t("exportEn")}
                </Button>
                <Button variant="outline" onClick={() => void downloadOpsTranslationExport("lb")}>
                  {t("exportLb")}
                </Button>
                <Button variant="primary" onClick={() => void onSavePage()} disabled={isSaving || dirtyCount === 0}>
                  {isSaving ? t("saving") : t("translationsSavePage", { count: dirtyCount })}
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="min-w-[12rem] flex-1">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("translationsSearchInPage")}
                />
              </div>
              <label className="flex min-h-[var(--control-height)] items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={missingOnly}
                  onChange={(event) => setMissingOnly(event.target.checked)}
                />
                {t("missingLbOnly")}
              </label>
            </div>
          </div>

          {isLoadingPage ? (
            <p className="mt-4 text-sm text-muted">{t("loading")}</p>
          ) : visibleRows.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t("translationsEmptyPage")}</p>
          ) : readingView ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <article className="app-panel p-5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{t("englishLabel")}</h3>
                {groups.map((group) => (
                  <section key={`en-${group.id}`} className="mt-5">
                    <h4 className="text-sm font-semibold text-foreground">{group.label}</h4>
                    <div className="mt-2 space-y-3 text-sm leading-relaxed text-foreground">
                      {group.rows.map((row) => (
                        <p key={`en-copy-${row.key}`}>{drafts[row.key]?.en || "—"}</p>
                      ))}
                    </div>
                  </section>
                ))}
              </article>
              <article className="app-panel p-5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{t("luxembourgishLabel")}</h3>
                {groups.map((group) => (
                  <section key={`lb-${group.id}`} className="mt-5">
                    <h4 className="text-sm font-semibold text-foreground">{group.label}</h4>
                    <div className="mt-2 space-y-3 text-sm leading-relaxed text-foreground">
                      {group.rows.map((row) => {
                        const value = drafts[row.key]?.lb || "";
                        return (
                          <p key={`lb-copy-${row.key}`} className={value.trim() ? "" : "text-[var(--danger)]"}>
                            {value.trim() ? value : t("missingLb")}
                          </p>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </article>
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-[var(--radius-card)] border border-border bg-[var(--surface)]">
              <div className="sticky top-0 z-10 hidden grid-cols-[minmax(9rem,14rem)_1fr_1fr] border-b border-border bg-[var(--surface)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
                <span>{t("translationsOnScreen")}</span>
                <span>{t("englishLabel")}</span>
                <span>{t("luxembourgishLabel")}</span>
              </div>
              {groups.map((group) => (
                <section key={group.id} className="border-b border-border last:border-b-0">
                  <h3 className="bg-[var(--surface-secondary)] px-4 py-2 text-sm font-semibold text-foreground">
                    {group.label}
                  </h3>
                  <ul>
                    {group.rows.map((row) => {
                      const draft = drafts[row.key] ?? { en: row.en, lb: row.lb };
                      const dirty = draft.en !== row.en || draft.lb !== row.lb;
                      return (
                        <li
                          key={row.key}
                          className={cn(
                            "grid gap-3 border-t border-border/70 px-4 py-3 md:grid-cols-[minmax(9rem,14rem)_1fr_1fr]",
                            row.missing_lb && !draft.lb.trim() ? "bg-[color-mix(in_oklab,var(--danger)_6%,white)]" : "",
                          )}
                        >
                          <div className="min-w-0">
                            <p className="break-all text-sm font-medium text-foreground">{row.local_key}</p>
                            {dirty ? (
                              <p className="mt-1 text-xs font-medium text-accent">{t("translationsDirty")}</p>
                            ) : null}
                            {row.placeholders.length > 0 ? (
                              <p className="mt-1 text-xs text-muted">
                                {t("translationsKeepPlaceholder")} {row.placeholders.join(" ")}
                              </p>
                            ) : null}
                            {row.en_overridden || row.lb_overridden ? (
                              <p className="mt-1 text-xs text-accent">{t("overridden")}</p>
                            ) : null}
                          </div>
                          <label className="block min-w-0 text-sm md:text-inherit">
                            <span className="mb-1 block text-xs font-medium text-muted md:hidden">
                              {t("englishLabel")}
                            </span>
                            <textarea
                              className="w-full resize-y rounded-[var(--radius-form)] border border-[var(--border)] bg-[var(--field-background)] px-3 py-2 text-sm leading-relaxed text-[var(--field-foreground)]"
                              rows={fieldRows(draft.en)}
                              value={draft.en}
                              onChange={(event) => updateDraft(row.key, "en", event.target.value)}
                            />
                          </label>
                          <label className="block min-w-0 text-sm md:text-inherit">
                            <span className="mb-1 block text-xs font-medium text-muted md:hidden">
                              {t("luxembourgishLabel")}
                            </span>
                            <textarea
                              className="w-full resize-y rounded-[var(--radius-form)] border border-[var(--border)] bg-[var(--field-background)] px-3 py-2 text-sm leading-relaxed text-[var(--field-foreground)]"
                              rows={fieldRows(draft.lb || draft.en)}
                              value={draft.lb}
                              onChange={(event) => updateDraft(row.key, "lb", event.target.value)}
                            />
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </OpsLayout>
  );
}
