"use client";

import { useSyncExternalStore } from "react";

import { getBackendHost, getDefaultBackendHost, subscribeBackendHost } from "@/lib/backend-host";

function getServerSnapshot() {
  return getDefaultBackendHost();
}

export function useBackendHost() {
  return useSyncExternalStore(subscribeBackendHost, getBackendHost, getServerSnapshot);
}
