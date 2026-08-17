"use client";

import { useTranslations } from "next-intl";

type ModalProps = {
  title: string;
  description?: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export function Modal({ title, description, isOpen, onClose, children }: ModalProps) {
  const t = useTranslations("Common");

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] px-4">
      <div className="w-full max-w-xl rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--surface-foreground)] shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">{title}</h2>
            {description ? <p className="mt-2 text-sm text-[var(--muted)]">{description}</p> : null}
          </div>
          <button
            className="inline-flex min-h-[var(--control-height)] min-w-[var(--control-height)] shrink-0 items-center justify-center rounded-[var(--radius-form)] text-sm font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground)]"
            type="button"
            onClick={onClose}
          >
            <span className="sr-only">{t("modalClose")}</span>
            <span aria-hidden className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
