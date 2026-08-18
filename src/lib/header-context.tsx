"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface HeaderContextValue {
  headerContent: ReactNode | null;
  setHeaderContent: (content: ReactNode | null) => void;
}

const HeaderContext = createContext<HeaderContextValue>({
  headerContent: null,
  setHeaderContent: () => {},
});

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [headerContent, setHeaderContent] = useState<ReactNode | null>(null);
  return (
    <HeaderContext.Provider value={{ headerContent, setHeaderContent }}>
      {children}
    </HeaderContext.Provider>
  );
}

export function useHeaderContent() {
  return useContext(HeaderContext);
}