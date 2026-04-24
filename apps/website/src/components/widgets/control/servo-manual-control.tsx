"use client";

import React from "react";

import { ServoManualControlUnit } from "@/components/widgets/control/servo-manual-control-unit";
import { SERVO_COUNT } from "@/lib/constants";
import { cn } from "@/lib/utils";

type Props = React.ComponentProps<"div">;

export function ServoManualControl({ className, ...props }: Props) {
  return (
    <div className={cn("flex items-center justify-around", className)} {...props}>
      {Array.from({ length: SERVO_COUNT }).map((_, index) => (
        <React.Fragment key={index}>
          <ServoManualControlUnit index={index} />
        </React.Fragment>
      ))}
    </div>
  );
}
