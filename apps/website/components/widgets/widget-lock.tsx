"use client";

import React, { createContext, useContext, useState } from "react";

type WidgetLockContextValue = {
  locked: boolean;
  lock: () => void;
  unlock: () => void;
  toggleLock: () => void;
};

const WidgetLockContext = createContext<WidgetLockContextValue | null>(null);

export function WidgetLockProvider({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(true);

  const unlock = () => setLocked(false);
  const lock = () => setLocked(true);
  const toggleLock = () => setLocked((v) => !v);

  return (
    <WidgetLockContext value={{ locked, lock, unlock, toggleLock }}>{children}</WidgetLockContext>
  );
}

export function useWidgetLock() {
  const context = useContext(WidgetLockContext);

  if (!context) {
    throw new Error();
  }

  return context;
}
