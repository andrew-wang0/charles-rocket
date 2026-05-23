"use client";

import React from "react";

import { client } from "@/client";
import { CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadChartConfig, LoadWidgetChart } from "@/components/widgets/load/load-widget-chart";
import { WidgetCard } from "@/components/widgets/widget-card";
import { WidgetChartRangeControl } from "@/components/widgets/widget-chart-range-control";
import { WidgetChartValueCard } from "@/components/widgets/widget-chart-value-card";
import { useStore } from "@/lib/store";
import { formatChartValue } from "@/lib/util/chart";

import { WidgetNoSignal } from "../widget-no-signal";

export function LoadWidget() {
  const hasLoadData = useStore((store) => store.loadChartData.length > 0);
  const chartPaused = useStore((store) => store.loadChartPaused);
  const chartWindowMs = useStore((store) => store.loadChartWindowMs);
  const latest = useStore((store) => store.loadLatestValue);
  const setChartPaused = useStore((store) => store.setLoadChartPaused);
  const setChartWindowMs = useStore((store) => store.setLoadChartWindowMs);
  const [maxResetKey, setMaxResetKey] = React.useState(0);
  const [tarePending, setTarePending] = React.useState(false);

  async function handleTare() {
    if (tarePending || latest === undefined) return;

    setTarePending(true);

    try {
      await client.tare({
        device: "load",
      });
      setMaxResetKey((key) => key + 1);
    } catch (error) {
      console.error("Failed to tare load cell", error);
    } finally {
      setTarePending(false);
    }
  }

  return (
    <WidgetCard size="sm">
      <CardHeader>
        <CardTitle>Load Monitor</CardTitle>
        <CardAction>
          <WidgetChartRangeControl
            ariaLabel="Load chart history range"
            onPausedChange={setChartPaused}
            onValueChange={setChartWindowMs}
            paused={chartPaused}
            value={chartWindowMs}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <WidgetChartValueCard
          label="Load"
          color={loadChartConfig.load.color}
          value={latest}
          display={(value) => `${formatChartValue(value, 2)} lb`}
          onTare={() => {
            void handleTare();
          }}
          tareDisabled={latest === undefined || tarePending}
          maxResetKey={maxResetKey}
          trackMax
        />
        {!hasLoadData ? <WidgetNoSignal className="flex-1" /> : <LoadWidgetChart />}
      </CardContent>
    </WidgetCard>
  );
}
