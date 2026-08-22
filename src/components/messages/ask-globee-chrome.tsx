"use client";

import { createContext, useContext, useMemo, useState } from "react";

import type { AskGlobeeHistoryRow, AskGlobeeStoredMessage } from "@/lib/ask-globee-conversations";

export type AskGlobeeChromeState = Pick<AskGlobeeHistoryRow, "id" | "title" | "pinned_at"> & {
  initials?: string;
  messages?: AskGlobeeStoredMessage[];
};

type AskGlobeeChromeContextValue = {
  chrome: AskGlobeeChromeState | null;
  setChrome: (next: AskGlobeeChromeState | null) => void;
  conversations: AskGlobeeHistoryRow[];
  setConversations: (next: AskGlobeeHistoryRow[]) => void;
};

const AskGlobeeChromeContext = createContext<AskGlobeeChromeContextValue>({
  chrome: null,
  setChrome: () => {},
  conversations: [],
  setConversations: () => {},
});

export function AskGlobeeChromeProvider({
  children,
  initialChrome = null,
  initialConversations = [],
}: {
  children: React.ReactNode;
  initialChrome?: AskGlobeeChromeState | null;
  initialConversations?: AskGlobeeHistoryRow[];
}) {
  const [chrome, setChrome] = useState<AskGlobeeChromeState | null>(initialChrome);
  const [conversations, setConversations] = useState<AskGlobeeHistoryRow[]>(initialConversations);
  const value = useMemo(
    () => ({ chrome, setChrome, conversations, setConversations }),
    [chrome, conversations],
  );
  return <AskGlobeeChromeContext.Provider value={value}>{children}</AskGlobeeChromeContext.Provider>;
}

export function useAskGlobeeChrome() {
  return useContext(AskGlobeeChromeContext);
}
