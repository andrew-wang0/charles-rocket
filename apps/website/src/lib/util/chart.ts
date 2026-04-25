import type { TimedReadings } from "@/lib/readings";

export const CHART_WINDOW_MS = 30_000;
export const CHART_TICK_INTERVAL_MS = 5_000;
export const CHART_BUCKET_MS = 50;

const PRESSURE_KEYS = ["pt1", "pt2", "pt3"] as const;
type PressureKey = (typeof PRESSURE_KEYS)[number];

export type LoadChartPoint = {
  time: number;
  load: number | null;
};

export type PressureChartPoint = {
  time: number;
  pt1: number | null;
  pt2: number | null;
  pt3: number | null;
};

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

function getChartBucketTime(time: number) {
  return Math.floor(time / CHART_BUCKET_MS) * CHART_BUCKET_MS;
}

function bucketReadings(readings: TimedReadings) {
  const buckets = new Map<number, TimedReadings[number]>();

  for (const reading of readings) {
    const bucketTime = getChartBucketTime(reading.time);
    buckets.set(bucketTime, {
      time: bucketTime,
      value: reading.value,
    });
  }

  // Readings are appended in timestamp order, so bucket insertion order is already sorted.
  return Array.from(buckets.values());
}

function mergeSortedReadingTimes(readingsWindows: TimedReadings[]) {
  const positions = Array.from({ length: readingsWindows.length }, () => 0);
  const timestamps: number[] = [];
  let lastTimestamp = -1;

  for (;;) {
    let nextTimestamp = Number.POSITIVE_INFINITY;

    for (let index = 0; index < readingsWindows.length; index += 1) {
      const readings = readingsWindows[index];
      const reading = readings.at(positions[index]);

      if (reading && reading.time < nextTimestamp) {
        nextTimestamp = reading.time;
      }
    }

    if (!Number.isFinite(nextTimestamp)) {
      return timestamps;
    }

    if (nextTimestamp !== lastTimestamp) {
      timestamps.push(nextTimestamp);
      lastTimestamp = nextTimestamp;
    }

    for (let index = 0; index < readingsWindows.length; index += 1) {
      const readings = readingsWindows[index];

      while (readings.at(positions[index])?.time === nextTimestamp) {
        positions[index] += 1;
      }
    }
  }
}

function createPressureChartPoint(time: number): PressureChartPoint {
  return {
    time,
    pt1: null,
    pt2: null,
    pt3: null,
  };
}

function trimChartWindow<T extends { time: number }>(chartData: T[], latestTime: number) {
  const cutoff = latestTime - CHART_WINDOW_MS;
  let firstVisibleIndex = 0;

  while (chartData[firstVisibleIndex]?.time < cutoff) {
    firstVisibleIndex += 1;
  }

  return firstVisibleIndex === 0 ? chartData : chartData.slice(firstVisibleIndex);
}

function replaceLastChartPoint<T>(chartData: T[], point: T) {
  const nextChartData = chartData.slice();
  nextChartData[nextChartData.length - 1] = point;
  return nextChartData;
}

export function buildLoadChartData(loadReadings: TimedReadings): LoadChartPoint[] {
  return bucketReadings(loadReadings).map((reading) => ({
    time: reading.time,
    load: reading.value,
  }));
}

export function buildPressureChartData(pressureReadings: TimedReadings[]): PressureChartPoint[] {
  const bucketedReadings = pressureReadings.map(bucketReadings);
  const timestamps = mergeSortedReadingTimes(bucketedReadings);

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

export function appendLoadChartData(chartData: LoadChartPoint[], incomingReadings: TimedReadings) {
  let nextChartData = chartData;

  for (const reading of incomingReadings) {
    const bucketTime = getChartBucketTime(reading.time);
    const lastPoint = nextChartData.at(-1);

    if (lastPoint?.time === bucketTime) {
      if (lastPoint.load === reading.value) {
        continue;
      }

      nextChartData = replaceLastChartPoint(nextChartData, {
        time: bucketTime,
        load: reading.value,
      });
      continue;
    }

    nextChartData = [
      ...trimChartWindow(nextChartData, bucketTime),
      {
        time: bucketTime,
        load: reading.value,
      },
    ];
  }

  return nextChartData;
}

export function appendPressureChartData(
  chartData: PressureChartPoint[],
  incomingReadings: TimedReadings[],
) {
  const pendingReadings = incomingReadings
    .flatMap((readings, sensorIndex) =>
      readings.map((reading) => ({
        sensorIndex,
        time: reading.time,
        value: reading.value,
      })),
    )
    .sort((left, right) => left.time - right.time);

  let nextChartData = chartData;

  for (const reading of pendingReadings) {
    const bucketTime = getChartBucketTime(reading.time);
    const key = PRESSURE_KEYS[reading.sensorIndex] as PressureKey;
    const lastPoint = nextChartData.at(-1);

    if (lastPoint?.time === bucketTime) {
      if (lastPoint[key] === reading.value) {
        continue;
      }

      nextChartData = replaceLastChartPoint(nextChartData, {
        ...lastPoint,
        [key]: reading.value,
      });
      continue;
    }

    const nextPoint = createPressureChartPoint(bucketTime);
    nextPoint[key] = reading.value;

    nextChartData = [...trimChartWindow(nextChartData, bucketTime), nextPoint];
  }

  return nextChartData;
}

export function formatRelativeTick(value: number, latestTime: number) {
  const secondsFromLatest = Math.round((value - latestTime) / 1000);
  return String(secondsFromLatest);
}
