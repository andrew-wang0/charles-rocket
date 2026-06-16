"use client";

import { SpeakerHighIcon, SpeakerSlashIcon } from "@phosphor-icons/react";
import React from "react";

import { ConnectionStatus } from "@/client";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetCard } from "@/components/widgets/widget-card";
import { hardwareAudioStreamUrl, hardwareVideoUrl } from "@/env";
import { useBackendHost } from "@/hooks/use-backend-host";
import { useConnectionGeneration, useConnectionStatus } from "@/hooks/use-connection-status";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util/cn";

const STREAM_RETRY_MS = 2_000;
const AUDIO_START_DELAY_SECONDS = 0.06;
const AUDIO_MAX_BUFFER_SECONDS = 0.35;
const PCM_SAMPLE_RATE = 48_000;
const PCM_CHANNELS = 1;

export function VideoWidget() {
  const [attempt, setAttempt] = React.useState(0);
  const [audioMuted, setAudioMuted] = React.useState(true);
  const audioAvailable = useStore((store) => store.readingsStatus.audioOk);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const audioSocketRef = React.useRef<WebSocket | null>(null);
  const nextAudioTimeRef = React.useRef(0);
  const status = useConnectionStatus();
  const backendHost = useBackendHost();
  const connectionGeneration = useConnectionGeneration();
  const [loadedStreamKey, setLoadedStreamKey] = React.useState<string | null>(null);
  const streamKey = `${connectionGeneration}:${attempt}`;
  const hasSignal = loadedStreamKey === streamKey;

  const streamUrl = React.useMemo(() => {
    const url = new URL(hardwareVideoUrl(backendHost));
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }

    url.searchParams.set("attempt", String(attempt));
    url.searchParams.set("connection", String(connectionGeneration));
    return url.toString();
  }, [attempt, backendHost, connectionGeneration]);

  const audioSocketUrl = React.useMemo(() => {
    const url = new URL(hardwareAudioStreamUrl(backendHost));
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol === "https:") {
      url.protocol = "wss:";
    }

    url.searchParams.set("connection", String(connectionGeneration));
    return url.toString();
  }, [backendHost, connectionGeneration]);

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
    if (hasSignal || status !== ConnectionStatus.CONNECTED) return;

    const timeout = window.setTimeout(() => {
      setAttempt((current) => current + 1);
    }, STREAM_RETRY_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [hasSignal, status]);

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
