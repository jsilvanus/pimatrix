import React, { useState, useEffect } from "react";
import { FormField, TextInput, Button, Badge, Rows, Text, Title, Alert } from "@canva/app-ui-kit";
import { pipgmApi, type ConnectionCheckResult } from "../services/pipgm-api";
import { BUILD_CONFIG, type NetworkProfile } from "../config";
import type { ConnectionStatus, PiPgmPipelineSnapshot } from "../types";

interface Props {
  onStatusChange?: (status: ConnectionStatus, pipelines?: PiPgmPipelineSnapshot[]) => void;
}

export const ServerConfigBar: React.FC<Props> = ({ onStatusChange }) => {
  const [profile, setProfile] = useState<NetworkProfile>(pipgmApi.getProfile());
  const [lanUrl, setLanUrl] = useState<string>(pipgmApi.getLanUrl());
  const [wanUrl, setWanUrl] = useState<string>(pipgmApi.getWanUrl());
  const [secretToken, setSecretToken] = useState<string>(pipgmApi.getSecretToken());

  const [checkResult, setCheckResult] = useState<ConnectionCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const check = async () => {
    setIsChecking(true);
    const result = await pipgmApi.checkConnection();
    setCheckResult(result);
    if (result.status === "connected" && result.pipelines) {
      onStatusChange?.("connected", result.pipelines);
    } else {
      onStatusChange?.(result.status);
    }
    setIsChecking(false);
  };

  useEffect(() => {
    check();
    const interval = setInterval(() => check(), 10000);
    return () => clearInterval(interval);
  }, []);

  const handleProfileSwitch = (newProfile: NetworkProfile) => {
    setProfile(newProfile);
    pipgmApi.setProfile(newProfile);
    check();
  };

  const handleSaveSettings = () => {
    pipgmApi.setLanUrl(lanUrl);
    pipgmApi.setWanUrl(wanUrl);
    pipgmApi.setSecretToken(secretToken);
    check();
  };

  const status = checkResult?.status || "connecting";
  const pipelineCount = checkResult?.pipelines?.length || 0;

  const getStatusBadge = () => {
    if (status === "connected") {
      const modeLabel = profile === "lan" ? "LAN" : "Internet";
      return <Badge tone="positive" text={`Online (${modeLabel} • ${pipelineCount} PGM)`} />;
    }
    if (status === "connecting" || isChecking) {
      return <Badge tone="warn" text="Connecting..." />;
    }
    return <Badge tone="critical" text={`Offline (${profile.toUpperCase()})`} />;
  };

  return (
    <div
      style={{
        background: "rgba(255, 255, 255, 0.04)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: "8px",
        padding: "10px 12px",
        marginBottom: "12px"
      }}
    >
      <Rows spacing="1u">
        {/* Organization & Plugin Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <Title size="small">{BUILD_CONFIG.pluginName}</Title>
            <Text size="xsmall" tone="secondary">
              {BUILD_CONFIG.orgName}
            </Text>
          </div>
          {getStatusBadge()}
        </div>

        {/* Network Mode Switcher (LAN vs Internet WAN) */}
        <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
          <button
            type="button"
            onClick={() => handleProfileSwitch("lan")}
            style={{
              flex: 1,
              padding: "7px 10px",
              borderRadius: "6px",
              border: profile === "lan" ? "2px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.15)",
              backgroundColor: profile === "lan" ? "#1e3a8a" : "rgba(255, 255, 255, 0.05)",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: profile === "lan" ? "bold" : "normal",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px"
            }}
          >
            <span>🏠</span>
            <span>Sanctuary LAN</span>
          </button>

          <button
            type="button"
            onClick={() => handleProfileSwitch("wan")}
            style={{
              flex: 1,
              padding: "7px 10px",
              borderRadius: "6px",
              border: profile === "wan" ? "2px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.15)",
              backgroundColor: profile === "wan" ? "#1e3a8a" : "rgba(255, 255, 255, 0.05)",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: profile === "wan" ? "bold" : "normal",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px"
            }}
          >
            <span>🌐</span>
            <span>Internet (WAN)</span>
          </button>
        </div>

        {/* Active URL & Quick Action */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "4px 2px",
            fontSize: "11px",
            color: "rgba(255, 255, 255, 0.7)"
          }}
        >
          <span style={{ fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "240px" }}>
            {pipgmApi.getActiveUrl() || "No URL configured"}
          </span>
          <div style={{ display: "flex", gap: "6px" }}>
            <Button
              variant="tertiary"
              size="small"
              onClick={() => check()}
              disabled={isChecking}
            >
              {isChecking ? "Testing" : "Test Ping"}
            </Button>
            <Button
              variant="tertiary"
              size="small"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? "Hide" : "Settings"}
            </Button>
          </div>
        </div>

        {/* Suggestion if other profile is online */}
        {checkResult?.alternativeProfile?.available && (
          <Alert tone="info">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Text size="small">
                {checkResult.alternativeProfile.profile === "lan" ? "🏠 Local LAN" : "🌐 Internet"} connection is active!
              </Text>
              <Button
                variant="primary"
                size="medium"
                onClick={() => handleProfileSwitch(checkResult.alternativeProfile!.profile)}
              >
                Switch
              </Button>
            </div>
          </Alert>
        )}

        {/* Expandable Advanced Network & Security Config */}
        {isExpanded && (
          <div
            style={{
              borderTop: "1px solid rgba(255, 255, 255, 0.1)",
              paddingTop: "10px",
              marginTop: "4px"
            }}
          >
            <Rows spacing="1u">
              <Text size="small" variant="bold" tone="secondary">
                ADDRESSES & ROUTER PORT SECURITY
              </Text>

              <FormField
                label="Sanctuary LAN Address"
                control={(controlProps) => (
                  <TextInput
                    {...controlProps}
                    value={lanUrl}
                    onChange={(val) => setLanUrl(val)}
                    placeholder="http://192.168.1.100:3000"
                  />
                )}
              />

              <FormField
                label="Internet Router WAN Address"
                control={(controlProps) => (
                  <TextInput
                    {...controlProps}
                    value={wanUrl}
                    onChange={(val) => setWanUrl(val)}
                    placeholder="http://yourchurch.dyndns.org:3000"
                  />
                )}
              />

              <FormField
                label="Canva Secret Token (Team-Only Security)"
                control={(controlProps) => (
                  <TextInput
                    {...controlProps}
                    value={secretToken}
                    onChange={(val) => setSecretToken(val)}
                    placeholder="e.g. keskuskirkko-canva-secret-2026"
                  />
                )}
              />

              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                <Button variant="primary" size="medium" onClick={handleSaveSettings}>
                  Save & Apply Settings
                </Button>
              </div>
            </Rows>
          </div>
        )}
      </Rows>
    </div>
  );
};
