"use client";

import React from "react";

import { client, ConnectionStatus } from "@/client";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { useStore } from "@/lib/store";

const READINGS_POLL_DELAY_MS = 10;

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function DataReader() {
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
          setLoadReadings(response.data.load);

          if (shouldFetchHistory) {
            setPressureWindows(response.data.pressure);
            shouldFetchHistory = false;
          } else {
            appendPressureReadings(response.data.pressure);
          }

          await delay(READINGS_POLL_DELAY_MS);
        } catch {
          return;
        }
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [appendPressureReadings, setLoadReadings, setPressureWindows, setReadingsStatus, status]);

  return null;
}
