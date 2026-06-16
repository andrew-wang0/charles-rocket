import React from "react";

import { ConnectionSettings } from "@/components/layout/header/connection-settings";
import { StatusBadge } from "@/components/layout/header/status-badge/status-badge";

export function Header() {
  return (
    <header className="px-4 py-2">
      <div className="flex items-center justify-between">
        <p className="space-x-2 text-xl">
          <span className="text-xl font-bold">Charles</span>
          <span className="text-muted-foreground font-light">Dashboard</span>
        </p>
        <div className="flex items-center">
          <StatusBadge />
          <ConnectionSettings />
        </div>
      </div>
    </header>
  );
}
