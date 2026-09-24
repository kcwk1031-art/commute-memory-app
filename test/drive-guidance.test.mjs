import assert from "node:assert/strict";
import test from "node:test";
import { buildLaneGuidance } from "../drive-guidance.js";

test("keeps delayed official lane records visible without presenting them as live guidance", () => {
  const now = Date.parse("2026-09-24T15:00:00.000Z");
  const guidance = buildLaneGuidance({
    vd: { dataCollectTime: "2026-09-24T14:50:00.000Z", distanceKm: 0.2 },
    screenLaneMapping: { state: "confirmed" },
    screenLanes: [
      { laneId: "0", displayNumber: 1, laneType: 1, speedKph: 64 },
      { laneId: "1", displayNumber: 2, laneType: 1, speedKph: 57 },
    ],
    screenFlowReference: { state: "reference", bestLaneId: "0", detail: "最後紀錄參考" },
  }, now);

  assert.equal(guidance.freshness.state, "delayed");
  assert.equal(guidance.freshness.canDisplay, true);
  assert.equal(guidance.freshness.canRecommend, false);
  assert.match(guidance.title, /最後紀錄最快/);
  assert.equal(guidance.lanes.find((lane) => lane.displayNumber === 1)?.isRecommended, true);
});
