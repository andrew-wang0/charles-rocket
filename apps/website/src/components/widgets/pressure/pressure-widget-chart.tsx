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

const CHART_WINDOW_MS = 30_000;
const CHART_TICK_INTERVAL_MS = 5_000;
const CHART_BUCKET_MS = 100;

type PressureChartPoint = {
  time: number;
  pt1: number | null;
  pt2: number | null;
  pt3: number | null;
};

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

export function formatPsi(value: number | undefined) {
  if (value === undefined) return "--";
  return value.toFixed(2);
}

function createTickValues(windowStart: number, latestTime: number) {
  const tickCount = CHART_WINDOW_MS / CHART_TICK_INTERVAL_MS;

  return Array.from({ length: tickCount + 1 }, (_, index) => {
    const tick = windowStart + index * CHART_TICK_INTERVAL_MS;
    return Math.min(tick, latestTime);
  });
}

function formatRelativeTick(value: number, latestTime: number) {
  const secondsFromLatest = Math.round((value - latestTime) / 1000);
  return String(secondsFromLatest);
}

function bucketReadingsBySecond(readings: TimedReadings) {
  const buckets = new Map<number, TimedReadings[number]>();

  for (const reading of readings) {
    const bucketTime = Math.floor(reading.time / CHART_BUCKET_MS) * CHART_BUCKET_MS;
    buckets.set(bucketTime, {
      time: bucketTime,
      value: reading.value,
    });
  }

  return Array.from(buckets.values()).sort((left, right) => left.time - right.time);
}

function buildChartData(pressureReadings: TimedReadings[]): PressureChartPoint[] {
  const bucketedReadings = pressureReadings.map(bucketReadingsBySecond);
  const timestamps = Array.from(
    new Set(bucketedReadings.flatMap((readings) => readings.map((reading) => reading.time))),
  ).sort((left, right) => left - right);

  if (timestamps.length === 0) return [];

  const valueMaps = bucketedReadings.map(
    (readings) => new Map(readings.map((reading) => [reading.time, reading.value])),
  );

  return timestamps.map((timestamp) => ({
    time: timestamp,
    pt1: valueMaps[0]?.get(timestamp) ?? null,
    pt2: valueMaps[1]?.get(timestamp) ?? null,
    pt3: valueMaps[2]?.get(timestamp) ?? null,
  }));
}

export function PressureWidgetChart() {
  const pressureReadings = useStore((store) => store.pressureReadings);
  const chartData = React.useMemo(() => buildChartData(pressureReadings), [pressureReadings]);
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
          left: 10,
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
          content={<ChartTooltipContent indicator="line" />}
          labelFormatter={() => ""}
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
}
