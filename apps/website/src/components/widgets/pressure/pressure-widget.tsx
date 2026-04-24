"use client";

import React from "react";

import {
  chartConfig,
  formatPsi,
  PressureWidgetChart,
} from "@/components/widgets/pressure/pressure-widget-chart";
import { useStore } from "@/lib/store";

export function PressureWidget() {
  const pressureReadings = useStore((store) => store.pressureReadings);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="grid shrink-0 gap-2 md:grid-cols-3">
        {Object.entries(chartConfig).map(([_, { label, color }], index) => {
          const latest = pressureReadings[index]?.at(-1)?.value;

          return (
            <div key={index} className="border border-b-4 p-2" style={{ borderBottomColor: color }}>
              <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                <span>{label}</span>
              </div>
              <div className="mt-1 font-mono text-lg tabular-nums">{formatPsi(latest)} PSI</div>
            </div>
          );
        })}
      </div>

      {pressureReadings.length === 0 ? (
        <div className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center border text-sm">
          AWAITING DATA
        </div>
      ) : (
        <PressureWidgetChart />
      )}
    </div>
  );
}
