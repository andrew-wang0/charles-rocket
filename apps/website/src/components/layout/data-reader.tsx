"use client";

import React from "react";

import { client, ConnectionStatus } from "@/client";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { useStore } from "@/lib/store";

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
