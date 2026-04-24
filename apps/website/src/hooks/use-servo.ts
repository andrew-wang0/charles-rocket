import { useMemo } from "react";

import { useStore } from "@/lib/store";
import { ServoState } from "@/types/servo";

function isServoSwitching(state: ServoState) {
  return state === ServoState.OPENING || state === ServoState.CLOSING;
}

export function useServo(index: number) {
  const state = useStore((store) => store.servoStates[index] ?? ServoState.UNKNOWN);

  return useMemo(
    () => ({
      state,
      isSwitching: isServoSwitching(state),
      isOpen: state === ServoState.OPEN,
      isClosed: state === ServoState.CLOSED,
    }),
    [state],
  );
}
