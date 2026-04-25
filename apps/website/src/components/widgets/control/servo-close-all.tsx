"use client";

import React from "react";

import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { useServoControl, useServoGroup } from "@/hooks/use-servo";
import { SERVO_COUNT } from "@/lib/constants";
import { cn } from "@/lib/util/cn";
import { ServoState } from "@/types/servo";

type Props = React.ComponentProps<typeof WidgetLockableButton>;
const ALL_SERVO_INDEXES = Array.from({ length: SERVO_COUNT }, (_, index) => index);

export function ServoCloseAll({ className, ...props }: Props) {
  const { setServos } = useServoControl();
  const servos = useServoGroup(ALL_SERVO_INDEXES);
  const isDisabled = servos.isSwitching || servos.hasUnknown || servos.areAllClosed;

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
      className={cn("hover:bg-negative/20", className)}
      onClick={() => {
        void handleCloseAll();
      }}
      {...props}
    >
      CLOSE ALL
    </WidgetLockableButton>
  );
}
