/**
 * This file is generated from ../../openapi/openapi.yaml.
 * Do not edit by hand. Run `npm run generate:api` from the repository root.
 */
export interface paths {
    "/health": {
        parameters: { query?: never; header?: never; path?: never; cookie?: never };
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ready": {
        parameters: { query?: never; header?: never; path?: never; cookie?: never };
        get: operations["getReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/status": {
        parameters: { query?: never; header?: never; path?: never; cookie?: never };
        get: operations["getStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sources": {
        parameters: { query?: never; header?: never; path?: never; cookie?: never };
        get: operations["listSources"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sources/{sourceId}": {
        parameters: { query?: never; header?: never; path: { sourceId: components["parameters"]["sourceId"] }; cookie?: never };
        get: operations["getSource"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/outputs": {
        parameters: { query?: never; header?: never; path?: never; cookie?: never };
        get: operations["listOutputs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        SourceId: "hama" | "rtmp1" | "rtmp2" | "cam1" | "cam2" | "cam3" | "PiPGM1" | "PiPGM2";
        OutputId: "hdmi0" | "hdmi1";
        Health: { status: "ok"; service: "pimatrix" };
        Readiness: {
            ready: boolean;
            mode: "simulation" | "production";
            checks: { api: string; media: string; capture: string; display: string };
        };
        Status: {
            apiVersion: "v1";
            service: "pimatrix";
            mode: "simulation" | "production";
            status: "running";
            integrations: { mediaMtx: string; fffleet: string; capture: string; display: string; amx: string };
            counts: { sources: 8; outputs: 2 };
        };
        Source: {
            id: components["schemas"]["SourceId"];
            label: string;
            kind: "capture" | "rtmp" | "camera" | "renderer";
            state: "unavailable" | "starting" | "live" | "degraded" | "failed";
            preview: { available: boolean; url: string | null };
        };
        Output: {
            id: components["schemas"]["OutputId"];
            label: string;
            desiredSource: components["schemas"]["SourceId"] | null;
            observedSource: components["schemas"]["SourceId"] | null;
            state: "unavailable" | "starting" | "active" | "failed";
        };
        Error: { error: { code: string; message: string } };
    };
    responses: { NotFound: components["schemas"]["Error"] };
    parameters: { sourceId: components["schemas"]["SourceId"] };
    requestBodies: Record<string, never>;
    headers: Record<string, never>;
    pathItems: Record<string, never>;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealth: {
        parameters: { query?: never; header?: never; path?: never; cookie?: never };
        requestBody?: never;
        responses: { 200: { headers: { [name: string]: unknown }; content: { "application/json": components["schemas"]["Health"] } } };
    };
    getReadiness: {
        parameters: { query?: never; header?: never; path?: never; cookie?: never };
        requestBody?: never;
        responses: { 200: { headers: { [name: string]: unknown }; content: { "application/json": components["schemas"]["Readiness"] } } };
    };
    getStatus: {
        parameters: { query?: never; header?: never; path?: never; cookie?: never };
        requestBody?: never;
        responses: { 200: { headers: { [name: string]: unknown }; content: { "application/json": components["schemas"]["Status"] } } };
    };
    listSources: {
        parameters: { query?: never; header?: never; path?: never; cookie?: never };
        requestBody?: never;
        responses: { 200: { headers: { [name: string]: unknown }; content: { "application/json": { items: components["schemas"]["Source"][] } } } };
    };
    getSource: {
        parameters: { query?: never; header?: never; path: { sourceId: components["parameters"]["sourceId"] }; cookie?: never };
        requestBody?: never;
        responses: {
            200: { headers: { [name: string]: unknown }; content: { "application/json": components["schemas"]["Source"] } };
            404: { headers: { [name: string]: unknown }; content: { "application/json": components["schemas"]["Error"] } };
        };
    };
    listOutputs: {
        parameters: { query?: never; header?: never; path?: never; cookie?: never };
        requestBody?: never;
        responses: { 200: { headers: { [name: string]: unknown }; content: { "application/json": { items: components["schemas"]["Output"][] } } } };
    };
}
