import { method } from "@danscan/zod-jsonrpc";
import z from "zod";

import { result } from "@/client/router/types";
import { SERVO_COUNT } from "@/lib/constants";
import { ServoState } from "@/types/servo";

const servoIndex = z.int().min(1).max(SERVO_COUNT);
const servoStateValue = z.enum(ServoState);

export const servoSnapshot = z.object({
  states: z
    .object({
      index: servoIndex,
      state: servoStateValue,
    })
    .array()
    .length(SERVO_COUNT),
});

export const servoControlResult = result.extend(servoSnapshot.shape);

export const servoControl = method({
  paramsSchema: z.object({
    index: servoIndex,
    set: z.enum([ServoState.OPEN, ServoState.CLOSED]),
  }),
  resultSchema: servoControlResult,
});

export const servoState = method({
  paramsSchema: z.void(),
  resultSchema: servoSnapshot,
});

export const servoStateNotification = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("servoState"),
  params: servoSnapshot,
});

export type ServoSnapshot = z.infer<typeof servoSnapshot>;
