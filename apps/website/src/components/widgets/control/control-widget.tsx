"use client";

import React from "react";

import { CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { WidgetCard } from "@/components/widgets/widget-card";
import { WidgetLockProvider } from "@/components/widgets/widget-lock";
import { WidgetLockToggleButton } from "@/components/widgets/widget-lock-toggle-button";

import { ControlIgnition } from "./control-ignition";
import { ControlServo } from "./control-servo";

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
          <ControlServo indexes={[0]} className="min-w-0 flex-1" />
          <Separator orientation="vertical" />
          <ControlServo indexes={[1, 2]} className="min-w-0 flex-1" />
          <Separator orientation="vertical" />
          <ControlIgnition className="min-w-0 flex-1" />
          <Separator orientation="vertical" />
          <ControlServo indexes={[3]} className="min-w-0 flex-1" />
          <Separator orientation="vertical" />
          <ControlServo indexes={[4]} className="min-w-0 flex-1" />
        </CardContent>
      </WidgetCard>
    </WidgetLockProvider>
  );
}
