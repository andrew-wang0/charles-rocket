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

export const chartConfig = {
  pt1: {
    label: "PT 1",
    color: "#047857",
  },
  pt2: {
    label: "PT 2",
    color: "#1d4ed8",
  },
  pt3: {
    label: "PT 3",
    color: "#6c00a0",
  },
} satisfies ChartConfig;

export const PressureWidgetChart = React.memo(function PressureWidgetChart() {
  const chartData = useStore((store) => store.pressureChartData);
  const latestTime = chartData.at(-1)?.time ?? 0;
  const windowStart = Math.max(0, latestTime - CHART_WINDOW_MS);

  const tickValues = React.useMemo(
    () => createTickValues(windowStart, latestTime),
    [latestTime, windowStart],
  );

  return (
    <ChartContainer
      config={chartConfig}
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
          content={<ChartTooltipContent indicator="line" />}
          labelFormatter={() => null}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          dataKey="pt1"
          type="natural"
          stroke="var(--color-pt1)"
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          dataKey="pt2"
          type="natural"
          stroke="var(--color-pt2)"
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          dataKey="pt3"
          type="natural"
          stroke="var(--color-pt3)"
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
});
