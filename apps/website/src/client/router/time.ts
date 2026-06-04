import { method } from "@danscan/zod-jsonrpc";
import z from "zod";

export const syncSystemTime = method({
  paramsSchema: z.object({
    clientTime: z.number().int().nonnegative(),
  }),
  resultSchema: z.object({
    applied: z.boolean(),
    error: z.string().optional(),
    offsetMs: z.number().int(),
    serverTimeAfter: z.number().int().nonnegative(),
    serverTimeBefore: z.number().int().nonnegative(),
  }),
});
