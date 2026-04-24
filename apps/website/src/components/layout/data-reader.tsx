"use client";

import React from "react";

import { client, ConnectionStatus } from "@/client";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { useStore } from "@/lib/store";

export function DataReader() {
  const appendLoadReadings = useStore((store) => store.appendLoadReadings);
  const status = useConnectionStatus();
  const appendPressureReadings = useStore((store) => store.appendPressureReadings);
  const setLoadReadings = useStore((store) => store.setLoadReadings);
  const setPressureWindows = useStore((store) => store.setPressureWindows);
  const setReadingsStatus = useStore((store) => store.setReadingsStatus);
  const cancelledRef = React.useRef(false);

  React.useEffect(() => {
    if (status !== ConnectionStatus.CONNECTED) return;

    cancelledRef.current = false;

    void (async () => {
      let shouldFetchHistory = true;

      while (!cancelledRef.current) {
        try {
          const response = await client.readings(shouldFetchHistory ? { history: true } : {});

          setReadingsStatus(response.status);

          if (shouldFetchHistory) {
            setLoadReadings(response.data.load);
            setPressureWindows(response.data.pressure);
            shouldFetchHistory = false;
          } else {
            appendLoadReadings(response.data.load);
            appendPressureReadings(response.data.pressure);
          }
        } catch {
          return;
        }
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [
    appendLoadReadings,
    appendPressureReadings,
    setLoadReadings,
    setPressureWindows,
    setReadingsStatus,
    status,
  ]);

  return null;
}
