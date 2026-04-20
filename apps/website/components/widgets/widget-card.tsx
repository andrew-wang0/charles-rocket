"use client";

import React from "react";
import { ReadyState } from "react-use-websocket";

import { Card } from "@/components/ui/card";
import { useAppWebSocket } from "@/hooks/use-websocket";
import { cn } from "@/lib/utils";

type Props = React.ComponentProps<typeof Card>;

export function WidgetCard({ children, className, ...props }: Props) {
  const websocket = useAppWebSocket();
  const isDisconnected = websocket.readyState !== ReadyState.OPEN;

  return (
    <Card
      aria-disabled={isDisconnected}
      className={cn("relative", isDisconnected && "cursor-not-allowed select-none", className)}
      {...props}
    >
      {children}
      {isDisconnected ? (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 z-10",
            "bg-muted-foreground/10 border backdrop-blur-[2px]",
            "flex items-center justify-center",
          )}
        >
          <div className="bg-muted-foreground/10 border-border border-2 p-1">DISCONNECTED</div>
        </div>
      ) : null}
    </Card>
  );
}
