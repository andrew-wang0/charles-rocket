"use client";

import React from "react";

import { Button } from "@/components/ui/button";
import { CHART_WINDOW_OPTIONS } from "@/lib/util/chart";

type Props = {
  ariaLabel: string;
  className?: string;
  inspectionButton?: React.ReactNode;
  value: number;
  onValueChange: (value: number) => void;
};

export function WidgetChartRangeControl({
  ariaLabel,
  className,
  inspectionButton,
  value,
  onValueChange,
}: Props) {
  return (
    <div className={className}>
      <div
        aria-label={ariaLabel}
        className="border-border bg-muted/20 flex overflow-hidden border"
        role="group"
      >
        {inspectionButton}
        {CHART_WINDOW_OPTIONS.map((option) => {
          const selected = value === option.value;

          return (
            <Button
              key={option.value}
              aria-pressed={selected}
              className="text-muted-foreground hover:bg-muted hover:text-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground h-4 min-w-7 border-0 px-1 text-[10px] leading-none"
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
    </div>
  );
}
