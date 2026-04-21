import React from "react";

import { Separator } from "@/components/ui/separator";
import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { useServoControl } from "@/hooks/use-servo-control";
import { cn } from "@/lib/utils";

type Props = {
  disabled: boolean;
} & React.ComponentProps<"div">;

export function ServoQuickControl({ className, disabled, ...props }: Props) {
  const { openAllServos, closeAllServos, openServo } = useServoControl();

  return (
    <div className={cn("flex flex-1 flex-col gap-y-2", className)} {...props}>
      <WidgetLockableButton
        disabled={disabled}
        className="hover:bg-positive/20"
        onClick={openAllServos}
      >
        OPEN ALL
      </WidgetLockableButton>
      <WidgetLockableButton
        disabled={disabled}
        className="hover:bg-destructive/20"
        onClick={closeAllServos}
      >
        CLOSE ALL
      </WidgetLockableButton>
      <Separator />
      <WidgetLockableButton
        disabled={disabled}
        className="hover:bg-positive/20"
        onClick={() => openServo([1, 2])}
      >
        OPEN 2 & OPEN 3
      </WidgetLockableButton>
    </div>
  );
}
