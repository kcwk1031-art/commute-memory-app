import assert from "node:assert/strict";
import test from "node:test";
import { appendVisualFlowSample, summariseVisualFlow } from "../visual-flow.mjs";

function analysis(capturedAt, laneCounts) {
  return { status: "ready", sourceCapturedAt: new Date(capturedAt).toISOString(), lanes: laneCounts.map((vehicleCount, index) => ({ laneIndex: index + 1, vehicleCount })) };
}

test("reports increasing vehicle observations only after enough distinct samples", () => {
  let history = [];
  history = appendVisualFlowSample(history, analysis(0, [1, 2]), 0);
  history = appendVisualFlowSample(history, analysis(12000, [2, 2]), 12000);
  history = appendVisualFlowSample(history, analysis(24000, [4, 2]), 24000);
  const summary = summariseVisualFlow(history, 2);
  assert.equal(summary.state, "ready");
  assert.equal(summary.lanes[0].trend, "increasing");
  assert.equal(summary.lanes[1].trend, "stable");
  assert.equal(summary.lanes[0].latestVehicleCount, 4);
});

test("does not count a repeated source frame as a new observation", () => {
  const first = appendVisualFlowSample([], analysis(10000, [2]), 10000);
  const repeated = appendVisualFlowSample(first, analysis(10000, [3]), 11000);
  assert.equal(repeated.length, 1);
  assert.equal(summariseVisualFlow(repeated, 1).state, "collecting");
});
