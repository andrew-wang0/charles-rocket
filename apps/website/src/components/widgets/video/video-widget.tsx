"use client";

import React from "react";

import { ConnectionStatus } from "@/client";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetCard } from "@/components/widgets/widget-card";
import { env } from "@/env";
import { useConnectionGeneration, useConnectionStatus } from "@/hooks/use-connection-status";
import { cn } from "@/lib/util/cn";

const STREAM_RETRY_MS = 2_000;

export function VideoWidget() {
  const [attempt, setAttempt] = React.useState(0);
  const status = useConnectionStatus();
  const connectionGeneration = useConnectionGeneration();
  const [loadedStreamKey, setLoadedStreamKey] = React.useState<string | null>(null);
  const streamKey = `${connectionGeneration}:${attempt}`;
  const hasSignal = loadedStreamKey === streamKey;

  const streamUrl = React.useMemo(() => {
    const url = new URL(env.NEXT_PUBLIC_VIDEO_URL);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }

    url.searchParams.set("attempt", String(attempt));
    url.searchParams.set("connection", String(connectionGeneration));
    return url.toString();
  }, [attempt, connectionGeneration]);

  React.useEffect(() => {
    if (hasSignal || status !== ConnectionStatus.CONNECTED) return;

    const timeout = window.setTimeout(() => {
      setAttempt((current) => current + 1);
    }, STREAM_RETRY_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [hasSignal, status]);

  return (
    <WidgetCard size="sm">
      <CardHeader>
        <CardTitle>Video Feed</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1">
        <div
          className={cn(
            "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden",
            "bg-muted bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,var(--border)_10px,var(--border)_11px)]",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="Live camera feed"
            className={cn("h-full w-full object-contain object-center", {
              invisible: !hasSignal,
            })}
            onError={() => {
              setLoadedStreamKey(null);
            }}
            onLoad={() => {
              setLoadedStreamKey(streamKey);
            }}
            src={streamUrl}
          />
          {!hasSignal ? (
            <div className="bg-muted text-muted-foreground absolute border p-2 text-sm">
              NO VIDEO SIGNAL
            </div>
          ) : null}
        </div>
      </CardContent>
    </WidgetCard>
  );
}
