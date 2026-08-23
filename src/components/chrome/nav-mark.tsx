import { ASK_GLOBEE_NAV_MARK, isNavImageItem, type NavItem } from "@/lib/nav";

// Rail / sheet mark. Lucide destinations stay 16 / 1.33. Ask Globee uses
// Adam's 64 PNG cropped into the same size-4 slot — not the padded 16 export,
// not a Lucide redraw, not an invented SVG.
export function NavMark({ item }: { item: NavItem }) {
  if (isNavImageItem(item)) {
    return (
      <span data-ask-globee-nav-mark="" className="relative size-4 shrink-0 overflow-hidden">
        {/* Adam's Design PNG. next/image would rewrite the mark. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.markSrc}
          alt=""
          width={64}
          height={64}
          className={ASK_GLOBEE_NAV_MARK.fillClass}
        />
      </span>
    );
  }

  const Icon = item.icon;
  return <Icon className="size-4 shrink-0" strokeWidth={1.33} />;
}
