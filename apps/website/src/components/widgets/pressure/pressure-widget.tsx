"use client";

import React from "react";

import { client, ConnectionStatus } from "@/client";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { PRESSURE_TRANSDUCER_COUNT } from "@/lib/constants";
import { useStore } from "@/lib/store";

const POLL_INTERVAL_MS = 1000 / 60;

function formatPsi(value: number | undefined) {
  if (value === undefined) return "--";
  return value.toFixed(2);
}

export function PressureWidget() {
  const status = useConnectionStatus();
  const pressureReadings = useStore((store) => store.pressureReadings);
  const appendPressureReadings = useStore((store) => store.appendPressureReadings);
  const setPressureWindows = useStore((store) => store.setPressureWindows);
  const setLoadReadings = useStore((store) => store.setLoadReadings);
  const cancelledRef = React.useRef(false);
  const inFlightRef = React.useRef(false);
  const timerRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (status !== ConnectionStatus.CONNECTED) return;

    cancelledRef.current = false;
    inFlightRef.current = false;
    timerRef.current = 0;
    const isCancelled = () => cancelledRef.current;

    const scheduleNextTick = () => {
      timerRef.current = window.setTimeout(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    };

    const tick = async () => {
      if (isCancelled()) return;

      if (inFlightRef.current) {
        scheduleNextTick();
        return;
      }

      inFlightRef.current = true;

      try {
        const response = await client.readings({});
        appendPressureReadings(response.data.pressure);
        setLoadReadings(response.data.load);
      } catch {
        // Connection state already represents transport failures.
      } finally {
        inFlightRef.current = false;
      }

      if (isCancelled()) return;

      scheduleNextTick();
    };

    void (async () => {
      try {
        const response = await client.readings({ history: true });

        if (isCancelled()) return;

        setPressureWindows(response.data.pressure);
        setLoadReadings(response.data.load);
      } catch {
        // Connection state already represents transport failures.
      }

      if (isCancelled()) return;

      void tick();
    })();

    return () => {
      cancelledRef.current = true;
      window.clearTimeout(timerRef.current);
    };
  }, [appendPressureReadings, setLoadReadings, setPressureWindows, status]);

  return (
    <div className="grid gap-2 font-mono text-sm">
      {Array.from({ length: PRESSURE_TRANSDUCER_COUNT }).map((_, index) => {
        const latest = pressureReadings[index]?.at(-1)?.value;

        return (
          <div key={index} className="flex items-center justify-between border p-2">
            <span>PT {index + 1}</span>
            <span>{formatPsi(latest)} PSI</span>
          </div>
        );
      })}
    </div>
  );
}
