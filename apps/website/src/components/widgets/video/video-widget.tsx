"use client";

import { SpeakerHighIcon, SpeakerSlashIcon } from "@phosphor-icons/react";
import React from "react";

import { ConnectionStatus } from "@/client";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetCard } from "@/components/widgets/widget-card";
import { hardwareAudioStreamUrl, hardwareVideoUrl } from "@/env";
import { useBackendHost } from "@/hooks/use-backend-host";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util/cn";

const STREAM_RETRY_MS = 2_000;
const STREAM_STALE_MS = 3_000;
const STREAM_STALE_CHECK_MS = 500;
const AUDIO_START_DELAY_SECONDS = 0.06;
const AUDIO_MAX_BUFFER_SECONDS = 0.35;
const PCM_SAMPLE_RATE = 48_000;
const PCM_CHANNELS = 1;

function buildVideoStreamUrl(backendHost: string, attempt: number) {
  const url = new URL(hardwareVideoUrl(backendHost));
  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  if (attempt > 0) {
    url.searchParams.set("attempt", String(attempt));
  }

  return url.toString();
}

async function consumeMjpegStream(
  url: string,
  onFrame: (blob: Blob) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`Video stream failed: ${response.status}`);
  }

  const body = response.body;
  if (body === null) {
    throw new Error("Video stream missing body");
  }

  const reader = body.getReader();
  let buffer = new Uint8Array(0);

  const append = (chunk: Uint8Array) => {
    const next = new Uint8Array(buffer.length + chunk.length);
    next.set(buffer);
    next.set(chunk, buffer.length);
    buffer = next;
  };

  const findMarker = (data: Uint8Array, start: number, first: number, second: number) => {
    for (let index = start; index < data.length - 1; index += 1) {
      if (data[index] === first && data[index + 1] === second) {
        return index;
      }
    }

    return -1;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (value !== undefined) {
      append(value);
    }

    while (true) {
      const start = findMarker(buffer, 0, 0xff, 0xd8);
      if (start < 0) {
        if (buffer.length > 1) {
          buffer = buffer.slice(-1);
        }
        break;
      }

      const end = findMarker(buffer, start + 2, 0xff, 0xd9);
      if (end < 0) {
        break;
      }

      const frame = buffer.slice(start, end + 2);
      buffer = buffer.slice(end + 2);
      onFrame(new Blob([frame], { type: "image/jpeg" }));
    }
  }
}

export function VideoWidget() {
  const [attempt, setAttempt] = React.useState(0);
  const [audioMuted, setAudioMuted] = React.useState(true);
  const audioAvailable = useStore((store) => store.readingsStatus.audioOk);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const audioSocketRef = React.useRef<WebSocket | null>(null);
  const nextAudioTimeRef = React.useRef(0);
  const status = useConnectionStatus();
  const backendHost = useBackendHost();
  const [frameUrl, setFrameUrl] = React.useState<string | null>(null);
  const [hasSignal, setHasSignal] = React.useState(false);
  const streamUrl = React.useMemo(
    () => buildVideoStreamUrl(backendHost, attempt),
    [attempt, backendHost],
  );

  const audioSocketUrl = React.useMemo(() => {
    const url = new URL(hardwareAudioStreamUrl(backendHost));
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol === "https:") {
      url.protocol = "wss:";
    }

    return url.toString();
  }, [backendHost]);

  const getAudioContext = () => {
    if (audioContextRef.current === null) {
      audioContextRef.current = new AudioContext({ latencyHint: "interactive" });
    }

    return audioContextRef.current;
  };

  const schedulePcmChunk = (audioContext: AudioContext, chunk: ArrayBuffer) => {
    const samples = new Int16Array(chunk);
    const frameCount = Math.floor(samples.length / PCM_CHANNELS);
    if (frameCount <= 0) return;

    const buffer = audioContext.createBuffer(PCM_CHANNELS, frameCount, PCM_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);

    for (let index = 0; index < frameCount; index += 1) {
      channel[index] = samples[index] / 32768;
    }

    const now = audioContext.currentTime;
    if (
      nextAudioTimeRef.current < now + AUDIO_START_DELAY_SECONDS ||
      nextAudioTimeRef.current > now + AUDIO_MAX_BUFFER_SECONDS
    ) {
      nextAudioTimeRef.current = now + AUDIO_START_DELAY_SECONDS;
    }

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(nextAudioTimeRef.current);
    nextAudioTimeRef.current += buffer.duration;
  };

  React.useEffect(() => {
    setAttempt(0);
    setFrameUrl(null);
    setHasSignal(false);
  }, [backendHost]);

  React.useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    let reconnectTimeout: number | null = null;
    let staleCheckInterval: number | null = null;
    let reconnectScheduled = false;
    let lastFrameAt = Date.now();
    const controller = new AbortController();

    const revokeObjectUrl = () => {
      if (objectUrl === null) return;
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectScheduled) return;

      reconnectScheduled = true;
      setHasSignal(false);
      revokeObjectUrl();
      setFrameUrl(null);

      reconnectTimeout = window.setTimeout(() => {
        if (!cancelled) {
          setAttempt((current) => current + 1);
        }
      }, STREAM_RETRY_MS);
    };

    const onFrame = (blob: Blob) => {
      if (cancelled) return;

      lastFrameAt = Date.now();
      setHasSignal(true);
      revokeObjectUrl();
      objectUrl = URL.createObjectURL(blob);
      setFrameUrl(objectUrl);
    };

    staleCheckInterval = window.setInterval(() => {
      if (cancelled || Date.now() - lastFrameAt < STREAM_STALE_MS) return;

      controller.abort();
      scheduleReconnect();
    }, STREAM_STALE_CHECK_MS);

    void consumeMjpegStream(streamUrl, onFrame, controller.signal)
      .then(() => {
        if (!cancelled) {
          scheduleReconnect();
        }
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;

        scheduleReconnect();
      });

    return () => {
      cancelled = true;
      controller.abort();

      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout);
      }

      if (staleCheckInterval !== null) {
        window.clearInterval(staleCheckInterval);
      }

      revokeObjectUrl();
    };
  }, [streamUrl]);

  React.useEffect(() => {
    if (audioMuted || !audioAvailable || status !== ConnectionStatus.CONNECTED) {
      audioSocketRef.current?.close();
      audioSocketRef.current = null;
      return;
    }

    const audioContext = audioContextRef.current;
    if (audioContext === null) {
      setAudioMuted(true);
      return;
    }

    let ignore = false;
    const socket = new WebSocket(audioSocketUrl);
    socket.binaryType = "arraybuffer";
    audioSocketRef.current = socket;

    socket.onmessage = (event) => {
      if (ignore || !(event.data instanceof ArrayBuffer)) return;
      schedulePcmChunk(audioContext, event.data);
    };

    socket.onerror = () => {
      if (ignore) return;
      setAudioMuted(true);
    };

    socket.onclose = () => {
      if (ignore) return;
      setAudioMuted(true);
    };

    return () => {
      ignore = true;
      socket.close();
      if (audioSocketRef.current === socket) {
        audioSocketRef.current = null;
      }
    };
  }, [audioAvailable, audioMuted, audioSocketUrl, status]);

  const toggleAudio = () => {
    if (!audioAvailable) return;

    const nextMuted = !audioMuted;
    setAudioMuted(nextMuted);

    if (!nextMuted) {
      const audioContext = getAudioContext();
      nextAudioTimeRef.current = 0;

      void audioContext.resume().catch(() => {
        setAudioMuted(true);
      });
    } else {
      audioSocketRef.current?.close();
      audioSocketRef.current = null;
    }
  };

  const audioButtonLabel = !audioAvailable ? "Audio unavailable" : audioMuted ? "Unmute" : "Mute";

  return (
    <WidgetCard size="sm">
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Video Feed</CardTitle>
        <Button
          aria-label={audioButtonLabel}
          disabled={status !== ConnectionStatus.CONNECTED || !audioAvailable}
          onClick={toggleAudio}
          size="xs"
          title={audioButtonLabel}
          type="button"
          variant="outline"
        >
          {audioMuted ? <SpeakerSlashIcon /> : <SpeakerHighIcon />}
          {audioButtonLabel}
        </Button>
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
            decoding="async"
            loading="eager"
            src={frameUrl ?? undefined}
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
