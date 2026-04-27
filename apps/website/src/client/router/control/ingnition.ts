import { method } from "@danscan/zod-jsonrpc";
import z from "zod";

import { result } from "@/client/router/types";
import { IgnitionState } from "@/types/ignition";

const ignitionStateValue = z.enum(IgnitionState);
const ignitionTargetState = z.enum([IgnitionState.ON, IgnitionState.OFF]);

export const ignitionSnapshot = z.object({
  state: ignitionStateValue,
});

export const ignitionControlResult = result.extend(ignitionSnapshot.shape);

export const ignitionControl = method({
  paramsSchema: z.object({
    set: ignitionTargetState,
  }),
  resultSchema: ignitionControlResult,
});

export const ignitionState = method({
  paramsSchema: z.void(),
  resultSchema: ignitionSnapshot,
});

export const ignitionStateNotification = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("ignitionState"),
  params: ignitionSnapshot,
});

export type IgnitionSnapshot = z.infer<typeof ignitionSnapshot>;
