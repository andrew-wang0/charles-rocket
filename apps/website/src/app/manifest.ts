import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Charles Dashboard",
    short_name: "Charles",
    description: "Rocket control and telemetry dashboard",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f5",
    theme_color: "#343434",
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
