import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "PDF Sort",
        short_name: "PDF Sort",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#2563eb",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/svg+xml",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/svg+xml",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,pfb,ttf}"],
      },
    }),
  ],
});
