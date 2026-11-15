import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Everyday Storage HQ",
    short_name: "Storage HQ",
    start_url: "/",
    display: "standalone",
    background_color: "#293221",
    theme_color: "#293221",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
