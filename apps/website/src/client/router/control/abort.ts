import { method } from "@danscan/zod-jsonrpc";
import z from "zod";

import { ignitionSnapshot } from "@/client/router/control/ingnition";
import { servoSnapshot } from "@/client/router/control/servo";
import { result } from "@/client/router/types";

export const abortResult = result.extend({
  ...ignitionSnapshot.shape,
  ...servoSnapshot.shape,
});

export const abort = method({
  paramsSchema: z.void(),
  resultSchema: abortResult,
});

export type AbortResult = z.infer<typeof abortResult>;
