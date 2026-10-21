import createClient from "openapi-fetch";
import type { paths } from "./generated.js";

export type { components, operations, paths } from "./generated.js";

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions) {
  return createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/$/, ""),
    fetch: options.fetch
  });
}
