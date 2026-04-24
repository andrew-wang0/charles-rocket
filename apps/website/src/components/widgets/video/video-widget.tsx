"use client";

/* eslint-disable @next/next/no-img-element */

import React from "react";

import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetCard } from "@/components/widgets/widget-card";
import { env } from "@/env";

const STREAM_RETRY_MS = 5_000;

function resolveStreamUrl() {
  if (env.NEXT_PUBLIC_MJPEG_URL) {
    return env.NEXT_PUBLIC_MJPEG_URL;
  }

  const websocketUrl = new URL(env.NEXT_PUBLIC_WS_URL);
  websocketUrl.protocol = websocketUrl.protocol === "wss:" ? "https:" : "http:";
  websocketUrl.port = "8766";
  websocketUrl.pathname = "/camera.mjpg";
  websocketUrl.search = "";

  return websocketUrl.toString();
}

export function VideoWidget() {
  const [attempt, setAttempt] = React.useState(0);
  const [hasSignal, setHasSignal] = React.useState(false);

  const streamUrl = React.useMemo(() => {
    const url = new URL(resolveStreamUrl());
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
      <CardContent className="relative flex min-h-0 flex-1 overflow-hidden">
        {!hasSignal ? (
          <div className="bg-muted text-muted-foreground flex flex-1 items-center justify-center border text-sm">
            NO VIDEO SIGNAL
          </div>
        ) : null}
        <img
          alt="Live camera feed"
          className={`absolute inset-0 h-full w-full object-cover ${hasSignal ? "" : "hidden"}`}
          onError={() => {
            setHasSignal(false);
          }}
          onLoad={() => {
            setHasSignal(true);
          }}
          src={streamUrl}
        />
      </CardContent>
    </WidgetCard>
  );
}
