"use client";

import React from "react";
import { ReadyState } from "react-use-websocket";

import { useAppWebSocket } from "@/hooks/use-websocket";
import { getHardwareStateSnapshot, subscribeHardwareState } from "@/lib/hardware-state-store";
import { type HardwareClientMessage, SERVO_CHANNELS, type ServoChannel } from "@/types/websocket";

export function useServoControl() {
  const { readyState, sendJsonMessage } = useAppWebSocket();
  const hardwareState = React.useSyncExternalStore(
    subscribeHardwareState,
    getHardwareStateSnapshot,
    getHardwareStateSnapshot,
  );

  React.useEffect(() => {
    if (readyState !== ReadyState.OPEN) {
      return;
    }

    sendJsonMessage({ command: "get_state" } satisfies HardwareClientMessage, false);
  }, [readyState, sendJsonMessage]);

  const sendServoCommand = (message: HardwareClientMessage) => {
    if (readyState !== ReadyState.OPEN) {
      return false;
    }

    sendJsonMessage(message, false);
    return true;
  };

  return {
    servoState: hardwareState.servoState,
    readyState,
    isConnected: readyState === ReadyState.OPEN,
    lastError: hardwareState.lastError,
    toggleServo: (channel: ServoChannel) => sendServoCommand({ command: "toggle_servo", channel }),
    openServo: (channel: ServoChannel | ServoChannel[]) =>
      sendServoCommand({ command: "open_servo", channel }),
    closeServo: (channel: ServoChannel | ServoChannel[]) =>
      sendServoCommand({ command: "close_servo", channel }),
    openAllServos: () => sendServoCommand({ command: "open_servo", channel: [...SERVO_CHANNELS] }),
    closeAllServos: () =>
      sendServoCommand({ command: "close_servo", channel: [...SERVO_CHANNELS] }),
  };
}
