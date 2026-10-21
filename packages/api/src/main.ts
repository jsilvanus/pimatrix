import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp(config);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "Shutting down PiMatrix");
    try {
      await app.close();
    } catch (error) {
      app.log.error({ err: error }, "Error while shutting down");
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    const address = await app.listen({ host: config.host, port: config.port });
    app.log.info({ address, mode: config.mode }, "PiMatrix API listening");
  } catch (error) {
    app.log.error({ err: error }, "Unable to start PiMatrix API");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("PiMatrix startup failed:", error);
  process.exitCode = 1;
});
