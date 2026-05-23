"use client";

import React from "react";

import { Button } from "@/components/ui/button";
import { CHART_WINDOW_OPTIONS } from "@/lib/util/chart";
import { cn } from "@/lib/util/cn";

type Props = {
  ariaLabel: string;
  className?: string;
  value: number;
  onValueChange: (value: number) => void;
};

export function WidgetChartRangeControl({ ariaLabel, className, value, onValueChange }: Props) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn("border-border bg-muted/30 flex overflow-hidden border", className)}
      role="group"
    >
      {CHART_WINDOW_OPTIONS.map((option) => {
        const selected = value === option.value;

        return (
          <Button
            key={option.value}
            aria-pressed={selected}
            className={cn(
              "data-[active=true]:bg-primary data-[active=true]:text-primary-foreground",
              "border-0 text-[10px]",
            )}
            data-active={selected}
            onClick={() => onValueChange(option.value)}
            size="xs"
            type="button"
            variant={selected ? "default" : "ghost"}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
