"use client";

import React from "react";

import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  chartConfig,
  PressureWidgetChart,
} from "@/components/widgets/pressure/pressure-widget-chart";
import { WidgetCard } from "@/components/widgets/widget-card";
import { WidgetChartValueCard } from "@/components/widgets/widget-chart-value-card";
import { useStore } from "@/lib/store";
import { formatChartValue } from "@/lib/util/chart";

import { WidgetNoSignal } from "../widget-no-signal";

export function PressureWidget() {
  const hasPressureData = useStore((store) => store.pressureChartData.length > 0);
  const pt1 = useStore((store) => store.pressureLatestValues[0]);
  const pt2 = useStore((store) => store.pressureLatestValues[1]);
  const pt3 = useStore((store) => store.pressureLatestValues[2]);
  const latestValues = [pt1, pt2, pt3];

  return (
    <WidgetCard size="sm">
      <CardHeader>
        <CardTitle>PT Monitor</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="flex shrink-0 gap-2">
            {Object.entries(chartConfig).map(([_, { label, color }], index) => {
              const latest = latestValues[index];

              return (
                <WidgetChartValueCard
                  key={index}
                  label={label}
                  color={color}
                  value={latest}
                  display={(value) => `${formatChartValue(value)} PSI`}
                  onTare={() => {}}
                />
              );
            })}
          </div>

          {!hasPressureData ? <WidgetNoSignal /> : <PressureWidgetChart />}
        </div>
      </CardContent>
    </WidgetCard>
  );
}
