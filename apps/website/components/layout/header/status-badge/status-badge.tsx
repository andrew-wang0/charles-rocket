"use client";

import React from "react";
import { ReadyState } from "react-use-websocket";

import { StatusBadgeClosed } from "@/components/layout/header/status-badge/status-badge-closed";
import { StatusBadgeConnected } from "@/components/layout/header/status-badge/status-badge-connected";
import { StatusBadgeConnecting } from "@/components/layout/header/status-badge/status-badge-connecting";
import { StatusBadgeUnknown } from "@/components/layout/header/status-badge/status-badge-unknown";
import { Badge } from "@/components/ui/badge";
import { useAppWebSocket } from "@/hooks/use-websocket";

export function StatusBadge() {
  const websocket = useAppWebSocket();

  let badgeContent: React.ReactNode;

  switch (websocket.readyState) {
    case ReadyState.CONNECTING:
      badgeContent = <StatusBadgeConnecting />;
      break;
    case ReadyState.OPEN:
      badgeContent = <StatusBadgeConnected />;
      break;
    case ReadyState.CLOSING:
    case ReadyState.CLOSED:
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
      <Badge variant="default">{badgeContent}</Badge>
    </div>
  );
}
