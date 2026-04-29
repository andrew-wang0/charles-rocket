"use client";

import React from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import type { ChartConfig } from "@/components/ui/chart";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useStore } from "@/lib/store";
import {
  CHART_WINDOW_MS,
  createTickValues,
  formatAxisTick,
  formatRelativeTick,
} from "@/lib/util/chart";

export const loadChartConfig = {
  load: {
    label: "Load",
    color: "#c2410c",
  },
} satisfies ChartConfig;

export const LoadWidgetChart = React.memo(function LoadWidgetChart() {
  const chartData = useStore((store) => store.loadChartData);
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
          left: 4,
          right: 10,
        }}
      >
        <CartesianGrid vertical={false} />
        <YAxis
          axisLine={false}
          tickLine={false}
          tickMargin={6}
          width={44}
          tickFormatter={(value) => formatAxisTick(Number(value))}
        />
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
});
