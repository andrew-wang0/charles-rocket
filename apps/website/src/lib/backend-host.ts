"use client";

const STORAGE_KEY = "charles.backend-host";
const HARDWARE_WS_PORT = 8765;
const HARDWARE_VIDEO_PORT = 8766;
const VIDEO_STREAM_PATH = "/camera.mjpg";
const AUDIO_STREAM_PATH = "/audio.raw";

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeBackendHost(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDefaultBackendHost() {
  return normalizeBackendHostInput(process.env.NEXT_PUBLIC_BACKEND_HOST ?? "");
}

function isInvalidHardwareHost(host: string) {
  const normalized = host.trim().toLowerCase();
  return normalized === "" || normalized === "0.0.0.0" || normalized === "::";
}

function readStoredBackendHost() {
  if (typeof window === "undefined") return null;

  try {
    const value = localStorage.getItem(STORAGE_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function getStoredBackendHost() {
  return readStoredBackendHost();
}

/** Pi hardware host — never the laptop URL and never proxied through this app. */
export function getBackendHost() {
  const stored = readStoredBackendHost();
  if (stored && !isInvalidHardwareHost(stored)) {
    return stored;
  }

  const envHost = getDefaultBackendHost();
  if (!isInvalidHardwareHost(envHost)) {
    return envHost;
  }

  return "";
}

export function normalizeBackendHostInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (trimmed.includes("://")) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      return trimmed;
    }
  }

  const [host] = trimmed.split(":");
  return host.trim();
}

export function setBackendHost(host: string | null) {
  const normalized = host === null ? null : normalizeBackendHostInput(host);
  if (normalized && isInvalidHardwareHost(normalized)) {
    return;
  }
  if (!normalized) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
    emit();
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Ignore storage failures.
  }

  emit();
}

export function hardwareWsUrl(host: string = getBackendHost()) {
  return `ws://${host}:${HARDWARE_WS_PORT}`;
}

export function hardwareVideoUrl(host: string = getBackendHost()) {
  return `http://${host}:${HARDWARE_VIDEO_PORT}${VIDEO_STREAM_PATH}`;
}

export function hardwareAudioStreamUrl(host: string = getBackendHost()) {
  return `ws://${host}:${HARDWARE_VIDEO_PORT}${AUDIO_STREAM_PATH}`;
}
