import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("@/app/(app)/messages/ask-globee-actions", () => ({
  startAskGlobeeConversation: vi.fn(),
  appendAskGlobeeTurn: vi.fn(),
  completeAskGlobeeTurn: vi.fn(),
  setAskGlobeeThumb: vi.fn(),
  renameAskGlobeeConversation: vi.fn(),
  pinAskGlobeeConversation: vi.fn(),
  deleteAskGlobeeConversation: vi.fn(),
}));

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { AskGlobeeChromeProvider } from "@/components/messages/ask-globee-chrome";
import { MessagesAppHeader } from "./messages-app-header";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "messages-app-header.tsx"), "utf8");
const houseSheetSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../lib/house-sheet.ts"),
  "utf8",
);

const THREAD = "2f1c8b6a-4d3e-4a11-9c22-7b8e1d0a5f44";

function visible(html: string): string {
  return html.replaceAll("&#x27;", "'");
}

describe("MessagesAppHeader", () => {
  it("restores Search only on the Access gate, even with a thread query", () => {
    navigation.search = `thread=${THREAD}`;
    const html = renderToStaticMarkup(<MessagesAppHeader surface="access-gate" />);
    expect(html).toContain("data-header-search");
    expect(html).toContain(ASK_GLOBEE.headerSearchPlaceholder);
    expect(html).toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain("data-header-thread");
    expect(html).not.toContain(ASK_GLOBEE.threadTitle);
    expect(html).not.toContain(ASK_GLOBEE.need);
    expect(html).not.toContain(ASK_GLOBEE.historyLabel);
  });

  it("keeps the 7:73 landing header as spacer + avatar only", () => {
    navigation.search = "";
    const html = renderToStaticMarkup(<MessagesAppHeader surface="ask-globee-landing" />);
    expect(html).toBe("");
    expect(html).not.toContain("data-header-search");
    expect(html).not.toContain("data-header-thread");
    expect(html).not.toContain("data-ask-globee-download");
    expect(html).not.toContain(ASK_GLOBEE.downloadLabel);
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain(ASK_GLOBEE.threadTitle);
  });

  it("shows back + the conversation title on the unlocked thread, with no Search", () => {
    navigation.search = `thread=${THREAD}`;
    const html = visible(
      renderToStaticMarkup(
        <AskGlobeeChromeProvider
          initialChrome={{ id: THREAD, title: "What needs attention", pinned_at: null }}
        >
          <MessagesAppHeader surface="ask-globee-landing" />
        </AskGlobeeChromeProvider>,
      ),
    );
    expect(html).toContain("data-header-thread");
    expect(html).toContain("What needs attention");
    expect(html).toContain("data-ask-globee-history-title");
    expect(html).toContain(`href="/messages"`);
    expect(html).toContain(ASK_GLOBEE.backLabel);
    expect(html).toContain(ASK_GLOBEE.downloadLabel);
    expect(html).toContain("data-ask-globee-download");
    expect(html).toContain("data-ask-globee-header-chrome");
    expect(html).toContain("data-ask-globee-title-cluster");
    expect(html).toContain("flex-1");
    expect(html).toContain(ASK_GLOBEE.moreLabel);
    const titleClusterStart = html.indexOf("data-ask-globee-title-cluster");
    const chromeStart = html.indexOf("data-ask-globee-header-chrome");
    const titleClusterHtml = html.slice(titleClusterStart, chromeStart);
    expect(titleClusterHtml).toContain("data-ask-globee-history-title");
    expect(titleClusterHtml).not.toContain(ASK_GLOBEE.moreLabel);
    expect(html.slice(chromeStart)).toContain(ASK_GLOBEE.moreLabel);
    expect(html).toContain("t-heading");
    expect(html).not.toContain("t-title");
    expect(src).toContain("Download");
    expect(src).toContain("saveAskGlobeeDownload");
    expect(src).toContain("strokeWidth={1.33}");
    expect(src).toContain("AskGlobeeHistoryPopover");
    expect(src).toContain("ChevronDown");
    expect(src).toContain("ChevronUp");
    expect(html).toContain('aria-expanded="false"');
    expect(src).toContain("historyOpen ? (");
    expect(src).toContain("<ChevronDown");
    expect(src).toContain("truncate t-heading text-ink max-md:hidden");
    expect(src).toContain(
      'className="flex min-w-0 flex-1 items-center gap-[var(--space-4)]"',
    );
    expect(src).toContain("data-ask-globee-header-chrome");
    expect(src).toContain("flex shrink-0 items-center gap-[var(--space-4)]");
    expect(src).toContain("<Download className=\"size-4\" strokeWidth={1.33} />");
    expect(src).toContain("<MoreHorizontal className=\"size-4\" strokeWidth={1.33} />");
    expect(src).not.toContain("truncate t-body-sm text-ink");
    expect(src).not.toContain("size-5");
    expect(src).not.toContain("size-6");
    expect(html).not.toContain("data-ask-globee-history-popover");
    expect(html).toContain(ASK_GLOBEE.deleteTitle);
    expect(html).toContain(ASK_GLOBEE.deleteBody);
    expect(html).toContain(ASK_GLOBEE.deleteConfirm);
    expect(html).toContain(ASK_GLOBEE.cancelLabel);
    expect(src).toContain("ASK_GLOBEE.downloadPdfLabel");
    expect(src).toContain("ASK_GLOBEE.renameLabel");
    expect(src).toContain("ASK_GLOBEE.pinLabel");
    expect(src).toContain("ASK_GLOBEE.deleteLabel");
    expect(src).not.toMatch(/Archive/);
    expect(html).not.toContain("data-header-search");
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain("SearchField");
    expect(html).not.toContain(ASK_GLOBEE.threadTitle);
    expect(html).not.toContain("Winter Line");
    if (src.includes("data-ask-globee-new")) {
      expect(html).toContain("data-ask-globee-new");
      expect(html).toContain(ASK_GLOBEE.newConversationLabel);
    }
  });

  it("keeps desktop title on t-heading 17 and mobile 531:542 on t-body 15", () => {
    const tokens = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/tokens.css"),
      "utf8",
    );
    const globals = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/globals.css"),
      "utf8",
    );

    expect(src).toContain("truncate t-heading text-ink max-md:hidden");
    expect(src).toContain("truncate t-body text-ink md:hidden");
    expect(src).not.toContain("truncate t-body-sm text-ink");
    expect(src).not.toContain("t-title");
    expect(tokens).toMatch(/--text-lg:\s*1\.0625rem;/);
    expect(tokens).toMatch(/--text-base:\s*0\.9375rem;/);
    expect(tokens).toMatch(/--text-sm:\s*0\.8125rem;/);
    expect(tokens).toMatch(/--text-title:\s*1\.5rem;/);
    expect(globals).toMatch(/\.t-heading\s*\{[\s\S]*?font-size:\s*var\(--text-lg\)/);
    expect(globals).toMatch(/\.t-body\s*\{[\s\S]*?font-size:\s*var\(--text-base\)/);
    expect(globals).toMatch(/\.t-body-sm\s*\{[\s\S]*?font-size:\s*var\(--text-sm\)/);
    expect(globals).toMatch(/\.t-title\s*\{[\s\S]*?font-size:\s*var\(--text-title\)/);
  });

  it("locks mobile 531:542 to thin ink and PDF inside the existing ···", () => {
    const shell = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "app-shell.tsx"),
      "utf8",
    );
    const landing = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../messages/ask-globee-landing.tsx"),
      "utf8",
    );
    const titles = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../titles/titles-catalog.tsx"),
      "utf8",
    );

    expect(src).toContain(
      'className="flex min-w-0 flex-1 items-center gap-[var(--space-4)]"',
    );
    expect(src).toContain(
      'className="flex min-w-0 flex-1 items-center gap-[var(--space-2)]"',
    );
    expect(src).toContain('data-ask-globee-title-cluster=""');
    expect(src.indexOf("data-ask-globee-title-cluster")).toBeLessThan(
      src.indexOf("data-ask-globee-header-chrome"),
    );
    expect(src.indexOf("<MoreHorizontal")).toBeGreaterThan(
      src.indexOf("data-ask-globee-header-chrome"),
    );
    expect(src.indexOf("<MoreHorizontal")).toBeGreaterThan(
      src.lastIndexOf("</AskGlobeeHistoryPopover>"),
    );
    expect(src).toContain('className="hidden size-4 shrink-0 items-center justify-center text-ink-3 md:flex"');
    expect(src).toContain('className="flex size-4 shrink-0 items-center justify-center text-ink-3"');
    expect(src).toContain('<ChevronDown className="size-4 shrink-0 text-ink-3" strokeWidth={1.33} />');
    expect(src).toContain('<MoreHorizontal className="size-4" strokeWidth={1.33} />');
    expect(src).toContain("ASK_GLOBEE.downloadPdfLabel");
    expect(src).toContain("<ThreadPopoverContent");
    expect(src).toContain("<ThreadPopoverItem");
    expect(src).toContain("THREAD_POPOVER_ICON_CLASS");
    expect(src).toContain("THREAD_POPOVER_DELETE_ICON_CLASS");
    expect(houseSheetSrc).toContain("text-[#c4564a]");
    expect(src).toContain("ASK_GLOBEE.deleteBody");
    expect(src).not.toContain("MessagesThreadOverflow");
    expect(src).not.toContain("data-ask-globee-mobile-overflow");
    expect(src).toContain("text-ink max-md:text-ink-3");
    expect(src).toContain("text-ink-3");
    expect(src).not.toContain("font-bold");
    expect(src).not.toContain("strokeWidth={2}");
    expect((src.match(/<MoreHorizontal/g) ?? []).length).toBe(1);
    expect(shell).not.toContain("MessagesThreadOverflow");
    expect(shell).toContain("<UserMenu email={email} name={name} />");
    expect(shell).toContain("justify-end gap-4");
    expect(shell).toContain("px-[var(--space-6)] md:px-[var(--content-inset)]");
    expect(shell).toContain("gap-3");
    expect(landing).not.toContain("MessagesThreadOverflow");
    expect(landing).not.toContain("data-ask-globee-title-cluster");
    expect(titles).not.toContain("MessagesThreadOverflow");
    expect(titles).not.toContain("data-ask-globee-title-cluster");
  });

  it("docks desktop download/··· 16 from the avatar; title stays left", () => {
    navigation.search = `thread=${THREAD}`;
    const html = visible(
      renderToStaticMarkup(
        <AskGlobeeChromeProvider
          initialChrome={{ id: THREAD, title: "What needs attention", pinned_at: null }}
        >
          <MessagesAppHeader surface="ask-globee-landing" />
        </AskGlobeeChromeProvider>,
      ),
    );
    const shell = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "app-shell.tsx"),
      "utf8",
    );
    const userMenu = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "user-menu.tsx"),
      "utf8",
    );
    const tokens = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/tokens.css"),
      "utf8",
    );

    expect(src).toContain(
      'className="flex min-w-0 flex-1 items-center gap-[var(--space-4)]"',
    );
    expect(src).toContain(
      'className="flex min-w-0 flex-1 items-center gap-[var(--space-2)]"',
    );
    expect(src).not.toContain(
      'className="flex min-w-0 items-center gap-[var(--space-4)] max-md:flex-1"',
    );
    expect(src).not.toContain(
      'className="flex min-w-0 items-center gap-[var(--space-2)] max-md:flex-1"',
    );
    expect(src).toContain("flex shrink-0 items-center gap-[var(--space-4)]");
    expect(html).toContain("data-ask-globee-title-cluster");
    expect(html).toContain("data-ask-globee-header-chrome");
    expect(html).toContain("data-ask-globee-download");
    expect(html).toContain(ASK_GLOBEE.moreLabel);
    const titleClusterStart = html.indexOf("data-ask-globee-title-cluster");
    const chromeStart = html.indexOf("data-ask-globee-header-chrome");
    expect(titleClusterStart).toBeGreaterThan(-1);
    expect(chromeStart).toBeGreaterThan(titleClusterStart);
    expect(html.slice(titleClusterStart, chromeStart)).toContain("data-ask-globee-history-title");
    expect(src.indexOf("<ChevronDown")).toBeGreaterThan(src.indexOf("data-ask-globee-title-cluster"));
    expect(src.indexOf("<ChevronDown")).toBeLessThan(src.indexOf("data-ask-globee-header-chrome"));
    expect(html.slice(titleClusterStart, chromeStart)).not.toContain(ASK_GLOBEE.downloadLabel);
    expect(html.slice(titleClusterStart, chromeStart)).not.toContain(ASK_GLOBEE.moreLabel);
    expect(html.slice(chromeStart)).toContain(ASK_GLOBEE.downloadLabel);
    expect(html.slice(chromeStart)).toContain(ASK_GLOBEE.moreLabel);
    expect(html.slice(chromeStart).indexOf(ASK_GLOBEE.downloadLabel)).toBeLessThan(
      html.slice(chromeStart).indexOf(ASK_GLOBEE.moreLabel),
    );
    expect(src).toContain('className="hidden size-4 shrink-0 items-center justify-center text-ink-3 md:flex"');
    expect(src.indexOf("data-ask-globee-download")).toBeLessThan(src.indexOf("<MoreHorizontal"));
    expect(shell).toContain("justify-end gap-4");
    expect(shell).toContain('data-app-header-leading="" className="mr-auto flex min-w-0 flex-1 items-center gap-2"');
    expect(shell).toContain("<UserMenu email={email} name={name} />");
    expect(shell.indexOf("<MessagesAppHeader")).toBeLessThan(shell.indexOf("<UserMenu"));
    expect(tokens).toMatch(/--space-4:\s*1rem;/);
    expect(userMenu).not.toContain("data-ask-globee-title-cluster");
    expect(userMenu).not.toContain("data-header-thread");
    expect(userMenu).not.toContain("data-ask-globee-header-chrome");
  });

  it("instances SSOT Thread Popover 544:592, not the avatar/account menu", () => {
    const houseSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "house.tsx"), "utf8");
    const userMenu = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "user-menu.tsx"),
      "utf8",
    );

    expect(src).toContain("<ThreadPopoverContent");
    expect(src).toContain("<ThreadPopoverItem");
    expect(src).toContain("THREAD_POPOVER_ICON_CLASS");
    expect(src).toContain("THREAD_POPOVER_DELETE_ICON_CLASS");
    expect(houseSrc).toContain("544:592");
    expect(houseSrc).toContain("DropdownMenuPrimitive.Content");
    expect(houseSrc).toContain('data-thread-popover=""');
    expect(houseSrc).not.toContain("from \"@/components/ui/dropdown-menu\"");
    expect(houseSheetSrc).toContain("rounded-[12px]");
    expect(houseSheetSrc).toContain("p-[var(--space-4)]");
    expect(houseSheetSrc).toContain("gap-[var(--space-2)]");
    expect(houseSheetSrc).toContain("shadow-none");
    expect(houseSheetSrc).toContain("text-[length:var(--text-base)]");
    expect(houseSheetSrc).toContain("text-ink");
    expect(houseSheetSrc).toContain("text-[#c4564a]");
    expect(houseSheetSrc).not.toMatch(/THREAD_POPOVER_ITEM_CLASS[\s\S]*t-body-sm/);
    expect(houseSheetSrc).not.toContain("min-w-[17.5rem]");
    expect(houseSheetSrc).not.toContain("min-w-[200px]");
    expect(src).not.toContain("min-w-[17.5rem]");
    expect(src).not.toContain("data-user-menu");
    expect(src).not.toContain("UserMenuIdentity");
    expect(src).not.toContain("sideOffset={10}");
    expect(houseSheetSrc).toContain('p-[var(--space-4)] shadow-none');
    expect(houseSheetSrc).not.toContain('p-[var(--space-2)] shadow');
    expect(userMenu).toContain("min-w-[17.5rem]");
    expect(userMenu).toContain("rounded-[var(--radius)]");
    expect(userMenu).toContain("t-body-sm");
    expect(userMenu).not.toContain("ThreadPopoverContent");
    expect(userMenu).not.toContain("544:592");
  });

  it("renders nothing for the staff inbox", () => {
    navigation.search = `thread=${THREAD}`;
    const html = renderToStaticMarkup(<MessagesAppHeader surface="staff-inbox" />);
    expect(html).toBe("");
  });
});
