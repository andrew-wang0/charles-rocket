import z from "zod";

export const timedReadings = z
  .object({
    time: z.number().int().nonnegative(),
    value: z.number(),
  })
  .array();

export type TimedReadings = z.infer<typeof timedReadings>;
