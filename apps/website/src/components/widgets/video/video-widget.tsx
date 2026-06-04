"use client";

import Hls from "hls.js";
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
  const videoRef = React.useRef<HTMLVideoElement>(null);
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

  React.useEffect(() => {
    if (status !== ConnectionStatus.CONNECTED) return;

    const video = videoRef.current;
    if (video === null) return;

    setLoadedStreamKey(null);

    let hls: Hls | null = null;
    const markLoaded = () => {
      setLoadedStreamKey(streamKey);
    };
    const markError = () => {
      setLoadedStreamKey(null);
    };

    video.addEventListener("loadeddata", markLoaded);
    video.addEventListener("playing", markLoaded);
    video.addEventListener("error", markError);

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      void video.play().catch(markError);
    } else if (Hls.isSupported()) {
      hls = new Hls({
        liveSyncDurationCount: 3,
        lowLatencyMode: true,
      });
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls?.loadSource(streamUrl);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(markError);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          markError();
        }
      });
    } else {
      markError();
    }

    return () => {
      video.removeEventListener("loadeddata", markLoaded);
      video.removeEventListener("playing", markLoaded);
      video.removeEventListener("error", markError);
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [status, streamKey, streamUrl]);

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
          <video
            ref={videoRef}
            aria-label="Live camera feed"
            autoPlay
            className={cn("h-full w-full object-contain object-center", {
              invisible: !hasSignal,
            })}
            muted
            playsInline
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
