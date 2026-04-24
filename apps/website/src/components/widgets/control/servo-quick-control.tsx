"use client";

import React from "react";

import { client } from "@/client";
import { Separator } from "@/components/ui/separator";
import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ServoState } from "@/types/servo";

type Props = React.ComponentProps<"div">;

function isServoUnavailable(state: ServoState) {
  return (
    state === ServoState.UNKNOWN || state === ServoState.OPENING || state === ServoState.CLOSING
  );
}

export function ServoQuickControl({ className, ...props }: Props) {
  const [isPending, setIsPending] = React.useState(false);
  const isDisabled = useStore((store) => store.servoStates.some(isServoUnavailable)) || isPending;

  async function setServos(indexes: number[], targetState: ServoState.OPEN | ServoState.CLOSED) {
    if (isDisabled) return;

    setIsPending(true);

    try {
      await Promise.all(
        indexes.map((index) =>
          client.servoControl({
            index,
            set: targetState,
          }),
        ),
      );
    } catch (error) {
      console.error("Failed to update servo group", error);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-y-2", className)} {...props}>
      <WidgetLockableButton
        disabled={isDisabled}
        className="hover:bg-positive/20"
        onClick={() => {
          void setServos([1, 2, 3], ServoState.OPEN);
        }}
      >
        OPEN ALL
      </WidgetLockableButton>
      <WidgetLockableButton
        disabled={isDisabled}
        className="hover:bg-destructive/20"
        onClick={() => {
          void setServos([1, 2, 3], ServoState.CLOSED);
        }}
      >
        CLOSE ALL
      </WidgetLockableButton>
      <Separator />
      <WidgetLockableButton
        disabled={isDisabled}
        className="hover:bg-positive/20"
        onClick={() => {
          void setServos([2, 3], ServoState.OPEN);
        }}
      >
        OPEN 2 & OPEN 3
      </WidgetLockableButton>
    </div>
  );
}
