import { control } from "@/client/router/control";
import { readings } from "@/client/router/readings";

export const router = {
  readings,
  ...control,
};
