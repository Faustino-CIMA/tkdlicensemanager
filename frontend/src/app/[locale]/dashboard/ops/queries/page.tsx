"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { EntityTable } from "@/components/club-admin/entity-table";
import { OpsLayout } from "@/components/ops/ops-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionNotices } from "@/components/ui/list-page-chrome";
import {
  downloadOpsQueryCsv,
  getOpsQueryCatalog,
  runOpsQuery,
  type OpsQueryResult,
  type OpsQuerySpec,
} from "@/lib/ops-api";

export default function OpsQueriesPage() {
  const t = useTranslations("Ops");
  const [catalog, setCatalog] = useState<OpsQuerySpec[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<OpsQueryResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const selected = useMemo(
    () => catalog.find((item) => item.id === selectedId) ?? null,
    [catalog, selectedId],
  );

  const load = useCallback(async () => {
    setErrorMessage(null);
    try {
      const response = await getOpsQueryCatalog();
      setCatalog(response.results);
      if (response.results[0] && !selectedId) {
        setSelectedId(response.results[0].id);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("loadError"));
    }
  }, [selectedId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    const next: Record<string, string> = {};
    selected.params.forEach((param) => {
      next[param.name] = String(param.default ?? "");
    });
    setParamValues(next);
    setResult(null);
  }, [selected]);

  const parsedParams = () => {
    const output: Record<string, string | number> = {};
    selected?.params.forEach((param) => {
      const raw = paramValues[param.name] ?? "";
      output[param.name] = param.type === "integer" ? Number(raw) : raw;
    });
    return output;
  };

  const onRun = async () => {
    if (!selected) return;
    setIsRunning(true);
    setErrorMessage(null);
    try {
      setResult(await runOpsQuery(selected.id, parsedParams()));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("saveError"));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <OpsLayout title={t("queriesTitle")} subtitle={t("queriesSubtitle")}>
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="app-panel p-3">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("queryCatalog")}</p>
          <ul className="flex flex-col gap-1">
            {catalog.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`w-full rounded-[var(--radius-control)] px-3 py-2 text-left text-sm ${
                    item.id === selectedId ? "bg-secondary font-semibold text-foreground" : "text-muted hover:bg-secondary/60"
                  }`}
                  onClick={() => setSelectedId(item.id)}
                >
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          {selected ? (
            <>
              <h2 className="text-lg font-semibold text-foreground">{selected.title}</h2>
              <p className="mt-1 text-sm text-muted">{selected.description}</p>
              {selected.params.length > 0 ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {selected.params.map((param) => (
                    <label key={param.name} className="text-sm">
                      <span className="mb-1 block text-muted">{param.name}</span>
                      <Input
                        value={paramValues[param.name] ?? ""}
                        onChange={(event) =>
                          setParamValues((current) => ({ ...current, [param.name]: event.target.value }))
                        }
                      />
                    </label>
                  ))}
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-3">
                <Button variant="primary" onClick={() => void onRun()} disabled={isRunning}>
                  {isRunning ? t("running") : t("runQuery")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void downloadOpsQueryCsv(selected.id, parsedParams())}
                >
                  {t("downloadCsv")}
                </Button>
              </div>
            </>
          ) : null}

          {result ? (
            <div className="mt-6">
              <p className="mb-3 text-sm text-muted">{t("rowCount", { count: result.row_count })}</p>
              <EntityTable
                columns={result.columns.map((column) => ({
                  key: column,
                  header: column,
                  render: (row: Record<string, unknown> & { id: string }) => String(row[column] ?? ""),
                }))}
                rows={result.rows.map((row, index) => ({ ...row, id: String(index) }))}
              />
            </div>
          ) : null}
        </div>
      </div>
    </OpsLayout>
  );
}
