"use client";

import React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/util/cn";

type Props = {
  label: string;
  color: string;
  value: number | undefined;
  display: (value: number | undefined) => string;
  onTare?: () => void;
  tareDisabled?: boolean;
  maxResetKey?: number;
  trackMax?: boolean;
} & React.ComponentProps<typeof Card>;

export function WidgetChartValueCard({
  label,
  color,
  value,
  display,
  className,
  onTare,
  tareDisabled,
  maxResetKey,
  trackMax,
  ...props
}: Props) {
  const [max, setMax] = React.useState(value);

  React.useEffect(() => {
    if (!trackMax) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMax(value);
  }, [maxResetKey, trackMax, value]);

  React.useEffect(() => {
    if (value === undefined || !trackMax) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMax((prevMax) => (prevMax === undefined ? value : Math.max(prevMax, value)));
  }, [trackMax, value]);

  return (
    <Card
      className={cn("w-full border border-b-3 p-0", className)}
      style={{ borderBottomColor: color }}
      {...props}
    >
      <CardContent className="flex justify-between p-2">
        <div>
          <div className="text-muted-foreground text-xs">{label}</div>
          <div className="flex items-end space-x-6">
            <div className="mt-1 font-mono text-lg tabular-nums">{display(value)}</div>
            {trackMax && <div className="text-muted-foreground">MAX: {display(max)}</div>}
          </div>
        </div>
        {onTare && (
          <Button size="xs" variant="outline" onClick={onTare} disabled={tareDisabled}>
            Tare
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
