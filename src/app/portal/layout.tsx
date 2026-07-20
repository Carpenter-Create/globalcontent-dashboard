// Minimal branded shell for the account-less asset-access portal. Deliberately
// outside the app/gc chromes (AppShell, gc nav) — no sidebar, no org switcher,
// no auth wall (exempted in middleware, Task 5). Just the wordmark + a centered card.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 t-label text-ink-3">Global Content</div>
        {children}
      </div>
    </div>
  );
}
