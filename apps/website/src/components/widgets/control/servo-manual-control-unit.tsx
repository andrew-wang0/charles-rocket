"use client";

import React from "react";

import { client } from "@/client";
import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { useServo } from "@/hooks/use-servo";
import { cn } from "@/lib/util/cn";
import { ServoState } from "@/types/servo";

type Props = {
  index: number;
} & React.ComponentProps<"div">;

function getStatusClassName(state: ServoState) {
  switch (state) {
    case ServoState.OPEN:
      return "bg-positive/20 text-positive border-positive/40";
    case ServoState.CLOSED:
      return "bg-destructive/10 text-destructive border-destructive/30";
    case ServoState.OPENING:
      return "bg-positive/20 text-positive border-positive/40 animate-pulse animation-duration-[250ms]";
    case ServoState.CLOSING:
      return "bg-destructive/20 text-destructive border-destructive/40 animate-pulse animation-duration-[250ms]";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function ServoManualControlUnit({ index, className, ...props }: Props) {
  const servo = useServo(index);
  const [isPending, setIsPending] = React.useState(false);
  const isDisabled = servo.isSwitching || servo.state === ServoState.UNKNOWN || isPending;

  async function handleSwitch() {
    if (isDisabled) return;

    setIsPending(true);

    try {
      await client.servoControl({
        index: index + 1,
        set: servo.isOpen ? ServoState.CLOSED : ServoState.OPEN,
      });
    } catch (error) {
      console.error(`Failed to switch servo ${index + 1}`, error);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className={cn("flex h-full flex-col items-center justify-between", className)} {...props}>
      <p className="h-8">SERVO {index + 1}</p>
      <div
        className={cn(
          "flex size-16 items-center justify-center rounded-full border text-[0.65rem] font-medium capitalize",
          getStatusClassName(servo.state),
        )}
      >
        <span>{servo.state}</span>
      </div>
      <WidgetLockableButton
        disabled={isDisabled}
        onClick={() => {
          void handleSwitch();
        }}
      >
        SWITCH
      </WidgetLockableButton>
    </div>
  );
}
