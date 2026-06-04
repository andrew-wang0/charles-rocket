"use client";

import React from "react";

import { client, ConnectionStatus } from "@/client";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { useStore } from "@/lib/store";

const MAX_READINGS_REQUEST_HZ = 30;
const MIN_READINGS_REQUEST_INTERVAL_MS = 1000 / MAX_READINGS_REQUEST_HZ;

function waitForNextReadingsRequest(startedAt: number, cancelledRef: React.RefObject<boolean>) {
  const elapsedMs = performance.now() - startedAt;
  const remainingMs = Math.max(0, MIN_READINGS_REQUEST_INTERVAL_MS - elapsedMs);

  if (remainingMs === 0 || cancelledRef.current) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, remainingMs);
  });
}

export function DataReader() {
  const appendReadings = useStore((store) => store.appendReadings);
  const hydrateReadings = useStore((store) => store.hydrateReadings);
  const status = useConnectionStatus();
  const cancelledRef = React.useRef(false);

  React.useEffect(() => {
    if (status !== ConnectionStatus.CONNECTED) return;

    cancelledRef.current = false;

    void (async () => {
      let shouldFetchHistory = true;

      while (!cancelledRef.current) {
        try {
          const requestStartedAt = performance.now();
          const response = await client.readings(shouldFetchHistory ? { history: true } : {});

          if (shouldFetchHistory) {
            React.startTransition(() => {
              hydrateReadings(response.status, response.data);
            });
            shouldFetchHistory = false;
          } else {
            React.startTransition(() => {
              appendReadings(response.status, response.data);
            });
          }

          await waitForNextReadingsRequest(requestStartedAt, cancelledRef);
        } catch {
          return;
        }
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [appendReadings, hydrateReadings, status]);

  return null;
}
