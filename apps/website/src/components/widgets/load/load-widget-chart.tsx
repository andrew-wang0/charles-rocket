"use client";

import React from "react";
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";

import type { ChartConfig } from "@/components/ui/chart";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { TimedReadings } from "@/lib/store";
import { useStore } from "@/lib/store";
import {
  bucketReadings,
  CHART_WINDOW_MS,
  createTickValues,
  formatRelativeTick,
} from "@/lib/util/chart";

type LoadChartPoint = {
  time: number;
  load: number | null;
};

export const loadChartConfig = {
  load: {
    label: "Load",
    color: "#c2410c",
  },
} satisfies ChartConfig;

function buildChartData(loadReadings: TimedReadings): LoadChartPoint[] {
  return bucketReadings(loadReadings).map((reading) => ({
    time: reading.time,
    load: reading.value,
  }));
}

export function LoadWidgetChart() {
  const loadReadings = useStore((store) => store.loadReadings);
  const chartData = React.useMemo(() => buildChartData(loadReadings), [loadReadings]);
  const latestTime = chartData.at(-1)?.time ?? 0;
  const windowStart = Math.max(0, latestTime - CHART_WINDOW_MS);

  const tickValues = React.useMemo(
    () => createTickValues(windowStart, latestTime),
    [latestTime, windowStart],
  );

  return (
    <ChartContainer
      config={loadChartConfig}
      className="aspect-auto h-full min-h-0 w-full flex-1 overflow-hidden"
    >
      <LineChart
        accessibilityLayer
        data={chartData}
        margin={{
          left: 18,
          right: 10,
        }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          type="number"
          dataKey="time"
          domain={[windowStart, latestTime]}
          ticks={tickValues}
          interval={0}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          allowDecimals={false}
          tickFormatter={(value) => formatRelativeTick(Number(value), latestTime)}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent indicator="line" labelFormatter={() => null} />}
        />
        <Line
          dataKey="load"
          type="natural"
          stroke="var(--color-load)"
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
        <ChartLegend content={<ChartLegendContent />} />
      </LineChart>
    </ChartContainer>
  );
}
