import React, { useState } from "react";
import {
  Rows,
  Text,
  Title,
  Button,
  Select,
  Switch,
  Alert,
  LoadingIndicator,
  FormField,
  TextInput
} from "@canva/app-ui-kit";
import { pipgmApi } from "../services/pipgm-api";
import { canvaSdk } from "../services/canva-sdk";
import type {
  CanvaDesignInfo,
  CanvaRenderMode,
  PiPgmPipelineId,
  CreatePiPgmCanvaRequest,
  AspectRatioSelection,
  CustomResolution
} from "../types";

interface Props {
  designInfo: CanvaDesignInfo;
  onPushSuccess?: (targetPipelineId: PiPgmPipelineId | null, activeItemTitle: string) => void;
}

export const PushSection: React.FC<Props> = ({ designInfo, onPushSuccess }) => {
  // Church AV default: Sanctuary PGM1 and mobile stream are usually vertical (9:16 or 10:16)
  const detectInitialRatio = (): AspectRatioSelection => {
    if (designInfo.defaultWidth && designInfo.defaultHeight) {
      if (designInfo.defaultWidth === 1200 && designInfo.defaultHeight === 1920) {
        return "10:16";
      }
      if (designInfo.defaultWidth > designInfo.defaultHeight) {
        return "landscape";
      }
      return "vertical";
    }
    return "vertical";
  };

  const [aspectRatio, setAspectRatio] = useState<AspectRatioSelection>(detectInitialRatio);
  const [customWidth, setCustomWidth] = useState<number>(designInfo.defaultWidth || 1080);
  const [customHeight, setCustomHeight] = useState<number>(designInfo.defaultHeight || 1920);

  const [renderMode, setRenderMode] = useState<CanvaRenderMode>("embed");
  const [autoExport, setAutoExport] = useState<boolean>(false);
  const [isPushing, setIsPushing] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [localExportUrls, setLocalExportUrls] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{
    tone: "positive" | "critical" | "info";
    message: string;
  } | null>(null);

  const getFormatShortLabel = (): string => {
    switch (aspectRatio) {
      case "vertical":
        return "Vertical 9:16";
      case "10:16":
        return "10:16 Epson";
      case "landscape":
        return "Landscape 16:9";
      case "custom":
        return `${customWidth}×${customHeight}`;
    }
  };

  const getResolvedResolution = (): CustomResolution => {
    switch (aspectRatio) {
      case "10:16":
        return { width: 1200, height: 1920 };
      case "landscape":
        return { width: 1920, height: 1080 };
      case "custom":
        return {
          width: Math.max(100, Math.min(7680, customWidth || 1080)),
          height: Math.max(100, Math.min(7680, customHeight || 1920))
        };
      case "vertical":
      default:
        return { width: 1080, height: 1920 };
    }
  };

  const handleLocalExport = async (format: "png" | "mp4") => {
    setIsExporting(true);
    setFeedback({ tone: "info", message: `Opening Canva export dialog for ${format.toUpperCase()}...` });
    try {
      const urls = await canvaSdk.exportDesignLocally(format);
      if (urls && urls.length > 0) {
        setLocalExportUrls(urls);
        setFeedback({
          tone: "positive",
          message: `Exported ${urls.length} ${format.toUpperCase()} asset(s) ready for push.`
        });
        if (format === "mp4") {
          setRenderMode("exported_mp4");
        } else {
          setRenderMode("exported_slides");
        }
      } else {
        setFeedback({ tone: "info", message: "Canva export finished (no direct URLs returned or cancelled)." });
      }
    } catch (err) {
      setFeedback({ tone: "critical", message: `Export error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setIsExporting(false);
    }
  };

  const handlePush = async (targetPipelineId: PiPgmPipelineId | null) => {
    setIsPushing(true);
    setFeedback(null);

    const resolution = getResolvedResolution();
    const orientation: "landscape" | "portrait" =
      aspectRatio === "landscape"
        ? "landscape"
        : aspectRatio === "custom"
        ? resolution.height >= resolution.width
          ? "portrait"
          : "landscape"
        : "portrait";

    const payload: CreatePiPgmCanvaRequest = {
      designId: designInfo.designId,
      title: designInfo.title,
      embedUrl: designInfo.embedUrl,
      viewUrl: designInfo.viewUrl,
      pageCount: designInfo.pageCount,
      mode: renderMode,
      autoExport: autoExport,
      exportFormat: renderMode === "exported_mp4" ? "mp4" : "png",
      aspectRatio,
      orientation,
      customResolution: resolution,
      ...(localExportUrls.length > 0 ? { exportUrls: localExportUrls } : {}),
      ...(targetPipelineId
        ? {
            targetPipelineId,
            cueImmediately: true
          }
        : {})
    };

    try {
      const res = await pipgmApi.pushDesign(payload);
      const targetLabel = targetPipelineId
        ? targetPipelineId === "PiPGM1"
          ? `Program 1 (Sanctuary - ${getFormatShortLabel()})`
          : targetPipelineId === "PiPGM2"
          ? `Program 2 (Mobile - ${getFormatShortLabel()})`
          : `Program 3 (Aux - ${getFormatShortLabel()})`
        : "Media Library (Store only)";

      setFeedback({
        tone: "positive",
        message: `Successfully pushed to ${targetLabel}! Item ID: ${res.item.id}`
      });

      onPushSuccess?.(targetPipelineId, res.item.title);
    } catch (err) {
      setFeedback({
        tone: "critical",
        message: err instanceof Error ? err.message : "Failed to push design to PiMatrix"
      });
    } finally {
      setIsPushing(false);
    }
  };

  const ratioOptions = [
    { label: "📱 Vertical 9:16 (1080×1920 — Standard Vertical / Mobile)", value: "vertical" },
    { label: "⛪ 10:16 Sanctuary (1200×1920 — Epson Church Projector)", value: "10:16" },
    { label: "📺 Landscape 16:9 (1920×1080 — Wide Sanctuary / Streams)", value: "landscape" },
    { label: "⚙️ Custom Aspect Ratio / Resolution (Custom W × H)", value: "custom" }
  ];

  const modeOptions = [
    { label: "Canva Live Embed (Interactive / Smooth)", value: "embed" },
    { label: "Exported PNG Slide Deck (Rock Solid)", value: "exported_slides" },
    { label: "Exported MP4 Video (Auto Playback)", value: "exported_mp4" }
  ];

  const resolutionSummary = getResolvedResolution();

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
          <Title size="small">Push to Sanctuary & Streams</Title>
          {isPushing && <LoadingIndicator />}
        </div>

        {feedback && (
          <Alert tone={feedback.tone}>
            <Text size="small">{feedback.message}</Text>
          </Alert>
        )}

        {/* Aspect Ratio & Orientation Selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Text size="small" variant="bold">
            Screen Format / Aspect Ratio
          </Text>
          <Select
            value={aspectRatio}
            onChange={(val) => setAspectRatio(val as AspectRatioSelection)}
            options={ratioOptions}
          />
        </div>

        {/* Custom Width & Height Inputs */}
        {aspectRatio === "custom" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
              background: "rgba(0, 0, 0, 0.2)",
              padding: "10px",
              borderRadius: "6px",
              border: "1px dashed rgba(255, 255, 255, 0.15)"
            }}
          >
            <FormField
              label="Width (px)"
              control={(props) => (
                <TextInput
                  {...props}
                  value={String(customWidth)}
                  onChange={(val) => {
                    const num = parseInt(val, 10);
                    if (!isNaN(num)) setCustomWidth(num);
                  }}
                  placeholder="1080"
                />
              )}
            />
            <FormField
              label="Height (px)"
              control={(props) => (
                <TextInput
                  {...props}
                  value={String(customHeight)}
                  onChange={(val) => {
                    const num = parseInt(val, 10);
                    if (!isNaN(num)) setCustomHeight(num);
                  }}
                  placeholder="1920"
                />
              )}
            />
          </div>
        )}

        {/* Selected Format Summary Badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(255, 255, 255, 0.03)",
            padding: "6px 10px",
            borderRadius: "4px",
            fontSize: "12px",
            color: "#94a3b8"
          }}
        >
          <span>Target Resolution:</span>
          <span style={{ fontWeight: 600, color: "#38bdf8" }}>
            {resolutionSummary.width} × {resolutionSummary.height} (
            {resolutionSummary.height >= resolutionSummary.width ? "Vertical" : "Landscape"})
          </span>
        </div>

        {/* Render Mode */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Text size="small" variant="bold">
            Render Mode
          </Text>
          <Select
            value={renderMode}
            onChange={(val) => setRenderMode(val as CanvaRenderMode)}
            options={modeOptions}
          />
        </div>

        {/* Auto-Export Switch */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Text size="small" variant="bold">Auto-Export via Connect API</Text>
            <Text size="xsmall">Automatically fetch slides in background</Text>
          </div>
          <Switch
            value={autoExport}
            onChange={(checked) => setAutoExport(checked)}
          />
        </div>

        {/* In-Editor Local Export Buttons */}
        <div style={{ display: "flex", gap: "6px" }}>
          <Button
            variant="tertiary"
            size="small"
            onClick={() => handleLocalExport("png")}
            disabled={isExporting || isPushing}
          >
            Export PNG Deck
          </Button>
          <Button
            variant="tertiary"
            size="small"
            onClick={() => handleLocalExport("mp4")}
            disabled={isExporting || isPushing}
          >
            Export MP4
          </Button>
        </div>

        <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.1)", paddingTop: "10px" }}>
          <Text size="small" variant="bold" tone="secondary">
            DESTINATION CHANNELS
          </Text>
        </div>

        {/* Destination Push Buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {/* Program 1 (Sanctuary) — respects selected aspect ratio (usually vertical) */}
          <Button
            variant="primary"
            size="medium"
            onClick={() => handlePush("PiPGM1")}
            disabled={isPushing}
          >
            {`📺 Push to Program 1 (Sanctuary - ${getFormatShortLabel()})`}
          </Button>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <Button
              variant="secondary"
              size="medium"
              onClick={() => handlePush("PiPGM2")}
              disabled={isPushing}
            >
              📱 Program 2 (Mobile)
            </Button>
            <Button
              variant="secondary"
              size="medium"
              onClick={() => handlePush("PiPGM3")}
              disabled={isPushing}
            >
              🔀 Program 3 (Aux / Over)
            </Button>
          </div>

          <Button
            variant="tertiary"
            size="medium"
            onClick={() => handlePush(null)}
            disabled={isPushing}
          >
            💾 Save to Library Only (Not on Air)
          </Button>
        </div>
      </Rows>
    </div>
  );
};
