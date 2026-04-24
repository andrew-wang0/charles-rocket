import { method } from "@danscan/zod-jsonrpc";
import z from "zod";

import { result } from "@/client/router/types";
import { SERVO_COUNT } from "@/lib/constants";
import { ServoState } from "@/types/servo";

const servoPosition = z.number().or(z.enum(ServoState));

export const servoControl = method({
  paramsSchema: z.object({
    index: z.int().min(1).max(SERVO_COUNT),
    set: servoPosition,
  }),
  resultSchema: result.extend({
    state: servoPosition,
  }),
});
