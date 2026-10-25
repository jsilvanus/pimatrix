/**
 * HTTP routes for the ATEM switcher. Reads are open to any client that may
 * call the API; writes go through the API's existing auth hook (non-GET under
 * /api/v1/). When no ATEM is configured the routes answer 503 instead of
 * pretending a switch happened.
 */

import type { FastifyInstance } from "fastify";
import type { AtemAdapter, AtemAdapterState } from "./atem-adapter.js";

export interface AtemRouteOptions {
  /** Largest input number the ATEM accepts; defaults to 40 (ATEM Extreme ISO class). */
  maxInput?: number;
}

const DEFAULT_MAX_INPUT = 40;

function notConnected(reply: { code: (n: number) => { send: (b: unknown) => unknown } }): unknown {
  return reply.code(503).send({
    error: { code: "ATEM_NOT_CONNECTED", message: "ATEM switcher is not connected" },
  });
}

function parseInput(value: unknown, max: number): number | null {
  const input = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(input) || input < 1 || input > max) return null;
  return input;
}

export function registerAtemRoutes(
  app: FastifyInstance,
  atem: AtemAdapter,
  options: AtemRouteOptions = {},
): void {
  const maxInput = options.maxInput ?? DEFAULT_MAX_INPUT;

  app.get("/api/v1/atem", async (): Promise<AtemAdapterState> => atem.getState());

  app.put<{ Body: { input?: unknown } }>("/api/v1/atem/program", async (request, reply) => {
    const input = parseInput(request.body?.input, maxInput);
    if (input === null) {
      return reply.code(422).send({
        error: { code: "INVALID_INPUT", message: `ATEM input must be an integer between 1 and ${maxInput}` },
      });
    }
    if (!atem.getState().connected) return notConnected(reply);
    await atem.setProgram(input);
    return reply.code(200).send(atem.getState());
  });

  app.put<{ Body: { input?: unknown } }>("/api/v1/atem/preview", async (request, reply) => {
    const input = parseInput(request.body?.input, maxInput);
    if (input === null) {
      return reply.code(422).send({
        error: { code: "INVALID_INPUT", message: `ATEM input must be an integer between 1 and ${maxInput}` },
      });
    }
    if (!atem.getState().connected) return notConnected(reply);
    await atem.setPreview(input);
    return reply.code(200).send(atem.getState());
  });

  app.post("/api/v1/atem/cut", async (_request, reply) => {
    if (!atem.getState().connected) return notConnected(reply);
    await atem.cut();
    return reply.code(200).send(atem.getState());
  });
}
