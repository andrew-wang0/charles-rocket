"use client";

import { ArrowsOutIcon, MagnifyingGlassIcon, SpinnerGapIcon, XIcon } from "@phosphor-icons/react";
import React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { client } from "@/client";
import { Button } from "@/components/ui/button";
import type { ChartConfig } from "@/components/ui/chart";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { loadChartConfig } from "@/components/widgets/load/load-widget-chart";
import { chartConfig as pressureChartConfig } from "@/components/widgets/pressure/pressure-widget-chart";
import {
  buildRawLoadChartData,
  buildRawPressureChartData,
  formatChartValue,
  formatClockTimestamp,
  type LoadChartPoint,
  type PressureChartPoint,
} from "@/lib/util/chart";

type GraphKind = "pressure" | "load";

type Props = {
  kind: GraphKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type InspectionPoint = {
  time: number;
  [key: string]: number | null;
};

type SeriesConfig = {
  key: string;
  label: string;
  color: string;
};

const DEFAULT_INSPECTION_WINDOW_MS = 60_000;
const INSPECTION_MAX_POINTS_PER_LINE = 1_200;

const PRESSURE_SERIES = [
  { key: "pt1", label: "PT 1", color: pressureChartConfig.pt1.color },
  { key: "pt2", label: "PT 2", color: pressureChartConfig.pt2.color },
  { key: "pt3", label: "PT 3", color: pressureChartConfig.pt3.color },
] satisfies SeriesConfig[];

const LOAD_SERIES = [
  { key: "load", label: "Load", color: loadChartConfig.load.color },
] satisfies SeriesConfig[];

function getDomain(data: Array<{ time: number }>, fallback: readonly [number, number]) {
  const first = data.at(0)?.time ?? fallback[0];
  const last = data.at(-1)?.time ?? fallback[1];
  return [first, last] as const;
}

function getReferenceValues(data: InspectionPoint[], series: SeriesConfig[]) {
  return series.map((entry) => {
    const values = data
      .map((point) => point[entry.key])
      .filter((value): value is number => typeof value === "number");

    return {
      ...entry,
      min: values.length > 0 ? Math.min(...values) : undefined,
      max: values.length > 0 ? Math.max(...values) : undefined,
    };
  });
}

function getVisibleData<TPoint extends { time: number }>(
  data: TPoint[],
  domain: readonly [number, number],
) {
  return data.filter((point) => point.time >= domain[0] && point.time <= domain[1]);
}

function downsampleReadings<T>(readings: T[], maxPoints: number) {
  if (readings.length <= maxPoints) return readings;

  return Array.from({ length: maxPoints }, (_, index) => {
    return readings[roundToNearestIndex(index, readings.length, maxPoints)];
  });
}

function roundToNearestIndex(index: number, totalPoints: number, maxPoints: number) {
  return Math.round((index * (totalPoints - 1)) / (maxPoints - 1));
}

function downsampleChartData(
  data: InspectionPoint[],
  series: SeriesConfig[],
  maxPointsPerLine: number,
) {
  if (series.length === 0) return [];

  const pointsByTime = new Map<number, InspectionPoint>();

  for (const entry of series) {
    const readings = data
      .map((point) => ({
        time: point.time,
        value: point[entry.key],
      }))
      .filter((point): point is { time: number; value: number } => {
        return typeof point.value === "number";
      });

    for (const reading of downsampleReadings(readings, maxPointsPerLine)) {
      const point = pointsByTime.get(reading.time) ?? { time: reading.time };
      point[entry.key] = reading.value;
      pointsByTime.set(reading.time, point);
    }
  }

  return Array.from(pointsByTime.values()).sort((left, right) => left.time - right.time);
}

function getInspectionCopy(kind: GraphKind) {
  if (kind === "pressure") {
    return {
      title: "PT Monitor",
      unit: "PSI",
      precision: 1,
      config: pressureChartConfig,
      series: PRESSURE_SERIES,
    };
  }

  return {
    title: "Load Monitor",
    unit: "lb",
    precision: 2,
    config: loadChartConfig,
    series: LOAD_SERIES,
  };
}

function toDatetimeLocalValue(time: number) {
  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function fromDatetimeLocalValue(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

export function GraphInspectionModal({ kind, open, onOpenChange }: Props) {
  const copy = getInspectionCopy(kind);
  const [pressureData, setPressureData] = React.useState<PressureChartPoint[]>([]);
  const [loadData, setLoadData] = React.useState<LoadChartPoint[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [queryDomain, setQueryDomain] = React.useState<readonly [number, number]>(() => {
    const end = Date.now();
    return [end - DEFAULT_INSPECTION_WINDOW_MS, end];
  });
  const [domain, setDomain] = React.useState<readonly [number, number] | null>(null);
  const [startInput, setStartInput] = React.useState("");
  const [endInput, setEndInput] = React.useState("");
  const [hiddenSeries, setHiddenSeries] = React.useState<Set<string>>(() => new Set());
  const [selectionStart, setSelectionStart] = React.useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = React.useState<number | null>(null);

  const data = (kind === "pressure" ? pressureData : loadData) as InspectionPoint[];
  const visibleSeries = React.useMemo(
    () => copy.series.filter((entry) => !hiddenSeries.has(entry.key)),
    [copy.series, hiddenSeries],
  );
  const fullDomain = React.useMemo(() => getDomain(data, queryDomain), [data, queryDomain]);
  const activeDomain = domain ?? fullDomain;
  const visibleData = React.useMemo(() => getVisibleData(data, activeDomain), [activeDomain, data]);
  const renderData = React.useMemo(
    () => downsampleChartData(visibleData, visibleSeries, INSPECTION_MAX_POINTS_PER_LINE),
    [visibleData, visibleSeries],
  );
  const referenceValues = React.useMemo(
    () => getReferenceValues(visibleData, visibleSeries),
    [visibleData, visibleSeries],
  );
  const legendValues = React.useMemo(
    () => getReferenceValues(visibleData, copy.series),
    [copy.series, visibleData],
  );
  const hasZoom = domain !== null;

  const loadHistory = React.useCallback(async (range: readonly [number, number]) => {
    setLoading(true);
    setError(null);

    try {
      const result = await client.readings({
        history: true,
        startTime: range[0],
        endTime: range[1],
      });

      setPressureData(buildRawPressureChartData(result.data.pressure));
      setLoadData(buildRawLoadChartData(result.data.load));
      setQueryDomain(range);
      setDomain(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load graph history");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDefaultHistory = React.useCallback(() => {
    const end = Date.now();
    const range = [end - DEFAULT_INSPECTION_WINDOW_MS, end] as const;

    setStartInput(toDatetimeLocalValue(range[0]));
    setEndInput(toDatetimeLocalValue(range[1]));
    void loadHistory(range);
  }, [loadHistory]);

  React.useEffect(() => {
    if (!open) return;

    const timeoutId = window.setTimeout(loadDefaultHistory, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadDefaultHistory, open]);

  function beginSelection(label: unknown) {
    const time = Number(label);
    if (!Number.isFinite(time)) return;

    setSelectionStart(time);
    setSelectionEnd(time);
  }

  function updateSelection(label: unknown) {
    if (selectionStart === null) return;

    const time = Number(label);
    if (!Number.isFinite(time)) return;

    setSelectionEnd(time);
  }

  function finishSelection() {
    if (selectionStart === null || selectionEnd === null) {
      setSelectionStart(null);
      setSelectionEnd(null);
      return;
    }

    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);

    if (end - start > 10) {
      setDomain([start, end]);
    }

    setSelectionStart(null);
    setSelectionEnd(null);
  }

  function resetZoom() {
    setDomain(null);
    setSelectionStart(null);
    setSelectionEnd(null);
  }

  function searchRange() {
    const start = fromDatetimeLocalValue(startInput);
    const end = fromDatetimeLocalValue(endInput);

    if (start === undefined || end === undefined || start >= end) {
      setError("Choose a valid start and end time");
      return;
    }

    void loadHistory([start, end]);
  }

  function toggleSeries(key: string) {
    setHiddenSeries((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] lg:h-[86dvh] lg:max-w-6xl"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <div className="min-w-0">
            <DialogTitle>{copy.title}</DialogTitle>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <DialogClose asChild>
              <Button aria-label="Close inspection" size="icon-sm" type="button" variant="ghost">
                <XIcon />
              </Button>
            </DialogClose>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          <div className="grid shrink-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
            <label className="text-muted-foreground grid gap-1 text-[10px] uppercase">
              Start
              <input
                className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 min-w-0 border px-2 text-xs normal-case tabular-nums outline-none focus-visible:ring-1"
                onChange={(event) => setStartInput(event.target.value)}
                step={1}
                type="datetime-local"
                value={startInput}
              />
            </label>
            <label className="text-muted-foreground grid gap-1 text-[10px] uppercase">
              End
              <input
                className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 min-w-0 border px-2 text-xs normal-case tabular-nums outline-none focus-visible:ring-1"
                onChange={(event) => setEndInput(event.target.value)}
                step={1}
                type="datetime-local"
                value={endInput}
              />
            </label>
            <Button
              className="self-end"
              disabled={loading}
              onClick={searchRange}
              size="default"
              type="button"
              variant="outline"
            >
              <MagnifyingGlassIcon data-icon="inline-start" />
              Search
            </Button>
            <Button
              aria-label="Zoom out"
              className="self-end"
              disabled={!hasZoom}
              onClick={resetZoom}
              size="icon"
              title="Zoom out"
              type="button"
              variant="outline"
            >
              <ArrowsOutIcon />
            </Button>
          </div>

          {loading ? (
            <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-xs">
              <SpinnerGapIcon className="animate-spin" />
              Loading history
            </div>
          ) : error ? (
            <div className="text-destructive flex flex-1 items-center justify-center text-xs">
              {error}
            </div>
          ) : data.length === 0 ? (
            <div className="text-muted-foreground flex flex-1 items-center justify-center text-xs">
              No recorded data
            </div>
          ) : (
            <div className="bg-card grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden border p-2">
              <ChartContainer
                config={copy.config as ChartConfig}
                className="aspect-auto h-full min-h-0 w-full"
              >
                <LineChart
                  accessibilityLayer
                  data={renderData}
                  margin={{ top: 10, right: 18, bottom: 2, left: 6 }}
                  onMouseDown={(event) => beginSelection(event.activeLabel)}
                  onMouseMove={(event) => updateSelection(event.activeLabel)}
                  onMouseUp={finishSelection}
                >
                  <CartesianGrid vertical={false} />
                  <YAxis
                    axisLine={false}
                    domain={["dataMin", "dataMax"]}
                    tickLine={false}
                    tickMargin={8}
                    tickFormatter={(value) => formatChartValue(Number(value), copy.precision)}
                  />
                  <XAxis
                    allowDecimals={false}
                    axisLine={false}
                    dataKey="time"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(value) => formatClockTimestamp(Number(value))}
                    tickLine={false}
                    tickMargin={8}
                    type="number"
                  />
                  <ChartTooltip
                    cursor={{ stroke: "var(--border)" }}
                    content={
                      <ChartTooltipContent
                        indicator="line"
                        labelFormatter={(_label, payload) => {
                          const time = payload.at(0)?.payload?.time;
                          return typeof time === "number" ? formatClockTimestamp(time) : null;
                        }}
                        valueFormatter={(value) =>
                          `${formatChartValue(Number(value), copy.precision)} ${copy.unit}`
                        }
                      />
                    }
                  />
                  {referenceValues.map((entry) => (
                    <React.Fragment key={entry.key}>
                      {entry.min !== undefined ? (
                        <ReferenceLine
                          y={entry.min}
                          stroke={entry.color}
                          strokeDasharray="4 4"
                          strokeOpacity={0.38}
                        />
                      ) : null}
                      {entry.max !== undefined ? (
                        <ReferenceLine
                          y={entry.max}
                          stroke={entry.color}
                          strokeDasharray="4 4"
                          strokeOpacity={0.38}
                        />
                      ) : null}
                    </React.Fragment>
                  ))}
                  {visibleSeries.map((entry) => (
                    <Line
                      key={entry.key}
                      connectNulls
                      dataKey={entry.key}
                      dot={false}
                      isAnimationActive={false}
                      stroke={`var(--color-${entry.key})`}
                      strokeWidth={1.5}
                      type="linear"
                    />
                  ))}
                  {selectionStart !== null && selectionEnd !== null ? (
                    <ReferenceArea
                      x1={Math.min(selectionStart, selectionEnd)}
                      x2={Math.max(selectionStart, selectionEnd)}
                      stroke="var(--foreground)"
                      strokeOpacity={0.25}
                      fill="var(--foreground)"
                      fillOpacity={0.08}
                    />
                  ) : null}
                </LineChart>
              </ChartContainer>
              <div
                aria-label={`${copy.title} series`}
                className="flex shrink-0 items-start justify-center gap-5 pt-3 text-xs"
                role="group"
              >
                {legendValues.map((entry) => {
                  const hidden = hiddenSeries.has(entry.key);

                  return (
                    <button
                      key={entry.key}
                      aria-pressed={!hidden}
                      className={`text-foreground flex cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-0 transition-opacity hover:opacity-75 ${
                        hidden ? "opacity-55" : "opacity-100"
                      }`}
                      onClick={() => toggleSeries(entry.key)}
                      type="button"
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-xs border"
                          style={{
                            backgroundColor: hidden ? "transparent" : entry.color,
                            borderColor: entry.color,
                          }}
                        />
                        {entry.label}
                      </span>
                      <span className="text-muted-foreground text-[14px] tabular-nums">
                        {formatChartValue(entry.min, copy.precision)} /{" "}
                        {formatChartValue(entry.max, copy.precision)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
