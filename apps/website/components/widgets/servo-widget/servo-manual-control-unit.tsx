"use client";

import React from "react";

import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { cn } from "@/lib/utils";
import type { ServoChannel, ServoChannelState, ServoStatus } from "@/types/websocket";

type Props = {
  canSendCommands: boolean;
  servo: ServoChannelState;
  onSwitch: (channel: ServoChannel) => void;
} & React.ComponentProps<"div">;

function getStatusClassName(state: ServoStatus) {
  switch (state) {
    case "open":
      return "bg-positive/20 text-positive border-positive/40";
    case "closed":
      return "bg-destructive/10 text-destructive border-destructive/30";
    case "opening":
    case "closing":
      return "bg-warning/20 text-warning border-warning/40 animate-pulse";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function ServoManualControlUnit({
  canSendCommands,
  servo,
  onSwitch,
  className,
  ...props
}: Props) {
  const isSwitching = servo.state === "opening" || servo.state === "closing";

  return (
    <div className={cn("flex h-full flex-col items-center justify-between", className)} {...props}>
      <p className="h-8">SERVO {servo.channel + 1}</p>
      <div
        className={cn(
          "flex size-16 items-center justify-center rounded-full border text-[0.65rem] font-medium capitalize",
          getStatusClassName(servo.state),
        )}
      >
        <span>{servo.state}</span>
      </div>
      <WidgetLockableButton
        disabled={!canSendCommands || isSwitching}
        onClick={() => onSwitch(servo.channel)}
      >
        SWITCH
      </WidgetLockableButton>
    </div>
  );
}
