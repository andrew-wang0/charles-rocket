"use client";

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
      className={cn("relative shadow-md", className)}
      {...props}
    >
      {children}
    </Button>
  );
}
