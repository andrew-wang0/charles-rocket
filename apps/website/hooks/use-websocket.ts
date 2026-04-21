import useWebSocket from "react-use-websocket";

import { WS_URL } from "@/lib/constants";
import { ingestHardwareMessage } from "@/lib/hardware-state-store";
import type { HardwareServerMessage } from "@/types/websocket";

export function useAppWebSocket() {
  const { lastJsonMessage, readyState, sendJsonMessage } =
    useWebSocket<HardwareServerMessage | null>(WS_URL, {
      share: true,
      onMessage: (event) => {
        if (typeof event.data === "string") {
          ingestHardwareMessage(event.data);
        }
      },
      shouldReconnect: () => true,
    });

  return {
    readyState,
    lastJsonMessage,
    sendJsonMessage,
  };
}
