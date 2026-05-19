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
  formatChartValue,
  formatRelativeTick,
  type PressureChartPoint,
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

const PRESSURE_AXIS_TICK_COUNT = 5;
const MIN_PRESSURE_AXIS_RANGE_PSI = 10;

function getNiceAxisStep(minStep: number) {
  const magnitude = 10 ** Math.floor(Math.log10(minStep));
  const normalized = minStep / magnitude;

  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 2.5) return 2.5 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function buildPressureAxisTicks(chartData: PressureChartPoint[]) {
  const values = chartData
    .flatMap((point) => [point.pt1, point.pt2, point.pt3])
    .filter((value): value is number => value !== null);

  if (values.length === 0) {
    return [-5, -2.5, 0, 2.5, 5];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min >= 0) {
    const step = getNiceAxisStep(Math.max(max, MIN_PRESSURE_AXIS_RANGE_PSI) / 4);
    return Array.from({ length: PRESSURE_AXIS_TICK_COUNT }, (_, index) => step * index);
  }

  if (max <= 0) {
    const step = getNiceAxisStep(Math.max(Math.abs(min), MIN_PRESSURE_AXIS_RANGE_PSI) / 4);
    return Array.from({ length: PRESSURE_AXIS_TICK_COUNT }, (_, index) => step * (index - 4));
  }

  const maxAbs = Math.max(Math.abs(min), Math.abs(max));
  const step = getNiceAxisStep(Math.max(maxAbs / 2, MIN_PRESSURE_AXIS_RANGE_PSI / 4));
  return Array.from({ length: PRESSURE_AXIS_TICK_COUNT }, (_, index) => step * (index - 2));
}

export const PressureWidgetChart = React.memo(function PressureWidgetChart() {
  const chartData = useStore((store) => store.pressureChartData);
  const latestTime = chartData.at(-1)?.time ?? 0;
  const windowStart = Math.max(0, latestTime - CHART_WINDOW_MS);

  const tickValues = React.useMemo(
    () => createTickValues(windowStart, latestTime),
    [latestTime, windowStart],
  );
  const pressureAxisTicks = React.useMemo(() => buildPressureAxisTicks(chartData), [chartData]);

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
          ticks={pressureAxisTicks}
          domain={[
            pressureAxisTicks[0] ?? 0,
            pressureAxisTicks.at(-1) ?? MIN_PRESSURE_AXIS_RANGE_PSI,
          ]}
          width={52}
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
          content={
            <ChartTooltipContent
              indicator="line"
              valueFormatter={(value) => `${formatChartValue(Number(value), 1)} PSI`}
            />
          }
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
