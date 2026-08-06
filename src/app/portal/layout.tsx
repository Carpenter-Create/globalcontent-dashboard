// Minimal branded shell for the account-less asset-access portal. Deliberately
// outside the app/gc chromes (AppShell, gc nav) — no sidebar, no org switcher,
// no auth wall (exempted in middleware, Task 5). Just the wordmark + a container.
//
// Width is generous (not a fixed card width) because the verified title page
// (title-page.tsx) is a two-column layout — viewing and metadata side by side at `lg:`,
// equal weight — that cannot fit inside a phone-width card. The identity/code/single-file
// stages still render inside their own narrow `Card` (portal-flow.tsx sets `max-w-md`
// on it directly), so they keep the original centered-card look at this wider container.
//
// `items-start` (not `items-center`): the title page can be taller than the viewport, and
// vertically centering an overflowing flex child opens the page scrolled to its middle —
// the buyer would land mid-page instead of at the hero.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink flex items-start justify-center p-6 sm:py-12">
      <div className="w-full max-w-6xl">
        <div className="mb-6 t-label text-ink-3">Global Content</div>
        {children}
      </div>
    </div>
  );
}
