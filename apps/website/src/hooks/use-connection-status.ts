"use client";

import { useEffect, useSyncExternalStore } from "react";

import { connect, ConnectionStatus, status, subscribe } from "@/client";

function getSnapshot() {
  return status;
}

function getServerSnapshot() {
  return ConnectionStatus.CLOSED;
}

export function useConnectionStatus() {
  useEffect(() => {
    connect();
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
