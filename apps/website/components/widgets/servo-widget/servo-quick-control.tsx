import React from "react";

import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { cn } from "@/lib/utils";

type Props = {
  disabled: boolean;
  onOpenAll: () => void;
  onCloseAll: () => void;
} & React.ComponentProps<"div">;

export function ServoQuickControl({ className, disabled, onOpenAll, onCloseAll, ...props }: Props) {
  return (
    <div className={cn("flex flex-1 flex-col gap-y-2", className)} {...props}>
      <WidgetLockableButton
        disabled={disabled}
        className="hover:bg-positive/20"
        onClick={onOpenAll}
      >
        OPEN ALL
      </WidgetLockableButton>
      <WidgetLockableButton
        disabled={disabled}
        className="hover:bg-destructive/20"
        onClick={onCloseAll}
      >
        CLOSE ALL
      </WidgetLockableButton>
    </div>
  );
}
