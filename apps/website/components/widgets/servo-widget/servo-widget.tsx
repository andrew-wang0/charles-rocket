import React from "react";

import { CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetCard } from "@/components/widgets/widget-card";
import { WidgetLockProvider } from "@/components/widgets/widget-lock";
import { WidgetLockButton } from "@/components/widgets/widget-lock-button";

export function ServoWidget() {
  return (
    <WidgetLockProvider>
      <WidgetCard size="sm">
        <CardHeader>
          <CardTitle>Servo Control</CardTitle>
          <CardAction>
            <WidgetLockButton />
          </CardAction>
        </CardHeader>
        <CardContent>X</CardContent>
      </WidgetCard>
    </WidgetLockProvider>
  );
}
