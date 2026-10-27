/** Small HTTP client for pigateway, the process that owns the ATEM, cameras and the Atlona matrix. */
export class GatewayClient {
  constructor(
    readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.apiKey ? { "x-api-key": this.apiKey } : {}), ...extra };
  }

  async request(method: string, path: string, init: { body?: string | Uint8Array | undefined; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(init.headers),
      ...(init.body !== undefined ? { body: init.body } : {}),
      signal: AbortSignal.timeout(init.timeoutMs ?? 10000)
    });
  }

  async json<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    const res = await this.request(method, path, {
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
      ...(timeoutMs ? { timeoutMs } : {})
    });
    if (!res.ok) throw new Error(`pigateway ${method} ${path} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  /** Server-sent events stream (the response body is read by the caller). */
  async openEvents(signal: AbortSignal): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}/api/v1/events`, { headers: this.headers({ accept: "text/event-stream" }), signal });
  }
}
