import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    // 127.0.0.1 고정 — API도 루프백이라 origin이 흔들리면 CORS가 어긋난다.
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
  },
});
