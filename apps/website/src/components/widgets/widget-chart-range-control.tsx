"use client";

import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import React from "react";

import { Button } from "@/components/ui/button";
import { CHART_WINDOW_OPTIONS } from "@/lib/util/chart";
import { cn } from "@/lib/util/cn";

type Props = {
  ariaLabel: string;
  className?: string;
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  value: number;
  onValueChange: (value: number) => void;
};

export function WidgetChartRangeControl({
  ariaLabel,
  className,
  paused,
  onPausedChange,
  value,
  onValueChange,
}: Props) {
  const RecordingIcon = paused ? PlayIcon : PauseIcon;

  return (
    <div
      aria-label={ariaLabel}
      className={cn("border-border bg-muted/20 flex overflow-hidden border", className)}
      role="group"
    >
      <Button
        aria-label={paused ? "Resume chart recording" : "Pause chart recording"}
        aria-pressed={paused}
        className={cn(
          "border-r-border text-muted-foreground hover:bg-muted hover:text-foreground h-4 w-5 border-0 border-r [&_svg:not([class*='size-'])]:size-2.5",
          paused && "bg-accent text-accent-foreground hover:bg-accent/80",
        )}
        onClick={() => onPausedChange(!paused)}
        size="icon-xs"
        title={paused ? "Resume chart recording" : "Pause chart recording"}
        type="button"
        variant="ghost"
      >
        <RecordingIcon weight="fill" />
      </Button>
      {CHART_WINDOW_OPTIONS.map((option) => {
        const selected = value === option.value;

        return (
          <Button
            key={option.value}
            aria-pressed={selected}
            className={cn(
              "text-muted-foreground hover:bg-muted hover:text-foreground h-4 min-w-7 border-0 px-1 text-[10px] leading-none",
              "data-[active=true]:bg-accent data-[active=true]:text-accent-foreground",
            )}
            data-active={selected}
            onClick={() => onValueChange(option.value)}
            size="xs"
            type="button"
            variant="ghost"
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
