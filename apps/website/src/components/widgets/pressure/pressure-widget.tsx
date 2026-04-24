"use client";

import React from "react";

import {
  chartConfig,
  PressureWidgetChart,
} from "@/components/widgets/pressure/pressure-widget-chart";
import { WidgetAwaitingData } from "@/components/widgets/widget-awaiting-data";
import { useStore } from "@/lib/store";
import { formatChartValue } from "@/lib/util/chart";

export function PressureWidget() {
  const pressureReadings = useStore((store) => store.pressureReadings);
  const hasPressureData = pressureReadings.some((readings) => readings.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="grid shrink-0 gap-2 md:grid-cols-3">
        {Object.entries(chartConfig).map(([_, { label, color }], index) => {
          const latest = pressureReadings[index]?.at(-1)?.value;

          return (
            <div key={index} className="border border-b-3 p-2" style={{ borderBottomColor: color }}>
              <div className="text-muted-foreground text-[11px]">{label}</div>
              <div className="mt-1 font-mono text-lg tabular-nums">
                {formatChartValue(latest)} PSI
              </div>
            </div>
          );
        })}
      </div>

      {!hasPressureData ? <WidgetAwaitingData /> : <PressureWidgetChart />}
    </div>
  );
}
