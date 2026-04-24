"use client";

import React from "react";

import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  chartConfig,
  PressureWidgetChart,
} from "@/components/widgets/pressure/pressure-widget-chart";
import { WidgetAwaitingData } from "@/components/widgets/widget-awaiting-data";
import { WidgetCard } from "@/components/widgets/widget-card";
import { WidgetChartValueCard } from "@/components/widgets/widget-chart-value-card";
import { useStore } from "@/lib/store";
import { formatChartValue } from "@/lib/util/chart";

export function PressureWidget() {
  const pressureReadings = useStore((store) => store.pressureReadings);
  const hasPressureData = pressureReadings.some((readings) => readings.length > 0);

  return (
    <WidgetCard size="sm">
      <CardHeader>
        <CardTitle>PT Monitor</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="flex shrink-0 gap-2">
            {Object.entries(chartConfig).map(([_, { label, color }], index) => {
              const latest = pressureReadings[index]?.at(-1)?.value;

              return (
                <WidgetChartValueCard
                  key={index}
                  label={label}
                  color={color}
                  value={`${formatChartValue(latest)} PSI`}
                />
              );
            })}
          </div>

          {!hasPressureData ? <WidgetAwaitingData /> : <PressureWidgetChart />}
        </div>
      </CardContent>
    </WidgetCard>
  );
}
