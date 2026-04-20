import React from "react";

import { CardHeader, CardTitle } from "@/components/ui/card";
import { ServoWidget } from "@/components/widgets/servo-widget/servo-widget";
import { WidgetCard } from "@/components/widgets/widget-card";

export default function Page() {
  return (
    <div className="grid grid-cols-2 gap-2 px-4 py-2">
      <ServoWidget />
      <WidgetCard>
        <CardHeader>
          <CardTitle>Video Feed</CardTitle>
        </CardHeader>
      </WidgetCard>
      <WidgetCard>
        <CardHeader>
          <CardTitle>PT Monitor</CardTitle>
        </CardHeader>
      </WidgetCard>
      <WidgetCard>
        <CardHeader>
          <CardTitle>Load Monitor</CardTitle>
        </CardHeader>
      </WidgetCard>
    </div>
  );
}
