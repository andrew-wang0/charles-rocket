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
  const ignition = useIgnition();
  const pendingCount = useStore((store) => store.ignitionPendingCount);
  const servoAbortClosingUntilMs = useStore((store) => store.servoAbortClosingUntilMs);
  const startIgnitionRequest = useStore((store) => store.startIgnitionRequest);
  const finishIgnitionRequest = useStore((store) => store.finishIgnitionRequest);
  const abortClosingActive = servoAbortClosingUntilMs > Date.now();

  async function setIgnition(targetState: IgnitionTargetState) {
    startIgnitionRequest();

    try {
      await client.ignitionControl({
        set: targetState,
      });
    } finally {
      finishIgnitionRequest();
    }
  }

  async function toggle() {
    if (pendingCount > 0 || abortClosingActive || ignition.isUnknown) return;
    await setIgnition(ignition.isOn ? IgnitionState.OFF : IgnitionState.ON);
  }

  return {
    ...ignition,
    isBusy: pendingCount > 0 || abortClosingActive,
    toggle,
    setIgnition,
  };
}
