"use client";

import { WarningIcon } from "@phosphor-icons/react";
import React from "react";

import { client, ConnectionStatus } from "@/client";
import { Button } from "@/components/ui/button";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { SERVO_ABORT_CLOSE_TRANSITION_MS } from "@/lib/servo-transition";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util/cn";

type Props = {
  className?: string;
  orientation?: "horizontal" | "vertical";
};

export function ControlAbortButton({ className, orientation = "horizontal" }: Props) {
  const status = useConnectionStatus();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [pending, setPending] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const startServoAbortClosing = useStore((store) => store.startServoAbortClosing);
  const clearServoAbortClosing = useStore((store) => store.clearServoAbortClosing);
  const abortTransitionTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isVertical = orientation === "vertical";

  const disabled = pending || status !== ConnectionStatus.CONNECTED;

  React.useEffect(() => {
    return () => {
      if (abortTransitionTimerRef.current !== null) {
        clearTimeout(abortTransitionTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (!confirming || pending) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        containerRef.current &&
        target instanceof Node &&
        !containerRef.current.contains(target)
      ) {
        setConfirming(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setConfirming(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [confirming, pending]);

  function scheduleAbortTransitionClear() {
    if (abortTransitionTimerRef.current !== null) {
      clearTimeout(abortTransitionTimerRef.current);
    }

    abortTransitionTimerRef.current = setTimeout(() => {
      clearServoAbortClosing();
      abortTransitionTimerRef.current = null;
    }, SERVO_ABORT_CLOSE_TRANSITION_MS);
  }

  async function handleAbort() {
    if (disabled) return;

    setPending(true);
    startServoAbortClosing(SERVO_ABORT_CLOSE_TRANSITION_MS);
    scheduleAbortTransitionClear();

    try {
      await client.abort(undefined);
    } catch (error) {
      console.error("Failed to abort sequence", error);
      clearServoAbortClosing();
      if (abortTransitionTimerRef.current !== null) {
        clearTimeout(abortTransitionTimerRef.current);
        abortTransitionTimerRef.current = null;
      }
    } finally {
      setConfirming(false);
      setPending(false);
    }
  }

  function handlePress() {
    if (disabled) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }

    void handleAbort();
  }

  const label = pending ? "ABORTING..." : confirming ? "CONFIRM" : "ABORT";
  const ariaLabel = confirming ? "Confirm abort sequence" : "Abort sequence";

  return (
    <div ref={containerRef}>
      <Button
        aria-label={ariaLabel}
        className={cn(isVertical && "h-full", className)}
        disabled={disabled}
        onClick={handlePress}
        onPointerLeave={() => {
          if (!pending) {
            setConfirming(false);
          }
        }}
        size="xs"
        type="button"
        variant="destructive"
      >
        {isVertical ? (
          <span className="flex -rotate-90 items-center gap-1 whitespace-nowrap">
            <WarningIcon weight="fill" />
            {label}
          </span>
        ) : (
          <>
            <WarningIcon data-icon="inline-start" weight="fill" />
            {label}
          </>
        )}
      </Button>
    </div>
  );
}
