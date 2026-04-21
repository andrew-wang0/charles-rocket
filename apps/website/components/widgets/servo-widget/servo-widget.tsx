"use client";

import React from "react";

import { CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ServoManualControl } from "@/components/widgets/servo-widget/servo-manual-control";
import { ServoQuickControl } from "@/components/widgets/servo-widget/servo-quick-control";
import { WidgetCard } from "@/components/widgets/widget-card";
import { WidgetLockProvider } from "@/components/widgets/widget-lock";
import { WidgetLockToggleButton } from "@/components/widgets/widget-lock-toggle-button";
import { useServoControl } from "@/hooks/use-servo-control";

export function ServoWidget() {
  const servoControl = useServoControl();
  const hasSwitchingServo = servoControl.servoState.channels.some(
    (servo) => servo.state === "opening" || servo.state === "closing",
  );

  return (
    <WidgetLockProvider>
      <WidgetCard size="sm">
        <CardHeader>
          <CardTitle>Servo Control</CardTitle>
          <CardAction>
            <WidgetLockToggleButton />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-1 gap-x-2">
          <ServoQuickControl
            disabled={!servoControl.isConnected || hasSwitchingServo}
            onOpenAll={servoControl.openAllServos}
            onCloseAll={servoControl.closeAllServos}
          />
          <Separator orientation="vertical" />
          <ServoManualControl
            className="h-full w-8/12"
            canSendCommands={servoControl.isConnected}
            servoState={servoControl.servoState}
            onSwitchServo={servoControl.toggleServo}
          />
        </CardContent>
      </WidgetCard>
    </WidgetLockProvider>
  );
}
