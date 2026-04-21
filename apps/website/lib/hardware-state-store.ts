import {
  parseHardwareServerMessage,
  SERVO_CHANNELS,
  type ServoStatePayload,
  ServoStatus,
} from "@/types/websocket";

type HardwareStateSnapshot = {
  servoState: ServoStatePayload;
  lastError: string | null;
};

const INITIAL_SERVO_STATE: ServoStatePayload = {
  channels: SERVO_CHANNELS.map((channel) => ({
    channel,
    state: ServoStatus.UNKNOWN,
  })),
};

let snapshot: HardwareStateSnapshot = {
  servoState: INITIAL_SERVO_STATE,
  lastError: null,
};

let lastRawMessage: string | null = null;

const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeHardwareState(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getHardwareStateSnapshot() {
  return snapshot;
}

export function ingestHardwareMessage(rawMessage: string) {
  if (rawMessage === lastRawMessage) {
    return;
  }

  lastRawMessage = rawMessage;

  let message: unknown;
  try {
    message = JSON.parse(rawMessage);
  } catch {
    return;
  }

  const result = parseHardwareServerMessage(message);
  if (!result.success) {
    return;
  }

  switch (result.data.type) {
    case "state":
      snapshot = {
        servoState: result.data.servo,
        lastError: null,
      };
      emitChange();
      break;
    case "error":
      snapshot = {
        ...snapshot,
        lastError: result.data.error,
      };
      emitChange();
      break;
  }
}
