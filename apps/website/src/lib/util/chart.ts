import type { TimedReadings } from "@/lib/store";

export const CHART_WINDOW_MS = 30_000;
export const CHART_TICK_INTERVAL_MS = 5_000;
export const CHART_BUCKET_MS = 50;

export function formatChartValue(value: number | undefined) {
  if (value === undefined) return "--";
  return value.toFixed(2);
}

export function formatAxisTick(value: number) {
  const rounded = Math.round(value * 10) / 10;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;

  if (Number.isInteger(normalized)) {
    return String(normalized);
  }

  return normalized.toFixed(1);
}

export function createTickValues(windowStart: number, latestTime: number) {
  const tickCount = CHART_WINDOW_MS / CHART_TICK_INTERVAL_MS;

  return Array.from({ length: tickCount + 1 }, (_, index) => {
    const tick = windowStart + index * CHART_TICK_INTERVAL_MS;
    return Math.min(tick, latestTime);
  });
}

export function bucketReadings(readings: TimedReadings) {
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

export function formatRelativeTick(value: number, latestTime: number) {
  const secondsFromLatest = Math.round((value - latestTime) / 1000);
  return String(secondsFromLatest);
}
