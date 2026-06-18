"use client";

import { useEffect, useSyncExternalStore } from "react";

import { ConnectionStatus, reconnect, status, subscribe } from "@/client";
import { useBackendHost } from "@/hooks/use-backend-host";

function getSnapshot() {
  return status;
}

function getServerSnapshot() {
  return ConnectionStatus.CLOSED;
}

export function useConnectionStatus() {
  const backendHost = useBackendHost();

  useEffect(() => {
    reconnect();
  }, [backendHost]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
