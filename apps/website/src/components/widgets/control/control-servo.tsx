"use client";

import React from "react";

import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { WidgetNoSignal } from "@/components/widgets/widget-no-signal";
import { useServoControl } from "@/hooks/use-servo";
import { cn } from "@/lib/util/cn";
import { ServoState } from "@/types/servo";

type Props = {
  indexes: number[];
} & React.ComponentProps<"div">;

const SERVO_TRANSITION_SECONDS = 0.4;
const SERVO_SLOW_TRANSITION_SECONDS = 15;

function getOpeningTransitionSeconds(index: number) {
  return index === 0 || index === 3 ? SERVO_SLOW_TRANSITION_SECONDS : SERVO_TRANSITION_SECONDS;
}

function getClosingTransitionSeconds(index: number) {
  return index === 1 || index === 2 || index === 3
    ? SERVO_SLOW_TRANSITION_SECONDS
    : SERVO_TRANSITION_SECONDS;
}

function assertCompatibleServoGroup(indexes: number[]) {
  if (indexes.length <= 1) return;

  const openingTimes = indexes.map(getOpeningTransitionSeconds);
  const closingTimes = indexes.map(getClosingTransitionSeconds);

  if (!openingTimes.every((time) => time === openingTimes[0])) {
    throw new Error(`Servo group [${indexes.join(", ")}] has mismatched opening transition times`);
  }

  if (!closingTimes.every((time) => time === closingTimes[0])) {
    throw new Error(`Servo group [${indexes.join(", ")}] has mismatched closing transition times`);
  }
}

function formatServoLabel(indexes: number[]) {
  return `SERVO ${indexes.map((index) => index + 1).join(" & ")}`;
}

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
    return getOpeningTransitionSeconds(index);
  }

  if (state === ServoState.CLOSING) {
    return getClosingTransitionSeconds(index);
  }

  return null;
}

function useServoRemainingSeconds(indexes: number[], state: ServoState) {
  const referenceIndex = indexes[0];
  const transitionSeconds =
    referenceIndex === undefined ? null : getTransitionSeconds(referenceIndex, state);
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

function ServoStatusCircle({ indexes, state }: { indexes: number[]; state: ServoState }) {
  const remainingSeconds = useServoRemainingSeconds(indexes, state);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          "flex size-16 cursor-not-allowed items-center justify-center rounded-full border text-[0.65rem] font-medium capitalize",
          getStatusClassName(state),
        )}
      >
        <span>{state}</span>
      </div>
      <div className="text-muted-foreground h-4 text-xs tabular-nums">
        {remainingSeconds === null ? "" : remainingSeconds.toFixed(1)}
      </div>
    </div>
  );
}

export function ControlServo({ indexes, className, ...props }: Props) {
  assertCompatibleServoGroup(indexes);

  const servoGroup = useServoControl(indexes);

  async function handleSwitch() {
    try {
      await servoGroup.toggle();
    } catch (error) {
      console.error(`Failed to switch ${formatServoLabel(indexes)}`, error);
    }
  }

  return (
    <div
      className={cn("flex h-full min-w-0 flex-col items-center justify-between gap-y-2", className)}
      {...props}
    >
      <p className="text-center">{formatServoLabel(indexes)}</p>
      <div className="flex flex-1 items-center justify-center">
        <ServoStatusCircle indexes={indexes} state={servoGroup.state} />
      </div>
      <div className="w-full">
        {servoGroup.anyUnknown ? (
          <WidgetNoSignal className="h-8 w-full" />
        ) : (
          <WidgetLockableButton
            className="w-full"
            disabled={servoGroup.isBusy}
            onClick={() => {
              void handleSwitch();
            }}
          >
            SWITCH
          </WidgetLockableButton>
        )}
      </div>
    </div>
  );
}
