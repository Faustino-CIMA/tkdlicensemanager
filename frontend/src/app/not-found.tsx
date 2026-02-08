export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-xl rounded-3xl bg-white p-10 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-900">Page not found</h1>
        <p className="mt-3 text-sm text-zinc-500">The page you requested does not exist.</p>
      </div>
    </main>
  );
}
