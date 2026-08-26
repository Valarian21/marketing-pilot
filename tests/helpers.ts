/** Test helpers: in-memory app with a fake host so no secret files are needed. */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { loadEnv } from "../src/server/env.js";
import { buildApp } from "../src/server/app.js";
import type { HostAdapter, HostUser } from "../src/host-adapter.js";

export const TEST_USER: HostUser = { id: "tester", name: "tester" };

export function fakeHost(opts: { token?: string } = {}): HostAdapter {
  const token = opts.token ?? "test-token";
  return {
    mode: "standalone",
    publicPaths: [],
    async authenticate(req: FastifyRequest) {
      return req.headers.authorization === `Bearer ${token}` ? TEST_USER : null;
    },
    registerRoutes() {},
    shell() { return { mode: "standalone", backLink: null, backLabel: null }; },
  };
}

export async function testApp(): Promise<{ app: FastifyInstance; close: () => Promise<void>; auth: Record<string, string> }> {
  const env = loadEnv({ MP_STANDALONE: "false", MP_DATA_DIR: "./data/test", OPENROUTER_API_KEY: "" });
  const built = await buildApp(env, { host: fakeHost(), dbFile: ":memory:", logger: false });
  return { app: built.app, close: built.close, auth: { authorization: "Bearer test-token" } };
}
