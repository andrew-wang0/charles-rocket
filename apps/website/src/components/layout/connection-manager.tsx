"use client";

import { useEffect } from "react";

import { reconnect } from "@/client";
import { useBackendHost } from "@/hooks/use-backend-host";

export function ConnectionManager() {
  const backendHost = useBackendHost();

  useEffect(() => {
    reconnect();
  }, [backendHost]);

  return null;
}
