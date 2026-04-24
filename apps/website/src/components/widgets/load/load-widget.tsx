"use client";

import React from "react";

import { loadChartConfig, LoadWidgetChart } from "@/components/widgets/load/load-widget-chart";
import { WidgetAwaitingData } from "@/components/widgets/widget-awaiting-data";
import { useStore } from "@/lib/store";
import { formatChartValue } from "@/lib/util/chart";

export function LoadWidget() {
  const loadReadings = useStore((store) => store.loadReadings);
  const latestLoad = loadReadings.at(-1)?.value;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div
        className="border border-b-3 p-2"
        style={{ borderBottomColor: loadChartConfig.load.color }}
      >
        <div className="text-muted-foreground text-[11px]">{loadChartConfig.load.label}</div>
        <div className="mt-1 font-mono text-lg tabular-nums">{formatChartValue(latestLoad)} LB</div>
      </div>

      {loadReadings.length === 0 ? <WidgetAwaitingData /> : <LoadWidgetChart />}
    </div>
  );
}
