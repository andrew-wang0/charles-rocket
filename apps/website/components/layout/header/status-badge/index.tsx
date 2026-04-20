"use client";

import React from "react";
import { ReadyState } from "react-use-websocket";

import { StatusBadgeClosed } from "@/components/layout/header/status-badge/status-badge-closed";
import { StatusBadgeConnecting } from "@/components/layout/header/status-badge/status-badge-connecting";
import { StatusBadgeOpen } from "@/components/layout/header/status-badge/status-badge-open";
import { StatusBadgeUnknown } from "@/components/layout/header/status-badge/status-badge-unknown";
import { Badge } from "@/components/ui/badge";
import { useAppWebSocket } from "@/hooks/use-websocket";

export function StatusBadge() {
  const websocket = useAppWebSocket();

  let badgeContent: React.ReactNode;

  switch (websocket.readyState) {
    case ReadyState.CONNECTING:
      badgeContent = StatusBadgeConnecting();
      break;
    case ReadyState.OPEN:
      badgeContent = StatusBadgeOpen();
      break;
    case ReadyState.CLOSING:
    case ReadyState.CLOSED:
      badgeContent = StatusBadgeClosed();
      break;
    default:
      badgeContent = StatusBadgeUnknown();
  }

  return (
    <Badge variant="default">
      <span className="tmf border-r pr-1">Status:</span>
      {badgeContent}
    </Badge>
  );
}
