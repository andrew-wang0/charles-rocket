import React from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/util/cn";

type Props = {
  label: string;
  color: string;
  value: number | string;
} & React.ComponentProps<typeof Card>;

export function WidgetChartValueCard({ label, color, value, className, ...props }: Props) {
  return (
    <Card
      className={cn("w-full border border-b-3 p-0", className)}
      style={{ borderBottomColor: color }}
      {...props}
    >
      <CardContent className="p-2">
        <div className="text-muted-foreground text-[11px]">{label}</div>
        <div className="mt-1 font-mono text-lg tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
