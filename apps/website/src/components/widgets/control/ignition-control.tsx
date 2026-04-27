import React, { useState } from "react";

import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { useIgnition, useIgnitionControl } from "@/hooks/use-ignition";
import { cn } from "@/lib/util/cn";
import { IgnitionState } from "@/types/ignition";

type Props = React.ComponentProps<"div">;

function getStatusClassName(state: IgnitionState) {
  switch (state) {
    case IgnitionState.ON:
      return "bg-positive/20 text-positive border-positive/40";
    case IgnitionState.OFF:
      return "bg-destructive/10 text-destructive border-destructive/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function IgnitionControl({ className, ...props }: Props) {
  const ignition = useIgnition();
  const { setIgnition } = useIgnitionControl();
  const [pending, setPending] = useState(false);
  const isDisabled = pending || ignition.isUnknown;

  async function handleSwitch() {
    if (isDisabled) return;

    setPending(true);

    try {
      await setIgnition(ignition.isOn ? IgnitionState.OFF : IgnitionState.ON);
    } catch (error) {
      console.error("Failed to switch ignition", error);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={cn("flex h-full flex-col items-center justify-between", className)} {...props}>
      <p className="h-8">IGNITION</p>
      <div
        className={cn(
          "flex size-16 items-center justify-center rounded-full border text-[0.65rem] font-medium",
          getStatusClassName(ignition.state),
          pending && "animation-duration-[250ms] animate-pulse",
        )}
      >
        <span>{ignition.state}</span>
      </div>
      <WidgetLockableButton
        disabled={isDisabled}
        onClick={() => {
          void handleSwitch();
        }}
      >
        SWITCH
      </WidgetLockableButton>
    </div>
  );
}
