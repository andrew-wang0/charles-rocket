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

const SERVO_TRANSITION_SECONDS = 0.4;
const SERVO_SLOW_TRANSITION_SECONDS = 15;

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

function getTransitionSeconds(index: number, state: ServoState) {
  if (state === ServoState.OPENING) {
    return index === 0 ? SERVO_SLOW_TRANSITION_SECONDS : SERVO_TRANSITION_SECONDS;
  }

  if (state === ServoState.CLOSING) {
    return index === 1 || index === 2 ? SERVO_SLOW_TRANSITION_SECONDS : SERVO_TRANSITION_SECONDS;
  }

  return null;
}

function useServoRemainingSeconds(index: number, state: ServoState) {
  const transitionSeconds = getTransitionSeconds(index, state);
  const [startedAt, setStartedAt] = React.useState(() => Date.now());
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const nextStartedAt = Date.now();
    setStartedAt(nextStartedAt);
    setNow(nextStartedAt);

    if (transitionSeconds === null) return;

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 100);

    return () => {
      clearInterval(interval);
    };
  }, [state, transitionSeconds]);

  if (transitionSeconds === null) return null;

  return Math.max(0, transitionSeconds - (now - startedAt) / 1000);
}

function ServoStatusCircle({ index }: { index: number }) {
  const servo = useServo(index);
  const remainingSeconds = useServoRemainingSeconds(index, servo.state);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          "flex size-16 cursor-not-allowed items-center justify-center rounded-full border text-[0.65rem] font-medium capitalize",
          getStatusClassName(servo.state),
        )}
      >
        <span>{servo.state}</span>
      </div>
      <div className="text-muted-foreground h-4 text-xs tabular-nums">
        {remainingSeconds === null ? "" : remainingSeconds.toFixed(1)}
      </div>
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
