import { OpenAPI } from "./generated/core/OpenAPI.js";

export { OpenAPI };
export { SystemService } from "./generated/services/SystemService.js";
export { SourcesService } from "./generated/services/SourcesService.js";
export { OutputsService } from "./generated/services/OutputsService.js";
export { CamerasService } from "./generated/services/CamerasService.js";
export type * from "./generated/index.js";

export interface ApiClientOptions {
  baseUrl: string;
}

export function configureApiClient(options: ApiClientOptions): void {
  OpenAPI.BASE = options.baseUrl.replace(/\/$/, "");
}
