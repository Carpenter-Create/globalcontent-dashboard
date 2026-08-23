import { ASK_GLOBEE_NAV_MARK, isNavImageItem, type NavItem } from "@/lib/nav";

// Rail / sheet mark. Lucide destinations stay 16 / 1.33. Ask Globee uses
// Adam's Grok Bee/16 18:3 PNG in the size-4 slot — already cropped. 64 is 2x.
// Not a Lucide redraw. Not an invented SVG.
export function NavMark({ item }: { item: NavItem }) {
  if (isNavImageItem(item)) {
    return (
      <span data-ask-globee-nav-mark="" className="size-4 shrink-0">
        {/* Adam's Grok PNG. next/image would rewrite the mark. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.markSrc}
          srcSet={`${ASK_GLOBEE_NAV_MARK.src64} 2x`}
          alt=""
          width={16}
          height={16}
          className={ASK_GLOBEE_NAV_MARK.fillClass}
        />
      </span>
    );
  }

  const Icon = item.icon;
  return <Icon className="size-4 shrink-0" strokeWidth={1.33} />;
}
