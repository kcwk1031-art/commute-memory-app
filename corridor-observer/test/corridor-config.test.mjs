import assert from "node:assert/strict";
import test from "node:test";
import { CORRIDOR_CAMERAS, isMainlineCorridorCamera, kilometerFromMile } from "../corridor-config.mjs";
import { corridorStatus, createCorridorState, recordAnalysis, recordFailure, recordLaneObservation, recordSnapshot } from "../corridor-state.mjs";

test("ships ten ordered National 3 southbound mainline cameras", () => {
  assert.equal(CORRIDOR_CAMERAS.length, 10);
  assert.ok(CORRIDOR_CAMERAS.every(isMainlineCorridorCamera));
  assert.ok(CORRIDOR_CAMERAS.every((camera, index) => index === 0 || kilometerFromMile(camera.mile) > kilometerFromMile(CORRIDOR_CAMERAS[index - 1].mile)));
});

test("retains the last successful snapshot after a later collection failure", () => {
  const state = createCorridorState(CORRIDOR_CAMERAS, 1000);
  recordSnapshot(state, CORRIDOR_CAMERAS[0].id, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 2000);
  recordFailure(state, CORRIDOR_CAMERAS[0].id, new Error("upstream_503"), 3000);
  const camera = corridorStatus(state, 9000, 3500).cameras[0];
  assert.equal(camera.state, "ready");
  assert.equal(camera.consecutiveFailures, 1);
});

test("reports the recent shared-stream frame rate for service QA", () => {
  const state = createCorridorState(CORRIDOR_CAMERAS, 0);
  recordSnapshot(state, CORRIDOR_CAMERAS[0].id, Buffer.from([0xff, 0xd8]), 1000);
  recordSnapshot(state, CORRIDOR_CAMERAS[0].id, Buffer.from([0xff, 0xd8]), 1200);
  recordSnapshot(state, CORRIDOR_CAMERAS[0].id, Buffer.from([0xff, 0xd8]), 1400);
  assert.equal(corridorStatus(state, 9000, 1400).cameras[0].sourceFps, 5);
});

test("retains the last successful official VD observation across a failed poll", () => {
  const state = createCorridorState(CORRIDOR_CAMERAS, 0);
  const id = CORRIDOR_CAMERAS[0].id;
  recordLaneObservation(state, id, {
    ok: true,
    updatedAt: "2026-09-24T00:00:00.000Z",
    mainLaneCount: 3,
    lanes: [{ laneId: "0", speedKph: 80 }],
    flowReference: { state: "similar" },
  }, 1000);
  recordLaneObservation(state, id, { ok: false, error: "upstream_503" }, 2000);
  const lane = corridorStatus(state, 9000, 2500).cameras[0].lane;
  assert.equal(lane.lanes[0].speedKph, 80);
  assert.equal(lane.ageMs, 1500);
  assert.equal(lane.consecutiveFailures, 1);
  assert.equal(lane.lastError, "upstream_503");
});

test("includes the official VD safety-gate state in the corridor summary", () => {
  const state = createCorridorState(CORRIDOR_CAMERAS, 0);
  recordAnalysis(state, CORRIDOR_CAMERAS[0].id, {
    status: "ready", analysedAt: "2026-09-24T00:00:00.000Z", sourceCapturedAt: null,
    detections: [], lanes: [], model: { id: "test", inferenceMs: 1 },
    officialVd: { state: "mapping_required" },
  }, 1000);
  assert.equal(corridorStatus(state, 9000, 1000).cameras[0].analysis.officialVd.state, "mapping_required");
});
