"use client";

import React from "react";

import { client } from "@/client";
import { CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  chartConfig,
  PressureWidgetChart,
} from "@/components/widgets/pressure/pressure-widget-chart";
import { WidgetCard } from "@/components/widgets/widget-card";
import { WidgetChartRangeControl } from "@/components/widgets/widget-chart-range-control";
import { WidgetChartValueCard } from "@/components/widgets/widget-chart-value-card";
import { useStore } from "@/lib/store";
import { formatChartValue } from "@/lib/util/chart";

import { WidgetNoSignal } from "../widget-no-signal";

export function PressureWidget() {
  const hasPressureData = useStore((store) => store.pressureChartData.length > 0);
  const chartPaused = useStore((store) => store.pressureChartPaused);
  const chartWindowMs = useStore((store) => store.pressureChartWindowMs);
  const pt1 = useStore((store) => store.pressureLatestValues[0]);
  const pt2 = useStore((store) => store.pressureLatestValues[1]);
  const pt3 = useStore((store) => store.pressureLatestValues[2]);
  const setChartPaused = useStore((store) => store.setPressureChartPaused);
  const setChartWindowMs = useStore((store) => store.setPressureChartWindowMs);
  const latestValues = [pt1, pt2, pt3];
  const [pendingIndex, setPendingIndex] = React.useState<number | null>(null);

  async function handleTare(index: number) {
    if (pendingIndex !== null || latestValues[index] === undefined) return;

    setPendingIndex(index);

    try {
      await client.tare({
        device: "pressure",
        index,
      });
    } catch (error) {
      console.error(`Failed to tare PT ${index + 1}`, error);
    } finally {
      setPendingIndex(null);
    }
  }

  return (
    <WidgetCard size="sm">
      <CardHeader>
        <CardTitle>PT Monitor</CardTitle>
        <CardAction>
          <WidgetChartRangeControl
            ariaLabel="Pressure chart history range"
            onPausedChange={setChartPaused}
            onValueChange={setChartWindowMs}
            paused={chartPaused}
            value={chartWindowMs}
          />
        </CardAction>
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
                  display={(value) => `${formatChartValue(value, 1)} PSI`}
                  onTare={() => {
                    void handleTare(index);
                  }}
                  tareDisabled={latest === undefined || pendingIndex !== null}
                />
              );
            })}
          </div>

          {!hasPressureData ? <WidgetNoSignal className="flex-1" /> : <PressureWidgetChart />}
        </div>
      </CardContent>
    </WidgetCard>
  );
}
