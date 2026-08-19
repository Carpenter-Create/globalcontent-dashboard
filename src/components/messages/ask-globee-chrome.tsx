"use client";

import { createContext, useContext, useMemo, useState } from "react";

import type { AskGlobeeHistoryRow } from "@/lib/ask-globee-conversations";

export type AskGlobeeChromeState = Pick<AskGlobeeHistoryRow, "id" | "title" | "pinned_at">;

type AskGlobeeChromeContextValue = {
  chrome: AskGlobeeChromeState | null;
  setChrome: (next: AskGlobeeChromeState | null) => void;
};

const AskGlobeeChromeContext = createContext<AskGlobeeChromeContextValue>({
  chrome: null,
  setChrome: () => {},
});

export function AskGlobeeChromeProvider({
  children,
  initialChrome = null,
}: {
  children: React.ReactNode;
  initialChrome?: AskGlobeeChromeState | null;
}) {
  const [chrome, setChrome] = useState<AskGlobeeChromeState | null>(initialChrome);
  const value = useMemo(() => ({ chrome, setChrome }), [chrome]);
  return <AskGlobeeChromeContext.Provider value={value}>{children}</AskGlobeeChromeContext.Provider>;
}

export function useAskGlobeeChrome() {
  return useContext(AskGlobeeChromeContext);
}
