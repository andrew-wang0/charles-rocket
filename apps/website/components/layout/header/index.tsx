import React from "react";

import { StatusBadge } from "@/components/layout/header/status-badge";

export function Header() {
  return (
    <header className="border-b p-2">
      <div className="flex items-center justify-between">
        <p className="space-x-2 text-xl">
          <span className="text-xl font-bold">Charles</span>
          <span className="text-muted-foreground font-light">Dashboard</span>
        </p>
        <StatusBadge />
      </div>
    </header>
  );
}
