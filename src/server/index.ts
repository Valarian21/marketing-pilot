/** Entry point: `pnpm start` (dashboard mode) or `MP_STANDALONE=true pnpm start`. */
import { loadEnv } from "./env.js";
import { buildApp } from "./app.js";

const env = loadEnv();
const built = await buildApp(env);

const shutdown = async (signal: string) => {
  built.app.log.info({ signal }, "shutting down");
  await built.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await built.app.listen({ host: env.MP_HOST, port: env.MP_PORT });
built.app.log.info(`Marketing Pilot (${built.host.mode}) -> http://${env.MP_HOST}:${env.MP_PORT}/mp/`);
