"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";

import { apiRequest } from "@/lib/api";
import { clearToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

type MeResponse = {
  id: number;
  username: string;
  email: string;
  role: string;
  consent_given: boolean;
};

type ExportResponse = {
  user: Record<string, unknown>;
  member: Record<string, unknown> | null;
  licenses: Array<Record<string, unknown>>;
};

export default function PrivacySettingsPage() {
  const router = useRouter();
  const locale = useLocale();
  const [consentGiven, setConsentGiven] = useState(false);
  const [exportData, setExportData] = useState<ExportResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const response = await apiRequest<MeResponse>("/api/auth/me/");
        setConsentGiven(response.consent_given);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to load user");
      }
    };

    loadUser();
  }, []);

  const handleConsentChange = async (checked: boolean) => {
    setErrorMessage(null);
    setConsentGiven(checked);

    try {
      await apiRequest<MeResponse>("/api/auth/consent/", {
        method: "POST",
        body: JSON.stringify({ consent_given: checked }),
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update consent");
      setConsentGiven(!checked);
    }
  };

  const handleExport = async () => {
    setErrorMessage(null);
    try {
      const response = await apiRequest<ExportResponse>("/api/auth/data-export/");
      setExportData(response);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to export data");
    }
  };

  const handleDelete = async () => {
    setErrorMessage(null);
    try {
      await apiRequest("/api/auth/data-delete/", { method: "DELETE" });
      clearToken();
      router.push(`/${locale}/`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete data");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-3xl rounded-3xl bg-white p-10 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-900">Privacy & GDPR</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Manage your consent and data rights in line with GDPR.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <Checkbox checked={consentGiven} onCheckedChange={handleConsentChange} />
          <span className="text-sm text-zinc-700">I consent to data processing.</span>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button variant="outline" onClick={handleExport}>
            Export my data
          </Button>
          <Button variant="destructive" onClick={handleDelete}>
            Delete my data
          </Button>
        </div>

        {errorMessage ? <p className="mt-4 text-sm text-red-600">{errorMessage}</p> : null}

        {exportData ? (
          <div className="mt-6 rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
            <p className="text-sm font-medium text-zinc-700">Export preview</p>
            <pre className="mt-3 overflow-auto text-xs text-zinc-600">
              {JSON.stringify(exportData, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </main>
  );
}
