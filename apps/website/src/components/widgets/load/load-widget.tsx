"use client";

import React from "react";

import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadChartConfig, LoadWidgetChart } from "@/components/widgets/load/load-widget-chart";
import { WidgetAwaitingData } from "@/components/widgets/widget-awaiting-data";
import { WidgetCard } from "@/components/widgets/widget-card";
import { WidgetChartValueCard } from "@/components/widgets/widget-chart-value-card";
import { useStore } from "@/lib/store";
import { formatChartValue } from "@/lib/util/chart";

export function LoadWidget() {
  const hasLoadData = useStore((store) => store.loadChartData.length > 0);
  const latest = useStore((store) => store.loadLatestValue);

  return (
    <WidgetCard size="sm">
      <CardHeader>
        <CardTitle>Load Monitor</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <WidgetChartValueCard
          label="Load"
          color={loadChartConfig.load.color}
          value={latest}
          display={(value) => `${formatChartValue(value)} kg`}
          onTare={() => {}}
          trackMax
        />
        {!hasLoadData ? <WidgetAwaitingData /> : <LoadWidgetChart />}
      </CardContent>
    </WidgetCard>
  );
}
