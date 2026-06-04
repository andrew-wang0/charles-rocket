import { control } from "@/client/router/control";
import { readings } from "@/client/router/readings";
import { tare } from "@/client/router/tare";
import { syncSystemTime } from "@/client/router/time";

export const router = {
  readings,
  syncSystemTime,
  tare,
  ...control,
};
