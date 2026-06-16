import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

const HARDWARE_WS_PORT = 8765;
const HARDWARE_VIDEO_PORT = 8766;
const VIDEO_STREAM_PATH = "/camera.mjpg";
const AUDIO_STREAM_PATH = "/audio.raw";

export const env = createEnv({
  client: {
    NEXT_PUBLIC_BACKEND_HOST: z.string().min(1),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_BACKEND_HOST: process.env.NEXT_PUBLIC_BACKEND_HOST,
  },
});

function backendHost() {
  return env.NEXT_PUBLIC_BACKEND_HOST;
}

export function hardwareWsUrl() {
  return `ws://${backendHost()}:${HARDWARE_WS_PORT}`;
}

export function hardwareVideoUrl() {
  return `http://${backendHost()}:${HARDWARE_VIDEO_PORT}${VIDEO_STREAM_PATH}`;
}

export function hardwareAudioStreamUrl() {
  return `ws://${backendHost()}:${HARDWARE_VIDEO_PORT}${AUDIO_STREAM_PATH}`;
}
