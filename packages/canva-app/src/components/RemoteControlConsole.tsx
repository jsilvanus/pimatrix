import React, { useState, useEffect } from "react";
import { Rows, Text, Title, Button, Select, Badge, Alert } from "@canva/app-ui-kit";
import { pipgmApi } from "../services/pipgm-api";
import { canvaSdk } from "../services/canva-sdk";
import type {
  CanvaDesignInfo,
  CanvaRenderMode,
  PiPgmPipelineId,
  PiPgmPipelineSnapshot,
  PiPgmCanvaControlRequest
} from "../types";

interface Props {
  designInfo: CanvaDesignInfo;
  pipelines: PiPgmPipelineSnapshot[];
  onPipelinesUpdate?: (pipelines: PiPgmPipelineSnapshot[]) => void;
}

type ControlTarget = "auto" | "PiPGM1" | "PiPGM2" | "PiPGM3" | "all";

export const RemoteControlConsole: React.FC<Props> = ({
  designInfo,
  pipelines,
  onPipelinesUpdate
}) => {
  const [target, setTarget] = useState<ControlTarget>("auto");
  const [activePipeline, setActivePipeline] = useState<PiPgmPipelineSnapshot | null>(null);
  const [ftbActive, setFtbActive] = useState<boolean>(false);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const [currentSlide, setCurrentSlide] = useState<number>(1);
  const [playbackState, setPlaybackState] = useState<string>("stopped");
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [controlError, setControlError] = useState<string | null>(null);

  // Update active pipeline view based on target
  useEffect(() => {
    let p: PiPgmPipelineSnapshot | undefined;
    if (target === "auto") {
      // Find pipeline presenting this design
      p = pipelines.find((item) => item.activeItemId?.includes(designInfo.designId)) || pipelines[0];
    } else if (target === "all") {
      p = pipelines[0];
    } else {
      p = pipelines.find((item) => item.id === target);
    }

    if (p) {
      setActivePipeline(p);
      setFtbActive(p.fadeToBlack);
      setAudioEnabled(p.audioEnabled);
      setCurrentSlide(p.currentStep + 1);
      setPlaybackState(p.playbackState);
    }
  }, [target, pipelines, designInfo.designId]);

  const sendControl = async (partialReq: Partial<PiPgmCanvaControlRequest>) => {
    setIsExecuting(true);
    setControlError(null);

    const isAll = target === "all";
    const targetPipelineId =
      target === "auto"
        ? undefined
        : target === "all"
        ? "all"
        : (target as PiPgmPipelineId);

    const req: PiPgmCanvaControlRequest = {
      action: partialReq.action!,
      designId: designInfo.designId,
      ...(targetPipelineId ? { targetPipelineId } : {}),
      ...(isAll ? { sync: true } : {}),
      ...partialReq
    };

    // Also relay via postMessage to parent/opener if inside stage embed
    canvaSdk.relayPostMessage({
      action: req.action,
      pageNumber: req.pageNumber,
      stepIndex: req.stepIndex,
      fadeToBlack: req.fadeToBlack,
      audioEnabled: req.audioEnabled,
      mode: req.mode
    });

    try {
      const res = await pipgmApi.controlPresentation(req);
      if (res.pipelines && res.pipelines.length > 0) {
        onPipelinesUpdate?.(res.pipelines);
        const match =
          res.pipelines.find((p) => p.id === activePipeline?.id) || res.pipelines[0];
        if (match) {
          setActivePipeline(match);
          setFtbActive(match.fadeToBlack);
          setAudioEnabled(match.audioEnabled);
          setCurrentSlide(match.currentStep + 1);
          setPlaybackState(match.playbackState);
        }
      }
    } catch (err) {
      setControlError(err instanceof Error ? err.message : "Failed to execute control action");
    } finally {
      setIsExecuting(false);
    }
  };

  const handleFtbToggle = () => {
    sendControl({ action: "ftb", ftbToggle: true });
  };

  const handleAudioToggle = () => {
    sendControl({ action: "mute", muteToggle: true });
  };

  const handlePrev = () => {
    sendControl({ action: "prev" });
  };

  const handleNext = () => {
    sendControl({ action: "next" });
  };

  const handleGotoPage = (pageNumber: number) => {
    sendControl({ action: "gotoPage", pageNumber });
  };

  const handlePlayback = (action: "play" | "pause" | "stop" | "restart") => {
    sendControl({ action });
  };

  const handleModeChange = (mode: CanvaRenderMode) => {
    sendControl({ action: "mode", mode });
  };

  const targetOptions = [
    { label: "⚡ Auto (Match Active Design)", value: "auto" },
    { label: "📺 Program 1 (Sanctuary 16:9)", value: "PiPGM1" },
    { label: "📱 Program 2 (Mobile 9:16)", value: "PiPGM2" },
    { label: "🔀 Program 3 (Auxiliary)", value: "PiPGM3" },
    { label: "🔗 All Sync (Simultaneous)", value: "all" }
  ];

  const totalPages = Math.max(designInfo.pageCount || 1, currentSlide);
  const slideNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div
      style={{
        background: "rgba(255, 255, 255, 0.04)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: "8px",
        padding: "14px 12px",
        marginBottom: "14px"
      }}
    >
      <Rows spacing="1.5u">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Title size="small">Live Remote Control</Title>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {ftbActive ? (
              <Badge tone="critical" text="FTB BLACKOUT" />
            ) : (
              <Badge tone="positive" text="ON AIR" />
            )}
          </div>
        </div>

        {controlError && (
          <Alert tone="critical">
            <Text size="small">{controlError}</Text>
          </Alert>
        )}

        {/* Target Pipeline Selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <Text size="small" variant="bold">
            Target Pipeline
          </Text>
          <Select
            value={target}
            onChange={(val) => setTarget(val as ControlTarget)}
            options={targetOptions}
          />
        </div>

        {/* Live Presentation Status Bar */}
        <div
          style={{
            background: ftbActive
              ? "rgba(239, 68, 68, 0.15)"
              : "rgba(0, 0, 0, 0.4)",
            border: ftbActive ? "1px solid #ef4444" : "1px solid rgba(255, 255, 255, 0.1)",
            boxShadow: ftbActive ? "0 0 15px rgba(239, 68, 68, 0.4)" : "none",
            borderRadius: "6px",
            padding: "8px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            transition: "all 0.2s ease"
          }}
        >
          <div>
            <div style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.6)" }}>
              {activePipeline ? activePipeline.label : "Target Pipeline"} • {activePipeline?.orientation || "landscape"}
            </div>
            <div style={{ fontSize: "14px", fontWeight: "bold" }}>
              Slide {currentSlide} of {totalPages}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.7)" }}>
              {audioEnabled ? "🔊 Sound On" : "🔇 Muted"}
            </span>
          </div>
        </div>

        {/* Big Emergency FTB & Audio Mute Toggles */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "8px" }}>
          <button
            type="button"
            onClick={handleFtbToggle}
            disabled={isExecuting}
            style={{
              padding: "12px 10px",
              borderRadius: "8px",
              border: ftbActive ? "2px solid #ef4444" : "1px solid #7f1d1d",
              backgroundColor: ftbActive ? "#dc2626" : "#450a0a",
              color: "#ffffff",
              fontWeight: "bold",
              fontSize: "13px",
              cursor: "pointer",
              boxShadow: ftbActive
                ? "0 0 20px rgba(239, 68, 68, 0.8), inset 0 0 10px rgba(255, 255, 255, 0.3)"
                : "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              transition: "all 0.15s ease"
            }}
          >
            <span style={{ fontSize: "16px" }}>⬛</span>
            <span>{ftbActive ? "FTB ACTIVE (BLACK)" : "FADE TO BLACK"}</span>
          </button>

          <button
            type="button"
            onClick={handleAudioToggle}
            disabled={isExecuting}
            style={{
              padding: "12px 10px",
              borderRadius: "8px",
              border: !audioEnabled ? "2px solid #f59e0b" : "1px solid rgba(255, 255, 255, 0.2)",
              backgroundColor: !audioEnabled ? "#78350f" : "rgba(255, 255, 255, 0.08)",
              color: "#ffffff",
              fontWeight: "bold",
              fontSize: "13px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px"
            }}
          >
            <span>{audioEnabled ? "🔊" : "🔇"}</span>
            <span>{audioEnabled ? "MUTE AUDIO" : "AUDIO MUTED"}</span>
          </button>
        </div>

        {/* Large Slide Navigation Prev & Next */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <button
            type="button"
            onClick={handlePrev}
            disabled={isExecuting || currentSlide <= 1}
            style={{
              padding: "16px",
              borderRadius: "8px",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              backgroundColor: "rgba(255, 255, 255, 0.1)",
              color: "#ffffff",
              fontSize: "15px",
              fontWeight: "bold",
              cursor: currentSlide <= 1 ? "not-allowed" : "pointer",
              opacity: currentSlide <= 1 ? 0.4 : 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px"
            }}
          >
            <span style={{ fontSize: "20px" }}>◀ PREV</span>
            <span style={{ fontSize: "10px", fontWeight: "normal", color: "rgba(255, 255, 255, 0.6)" }}>
              Slide {Math.max(1, currentSlide - 1)}
            </span>
          </button>

          <button
            type="button"
            onClick={handleNext}
            disabled={isExecuting || currentSlide >= totalPages}
            style={{
              padding: "16px",
              borderRadius: "8px",
              border: "1px solid #3b82f6",
              backgroundColor: "#2563eb",
              color: "#ffffff",
              fontSize: "15px",
              fontWeight: "bold",
              cursor: currentSlide >= totalPages ? "not-allowed" : "pointer",
              opacity: currentSlide >= totalPages ? 0.4 : 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px"
            }}
          >
            <span style={{ fontSize: "20px" }}>NEXT ▶</span>
            <span style={{ fontSize: "10px", fontWeight: "normal", color: "rgba(255, 255, 255, 0.8)" }}>
              Slide {Math.min(totalPages, currentSlide + 1)}
            </span>
          </button>
        </div>

        {/* Quick Slide Selector Grid */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Text size="small" variant="bold" tone="secondary">
              DIRECT SLIDE JUMP
            </Text>
            <Text size="xsmall" tone="secondary">
              {totalPages} slides
            </Text>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              maxHeight: "100px",
              overflowY: "auto",
              padding: "4px 0"
            }}
          >
            {slideNumbers.map((num) => {
              const isSelected = num === currentSlide;
              return (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleGotoPage(num)}
                  disabled={isExecuting}
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "6px",
                    border: isSelected ? "2px solid #60a5fa" : "1px solid rgba(255, 255, 255, 0.15)",
                    backgroundColor: isSelected ? "#1d4ed8" : "rgba(255, 255, 255, 0.05)",
                    color: "#ffffff",
                    fontWeight: isSelected ? "bold" : "normal",
                    fontSize: "13px",
                    cursor: "pointer"
                  }}
                >
                  {num}
                </button>
              );
            })}
          </div>
        </div>

        {/* Playback Controls & Render Mode Switcher */}
        <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.1)", paddingTop: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <Text size="small" variant="bold" tone="secondary">
              VIDEO PLAYBACK & RESTART
            </Text>
            <Text size="xsmall" tone="secondary">
              State: {playbackState}
            </Text>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "6px" }}>
            <Button
              variant="secondary"
              size="small"
              onClick={() => handlePlayback("play")}
              disabled={isExecuting}
            >
              ▶ Play
            </Button>
            <Button
              variant="secondary"
              size="small"
              onClick={() => handlePlayback("pause")}
              disabled={isExecuting}
            >
              ⏸ Pause
            </Button>
            <Button
              variant="secondary"
              size="small"
              onClick={() => handlePlayback("stop")}
              disabled={isExecuting}
            >
              ⏹ Stop
            </Button>
            <Button
              variant="secondary"
              size="small"
              onClick={() => handlePlayback("restart")}
              disabled={isExecuting}
            >
              ⏮ Restart
            </Button>
          </div>
        </div>

        {/* Live Switch Mode */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Text size="small" variant="bold" tone="secondary">
            SWITCH STAGE RENDER MODE
          </Text>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
            <Button
              variant="tertiary"
              size="small"
              onClick={() => handleModeChange("embed")}
              disabled={isExecuting}
            >
              Live Embed
            </Button>
            <Button
              variant="tertiary"
              size="small"
              onClick={() => handleModeChange("exported_slides")}
              disabled={isExecuting}
            >
              PNG Deck
            </Button>
            <Button
              variant="tertiary"
              size="small"
              onClick={() => handleModeChange("exported_mp4")}
              disabled={isExecuting}
            >
              MP4 Video
            </Button>
          </div>
        </div>
      </Rows>
    </div>
  );
};
