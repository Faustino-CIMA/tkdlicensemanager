"use client";

type ModalProps = {
  title: string;
  description?: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export function Modal({ title, description, isOpen, onClose, children }: ModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:oklch(0%_0_0_/_0.40)] px-4">
      <div className="w-full max-w-xl rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--surface-foreground)] shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">{title}</h2>
            {description ? <p className="mt-2 text-sm text-[var(--muted)]">{description}</p> : null}
          </div>
          <button
            className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
