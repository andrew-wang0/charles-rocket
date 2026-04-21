"use client";

import React from "react";

import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { cn } from "@/lib/utils";

type Props = {
  index: number;
} & React.ComponentProps<"div">;

export function ServoManualControlUnit({ index, className, ...props }: Props) {
  return (
    <div className={cn("flex h-full flex-col items-center justify-between", className)} {...props}>
      <p className="h-8">SERVO {index + 1}</p>
      <div className="bg-positive/20 text-positive flex size-16 items-center justify-center rounded-full">
        <span>OPEN</span>
      </div>
      <WidgetLockableButton>SWITCH</WidgetLockableButton>
    </div>
  );
}
