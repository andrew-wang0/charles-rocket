import React from "react";

import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ControlWidget } from "@/components/widgets/control/control-widget";
import { WidgetCard } from "@/components/widgets/widget-card";

export default function Page() {
  return (
    <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-2 p-4 pt-2">
      <ControlWidget />
      <WidgetCard size="sm">
        <CardHeader>
          <CardTitle>Video Feed</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1">
          <div className="bg-muted flex-1 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,var(--border)_10px,var(--border)_11px)]" />
        </CardContent>
      </WidgetCard>
      <WidgetCard size="sm">
        <CardHeader>
          <CardTitle>PT Monitor</CardTitle>
        </CardHeader>
      </WidgetCard>
      <WidgetCard size="sm">
        <CardHeader>
          <CardTitle>Load Monitor</CardTitle>
        </CardHeader>
      </WidgetCard>
    </div>
  );
}
