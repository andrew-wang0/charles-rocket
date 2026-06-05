import { create } from "zustand";

import { PRESSURE_TRANSDUCER_COUNT, SERVO_COUNT } from "@/lib/constants";
import type { TimedReadings } from "@/lib/readings";
import {
  appendLoadChartData,
  appendPressureChartData,
  buildLoadChartData,
  buildPressureChartData,
  DEFAULT_CHART_WINDOW_MS,
  type LoadChartPoint,
  type PressureChartPoint,
} from "@/lib/util/chart";
import { IgnitionState } from "@/types/ignition";
import { ServoState } from "@/types/servo";

const INITIAL_TIME = -1;

export type ReadingsStatus = {
  servoControllerOk: boolean;
  pressureSensorsOk: boolean[];
  loadSensorOk: boolean;
  audioOk: boolean;
};

type Store = {
  pressureChartData: PressureChartPoint[];
  pressureLatestTimes: number[];
  pressureLatestValues: Array<number | undefined>;

  loadChartData: LoadChartPoint[];
  loadLatestTime: number;
  loadLatestValue: number | undefined;
  loadChartWindowMs: number;
  pressureChartWindowMs: number;
  setLoadChartWindowMs: (chartWindowMs: number) => void;
  setPressureChartWindowMs: (chartWindowMs: number) => void;

  hydrateReadings: (
    status: ReadingsStatus,
    data: {
      load: TimedReadings;
      pressure: TimedReadings[];
    },
  ) => void;
  appendReadings: (
    status: ReadingsStatus,
    data: {
      load: TimedReadings;
      pressure: TimedReadings[];
    },
  ) => void;

  readingsStatus: ReadingsStatus;

  ignitionState: IgnitionState;
  ignitionPendingCount: number;
  setIgnitionState: (state: IgnitionState) => void;
  startIgnitionRequest: () => void;
  finishIgnitionRequest: () => void;

  servoStates: ServoState[];
  setServoState: (index: number, state: ServoState) => void;
  syncServoStates: (states: { index: number; state: ServoState }[]) => void;
  resetServoStates: () => void;
};

function createInitialServoStates() {
  return Array.from({ length: SERVO_COUNT }, () => ServoState.UNKNOWN);
}

function createInitialPressureLatestTimes() {
  return Array.from({ length: PRESSURE_TRANSDUCER_COUNT }, () => INITIAL_TIME);
}

function createInitialPressureLatestValues(): Array<number | undefined> {
  return Array.from({ length: PRESSURE_TRANSDUCER_COUNT }, () => undefined);
}

function areReadingsStatusesEqual(left: ReadingsStatus, right: ReadingsStatus) {
  return (
    left.servoControllerOk === right.servoControllerOk &&
    left.loadSensorOk === right.loadSensorOk &&
    left.audioOk === right.audioOk &&
    left.pressureSensorsOk.length === right.pressureSensorsOk.length &&
    left.pressureSensorsOk.every((value, index) => value === right.pressureSensorsOk[index])
  );
}

function filterNewReadings(incoming: TimedReadings, lastTime: number) {
  let firstNewIndex = 0;

  while ((incoming[firstNewIndex]?.time ?? Number.POSITIVE_INFINITY) <= lastTime) {
    firstNewIndex += 1;
  }

  return firstNewIndex === 0 ? incoming : incoming.slice(firstNewIndex);
}

export const useStore = create<Store>((set) => ({
  pressureChartData: [],
  pressureLatestTimes: createInitialPressureLatestTimes(),
  pressureLatestValues: createInitialPressureLatestValues(),

  loadChartData: [],
  loadLatestTime: INITIAL_TIME,
  loadLatestValue: undefined,
  loadChartWindowMs: DEFAULT_CHART_WINDOW_MS,
  pressureChartWindowMs: DEFAULT_CHART_WINDOW_MS,
  setLoadChartWindowMs: (chartWindowMs) => set({ loadChartWindowMs: chartWindowMs }),
  setPressureChartWindowMs: (chartWindowMs) => set({ pressureChartWindowMs: chartWindowMs }),

  hydrateReadings: (status, data) =>
    set((state) => {
      const nextLoadLatest = data.load.at(-1);
      const pressureLatestTimes = createInitialPressureLatestTimes();
      const pressureLatestValues = createInitialPressureLatestValues();

      data.pressure.forEach((readings, index) => {
        const latest = readings.at(-1);
        pressureLatestTimes[index] = latest?.time ?? INITIAL_TIME;
        pressureLatestValues[index] = latest?.value;
      });

      return {
        pressureChartData: buildPressureChartData(data.pressure),
        pressureLatestTimes,
        pressureLatestValues,
        loadChartData: buildLoadChartData(data.load),
        loadLatestTime: nextLoadLatest?.time ?? INITIAL_TIME,
        loadLatestValue: nextLoadLatest?.value,
        readingsStatus: areReadingsStatusesEqual(state.readingsStatus, status)
          ? state.readingsStatus
          : status,
      };
    }),

  appendReadings: (status, data) =>
    set((state) => {
      const nextLoadReadings = filterNewReadings(data.load, state.loadLatestTime);
      const nextPressureReadings = data.pressure.map((readings, index) =>
        filterNewReadings(readings, state.pressureLatestTimes[index] ?? INITIAL_TIME),
      );

      const loadChanged = nextLoadReadings.length > 0;
      const pressureChanged = nextPressureReadings.some((readings) => readings.length > 0);
      const statusChanged = !areReadingsStatusesEqual(state.readingsStatus, status);

      if (!loadChanged && !pressureChanged && !statusChanged) {
        return state;
      }

      const nextState: Partial<Store> = {
        readingsStatus: statusChanged ? status : state.readingsStatus,
      };

      if (loadChanged) {
        const latestLoad = nextLoadReadings.at(-1);

        nextState.loadChartData = appendLoadChartData(state.loadChartData, nextLoadReadings);
        nextState.loadLatestTime = latestLoad?.time ?? state.loadLatestTime;
        nextState.loadLatestValue = latestLoad?.value ?? state.loadLatestValue;
      }

      if (pressureChanged) {
        const pressureLatestTimes = state.pressureLatestTimes.slice();
        const pressureLatestValues = [...state.pressureLatestValues];

        nextPressureReadings.forEach((readings, index) => {
          const latest = readings.at(-1);
          if (!latest) return;

          pressureLatestTimes[index] = latest.time;
          pressureLatestValues[index] = latest.value;
        });

        nextState.pressureChartData = appendPressureChartData(
          state.pressureChartData,
          nextPressureReadings,
        );
        nextState.pressureLatestTimes = pressureLatestTimes;
        nextState.pressureLatestValues = pressureLatestValues;
      }

      return nextState;
    }),

  readingsStatus: {
    servoControllerOk: false,
    pressureSensorsOk: Array.from({ length: PRESSURE_TRANSDUCER_COUNT }, () => false),
    loadSensorOk: false,
    audioOk: false,
  },

  ignitionState: IgnitionState.UNKNOWN,
  ignitionPendingCount: 0,
  setIgnitionState: (ignitionState) => set({ ignitionState }),
  startIgnitionRequest: () =>
    set((state) => ({
      ignitionPendingCount: state.ignitionPendingCount + 1,
    })),
  finishIgnitionRequest: () =>
    set((state) => ({
      ignitionPendingCount: Math.max(0, state.ignitionPendingCount - 1),
    })),

  servoStates: createInitialServoStates(),

  setServoState: (index, servoState) =>
    set((state) => {
      const servoStates = [...state.servoStates];
      servoStates[index] = servoState;
      return { servoStates };
    }),

  syncServoStates: (states) =>
    set(() => {
      const servoStates = createInitialServoStates();

      states.forEach(({ index, state }) => {
        servoStates[index] = state;
      });

      return { servoStates };
    }),

  resetServoStates: () => set({ servoStates: createInitialServoStates() }),
}));
