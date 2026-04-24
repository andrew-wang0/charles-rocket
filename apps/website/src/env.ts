import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  client: {
    NEXT_PUBLIC_VIDEO_URL: z.url(),
    NEXT_PUBLIC_WS_URL: z.url(),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_VIDEO_URL: process.env.NEXT_PUBLIC_VIDEO_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  },
});
