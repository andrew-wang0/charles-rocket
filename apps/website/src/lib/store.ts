import z from "zod";
import { create } from "zustand";

import { PRESSURE_TRANSDUCER_COUNT, SERVO_COUNT } from "@/lib/constants";
import { ServoState } from "@/types/servo";

export const timedReadings = z
  .object({
    time: z.iso.time(),
    value: z.number(),
  })
  .array();

type TimedReadings = z.infer<typeof timedReadings>;

type Store = {
  pressureReadings: TimedReadings[];
  setPressureReadings: (index: number, readings: TimedReadings) => void;

  loadReadings: TimedReadings;
  setLoadReadings: (readings: TimedReadings) => void;

  servoStates: ServoState[];
  setServoState: (index: number, state: ServoState) => void;
  syncServoStates: (states: { index: number; state: ServoState }[]) => void;
  resetServoStates: () => void;
};

function createInitialServoStates() {
  return Array.from({ length: SERVO_COUNT }, () => ServoState.UNKNOWN);
}

export const useStore = create<Store>((set) => ({
  pressureReadings: Array.from({ length: PRESSURE_TRANSDUCER_COUNT }, () => []),

  setPressureReadings: (index, readings) =>
    set((state) => {
      const pressureReadings = [...state.pressureReadings];
      pressureReadings[index] = readings;
      return { pressureReadings };
    }),

  loadReadings: [],

  setLoadReadings: (readings) => set({ loadReadings: readings }),

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
