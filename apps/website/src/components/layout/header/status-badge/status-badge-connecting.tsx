import React from "react";

import { Badge } from "@/components/ui/badge";

export function StatusBadgeConnecting() {
  return (
    <Badge>
      <span className="relative flex *:size-2">
        <span className="bg-warning animation-duration-[500ms] absolute animate-ping rounded-full" />
        <span className="bg-warning relative rounded-full" />
      </span>
      <span>CONNECTING</span>
    </Badge>
  );
}
