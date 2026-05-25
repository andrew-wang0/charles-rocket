"use client";

import { ChartPolarIcon } from "@phosphor-icons/react";
import React from "react";

import { client } from "@/client";
import { Button } from "@/components/ui/button";
import { CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GraphInspectionModal } from "@/components/widgets/graph-inspection-modal";
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
  const chartWindowMs = useStore((store) => store.pressureChartWindowMs);
  const pt1 = useStore((store) => store.pressureLatestValues[0]);
  const pt2 = useStore((store) => store.pressureLatestValues[1]);
  const pt3 = useStore((store) => store.pressureLatestValues[2]);
  const setChartWindowMs = useStore((store) => store.setPressureChartWindowMs);
  const latestValues = [pt1, pt2, pt3];
  const [pendingIndex, setPendingIndex] = React.useState<number | null>(null);
  const [inspectionOpen, setInspectionOpen] = React.useState(false);

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
            inspectionButton={
              <Button
                aria-label="Inspect pressure graph"
                className="border-r-border text-muted-foreground hover:bg-muted hover:text-foreground h-4 w-5 border-0 border-r [&_svg:not([class*='size-'])]:size-2.5"
                onClick={() => setInspectionOpen(true)}
                size="icon-xs"
                title="Inspect pressure graph"
                type="button"
                variant="ghost"
              >
                <ChartPolarIcon />
              </Button>
            }
            onValueChange={setChartWindowMs}
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
      <GraphInspectionModal
        kind="pressure"
        open={inspectionOpen}
        onOpenChange={setInspectionOpen}
      />
    </WidgetCard>
  );
}
