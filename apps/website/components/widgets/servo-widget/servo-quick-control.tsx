import React from "react";

import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { cn } from "@/lib/utils";

type Props = React.ComponentProps<"div">;

export function ServoQuickControl({ className, ...props }: Props) {
  return (
    <div className={cn("flex flex-1 flex-col gap-y-2", className)} {...props}>
      <WidgetLockableButton className="hover:bg-positive/20">OPEN ALL</WidgetLockableButton>
      <WidgetLockableButton className="hover:bg-destructive/20">CLOSE ALL</WidgetLockableButton>
    </div>
  );
}
