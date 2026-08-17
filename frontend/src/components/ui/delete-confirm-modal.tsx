"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type DeleteConfirmModalProps = {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  listTitle?: string;
  listItems?: string[];
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeleteConfirmModal({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel,
  listTitle,
  listItems,
  onConfirm,
  onCancel,
}: DeleteConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} description={description}>
      {listItems && listItems.length > 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-secondary)] p-4 text-sm text-[var(--muted)]">
          {listTitle ? <p className="font-medium text-[var(--foreground)]">{listTitle}</p> : null}
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            {listItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="mt-8 flex flex-wrap justify-end gap-3">
        <Button variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant="destructive" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
