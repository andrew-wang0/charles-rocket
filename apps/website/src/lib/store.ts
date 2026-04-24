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
  setServoStates: (states: Map<number, ServoState>) => void;
};

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

  servoStates: Array.from({ length: SERVO_COUNT }, () => ServoState.UNKNOWN),

  setServoState: (index, servoState) =>
    set((state) => {
      const servoStates = [...state.servoStates];
      servoStates[index] = servoState;
      return { servoStates };
    }),

  setServoStates: (states) =>
    set((state) => {
      const servoStates = [...state.servoStates];

      states.forEach((servoState, index) => {
        servoStates[index] = servoState;
      });

      return { servoStates };
    }),
}));
