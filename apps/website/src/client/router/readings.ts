import { method } from "@danscan/zod-jsonrpc";
import z from "zod";

import { PRESSURE_TRANSDUCER_COUNT } from "@/lib/constants";
import { timedReadings } from "@/lib/store";

export const readings = method({
  paramsSchema: z
    .object({
      history: z.boolean().optional(),
    })
    .optional(),
  resultSchema: z.object({
    status: z.object({
      servoControllerOk: z.boolean(),
      pressureSensorsOk: z.array(z.boolean()).length(PRESSURE_TRANSDUCER_COUNT),
      loadSensorOk: z.boolean(),
    }),
    data: z.object({
      load: timedReadings,
      pressure: z.array(timedReadings).length(PRESSURE_TRANSDUCER_COUNT),
    }),
  }),
});
