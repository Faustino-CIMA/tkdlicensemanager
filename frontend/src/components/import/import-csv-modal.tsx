"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { confirmImport, previewImport, ImportRow } from "@/lib/import-api";

type FieldOption = {
  key: string;
  label: string;
  required?: boolean;
};

type ClubOption = {
  id: number;
  name: string;
};

type ImportCsvModalProps = {
  isOpen: boolean;
  onClose: () => void;
  type: "clubs" | "members";
  title: string;
  subtitle: string;
  fields: FieldOption[];
  clubOptions?: ClubOption[];
  fixedClubId?: number | null;
  onComplete?: () => void;
};

export function ImportCsvModal({
  isOpen,
  onClose,
  type,
  title,
  subtitle,
  fields,
  clubOptions = [],
  fixedClubId,
  onComplete,
}: ImportCsvModalProps) {
  const t = useTranslations("Import");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<ImportRow[]>([]);
  const [actions, setActions] = useState<Record<number, "create" | "skip">>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [dateFormat, setDateFormat] = useState("YYYY-MM-DD");
  const [selectedClubId, setSelectedClubId] = useState<number | null>(
    fixedClubId ?? (clubOptions[0]?.id ?? null)
  );

  const requiredFields = fields.filter((field) => field.required);

  const resetState = () => {
    setFile(null);
    setHeaders([]);
    setMapping({});
    setPreviewRows([]);
    setActions({});
    setErrorMessage(null);
    setIsLoading(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFileChange = async (selectedFile: File | null) => {
    if (type === "members" && !selectedClubId) {
      setErrorMessage(t("selectClubRequired"));
      return;
    }
    setFile(selectedFile);
    setErrorMessage(null);
    setPreviewRows([]);
    setActions({});
    if (!selectedFile) {
      return;
    }
    try {
      setIsLoading(true);
      const preview = await previewImport(
        type,
        selectedFile,
        undefined,
        selectedClubId ?? undefined,
        type === "members" ? dateFormat : undefined
      );
      setHeaders(preview.headers);
      const autoMapping = buildAutoMapping(fields, preview.headers);
      setMapping(autoMapping);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("previewFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (fixedClubId && fixedClubId !== selectedClubId) {
      setSelectedClubId(fixedClubId);
    }
  }, [fixedClubId, selectedClubId]);

  useEffect(() => {
    if (!fixedClubId && clubOptions.length > 0 && !selectedClubId) {
      setSelectedClubId(clubOptions[0].id);
    }
  }, [clubOptions, fixedClubId, selectedClubId]);

  const mappingComplete = useMemo(() => {
    return requiredFields.every((field) => mapping[field.key]);
  }, [mapping, requiredFields]);

  const runPreview = async () => {
    if (!file || !mappingComplete) {
      return;
    }
    setErrorMessage(null);
    try {
      setIsLoading(true);
      const preview = await previewImport(
        type,
        file,
        mapping,
        selectedClubId ?? undefined,
        type === "members" ? dateFormat : undefined
      );
      setPreviewRows(preview.rows ?? []);
      const defaultActions = (preview.rows ?? []).reduce<Record<number, "create" | "skip">>(
        (acc, row) => {
          acc[row.row_index] = "create";
          return acc;
        },
        {}
      );
      setActions(defaultActions);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("previewFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const runImport = async () => {
    if (!file || !mappingComplete) {
      return;
    }
    setErrorMessage(null);
    try {
      setIsLoading(true);
      const actionList = Object.entries(actions).map(([rowIndex, action]) => ({
        row_index: Number(rowIndex),
        action,
      }));
      await confirmImport(
        type,
        file,
        mapping,
        actionList,
        selectedClubId ?? undefined,
        type === "members" ? dateFormat : undefined
      );
      onComplete?.();
      handleClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("importFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal title={title} description={subtitle} isOpen={isOpen} onClose={handleClose}>
      <div className="space-y-6">
        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

        {type === "members" && !fixedClubId ? (
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("clubLabel")}</label>
            <Select
              value={selectedClubId ? String(selectedClubId) : ""}
              onValueChange={(value) => setSelectedClubId(Number(value))}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("selectClubPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {clubOptions.map((club) => (
                  <SelectItem key={club.id} value={String(club.id)}>
                    {club.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {type === "members" ? (
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("dateFormatLabel")}</label>
            <Select value={dateFormat} onValueChange={setDateFormat}>
              <SelectTrigger>
                <SelectValue placeholder={t("dateFormatPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                <SelectItem value="DD-MM-YYYY">DD-MM-YYYY</SelectItem>
                <SelectItem value="DD.MM.YYYY">DD.MM.YYYY</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-700">{t("fileLabel")}</label>
          <input
            type="file"
            accept=".csv"
            onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
          />
        </div>

        {headers.length > 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600">{t("mappingTitle")}</p>
            <div className="grid gap-4 md:grid-cols-2">
              {fields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <label className="text-sm font-medium text-zinc-700">
                    {field.label}
                    {field.required ? " *" : ""}
                  </label>
                  <Select
                    value={mapping[field.key] ?? ""}
                    onValueChange={(value) =>
                      setMapping((prev) => ({ ...prev, [field.key]: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectColumnPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map((header) => (
                        <SelectItem key={header} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={runPreview} disabled={!file || !mappingComplete}>
            {t("previewButton")}
          </Button>
          <Button onClick={runImport} disabled={!file || previewRows.length === 0}>
            {t("importButton")}
          </Button>
        </div>

        {previewRows.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-zinc-600">{t("previewTitle")}</p>
            <div className="max-h-64 overflow-auto rounded-md border border-zinc-200">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left">
                  <tr>
                    <th className="p-2">{t("rowLabel")}</th>
                    <th className="p-2">{t("dataLabel")}</th>
                    <th className="p-2">{t("errorsLabel")}</th>
                    <th className="p-2">{t("actionLabel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.row_index} className="border-t border-zinc-100">
                      <td className="p-2">{row.row_index}</td>
                      <td className="p-2 text-xs text-zinc-600">
                        {Object.entries(row.data)
                          .filter(([, value]) => value)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(", ")}
                      </td>
                      <td className="p-2 text-xs text-red-600">
                        {row.errors.join(", ")}
                        {row.duplicate ? ` ${t("duplicateHint")}` : ""}
                      </td>
                      <td className="p-2">
                        <Select
                          value={actions[row.row_index] ?? "create"}
                          onValueChange={(value) =>
                            setActions((prev) => ({
                              ...prev,
                              [row.row_index]: value as "create" | "skip",
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="create">{t("createAction")}</SelectItem>
                            <SelectItem value="skip">{t("skipAction")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function buildAutoMapping(fields: FieldOption[], headers: string[]) {
  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());
  return fields.reduce<Record<string, string>>((acc, field) => {
    const index = normalizedHeaders.indexOf(field.key.toLowerCase());
    if (index >= 0) {
      acc[field.key] = headers[index];
    }
    return acc;
  }, {});
}
