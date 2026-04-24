"use client";

import React from "react";

import { CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ServoCloseAll } from "@/components/widgets/control/servo-close-all";
import { ServoManualControlUnit } from "@/components/widgets/control/servo-manual-control-unit";
import { WidgetCard } from "@/components/widgets/widget-card";
import { WidgetLockProvider } from "@/components/widgets/widget-lock";
import { WidgetLockToggleButton } from "@/components/widgets/widget-lock-toggle-button";

export function ControlWidget() {
  return (
    <WidgetLockProvider>
      <WidgetCard size="sm">
        <CardHeader>
          <CardTitle>Control</CardTitle>
          <CardAction>
            <WidgetLockToggleButton />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-1 gap-x-2">
          <ServoCloseAll />
          <Separator orientation="vertical" />
          <ServoManualControlUnit index={0} />
          <Separator orientation="vertical" />
          <ServoManualControlUnit index={1} />
          <ServoManualControlUnit index={2} />

          <Separator orientation="vertical" />
        </CardContent>
      </WidgetCard>
    </WidgetLockProvider>
  );
}
