import React, { useState, useEffect } from "react";
import {
  Rows,
  Title,
  Text,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Badge,
  Button
} from "@canva/app-ui-kit";
import { ServerConfigBar } from "./components/ServerConfigBar";
import { ActiveDesignCard } from "./components/ActiveDesignCard";
import { PushSection } from "./components/PushSection";
import { RemoteControlConsole } from "./components/RemoteControlConsole";
import { LivePipelineStatus } from "./components/LivePipelineStatus";
import { canvaSdk } from "./services/canva-sdk";
import { pipgmApi } from "./services/pipgm-api";
import { BUILD_CONFIG } from "./config";
import type { CanvaDesignInfo, PiPgmPipelineSnapshot, ConnectionStatus } from "./types";

export const App: React.FC = () => {
  const [designInfo, setDesignInfo] = useState<CanvaDesignInfo>({
    designId: "DAF_KESKUSKIRKKO_2026",
    title: "Sunday Worship Presentation",
    pageCount: 3,
    embedUrl: "https://www.canva.com/design/DAF_KESKUSKIRKKO_2026/view?embed",
    viewUrl: "https://www.canva.com/design/DAF_KESKUSKIRKKO_2026/view",
    defaultWidth: 1920,
    defaultHeight: 1080,
    isSimulated: true
  });

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [pipelines, setPipelines] = useState<PiPgmPipelineSnapshot[]>([]);
  const [activeTab, setActiveTab] = useState<string>("push");

  // Load Canva design info on mount
  useEffect(() => {
    canvaSdk.getActiveDesign().then((info) => {
      setDesignInfo(info);
    });
  }, []);

  // Subscribe to real-time events from PiMatrix AV system
  useEffect(() => {
    const unsubscribe = pipgmApi.subscribeEvents((updatedPipelines) => {
      setPipelines((prev) => {
        const map = new Map(prev.map((p) => [p.id, p]));
        for (const up of updatedPipelines) {
          map.set(up.id, up);
        }
        return Array.from(map.values());
      });
    });

    return () => unsubscribe();
  }, []);

  const handleRefreshDesign = () => {
    canvaSdk.getActiveDesign().then((info) => {
      setDesignInfo(info);
    });
  };

  const handleStatusChange = (status: ConnectionStatus, initialPipelines?: PiPgmPipelineSnapshot[]) => {
    setConnectionStatus(status);
    if (initialPipelines) {
      setPipelines(initialPipelines);
    }
  };

  const handlePushSuccess = () => {
    // Automatically switch to remote control tab on push
    setActiveTab("control");
  };

  const hostUrl = pipgmApi.getActiveUrl();

  const openUrl = (url: string) => {
    window.open(url, "_blank");
  };

  return (
    <div
      style={{
        maxWidth: "420px",
        margin: "0 auto",
        padding: "16px 12px",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box"
      }}
    >
      <Rows spacing="1.5u">
        {/* App Title Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <Title size="medium">{BUILD_CONFIG.pluginName}</Title>
            <Text size="xsmall" tone="secondary">
              {BUILD_CONFIG.orgName} • Team App Plugin
            </Text>
          </div>
          <Badge tone="contrast" text="v1.1 Plugin" />
        </div>

        {/* Server Configuration Bar with LAN / Internet Switching */}
        <ServerConfigBar onStatusChange={handleStatusChange} />

        {/* Active Presentation Card */}
        <ActiveDesignCard
          designInfo={designInfo}
          onUpdateDesignInfo={setDesignInfo}
          onRefreshFromSdk={handleRefreshDesign}
        />

        {/* Tabs for Push and Live Remote Control */}
        <Tabs activeId={activeTab} onSelect={(id) => setActiveTab(id)}>
          <TabList align="stretch">
            <Tab id="push">Push to Air</Tab>
            <Tab id="control">Live Control</Tab>
            <Tab id="stages">Stage Feeds</Tab>
          </TabList>

          <TabPanels>
            <TabPanel id="push">
              <div style={{ paddingTop: "12px" }}>
                <PushSection
                  designInfo={designInfo}
                  onPushSuccess={handlePushSuccess}
                />
              </div>
            </TabPanel>

            <TabPanel id="control">
              <div style={{ paddingTop: "12px" }}>
                <RemoteControlConsole
                  designInfo={designInfo}
                  pipelines={pipelines}
                  onPipelinesUpdate={setPipelines}
                />
              </div>
            </TabPanel>

            <TabPanel id="stages">
              <div
                style={{
                  paddingTop: "12px",
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "8px",
                  padding: "12px",
                  marginTop: "12px"
                }}
              >
                <Rows spacing="1.5u">
                  <Title size="small">Stage Display Outputs</Title>
                  <Text size="small">
                    Canva presentations render directly inside these zero-latency PiPGM stage endpoints:
                  </Text>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <Button
                      variant="secondary"
                      size="medium"
                      onClick={() => openUrl(`${hostUrl}/pipgm/PiPGM1/stage`)}
                    >
                      🖥 Sanctuary Stage (PiPGM 1 - 16:9)
                    </Button>
                    <Button
                      variant="secondary"
                      size="medium"
                      onClick={() => openUrl(`${hostUrl}/pipgm/PiPGM2/stage`)}
                    >
                      📱 Mobile Stage (PiPGM 2 - 9:16)
                    </Button>
                    <Button
                      variant="secondary"
                      size="medium"
                      onClick={() => openUrl(`${hostUrl}/pipgm/PiPGM3/stage`)}
                    >
                      🔀 Auxiliary Stage (PiPGM 3)
                    </Button>
                    <Button
                      variant="tertiary"
                      size="medium"
                      onClick={() => openUrl(`${hostUrl}/multiview`)}
                    >
                      🎛 Full Multiview & Switcher
                    </Button>
                  </div>
                </Rows>
              </div>
            </TabPanel>
          </TabPanels>
        </Tabs>

        {/* Live Multi-Pipeline Status Monitor */}
        <LivePipelineStatus pipelines={pipelines} />
      </Rows>
    </div>
  );
};
