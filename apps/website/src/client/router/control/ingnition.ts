import { method } from "@danscan/zod-jsonrpc";
import z from "zod";

import { result } from "@/client/router/types";
import { IgnitionState } from "@/types/ignition";

export const ignitionControl = method({
  paramsSchema: z.object({
    set: z.enum(IgnitionState),
  }),
  resultSchema: result.extend({
    state: z.enum(IgnitionState),
  }),
});
