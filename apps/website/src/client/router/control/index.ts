import { abort } from "@/client/router/control/abort";
import { ignitionControl, ignitionState } from "@/client/router/control/ingnition";
import { servoControl, servoControlMany, servoState } from "@/client/router/control/servo";

export const control = {
  abort,
  servoControl,
  servoControlMany,
  servoState,
  ignitionControl,
  ignitionState,
};
