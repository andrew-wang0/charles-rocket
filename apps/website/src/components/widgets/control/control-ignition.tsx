import { LockSimpleIcon } from "@phosphor-icons/react";
import React from "react";

import { useWidgetLock } from "@/components/widgets/widget-lock";
import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { WidgetNoSignal } from "@/components/widgets/widget-no-signal";
import { useIgnitionControl } from "@/hooks/use-ignition";
import { cn } from "@/lib/util/cn";
import { IgnitionState } from "@/types/ignition";

type Props = React.ComponentProps<"div">;

function getStatusClassName(state: IgnitionState) {
  switch (state) {
    case IgnitionState.ON:
      return "bg-positive/20 text-positive border-positive/40 hover:!bg-positive/20 hover:!text-positive hover:!border-positive/40 dark:hover:!bg-positive/20 dark:hover:!text-positive";
    case IgnitionState.OFF:
      return "bg-destructive/10 text-destructive border-destructive/30 hover:!bg-destructive/10 hover:!text-destructive hover:!border-destructive/30 dark:hover:!bg-destructive/10 dark:hover:!text-destructive";
    default:
      return "bg-muted text-muted-foreground border-border hover:!bg-muted hover:!text-muted-foreground hover:!border-border dark:hover:!bg-muted dark:hover:!text-muted-foreground";
  }
}

export function ControlIgnition({ className, ...props }: Props) {
  const ignition = useIgnitionControl();
  const { locked } = useWidgetLock();

  async function handleSwitch() {
    try {
      await ignition.toggle();
    } catch (error) {
      console.error("Failed to switch ignition", error);
    }
  }

  return (
    <div className={cn("flex h-full flex-col items-center gap-y-2", className)} {...props}>
      <p className="text-center">IGNITION</p>
      {ignition.isUnknown ? (
        <div className="flex flex-1 items-center justify-center">
          <WidgetNoSignal className="size-16 text-[0.65rem]" />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-1">
            <WidgetLockableButton
              aria-label="Switch ignition"
              variant="ghost"
              className={cn(
                "size-16 rounded-full border p-0 text-[0.65rem] font-medium shadow-none",
                !ignition.isBusy && "enabled:hover:ring-ring/60 enabled:hover:ring-4",
                getStatusClassName(ignition.state),
                ignition.isBusy &&
                  "animation-duration-[250ms] animate-pulse transition-none disabled:opacity-100",
              )}
              disabled={ignition.isBusy}
              onClick={() => {
                void handleSwitch();
              }}
            >
              {ignition.state}
            </WidgetLockableButton>
            <div aria-hidden="true" className="h-3 leading-none">
              <LockSimpleIcon
                className={cn("size-3", locked ? "opacity-100" : "opacity-0")}
                weight="fill"
              />
            </div>
            <div aria-hidden="true" className="text-muted-foreground h-4 text-xs tabular-nums" />
          </div>
        </div>
      )}
    </div>
  );
}
