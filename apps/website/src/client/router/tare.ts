import { method } from "@danscan/zod-jsonrpc";
import z from "zod";

import { PRESSURE_TRANSDUCER_COUNT } from "@/lib/constants";

const pressureIndex = z
  .int()
  .min(0)
  .max(PRESSURE_TRANSDUCER_COUNT - 1);

export const tare = method({
  paramsSchema: z.object({
    device: z.enum(["load", "pressure"]),
    index: pressureIndex.optional(),
  }),
  resultSchema: z.object({
    device: z.enum(["load", "pressure"]),
    index: pressureIndex.optional(),
    value: z.number(),
  }),
});
