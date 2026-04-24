"use client";

import React from "react";

import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetCard } from "@/components/widgets/widget-card";
import { env } from "@/env";
import { cn } from "@/lib/util/cn";

const STREAM_RETRY_MS = 500;

export function VideoWidget() {
  const [attempt, setAttempt] = React.useState(0);
  const [hasSignal, setHasSignal] = React.useState(false);

  const streamUrl = React.useMemo(() => {
    const url = new URL(env.NEXT_PUBLIC_VIDEO_URL);
    url.searchParams.set("attempt", String(attempt));
    return url.toString();
  }, [attempt]);

  React.useEffect(() => {
    if (hasSignal) return;

    const timeout = window.setTimeout(() => {
      setAttempt((current) => current + 1);
    }, STREAM_RETRY_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [hasSignal]);

  return (
    <WidgetCard size="sm">
      <CardHeader>
        <CardTitle>Video Feed</CardTitle>
      </CardHeader>
      <CardContent className="relative flex min-h-0 flex-1">
        {!hasSignal ? (
          <div className="bg-muted text-muted-foreground flex flex-1 items-center justify-center border text-sm">
            NO VIDEO SIGNAL
          </div>
        ) : null}

        <div
          className={cn(
            "bg-muted flex w-full justify-center",
            "bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,var(--border)_10px,var(--border)_11px)]",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="Live camera feed"
            className={cn({ hidden: !hasSignal })}
            onError={() => {
              setHasSignal(false);
            }}
            onLoad={() => {
              setHasSignal(true);
            }}
            src={streamUrl}
          />
        </div>
      </CardContent>
    </WidgetCard>
  );
}
