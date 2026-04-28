"use client";

import { useEffect, useSyncExternalStore } from "react";

import { connect, ConnectionStatus, subscribe } from "@/client";

function getSnapshot() {
  // return status;
  return ConnectionStatus.CONNECTED;
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
