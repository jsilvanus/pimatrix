import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GatewayClient } from "./gateway-client.js";

const PROXIED = ["/api/v1/atem", "/api/v1/cameras", "/api/v1/matrix"];

/**
 * ATEM, camera and matrix endpoints moved to pigateway. pimatrix keeps answering them (after its own
 * auth hook) by passing the call on, so picontrol, the CLI and the MCP keep their base URL.
 */
export function registerGatewayProxy(app: FastifyInstance, gateway: GatewayClient | null): void {
  const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    if (!gateway) {
      return reply.code(503).send({
        error: { code: "GATEWAY_NOT_CONFIGURED", message: "ATEM, camera and matrix control moved to pigateway; set PIMATRIX_GATEWAY_URL" }
      });
    }
    const hasBody = request.body !== undefined && request.body !== null && !["GET", "HEAD"].includes(request.method);
    let upstream: Response;
    try {
      upstream = await gateway.request(request.method, request.url, {
        ...(hasBody ? { body: JSON.stringify(request.body), headers: { "content-type": "application/json" } } : {})
      });
    } catch (err) {
      return reply.code(502).send({
        error: { code: "GATEWAY_UNAVAILABLE", message: err instanceof Error ? err.message : "pigateway request failed" }
      });
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get("content-type");
    if (type) void reply.header("content-type", type);
    return reply.code(upstream.status).send(body);
  };

  for (const base of PROXIED) {
    for (const route of [base, `${base}/*`]) {
      app.all(route, handler);
    }
  }
}
