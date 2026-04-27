"use client";

import { client } from "@/client";
import { useStore } from "@/lib/store";
import { IgnitionState } from "@/types/ignition";

type IgnitionTargetState = IgnitionState.ON | IgnitionState.OFF;

export function useIgnition() {
  const state = useStore((store) => store.ignitionState);

  return {
    state,
    isOn: state === IgnitionState.ON,
    isOff: state === IgnitionState.OFF,
    isUnknown: state === IgnitionState.UNKNOWN,
  };
}

export function useIgnitionControl() {
  async function setIgnition(targetState: IgnitionTargetState) {
    await client.ignitionControl({
      set: targetState,
    });
  }

  return {
    setIgnition,
  };
}
