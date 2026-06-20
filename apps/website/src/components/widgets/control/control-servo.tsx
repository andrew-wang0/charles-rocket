"use client";

import { LockSimpleIcon } from "@phosphor-icons/react";
import React from "react";

import { useWidgetLock } from "@/components/widgets/widget-lock";
import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { WidgetNoSignal } from "@/components/widgets/widget-no-signal";
import { useServoControl } from "@/hooks/use-servo";
import { getClosingTransitionSeconds, getOpeningTransitionSeconds } from "@/lib/servo-transition";
import { cn } from "@/lib/util/cn";
import { ServoState } from "@/types/servo";

type Props = {
  indexes: number[];
} & React.ComponentProps<"div">;

function assertCompatibleServoGroup(indexes: number[]) {
  if (indexes.length <= 1) return;

  const openingTimes = indexes.map(getOpeningTransitionSeconds);
  const closingTimes = indexes.map((index) => getClosingTransitionSeconds(index));

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

function isServoSwitchingState(state: ServoState) {
  return state === ServoState.OPENING || state === ServoState.CLOSING;
}

function getStatusClassName(state: ServoState) {
  switch (state) {
    case ServoState.OPEN:
      return "bg-positive/20 text-positive border-positive/40 hover:!bg-positive/20 hover:!text-positive hover:!border-positive/40 dark:hover:!bg-positive/20 dark:hover:!text-positive";
    case ServoState.CLOSED:
      return "bg-destructive/10 text-destructive border-destructive/30 hover:!bg-destructive/10 hover:!text-destructive hover:!border-destructive/30 dark:hover:!bg-destructive/10 dark:hover:!text-destructive";
    case ServoState.OPENING:
      return "bg-positive/20 text-positive border-positive/40 hover:!bg-positive/20 hover:!text-positive hover:!border-positive/40 dark:hover:!bg-positive/20 dark:hover:!text-positive";
    case ServoState.CLOSING:
      return "bg-destructive/20 text-destructive border-destructive/40 hover:!bg-destructive/20 hover:!text-destructive hover:!border-destructive/40 dark:hover:!bg-destructive/20 dark:hover:!text-destructive";
    default:
      return "bg-muted text-muted-foreground border-border hover:!bg-muted hover:!text-muted-foreground hover:!border-border dark:hover:!bg-muted dark:hover:!text-muted-foreground";
  }
}

function getTransitionSeconds(index: number, state: ServoState, isAbortClosing: boolean) {
  if (state === ServoState.OPENING) {
    return getOpeningTransitionSeconds(index);
  }

  if (state === ServoState.CLOSING) {
    return getClosingTransitionSeconds(index, { fast: isAbortClosing });
  }

  return null;
}

function useServoRemainingSeconds(indexes: number[], state: ServoState, isAbortClosing: boolean) {
  const referenceIndex = indexes[0];
  const transitionSeconds =
    referenceIndex === undefined
      ? null
      : getTransitionSeconds(referenceIndex, state, isAbortClosing);
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
  }, [isAbortClosing, state, transitionSeconds]);

  if (transitionSeconds === null) return null;

  return Math.max(0, transitionSeconds - (now - startedAt) / 1000);
}

function ServoStatusCircle({
  indexes,
  state,
  isAbortClosing,
  disabled,
  onClick,
}: {
  indexes: number[];
  state: ServoState;
  isAbortClosing: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const { locked } = useWidgetLock();
  const remainingSeconds = useServoRemainingSeconds(indexes, state, isAbortClosing);
  const isSwitching = isServoSwitchingState(state);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn("rounded-full", isSwitching && "animation-duration-[250ms] animate-pulse")}
      >
        <WidgetLockableButton
          aria-label={`Switch ${formatServoLabel(indexes)}`}
          variant="ghost"
          className={cn(
            "size-16 rounded-full border p-0 text-[0.65rem] font-medium capitalize shadow-none",
            !isSwitching && "enabled:hover:ring-ring/60 enabled:hover:ring-4",
            isSwitching && "transition-none disabled:opacity-100",
            getStatusClassName(state),
          )}
          disabled={disabled}
          onClick={onClick}
        >
          <span>{state}</span>
        </WidgetLockableButton>
      </div>
      <div aria-hidden="true" className="h-3 leading-none">
        <LockSimpleIcon
          className={cn("size-3", locked ? "opacity-100" : "opacity-0")}
          weight="fill"
        />
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
    <div className={cn("flex h-full min-w-0 flex-col items-center gap-y-2", className)} {...props}>
      <p className="text-center">{formatServoLabel(indexes)}</p>
      {servoGroup.anyUnknown ? (
        <div className="flex flex-1 items-center justify-center">
          <WidgetNoSignal className="size-16 text-[0.65rem]" />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <ServoStatusCircle
            indexes={indexes}
            isAbortClosing={servoGroup.isAbortClosing}
            state={servoGroup.state}
            disabled={servoGroup.isBusy}
            onClick={() => {
              void handleSwitch();
            }}
          />
        </div>
      )}
    </div>
  );
}
