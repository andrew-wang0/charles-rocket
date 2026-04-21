"use client";

import { LockSimpleIcon } from "@phosphor-icons/react";
import React from "react";

import { Button } from "@/components/ui/button";
import { useWidgetLock } from "@/components/widgets/widget-lock";
import { cn } from "@/lib/utils";

type Props = React.ComponentProps<typeof Button>;

export function WidgetLockableButton({ children, className, ...props }: Props) {
  const { locked } = useWidgetLock();
  return (
    <Button
      variant="outline"
      disabled={locked}
      className={cn("relative shadow-md", className)}
      {...props}
    >
      {children}
      {locked && (
        <div className="bg-muted-foreground/20 absolute flex size-full items-center justify-center backdrop-blur-[2px]">
          <LockSimpleIcon weight="fill" />
        </div>
      )}
    </Button>
  );
}
