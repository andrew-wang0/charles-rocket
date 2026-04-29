import { method } from "@danscan/zod-jsonrpc";
import z from "zod";

export const tare = method({
  paramsSchema: z.object({
    device: z.enum(["load", "pressure"]),
    index: z.int().optional(),
  }),
  resultSchema: z.object({
    device: z.enum(["load", "pressure"]),
    index: z.int().optional(),
    value: z.number(),
  }),
});
