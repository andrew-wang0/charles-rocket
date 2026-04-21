"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import React from "react";

import { ServoManualControlUnit } from "@/components/widgets/servo-widget/servo-manual-control-unit";
import { cn } from "@/lib/utils";

type Props = React.ComponentProps<"div">;

export function ServoManualControl({ className, ...props }: Props) {
  return (
    <div className={cn("flex items-center justify-around", className)} {...props}>
      <ServoManualControlUnit index={0} />
      <ArrowRightIcon weight="bold" />
      <ServoManualControlUnit index={1} />
      <ArrowRightIcon weight="bold" />
      <ServoManualControlUnit index={2} />
    </div>
  );
}
