import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

const hardwareHostSchema = z
  .string()
  .min(1)
  .refine((host) => {
    const normalized = host.trim().toLowerCase();
    return normalized !== "0.0.0.0" && normalized !== "::";
  }, "NEXT_PUBLIC_BACKEND_HOST must be the Pi address, not 0.0.0.0");

export const env = createEnv({
  client: {
    NEXT_PUBLIC_BACKEND_HOST: hardwareHostSchema,
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_BACKEND_HOST: process.env.NEXT_PUBLIC_BACKEND_HOST,
  },
});

export {
  getBackendHost,
  getDefaultBackendHost,
  getStoredBackendHost,
  hardwareAudioStreamUrl,
  hardwareVideoUrl,
  hardwareWsUrl,
  normalizeBackendHostInput,
  setBackendHost,
} from "@/lib/backend-host";
