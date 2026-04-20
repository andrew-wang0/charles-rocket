import React from "react";

import { CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetCard } from "@/components/widgets/widget-card";

export function ServoWidget() {
  return (
    <WidgetCard size="sm">
      <CardHeader>
        <CardTitle>Servo Control</CardTitle>
        <CardAction>X</CardAction>
      </CardHeader>
      <CardContent>X</CardContent>
    </WidgetCard>
  );
}
