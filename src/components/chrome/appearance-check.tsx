// Quiet selected mark for Light / Dark / Auto. Inline stroke — not an
// icon pack, not a radio.

export function AppearanceCheck({ selected }: { selected: boolean }) {
  if (!selected) return null;

  return (
    <svg
      data-appearance-check=""
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-ink-3"
    >
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}
