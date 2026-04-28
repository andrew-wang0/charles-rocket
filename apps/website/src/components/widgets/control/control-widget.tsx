"use client";

import React from "react";

import { CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { IgnitionControl } from "@/components/widgets/control/ignition-control";
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
        <CardContent className="flex size-full gap-x-2">
          <ServoCloseAll />
          <Separator orientation="vertical" />
          <div className="flex w-full gap-x-2">
            <ServoManualControlUnit indexes={[0]} className="w-1/3" />
            <Separator orientation="vertical" />
            <IgnitionControl className="w-1/3" />
            <Separator orientation="vertical" />
            <ServoManualControlUnit indexes={[1, 2]} className="w-1/3" />
          </div>
        </CardContent>
      </WidgetCard>
    </WidgetLockProvider>
  );
}
