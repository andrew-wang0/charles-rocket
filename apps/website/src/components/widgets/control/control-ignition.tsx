import React from "react";

import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { WidgetNoSignal } from "@/components/widgets/widget-no-signal";
import { useIgnitionControl } from "@/hooks/use-ignition";
import { cn } from "@/lib/util/cn";
import { IgnitionState } from "@/types/ignition";

type Props = React.ComponentProps<"div">;

function getStatusClassName(state: IgnitionState) {
  switch (state) {
    case IgnitionState.ON:
      return "bg-positive/20 text-positive border-positive/40";
    case IgnitionState.OFF:
      return "bg-destructive/10 text-destructive border-destructive/30 cursor-not-allowed";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function ControlIgnition({ className, ...props }: Props) {
  const ignition = useIgnitionControl();

  async function handleSwitch() {
    try {
      await ignition.toggle();
    } catch (error) {
      console.error("Failed to switch ignition", error);
    }
  }

  return (
    <div
      className={cn("flex h-full flex-col items-center justify-between gap-y-2", className)}
      {...props}
    >
      <p className="text-center">IGNITION</p>
      <div className="flex flex-1 items-center justify-center">
        <div
          className={cn(
            "flex size-16 items-center justify-center rounded-full border text-[0.65rem] font-medium",
            getStatusClassName(ignition.state),
            ignition.isBusy && "animation-duration-[250ms] animate-pulse",
          )}
        >
          <span>{ignition.state}</span>
        </div>
      </div>
      <div className="w-full">
        {ignition.isUnknown ? (
          <WidgetNoSignal className="h-8 w-full" />
        ) : (
          <WidgetLockableButton
            disabled={ignition.isBusy}
            onClick={() => {
              void handleSwitch();
            }}
            className="w-full"
          >
            SWITCH
          </WidgetLockableButton>
        )}
      </div>
    </div>
  );
}
