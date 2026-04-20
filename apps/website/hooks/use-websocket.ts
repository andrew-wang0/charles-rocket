import useWebSocket from "react-use-websocket";

import { WS_URL } from "@/lib/constants";

export function useAppWebSocket() {
  const { lastJsonMessage, readyState, sendJsonMessage } = useWebSocket(WS_URL, {
    share: true,
    shouldReconnect: () => true,
  });

  return {
    readyState,
    lastJsonMessage,
    sendJsonMessage,
  };
}
