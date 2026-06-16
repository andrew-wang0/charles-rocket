import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  client: {
    NEXT_PUBLIC_BACKEND_HOST: z.string().min(1),
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
