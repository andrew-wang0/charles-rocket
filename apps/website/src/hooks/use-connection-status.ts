"use client";

import { useEffect, useSyncExternalStore } from "react";

import { connect, connectionGeneration, ConnectionStatus, status, subscribe } from "@/client";

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

function getConnectionGenerationSnapshot() {
  return connectionGeneration;
}

function getConnectionGenerationServerSnapshot() {
  return 0;
}

export function useConnectionGeneration() {
  useEffect(() => {
    connect();
  }, []);

  return useSyncExternalStore(
    subscribe,
    getConnectionGenerationSnapshot,
    getConnectionGenerationServerSnapshot,
  );
}
