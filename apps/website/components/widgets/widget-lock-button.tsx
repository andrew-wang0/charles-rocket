"use client";

import { LockSimpleIcon } from "@phosphor-icons/react";
import React from "react";

import { Button } from "@/components/ui/button";
import { useWidgetLock } from "@/components/widgets/widget-lock";

export function WidgetLockButton() {
  const { locked, toggleLock } = useWidgetLock();

  return (
    <Button size="xs" variant={locked ? "destructive" : "secondary"} onClick={toggleLock}>
      {locked && <LockSimpleIcon weight="fill" />}
      {locked ? "LOCKED" : "UNLOCKED"}
    </Button>
  );
}
