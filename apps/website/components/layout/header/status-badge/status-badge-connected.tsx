import { intervalToDuration } from "date-fns";
import React, { useEffect, useState } from "react";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function StatusBadgeConnected() {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const start = Date.now();

    const interval = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 250);

    return () => clearInterval(interval);
  }, []);

  const d = intervalToDuration({ start: 0, end: elapsedMs });
  const totalHours = (d.days || 0) * 24 + (d.hours || 0);

  const elapsed = `${pad(totalHours)}:${pad(d.minutes || 0)}:${pad(d.seconds || 0)}`;

  return (
    <>
      <span className="bg-positive animation-duration-[500ms] size-2 animate-pulse rounded-full" />
      <span>CONNECTED</span>
      <span className="text-muted-foreground font-light">{elapsed}</span>
    </>
  );
}
