"use client";

import { createClient } from "@danscan/zod-jsonrpc";

import { router } from "@/client/router";
import { env } from "@/env";

export enum ConnectionStatus {
  CONNECTING = "CONNECTING",
  CLOSED = "CLOSED",
  ERROR = "ERROR",
  OPEN = "OPEN",
}

let ws: WebSocket | null = null;

export const listeners = new Set<() => void>();
export let status: ConnectionStatus = ConnectionStatus.CLOSED;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: Partial<{ status: ConnectionStatus }>) {
  if (next.status) status = next.status;
  emit();
}

export function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  setState({ status: ConnectionStatus.CONNECTING });

  ws = new WebSocket(env.NEXT_PUBLIC_WS_URL);

  ws.addEventListener("open", () => {
    setState({ status: ConnectionStatus.OPEN });
  });

  ws.addEventListener("close", () => {
    setState({ status: ConnectionStatus.CLOSED });
    ws = null;
  });

  ws.addEventListener("error", () => {
    setState({ status: ConnectionStatus.ERROR });
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));

    if (typeof msg?.id !== "number") return;

    const entry = pending.get(msg.id);
    if (!entry) return;

    pending.delete(msg.id);

    if (msg.error) {
      entry.reject(msg.error);
    } else {
      entry.resolve(msg);
    }
  });
}

const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }
>();

export const client = createClient(router, async (request) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket is not connected");
  }

  const id = crypto.randomUUID();
  const payload = { ...request, id, jsonrpc: "2.0" };

  return await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pending.delete(id);
    } else {
      ws.send(JSON.stringify(payload));
    }
  });
});
