import z from "zod";
import { create } from "zustand";

import { PRESSURE_TRANSDUCER_COUNT, SERVO_COUNT } from "@/lib/constants";
import { ServoState } from "@/types/servo";

export const timedReadings = z
  .object({
    time: z.number().int().nonnegative(),
    value: z.number(),
  })
  .array();

export type TimedReadings = z.infer<typeof timedReadings>;
const READINGS_WINDOW_MS = 30_000;

export type ReadingsStatus = {
  servoControllerOk: boolean;
  pressureSensorsOk: boolean[];
  loadSensorOk: boolean;
};

type Store = {
  pressureReadings: TimedReadings[];
  setPressureReadings: (index: number, readings: TimedReadings) => void;
  setPressureWindows: (readings: TimedReadings[]) => void;
  appendPressureReadings: (readings: TimedReadings[]) => void;

  loadReadings: TimedReadings;
  setLoadReadings: (readings: TimedReadings) => void;
  appendLoadReadings: (readings: TimedReadings) => void;

  readingsStatus: ReadingsStatus;
  setReadingsStatus: (status: ReadingsStatus) => void;

  servoStates: ServoState[];
  setServoState: (index: number, state: ServoState) => void;
  syncServoStates: (states: { index: number; state: ServoState }[]) => void;
  resetServoStates: () => void;
};

function createInitialServoStates() {
  return Array.from({ length: SERVO_COUNT }, () => ServoState.UNKNOWN);
}

function mergeReadingsWindow(existing: TimedReadings, incoming: TimedReadings) {
  if (incoming.length === 0) return existing;

  const lastTime = existing.at(-1)?.time ?? -1;
  const next = incoming.filter((reading) => reading.time > lastTime);
  if (next.length === 0) return existing;

  const merged = [...existing, ...next];
  const cutoff = (merged.at(-1)?.time ?? 0) - READINGS_WINDOW_MS;
  return merged.filter((reading) => reading.time >= cutoff);
}

export const useStore = create<Store>((set) => ({
  pressureReadings: Array.from({ length: PRESSURE_TRANSDUCER_COUNT }, () => []),

  setPressureReadings: (index, readings) =>
    set((state) => {
      const pressureReadings = [...state.pressureReadings];
      pressureReadings[index] = readings;
      return { pressureReadings };
    }),

  setPressureWindows: (readings) => set({ pressureReadings: readings }),

  appendPressureReadings: (readings) =>
    set((state) => {
      const pressureReadings = state.pressureReadings.map((existing, index) => {
        const incoming = readings[index] ?? [];
        return mergeReadingsWindow(existing, incoming);
      });

      return { pressureReadings };
    }),

  loadReadings: [],

  setLoadReadings: (readings) => set({ loadReadings: readings }),

  appendLoadReadings: (readings) =>
    set((state) => ({
      loadReadings: mergeReadingsWindow(state.loadReadings, readings),
    })),

  readingsStatus: {
    servoControllerOk: false,
    pressureSensorsOk: Array.from({ length: PRESSURE_TRANSDUCER_COUNT }, () => false),
    loadSensorOk: false,
  },

  setReadingsStatus: (readingsStatus) => set({ readingsStatus }),

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
        servoStates[index - 1] = state;
      });

      return { servoStates };
    }),

  resetServoStates: () => set({ servoStates: createInitialServoStates() }),
}));
