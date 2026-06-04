"use client";

import { createClient } from "@danscan/zod-jsonrpc";

import { router } from "@/client/router";
import {
  ignitionControlResult,
  type IgnitionSnapshot,
  ignitionSnapshot,
  ignitionStateNotification,
} from "@/client/router/control/ingnition";
import {
  servoControlResult,
  type ServoSnapshot,
  servoSnapshot,
  servoStateNotification,
} from "@/client/router/control/servo";
import { env } from "@/env";
import { useStore } from "@/lib/store";

export enum ConnectionStatus {
  CONNECTING = "CONNECTING",
  CLOSED = "CLOSED",
  ERROR = "ERROR",
  CONNECTED = "CONNECTED",
}

let ws: WebSocket | null = null;

export const listeners = new Set<() => void>();
export let status: ConnectionStatus = ConnectionStatus.CLOSED;
export let connectionGeneration = 0;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: Partial<{ status: ConnectionStatus; connectionGeneration: number }>) {
  if (next.status) status = next.status;
  if (next.connectionGeneration !== undefined) {
    connectionGeneration = next.connectionGeneration;
  }
  emit();
}

function applyServoSnapshot(snapshot: ServoSnapshot) {
  useStore.getState().syncServoStates(snapshot.states);
}

function applyIgnitionSnapshot(snapshot: IgnitionSnapshot) {
  useStore.getState().setIgnitionState(snapshot.state);
}

function rejectPending(reason: Error) {
  pending.forEach(({ reject }) => reject(reason));
  pending.clear();
}

function isObjectMessage(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function handleNotification(message: unknown) {
  const servo = servoStateNotification.safeParse(message);
  if (servo.success) {
    applyServoSnapshot(servo.data.params);
    return true;
  }

  const ignition = ignitionStateNotification.safeParse(message);
  if (!ignition.success) return false;

  applyIgnitionSnapshot(ignition.data.params);
  return true;
}

function applyKnownResult(result: unknown) {
  const servoControlResponse = servoControlResult.safeParse(result);
  if (servoControlResponse.success) {
    applyServoSnapshot({ states: servoControlResponse.data.states });
    return;
  }

  const servoStateResponse = servoSnapshot.safeParse(result);
  if (servoStateResponse.success) {
    applyServoSnapshot(servoStateResponse.data);
    return;
  }

  const ignitionControlResponse = ignitionControlResult.safeParse(result);
  if (ignitionControlResponse.success) {
    applyIgnitionSnapshot(ignitionControlResponse.data);
    return;
  }

  const ignitionStateResponse = ignitionSnapshot.safeParse(result);
  if (ignitionStateResponse.success) {
    applyIgnitionSnapshot(ignitionStateResponse.data);
  }
}

function handleResponse(message: unknown) {
  if (!isObjectMessage(message)) return false;

  const { id } = message;
  if (typeof id !== "string" && typeof id !== "number") return false;

  const entry = pending.get(String(id));
  if (!entry) return false;

  pending.delete(String(id));

  if ("error" in message && message.error !== undefined) {
    entry.reject(message.error);
  } else {
    applyKnownResult(message.result);
    entry.resolve(message);
  }

  return true;
}

function handleMessage(message: unknown) {
  if (Array.isArray(message)) {
    message.forEach((entry) => {
      if (!handleNotification(entry)) {
        handleResponse(entry);
      }
    });
    return;
  }

  if (handleNotification(message)) return;

  handleResponse(message);
}

async function syncServoState() {
  const snapshot = await client.servoState(undefined);
  applyServoSnapshot(snapshot);
}

async function syncIgnitionState() {
  const snapshot = await client.ignitionState(undefined);
  applyIgnitionSnapshot(snapshot);
}

async function syncSystemTime() {
  await client.syncSystemTime({
    clientTime: Date.now(),
  });
}

async function initializeConnection() {
  try {
    await syncSystemTime();
  } catch (error) {
    console.warn("Failed to sync Pi system time", error);
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  setState({
    status: ConnectionStatus.CONNECTED,
    connectionGeneration: connectionGeneration + 1,
  });

  void Promise.all([syncServoState(), syncIgnitionState()]).catch(() => {
    ws?.close();
  });
}

export function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  setState({ status: ConnectionStatus.CONNECTING });

  ws = new WebSocket(env.NEXT_PUBLIC_WS_URL);

  ws.addEventListener("open", () => {
    void initializeConnection();
  });

  ws.addEventListener("close", () => {
    rejectPending(new Error("WebSocket closed"));
    setState({ status: ConnectionStatus.CLOSED });
    ws = null;
  });

  ws.addEventListener("error", () => {
    rejectPending(new Error("WebSocket error"));
    setState({ status: ConnectionStatus.ERROR });
  });

  ws.addEventListener("message", (event) => {
    try {
      handleMessage(JSON.parse(String(event.data)));
    } catch {
      // Ignore malformed websocket payloads.
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
  if (Array.isArray(request)) {
    throw new Error("Batch JSON-RPC requests are not supported by this transport");
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket is not connected");
  }

  const { id } = request;

  if (typeof id !== "string" && typeof id !== "number") {
    ws.send(JSON.stringify(request));
    return null;
  }

  return await new Promise((resolve, reject) => {
    pending.set(String(id), { resolve, reject });

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pending.delete(String(id));
      reject(new Error("WebSocket is not connected"));
    } else {
      ws.send(JSON.stringify(request));
    }
  });
});
