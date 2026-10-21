#!/usr/bin/env node

import {
  configureApiClient,
  SourcesService,
  SystemService,
  OutputsService
} from "@pimatrix/api-client";
import type { OutputId, SourceId } from "@pimatrix/api-client";
import { parseArgs, type CliOptions } from "./options.js";

const outputIds = ["hdmi0", "hdmi1"] as const;
const sourceIds = ["hama", "rtmp1", "rtmp2", "cam1", "cam2", "cam3", "PiPGM1", "PiPGM2"] as const;

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length))
  );
  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  console.log(line(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(line(row));
}

async function run(options: CliOptions): Promise<void> {
  configureApiClient({ baseUrl: options.server });
  const [group, action, arg1, arg2] = options.command;

  if (group === "help" || options.command.length === 0) {
    console.log("Usage: pimatrix [--server <url>] [--json] <status|sources list|outputs list|outputs set <outputId> <sourceId|none>>");
    return;
  }

  if (group === "status" && options.command.length === 1) {
    const data = await SystemService.getStatus();
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else {
      console.log(`PiMatrix: ${data.status}`);
      console.log(`Mode:     ${data.mode}`);
      console.log(`API:      ${data.apiVersion}`);
      console.log(`Sources:  ${data.counts.sources}`);
      console.log(`Outputs:  ${data.counts.outputs}`);
      console.log("Integrations:");
      for (const [name, state] of Object.entries(data.integrations)) console.log(`  ${name}: ${state}`);
    }
    return;
  }

  if (group === "sources" && action === "list" && options.command.length === 2) {
    const data = await SourcesService.listSources();
    if (options.json) console.log(JSON.stringify(data.items, null, 2));
    else printTable(["ID", "LABEL", "KIND", "STATE", "PREVIEW"], data.items.map((source) => [
      source.id, source.label, source.kind, source.state,
      source.preview.available ? "available" : "unavailable"
    ]));
    return;
  }

  if (group === "outputs" && action === "list" && options.command.length === 2) {
    const data = await OutputsService.listOutputs();
    if (options.json) console.log(JSON.stringify(data.items, null, 2));
    else printTable(["ID", "LABEL", "DESIRED SOURCE", "OBSERVED SOURCE", "STATE"], data.items.map((output) => [
      output.id, output.label, output.desiredSource ?? "-", output.observedSource ?? "-", output.state
    ]));
    return;
  }

  if (group === "outputs" && action === "set" && options.command.length === 4) {
    if (!outputIds.includes(arg1 as OutputId)) throw new Error(`Unknown output ID: ${arg1}`);
    if (arg2 !== "none" && !sourceIds.includes(arg2 as SourceId)) throw new Error(`Unknown source ID: ${arg2}`);
    const data = await OutputsService.setOutputSource(arg1 as OutputId, {
      sourceId: arg2 === "none" ? null : arg2 as SourceId
    });
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else {
      console.log(`Desired source for ${data.id}: ${data.desiredSource ?? "none"}`);
      console.log(`Output state: ${data.state}`);
      if (data.state === "unavailable") console.log("Note: route intent is saved; HDMI hardware output is not implemented yet.");
    }
    return;
  }

  throw new Error(`Unknown command: ${options.command.join(" ")}`);
}

async function main(): Promise<void> {
  try {
    await run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error(`pimatrix: ${message}`);
    process.exitCode = 1;
  }
}

await main();
