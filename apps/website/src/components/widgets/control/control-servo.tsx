"use client";

import React from "react";

import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { WidgetNoSignal } from "@/components/widgets/widget-no-signal";
import { useServo, useServoControl } from "@/hooks/use-servo";
import { cn } from "@/lib/util/cn";
import { ServoState } from "@/types/servo";

type Props = {
  indexes: number[];
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

function ServoStatusCircle({ index }: { index: number }) {
  const servo = useServo(index);

  return (
    <div
      className={cn(
        "flex size-16 items-center justify-center rounded-full border text-[0.65rem] font-medium capitalize",
        getStatusClassName(servo.state),
      )}
    >
      <span>{servo.state}</span>
    </div>
  );
}

export function ControlServo({ indexes, className, ...props }: Props) {
  const servoGroup = useServoControl(indexes);

  async function handleSwitch() {
    try {
      await servoGroup.toggle();
    } catch (error) {
      console.error(
        `Failed to switch servo group ${indexes.map((index) => index + 1).join(", ")}`,
        error,
      );
    }
  }

  return (
    <div
      className={cn("flex h-full min-w-0 flex-col justify-between gap-y-2", className)}
      {...props}
    >
      <div className="grid w-full auto-cols-fr grid-flow-col gap-x-2">
        {indexes.map((index) => (
          <p key={index} className="text-center">
            SERVO {index + 1}
          </p>
        ))}
      </div>
      <div className="grid w-full flex-1 auto-cols-fr grid-flow-col place-items-center gap-x-2">
        {indexes.map((index) => (
          <ServoStatusCircle key={index} index={index} />
        ))}
      </div>
      <div className="w-full">
        {servoGroup.anyUnknown ? (
          <WidgetNoSignal className="h-8 w-full" />
        ) : (
          <WidgetLockableButton
            className="w-full"
            onClick={() => {
              void handleSwitch();
            }}
            disabled={servoGroup.isBusy}
          >
            SWITCH
          </WidgetLockableButton>
        )}
      </div>
    </div>
  );
}
