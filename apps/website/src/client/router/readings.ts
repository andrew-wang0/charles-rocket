import { method } from "@danscan/zod-jsonrpc";
import z from "zod";

import { PRESSURE_TRANSDUCER_COUNT } from "@/lib/constants";
import { timedReadings } from "@/lib/readings";

export const readings = method({
  paramsSchema: z
    .object({
      endTime: z.number().int().nonnegative().optional(),
      history: z.boolean().optional(),
      includeLoad: z.boolean().optional(),
      includePressure: z.boolean().optional(),
      maxPoints: z.number().int().min(100).max(5_000).optional(),
      startTime: z.number().int().nonnegative().optional(),
      windowMs: z.number().int().positive().optional(),
    })
    .optional(),
  resultSchema: z.object({
    serverTime: z.number().int().nonnegative().optional(),
    timeRange: z
      .object({
        endTime: z.number().int().nonnegative(),
        startTime: z.number().int().nonnegative(),
      })
      .optional(),
    status: z.object({
      servoControllerOk: z.boolean(),
      pressureSensorsOk: z.array(z.boolean()).length(PRESSURE_TRANSDUCER_COUNT),
      loadSensorOk: z.boolean(),
      audioOk: z.boolean(),
    }),
    data: z.object({
      load: timedReadings,
      pressure: z.array(timedReadings).length(PRESSURE_TRANSDUCER_COUNT),
    }),
  }),
});
