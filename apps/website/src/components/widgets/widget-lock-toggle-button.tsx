"use client";

import { LockSimpleIcon } from "@phosphor-icons/react";
import React from "react";

import { Button } from "@/components/ui/button";
import { useWidgetLock } from "@/components/widgets/widget-lock";

export function WidgetLockToggleButton() {
  const { locked, toggleLock } = useWidgetLock();

  return (
    <Button size="xs" variant="secondary" onClick={toggleLock}>
      {locked && <LockSimpleIcon weight="fill" />}
      {locked ? "LOCKED" : "UNLOCKED"}
    </Button>
  );
}
