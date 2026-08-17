export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-xl rounded-[var(--radius-card)] bg-card p-10 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
        <p className="mt-3 text-sm text-muted">The page you requested does not exist.</p>
      </div>
    </main>
  );
}
