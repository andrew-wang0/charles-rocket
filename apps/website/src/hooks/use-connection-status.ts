"use client";

import { useSyncExternalStore } from "react";

import { ConnectionStatus, status, subscribe } from "@/client";

function getSnapshot() {
  return status;
}

function getServerSnapshot() {
  return ConnectionStatus.CLOSED;
}

export function useConnectionStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
