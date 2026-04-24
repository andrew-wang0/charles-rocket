"use client";

import React from "react";

import { ConnectionStatus } from "@/client";
import { Card } from "@/components/ui/card";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { cn } from "@/lib/utils";

type Props = React.ComponentProps<typeof Card>;

export function WidgetCard({ children, className, ...props }: Props) {
  const status = useConnectionStatus();

  const isOpen = status === ConnectionStatus.OPEN;

  return (
    <Card
      aria-disabled={!isOpen}
      className={cn("relative", !isOpen && "pointer-events-none select-none", className)}
      {...props}
    >
      {children}
      {!isOpen ? (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 z-10",
            "bg-muted-foreground/10 border backdrop-blur-[2px]",
            "flex items-center justify-center",
          )}
        >
          <div className="bg-accent border-border border-2 p-1">DISCONNECTED</div>
        </div>
      ) : null}
    </Card>
  );
}
