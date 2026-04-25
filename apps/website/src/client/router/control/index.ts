import { ignitionControl } from "@/client/router/control/ingnition";
import { servoControl, servoControlMany, servoState } from "@/client/router/control/servo";

export const control = {
  servoControl,
  servoControlMany,
  servoState,
  ignitionControl,
};
