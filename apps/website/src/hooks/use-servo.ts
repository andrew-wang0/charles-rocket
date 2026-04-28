import { useMemo } from "react";

import { client } from "@/client";
import { SERVO_COUNT } from "@/lib/constants";
import { useStore } from "@/lib/store";
import { ServoState } from "@/types/servo";

type ServoTargetState = ServoState.OPEN | ServoState.CLOSED;

function isServoSwitching(state: ServoState) {
  return state === ServoState.OPENING || state === ServoState.CLOSING;
}

function getServoAggregateState(states: ServoState[]) {
  if (states.length === 0) return ServoState.UNKNOWN;

  const firstState = states[0];
  return states.every((state) => state === firstState) ? firstState : ServoState.UNKNOWN;
}

function toServoRequestIndex(index: number) {
  const requestIndex = index + 1;

  if (requestIndex < 1 || requestIndex > SERVO_COUNT) {
    throw new Error(`Invalid servo index: ${index}`);
  }

  return requestIndex;
}

function toServoRequestIndexes(indexes: number[]) {
  const requestIndexes: number[] = [];
  const seen = new Set<number>();

  for (const index of indexes) {
    const requestIndex = toServoRequestIndex(index);

    if (seen.has(requestIndex)) {
      continue;
    }

    seen.add(requestIndex);
    requestIndexes.push(requestIndex);
  }

  return requestIndexes;
}

export function useServo(index: number) {
  const state = useStore((store) => store.servoStates[index] ?? ServoState.UNKNOWN);

  return useMemo(
    () => ({
      state,
      isBusy: isServoSwitching(state),
      isSwitching: isServoSwitching(state),
      isOpen: state === ServoState.OPEN,
      isClosed: state === ServoState.CLOSED,
    }),
    [state],
  );
}

export function useServoGroup(indexes: number[]) {
  const servoStates = useStore((store) => store.servoStates);

  return useMemo(() => {
    const states = indexes.map((index) => servoStates[index] ?? ServoState.UNKNOWN);

    return {
      states,
      state: getServoAggregateState(states),
      isBusy: states.some(isServoSwitching),
      isSwitching: states.some(isServoSwitching),
      anyUnknown: states.some((state) => state === ServoState.UNKNOWN),
      allOpen: states.length > 0 && states.every((state) => state === ServoState.OPEN),
      allClosed: states.length > 0 && states.every((state) => state === ServoState.CLOSED),
    };
  }, [indexes, servoStates]);
}

export function useServoControl(indexes: number[] = []) {
  const servoGroup = useServoGroup(indexes);

  async function setServos(indexes: number[], targetState: ServoTargetState) {
    const requestIndexes = toServoRequestIndexes(indexes);

    if (requestIndexes.length === 0) {
      return;
    }

    if (requestIndexes.length === 1) {
      await client.servoControl({
        index: requestIndexes[0],
        set: targetState,
      });
      return;
    }

    await client.servoControlMany({
      indexes: requestIndexes,
      set: targetState,
    });
  }

  async function setServo(index: number, targetState: ServoTargetState) {
    await setServos([index], targetState);
  }

  async function toggle() {
    if (indexes.length === 0 || servoGroup.anyUnknown || servoGroup.isBusy) return;
    await setServos(indexes, servoGroup.allOpen ? ServoState.CLOSED : ServoState.OPEN);
  }

  return {
    ...servoGroup,
    isBusy: servoGroup.isBusy,
    toggle,
    setServo,
    setServos,
  };
}
