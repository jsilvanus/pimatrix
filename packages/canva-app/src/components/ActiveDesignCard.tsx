import React, { useState } from "react";
import { Rows, Text, Title, Badge, Button, FormField, TextInput } from "@canva/app-ui-kit";
import type { CanvaDesignInfo } from "../types";

interface Props {
  designInfo: CanvaDesignInfo;
  onUpdateDesignInfo: (updated: CanvaDesignInfo) => void;
  onRefreshFromSdk: () => void;
}

export const ActiveDesignCard: React.FC<Props> = ({
  designInfo,
  onUpdateDesignInfo,
  onRefreshFromSdk
}) => {
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [customTitle, setCustomTitle] = useState<string>(designInfo.title);
  const [customId, setCustomId] = useState<string>(designInfo.designId);
  const [customPages, setCustomPages] = useState<string>(String(designInfo.pageCount));

  const handleSaveEdit = () => {
    const pages = Math.max(1, parseInt(customPages, 10) || 1);
    const id = customId.trim() || designInfo.designId;
    const title = customTitle.trim() || designInfo.title;
    onUpdateDesignInfo({
      ...designInfo,
      designId: id,
      title,
      pageCount: pages,
      embedUrl: `https://www.canva.com/design/${encodeURIComponent(id)}/view?embed`,
      viewUrl: `https://www.canva.com/design/${encodeURIComponent(id)}/view`
    });
    setIsEditing(false);
  };

  return (
    <div
      style={{
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "8px",
        padding: "12px",
        marginBottom: "12px"
      }}
    >
      <Rows spacing="1u">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <Title size="small">Active Presentation</Title>
              {designInfo.isSimulated && <Badge tone="contrast" text="Sandbox / Simulation" />}
            </div>
            <Text size="medium" variant="bold">
              {designInfo.title}
            </Text>
          </div>
          <Button
            variant="tertiary"
            size="small"
            onClick={() => setIsEditing(!isEditing)}
          >
            {isEditing ? "Cancel" : "Edit Details"}
          </Button>
        </div>

        {!isEditing ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "4px 12px",
              fontSize: "12px",
              color: "rgba(255, 255, 255, 0.7)"
            }}
          >
            <span style={{ fontWeight: 600 }}>Design ID:</span>
            <span style={{ fontFamily: "monospace", color: "#60a5fa" }}>{designInfo.designId}</span>

            <span style={{ fontWeight: 600 }}>Slides / Pages:</span>
            <span>{designInfo.pageCount} pages</span>

            <span style={{ fontWeight: 600 }}>Embed URL:</span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "220px",
                fontFamily: "monospace",
                fontSize: "11px"
              }}
            >
              {designInfo.embedUrl}
            </span>
          </div>
        ) : (
          <div style={{ marginTop: "8px" }}>
            <Rows spacing="1u">
              <FormField
                label="Presentation Title"
                control={(controlProps) => (
                  <TextInput
                    {...controlProps}
                    value={customTitle}
                    onChange={(val) => setCustomTitle(val)}
                    placeholder="Sunday Service Slides"
                  />
                )}
              />
              <FormField
                label="Canva Design ID"
                control={(controlProps) => (
                  <TextInput
                    {...controlProps}
                    value={customId}
                    onChange={(val) => setCustomId(val)}
                    placeholder="DAF_..."
                  />
                )}
              />
              <FormField
                label="Page Count"
                control={(controlProps) => (
                  <TextInput
                    {...controlProps}
                    value={customPages}
                    onChange={(val) => setCustomPages(val)}
                    placeholder="e.g. 5"
                  />
                )}
              />
              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                <Button variant="primary" size="medium" onClick={handleSaveEdit}>
                  Apply
                </Button>
                <Button variant="secondary" size="small" onClick={onRefreshFromSdk}>
                  Reload from Canva
                </Button>
              </div>
            </Rows>
          </div>
        )}
      </Rows>
    </div>
  );
};
