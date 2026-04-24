import React from "react";

import { Badge } from "@/components/ui/badge";

export function StatusBadgeUnknown() {
  return (
    <Badge>
      <span className="bg-muted-foreground size-2 rounded-full" />
      <span>UNKNOWN</span>
    </Badge>
  );
}
