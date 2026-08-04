import type { MetadataRoute } from "next";

// Web app manifest so the game can be installed / added to the home screen
// (Android + Chrome read this; iOS uses apple-icon.png + appleWebApp metadata).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Country Defense",
    short_name: "Defense",
    description:
      "Pick your country as a glossy 3D flag marble and defend it from waves of invaders with 7 upgradeable towers.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["games"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
