import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const pluginName =
    env.VITE_PLUGIN_NAME ||
    process.env.VITE_PLUGIN_NAME ||
    env.PIMATRIX_CANVA_PLUGIN_NAME ||
    process.env.PIMATRIX_CANVA_PLUGIN_NAME ||
    "PiMatrix Canva App";

  const orgName =
    env.VITE_ORG_NAME ||
    process.env.VITE_ORG_NAME ||
    env.PIMATRIX_CANVA_ORG_NAME ||
    process.env.PIMATRIX_CANVA_ORG_NAME ||
    "Riihimäen Keskuskirkko";

  const lanUrl =
    env.VITE_LAN_URL ||
    process.env.VITE_LAN_URL ||
    env.PIMATRIX_CANVA_LAN_URL ||
    process.env.PIMATRIX_CANVA_LAN_URL ||
    "http://127.0.0.1:3000";

  const wanUrl =
    env.VITE_WAN_URL ||
    process.env.VITE_WAN_URL ||
    env.PIMATRIX_CANVA_WAN_URL ||
    process.env.PIMATRIX_CANVA_WAN_URL ||
    "";

  const canvaSecretToken =
    env.VITE_CANVA_SECRET_TOKEN ||
    process.env.VITE_CANVA_SECRET_TOKEN ||
    env.PIMATRIX_CANVA_SECRET_TOKEN ||
    process.env.PIMATRIX_CANVA_SECRET_TOKEN ||
    "";

  const defaultProfile =
    env.VITE_DEFAULT_PROFILE ||
    process.env.VITE_DEFAULT_PROFILE ||
    "lan";

  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_PLUGIN_NAME": JSON.stringify(pluginName),
      "import.meta.env.VITE_ORG_NAME": JSON.stringify(orgName),
      "import.meta.env.VITE_LAN_URL": JSON.stringify(lanUrl),
      "import.meta.env.VITE_WAN_URL": JSON.stringify(wanUrl),
      "import.meta.env.VITE_CANVA_SECRET_TOKEN": JSON.stringify(canvaSecretToken),
      "import.meta.env.VITE_DEFAULT_PROFILE": JSON.stringify(defaultProfile)
    },
    server: {
      port: 3001,
      cors: true,
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    },
    build: {
      outDir: "dist",
      sourcemap: true
    }
  };
});
