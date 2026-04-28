import React from "react";

import { cn } from "@/lib/util/cn";

type Props = React.ComponentProps<"div">;

export function WidgetNoSignal({ className, ...props }: Props) {
  return (
    <div
      className={cn(
        "flex items-center justify-center",
        "text-muted-foreground bg-muted border text-sm",
        className,
      )}
      {...props}
    >
      NO SIGNAL
    </div>
  );
}
