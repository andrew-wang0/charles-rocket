"use client";

import { LockSimpleIcon } from "@phosphor-icons/react";
import React from "react";

import { Button } from "@/components/ui/button";
import { useWidgetLock } from "@/components/widgets/widget-lock";
import { cn } from "@/lib/util/cn";

type Props = React.ComponentProps<typeof Button>;

export function WidgetLockableButton({ children, className, disabled, ...props }: Props) {
  const { locked } = useWidgetLock();

  return (
    <Button
      variant="outline"
      disabled={locked || disabled}
      className={cn(
        "disabled:hover:bg-background disabled:hover:text-foreground relative shadow-md",
        className,
      )}
      {...props}
    >
      {children}
      {locked && (
        <div className="bg-muted-foreground/20 pointer-events-none absolute flex size-full items-center justify-center backdrop-blur-sm">
          <LockSimpleIcon weight="fill" />
        </div>
      )}
    </Button>
  );
}
