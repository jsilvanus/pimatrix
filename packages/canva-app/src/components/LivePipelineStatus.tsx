import React from "react";
import { Rows, Text, Badge } from "@canva/app-ui-kit";
import type { PiPgmPipelineSnapshot } from "../types";

interface Props {
  pipelines: PiPgmPipelineSnapshot[];
}

export const LivePipelineStatus: React.FC<Props> = ({ pipelines }) => {
  if (!pipelines || pipelines.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        background: "rgba(255, 255, 255, 0.02)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        borderRadius: "8px",
        padding: "10px 12px",
        marginBottom: "12px"
      }}
    >
      <Rows spacing="1u">
        <Text size="small" variant="bold" tone="secondary">
          LIVE PROGRAM FEEDS (PIPGM)
        </Text>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {pipelines.map((p) => {
            const isFtb = p.fadeToBlack;
            const isMuted = !p.audioEnabled;

            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  backgroundColor: isFtb
                    ? "rgba(239, 68, 68, 0.12)"
                    : "rgba(255, 255, 255, 0.04)",
                  border: isFtb
                    ? "1px solid rgba(239, 68, 68, 0.3)"
                    : "1px solid rgba(255, 255, 255, 0.06)"
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontWeight: "bold", fontSize: "12px" }}>
                      {p.id} ({p.label})
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "1px 4px",
                        borderRadius: "3px",
                        backgroundColor: "rgba(255, 255, 255, 0.1)"
                      }}
                    >
                      {p.orientation === "portrait" ? "9:16 Portrait" : "16:9 Landscape"}
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.6)" }}>
                    Step {p.currentStep + 1} • {p.activeItemId || "No item active"}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  {isFtb && <Badge tone="critical" text="FTB" />}
                  {isMuted && <Badge tone="warn" text="MUTED" />}
                  {!isFtb && !isMuted && <Badge tone="positive" text="LIVE" />}
                </div>
              </div>
            );
          })}
        </div>
      </Rows>
    </div>
  );
};
