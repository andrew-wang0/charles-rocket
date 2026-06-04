import process from "node:process";

import { type WebSocket, WebSocketServer } from "ws";

import { PRESSURE_TRANSDUCER_COUNT, SERVO_COUNT } from "@/lib/constants";
import { IgnitionState } from "@/types/ignition";
import { ServoState } from "@/types/servo";

const HISTORY_WINDOW_MS = 10 * 60_000;
const SAMPLE_INTERVAL_MS = 50;
const LOAD_SENSOR_MAX_LB = 200;
const DEFAULT_PORT = 8765;
const DEFAULT_HOST = "0.0.0.0";

type JsonRpcId = string | number | null;
type TimedReading = {
  time: number;
  value: number;
};

type JsonRpcRequest = {
  jsonrpc?: unknown;
  method?: unknown;
  params?: unknown;
  id?: unknown;
};

const servoStates = Array.from({ length: SERVO_COUNT }, () => ServoState.CLOSED);
let ignitionState = IgnitionState.OFF;
const pressureBuffers: TimedReading[][] = Array.from(
  { length: PRESSURE_TRANSDUCER_COUNT },
  () => [],
);
const loadBuffer: TimedReading[] = [];
const latestPressureValues = Array.from({ length: PRESSURE_TRANSDUCER_COUNT }, () =>
  randomPressureValue(),
);
let latestLoadValue = randomLoadValue();

seedPressureHistory();
seedLoadHistory();

const sampler = setInterval(() => {
  const now = Date.now();
  appendPressureSample(now);
  appendLoadSample(now);
}, SAMPLE_INTERVAL_MS);

const port = Number(process.env.MOCK_WS_PORT ?? DEFAULT_PORT);
const host = process.env.MOCK_WS_HOST ?? DEFAULT_HOST;

const wss = new WebSocketServer({ host, port });

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    void handleMessage(socket, raw.toString());
  });
});

wss.on("listening", () => {
  console.log(`mock websocket server listening on ws://${host}:${port}`);
});

wss.on("close", () => {
  clearInterval(sampler);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function handleMessage(socket: WebSocket, raw: string) {
  let request: JsonRpcRequest;

  try {
    request = JSON.parse(raw) as JsonRpcRequest;
  } catch {
    await send(socket, errorResponse(null, -32700, "Parse error"));
    return;
  }

  if (!isValidRequest(request)) {
    await send(socket, errorResponse(extractId(request.id), -32600, "Invalid Request"));
    return;
  }

  const id = extractId(request.id);
  const isNotification = request.id === undefined;

  try {
    const response = handleMethod(request.method, request.params, id);
    if (isNotification) return;

    await send(socket, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    await send(socket, errorResponse(id, -32000, message));
  }
}

function handleMethod(method: string, params: unknown, id: JsonRpcId) {
  switch (method) {
    case "servoControl":
      return okResponse(id, handleServoControl(params));
    case "servoState":
      return okResponse(id, servoSnapshot());
    case "ignitionControl":
      return okResponse(id, handleIgnitionControl(params));
    case "ignitionState":
      return okResponse(id, ignitionSnapshot());
    case "syncSystemTime":
      return okResponse(id, handleSyncSystemTime(params));
    case "readings":
      return okResponse(id, handleReadings(params));
    case "tare":
      return okResponse(id, handleTare(params));
    default:
      return errorResponse(id, -32601, `Method not found: ${method}`);
  }
}

function handleServoControl(params: unknown) {
  const payload = asRecord(params);
  const index = Number(payload.index);
  const nextState = payload.set;

  if (!Number.isInteger(index) || index < 0 || index >= SERVO_COUNT) {
    throw new Error("servoControl index must be a valid servo number");
  }

  if (nextState !== ServoState.OPEN && nextState !== ServoState.CLOSED) {
    throw new Error("servoControl set must be OPEN or CLOSED");
  }

  servoStates[index] = nextState;

  return {
    result: "success",
    ...servoSnapshot(),
  };
}

function handleIgnitionControl(params: unknown) {
  const payload = asRecord(params);
  const nextState = payload.set;

  if (nextState !== IgnitionState.ON && nextState !== IgnitionState.OFF) {
    throw new Error("ignitionControl set must be ON or OFF");
  }

  ignitionState = nextState;

  return {
    result: "success",
    state: ignitionState,
  };
}

function ignitionSnapshot() {
  return {
    state: ignitionState,
  };
}

function handleSyncSystemTime(params: unknown) {
  const payload = asRecord(params);
  const clientTime = Number(payload.clientTime);
  const serverTimeBefore = Date.now();

  if (!Number.isInteger(clientTime) || clientTime < 0) {
    throw new Error("clientTime must be a nonnegative integer");
  }

  return {
    applied: false,
    offsetMs: clientTime - serverTimeBefore,
    serverTimeAfter: Date.now(),
    serverTimeBefore,
  };
}

function handleReadings(params: unknown) {
  const payload = params === undefined ? {} : asRecord(params);
  const includeHistory = payload.history === true;
  const includeLoad = payload.includeLoad !== false;
  const includePressure = payload.includePressure !== false;
  const serverTime = Date.now();
  let startTime = getOptionalNumber(payload.startTime);
  let endTime = getOptionalNumber(payload.endTime);
  const windowMs = getOptionalNumber(payload.windowMs);

  if (includeHistory && windowMs !== undefined) {
    endTime ??= serverTime;
    startTime ??= Math.max(0, endTime - windowMs);
  }

  const loadData = includeLoad
    ? includeHistory
      ? loadHistory(startTime, endTime)
      : latestLoadPayload()
    : [];
  const pressureData = includePressure
    ? includeHistory
      ? pressureHistory(startTime, endTime)
      : latestPressurePayload()
    : emptyPressurePayload();

  return {
    serverTime,
    ...(includeHistory && startTime !== undefined && endTime !== undefined
      ? {
          timeRange: {
            startTime,
            endTime,
          },
        }
      : {}),
    status: {
      servoControllerOk: true,
      pressureSensorsOk: Array.from({ length: PRESSURE_TRANSDUCER_COUNT }, () => true),
      loadSensorOk: true,
    },
    data: {
      load: loadData,
      pressure: pressureData,
    },
  };
}

function handleTare(params: unknown) {
  const payload = asRecord(params);

  if (payload.device !== "pressure") {
    throw new Error("tare device must be pressure");
  }

  const index = Number(payload.index);
  if (!Number.isInteger(index) || index < 0 || index >= PRESSURE_TRANSDUCER_COUNT) {
    throw new Error("tare index must be a valid pressure transducer number");
  }

  const channelIndex = index;
  const tareValue = latestPressureValues[channelIndex] ?? 0;

  latestPressureValues[channelIndex] -= tareValue;
  pressureBuffers[channelIndex] = pressureBuffers[channelIndex].map((reading) => ({
    ...reading,
    value: reading.value - tareValue,
  }));

  return {
    device: "pressure",
    index,
    value: tareValue,
  };
}

function servoSnapshot() {
  return {
    states: servoStates.map((state, index) => ({
      index,
      state,
    })),
  };
}

function latestPressurePayload() {
  return pressureBuffers.map((buffer) => {
    const latest = buffer.at(-1);
    return latest ? [latest] : [];
  });
}

function emptyPressurePayload() {
  return Array.from({ length: PRESSURE_TRANSDUCER_COUNT }, () => []);
}

function pressureHistory(startTime?: number, endTime?: number) {
  return pressureBuffers.map((buffer) => filterHistory(buffer, startTime, endTime));
}

function latestLoadPayload() {
  const latest = loadBuffer.at(-1);
  return latest ? [latest] : [];
}

function loadHistory(startTime?: number, endTime?: number) {
  return filterHistory(loadBuffer, startTime, endTime);
}

function filterHistory(buffer: TimedReading[], startTime?: number, endTime?: number) {
  return buffer.filter((reading) => {
    if (startTime !== undefined && reading.time < startTime) return false;
    return !(endTime !== undefined && reading.time > endTime);
  });
}

function appendPressureSample(now: number) {
  for (let index = 0; index < PRESSURE_TRANSDUCER_COUNT; index += 1) {
    latestPressureValues[index] = nextPressureValue(latestPressureValues[index]);
    pressureBuffers[index].push({
      time: now,
      value: latestPressureValues[index],
    });
    trimBuffer(pressureBuffers[index], now);
  }
}

function appendLoadSample(now: number) {
  latestLoadValue = nextLoadValue(latestLoadValue);
  loadBuffer.push({
    time: now,
    value: latestLoadValue,
  });
  trimBuffer(loadBuffer, now);
}

function trimBuffer(buffer: TimedReading[], now: number) {
  const cutoff = now - HISTORY_WINDOW_MS;

  while ((buffer[0]?.time ?? Number.POSITIVE_INFINITY) < cutoff) {
    buffer.shift();
  }
}

function seedPressureHistory() {
  const now = Date.now();

  for (
    let timestamp = now - HISTORY_WINDOW_MS + SAMPLE_INTERVAL_MS;
    timestamp <= now;
    timestamp += SAMPLE_INTERVAL_MS
  ) {
    appendPressureSample(timestamp);
  }
}

function seedLoadHistory() {
  const now = Date.now();

  for (
    let timestamp = now - HISTORY_WINDOW_MS + SAMPLE_INTERVAL_MS;
    timestamp <= now;
    timestamp += SAMPLE_INTERVAL_MS
  ) {
    appendLoadSample(timestamp);
  }
}

function nextPressureValue(previous: number) {
  const delta = (Math.random() - 0.5) * 50;
  return clamp(previous + delta, -500, 500);
}

function randomPressureValue() {
  return Math.random() * 500;
}

function nextLoadValue(previous: number) {
  const delta = (Math.random() - 0.5) * 24;
  return clamp(previous + delta, 0, LOAD_SENSOR_MAX_LB);
}

function randomLoadValue() {
  return Math.random() * LOAD_SENSOR_MAX_LB;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isValidRequest(value: JsonRpcRequest): value is {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id?: string | number | null;
} {
  return value.jsonrpc === "2.0" && typeof value.method === "string";
}

function extractId(id: unknown): JsonRpcId {
  if (typeof id === "string" || typeof id === "number" || id === null) {
    return id;
  }

  return null;
}

function asRecord(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("params must be an object");
  }

  return value as Record<string, unknown>;
}

function getOptionalNumber(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function okResponse(id: JsonRpcId, result: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id,
    result,
  };
}

function errorResponse(id: JsonRpcId, code: number, message: string) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: {
      code,
      message,
    },
  };
}

async function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function shutdown() {
  clearInterval(sampler);
  wss.close();
}
