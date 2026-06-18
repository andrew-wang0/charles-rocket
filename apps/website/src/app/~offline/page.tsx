import React from "react";

export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
      <h1 className="text-lg font-semibold">You&apos;re offline</h1>
      <p className="text-muted-foreground text-sm">
        Reconnect to refresh live data from the rocket.
      </p>
    </main>
  );
}
