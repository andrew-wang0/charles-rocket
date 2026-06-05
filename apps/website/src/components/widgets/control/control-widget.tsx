"use client";

import React from "react";

import { CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { WidgetCard } from "@/components/widgets/widget-card";
import { WidgetLockProvider } from "@/components/widgets/widget-lock";
import { WidgetLockToggleButton } from "@/components/widgets/widget-lock-toggle-button";

import { ControlAdditionalControls } from "./control-additional-controls";
import { ControlIgnition } from "./control-ignition";
import { ControlServo } from "./control-servo";

export function ControlWidget() {
  return (
    <WidgetLockProvider>
      <WidgetCard size="sm">
        <CardHeader>
          <CardTitle>Control</CardTitle>
          <CardAction className="flex items-center gap-1">
            <WidgetLockToggleButton />
            <ControlAdditionalControls />
          </CardAction>
        </CardHeader>
        <CardContent className="flex size-full gap-x-2">
          <div className="flex w-full gap-x-2">
            <ControlServo indexes={[0]} className="w-1/3" />
            <Separator orientation="vertical" />
            <ControlIgnition className="w-1/3" />
            <Separator orientation="vertical" />
            <ControlServo indexes={[1, 2]} className="w-1/3" />
          </div>
        </CardContent>
      </WidgetCard>
    </WidgetLockProvider>
  );
}
