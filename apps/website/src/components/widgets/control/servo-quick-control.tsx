import React from "react";

import { Separator } from "@/components/ui/separator";
import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { cn } from "@/lib/utils";

type Props = React.ComponentProps<"div">;

export function ServoQuickControl({ className, ...props }: Props) {
  return (
    <div className={cn("flex flex-col gap-y-2", className)} {...props}>
      <WidgetLockableButton
        className="hover:bg-positive/20"
        onClick={() => {
          /* TODO */
        }}
      >
        OPEN ALL
      </WidgetLockableButton>
      <WidgetLockableButton className="hover:bg-destructive/20" onClick={() => {}}>
        CLOSE ALL
      </WidgetLockableButton>
      <Separator />
      <WidgetLockableButton
        className="hover:bg-positive/20"
        onClick={() => {
          /* TODO */
        }}
      >
        OPEN 2 & OPEN 3
      </WidgetLockableButton>
    </div>
  );
}
