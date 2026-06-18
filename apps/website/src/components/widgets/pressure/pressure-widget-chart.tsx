import React from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import type { ChartConfig } from "@/components/ui/chart";
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useStore } from "@/lib/store";
import {
  createTickValues,
  formatAxisTick,
  formatChartValue,
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

type PressureSeriesKey = keyof typeof chartConfig;
const PRESSURE_SERIES_KEYS = Object.keys(chartConfig) as PressureSeriesKey[];

function PressureLegendContent({
  hiddenSeries,
  onToggleSeries,
}: {
  hiddenSeries: Set<PressureSeriesKey>;
  onToggleSeries: (key: PressureSeriesKey) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-4 pt-3">
      {PRESSURE_SERIES_KEYS.map((key) => {
        const item = chartConfig[key];
        const hidden = hiddenSeries.has(key);

        return (
          <button
            key={key}
            aria-pressed={!hidden}
            className={`text-foreground flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 transition-opacity hover:opacity-75 ${
              hidden ? "opacity-55" : "opacity-100"
            }`}
            onClick={() => onToggleSeries(key)}
            type="button"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-xs border"
              style={{
                backgroundColor: hidden ? "transparent" : item.color,
                borderColor: item.color,
              }}
            />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export const PressureWidgetChart = React.memo(function PressureWidgetChart() {
  const chartData = useStore((store) => store.pressureChartData);
  const chartWindowMs = useStore((store) => store.pressureChartWindowMs);
  const [hiddenSeries, setHiddenSeries] = React.useState<Set<PressureSeriesKey>>(() => new Set());
  const latestTime = chartData.at(-1)?.time ?? 0;
  const windowStart = Math.max(0, latestTime - chartWindowMs);
  const visibleChartData = React.useMemo(
    () => chartData.filter((point) => point.time >= windowStart),
    [chartData, windowStart],
  );
  const visibleSeries = React.useMemo(
    () => PRESSURE_SERIES_KEYS.filter((key) => !hiddenSeries.has(key)),
    [hiddenSeries],
  );

  const tickValues = React.useMemo(
    () => createTickValues(windowStart, latestTime, chartWindowMs),
    [chartWindowMs, latestTime, windowStart],
  );
  const toggleSeries = React.useCallback((key: PressureSeriesKey) => {
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-full min-h-0 w-full flex-1 overflow-hidden"
    >
      <LineChart
        accessibilityLayer
        data={visibleChartData}
        margin={{
          left: 12,
          right: 10,
        }}
      >
        <CartesianGrid vertical={false} />
        <YAxis
          axisLine={false}
          domain={["dataMin", "dataMax"]}
          tickLine={false}
          tickMargin={6}
          width={64}
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
        <ChartLegend
          content={
            <PressureLegendContent hiddenSeries={hiddenSeries} onToggleSeries={toggleSeries} />
          }
        />
        {visibleSeries.map((key) => (
          <Line
            key={key}
            dataKey={key}
            type="linear"
            stroke={`var(--color-${key})`}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
});
