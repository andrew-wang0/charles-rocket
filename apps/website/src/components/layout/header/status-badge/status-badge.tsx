"use client";

import React from "react";

import { ConnectionStatus } from "@/client";
import { StatusBadgeClosed } from "@/components/layout/header/status-badge/status-badge-closed";
import { StatusBadgeConnected } from "@/components/layout/header/status-badge/status-badge-connected";
import { StatusBadgeConnecting } from "@/components/layout/header/status-badge/status-badge-connecting";
import { StatusBadgeUnknown } from "@/components/layout/header/status-badge/status-badge-unknown";
import { Badge } from "@/components/ui/badge";
import { useConnectionStatus } from "@/hooks/use-connection-status";

export function StatusBadge() {
  const status = useConnectionStatus();

  let badgeContent: React.ReactNode;

  switch (status) {
    case ConnectionStatus.CONNECTING:
      badgeContent = <StatusBadgeConnecting />;
      break;
    case ConnectionStatus.CONNECTED:
      badgeContent = <StatusBadgeConnected />;
      break;
    case ConnectionStatus.CLOSED:
      badgeContent = <StatusBadgeClosed />;
      break;
    default:
      badgeContent = <StatusBadgeUnknown />;
  }

  return (
    <div className="flex">
      <Badge variant="secondary" className="border-r-0">
        Status
      </Badge>
      {badgeContent}
    </div>
  );
}
