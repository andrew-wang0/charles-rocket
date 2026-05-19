"use client";

import React from "react";

import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { useIgnitionControl } from "@/hooks/use-ignition";
import { useServoControl } from "@/hooks/use-servo";
import { ALL_SERVO_INDEXES } from "@/lib/constants";
import { cn } from "@/lib/util/cn";
import { IgnitionState } from "@/types/ignition";
import { ServoState } from "@/types/servo";

type Props = React.ComponentProps<typeof WidgetLockableButton>;

export function ControlShutoffAll({ className, ...props }: Props) {
  const ignition = useIgnitionControl();
  const { setServos } = useServoControl();
  const isDisabled = ignition.isBusy || ignition.isUnknown;

  async function handleCloseAll() {
    if (isDisabled) return;

    try {
      await Promise.all([
        setServos(ALL_SERVO_INDEXES, ServoState.CLOSED),
        ignition.setIgnition(IgnitionState.OFF),
      ]);
    } catch (error) {
      console.error("Failed to shut off all controls", error);
    }
  }

  return (
    <WidgetLockableButton
      disabled={isDisabled}
      className={cn(
        "hover:bg-destructive/20 hover:text-destructive h-auto self-stretch px-1 py-3 [text-orientation:mixed] [writing-mode:vertical-rl]",
        className,
      )}
      onClick={() => {
        void handleCloseAll();
      }}
      {...props}
    >
      SHUTOFF ALL
    </WidgetLockableButton>
  );
}
