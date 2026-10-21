export { OpenAPI } from "./generated/core/OpenAPI.js";
export { SystemService } from "./generated/services/SystemService.js";
export { SourcesService } from "./generated/services/SourcesService.js";
export { OutputsService } from "./generated/services/OutputsService.js";
export type * from "./generated/index.js";

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export function configureApiClient(options: ApiClientOptions): void {
  OpenAPI.BASE = options.baseUrl.replace(/\/$/, "");
  if (options.fetch) {
    OpenAPI.FETCH = options.fetch;
  }
}
