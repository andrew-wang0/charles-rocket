"use client";

import React from "react";

import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { useServoControl, useServoGroup } from "@/hooks/use-servo";
import { ALL_SERVO_INDEXES } from "@/lib/constants";
import { cn } from "@/lib/util/cn";
import { ServoState } from "@/types/servo";

type Props = React.ComponentProps<typeof WidgetLockableButton>;

export function ServoCloseAll({ className, ...props }: Props) {
  const { setServos } = useServoControl();
  const servos = useServoGroup(ALL_SERVO_INDEXES);
  const isDisabled = servos.isSwitching || servos.anyUnknown;

  async function handleCloseAll() {
    if (isDisabled) return;

    try {
      await setServos(ALL_SERVO_INDEXES, ServoState.CLOSED);
    } catch (error) {
      console.error("Failed to close all servos", error);
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
      CLOSE ALL
    </WidgetLockableButton>
  );
}
