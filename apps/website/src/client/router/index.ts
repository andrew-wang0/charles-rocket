import { control } from "@/client/router/control";
import { readings } from "@/client/router/readings";
import { tare } from "@/client/router/tare";

export const router = {
  readings,
  tare,
  ...control,
};
