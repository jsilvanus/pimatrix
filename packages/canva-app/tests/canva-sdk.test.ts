import test from "node:test";
import assert from "node:assert/strict";
import { CanvaSdkService } from "../src/services/canva-sdk";

test("CanvaSdkService provides fallback design metadata in simulation environment", async () => {
  const service = new CanvaSdkService();
  const design = await service.getActiveDesign();

  assert.ok(design.designId);
  assert.ok(design.title);
  assert.ok(design.pageCount >= 1);
  assert.ok(design.embedUrl.startsWith("https://www.canva.com/design/"));
  assert.ok(design.embedUrl.endsWith("/view?embed"));
});

test("CanvaSdkService relayPostMessage emits correct canva:control payload structure", () => {
  const service = new CanvaSdkService();
  const postedMessages: any[] = [];

  const mockParent = {
    postMessage: (msg: any, targetOrigin: string) => {
      postedMessages.push({ msg, targetOrigin });
    }
  };

  // Mock global window parent
  const originalParent = globalThis.window?.parent;
  if (!globalThis.window) {
    (globalThis as any).window = {};
  }
  (globalThis.window as any).parent = mockParent;

  try {
    service.relayPostMessage({
      action: "gotoPage",
      pageNumber: 3,
      fadeToBlack: false
    });

    assert.equal(postedMessages.length, 1);
    assert.equal(postedMessages[0].targetOrigin, "*");
    assert.equal(postedMessages[0].msg.type, "canva:control");
    assert.equal(postedMessages[0].msg.action, "gotoPage");
    assert.equal(postedMessages[0].msg.pageNumber, 3);
    assert.equal(postedMessages[0].msg.fadeToBlack, false);
  } finally {
    if (originalParent) {
      (globalThis.window as any).parent = originalParent;
    }
  }
});
