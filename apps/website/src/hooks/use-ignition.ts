"use client";

import { useState } from "react";

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
  const [pending, setPending] = useState(false);

  async function setIgnition(targetState: IgnitionTargetState) {
    setPending(true);

    try {
      await client.ignitionControl({
        set: targetState,
      });
    } finally {
      setPending(false);
    }
  }

  async function toggle() {
    if (pending || ignition.isUnknown) return;
    await setIgnition(ignition.isOn ? IgnitionState.OFF : IgnitionState.ON);
  }

  return {
    ...ignition,
    isBusy: pending,
    toggle,
    setIgnition,
  };
}
