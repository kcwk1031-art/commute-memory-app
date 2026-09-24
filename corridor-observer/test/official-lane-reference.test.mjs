import assert from "node:assert/strict";
import test from "node:test";
import { buildOfficialLaneReference } from "../official-lane-reference.mjs";

const observation = {
  ok: true,
  updatedAt: "2026-09-24T00:00:00.000Z",
  mainLaneCount: 3,
  vd: { id: "VD-N3-S-35K" },
  lanes: [
    { laneId: "0", speedKph: 92, occupancy: 10, volume: 12 },
    { laneId: "1", speedKph: 81, occupancy: 20, volume: 22 },
    { laneId: "2", speedKph: 78, occupancy: 24, volume: 27 },
  ],
  flowReference: { state: "reference", bestLaneId: "0", detail: "官方 VD 顯示 92 km/h。" },
};

test("does not expose per-centreline speeds until every official lane is mapped", () => {
  assert.equal(buildOfficialLaneReference({ laneCount: 3, savedAt: "yes" }, observation).state, "mapping_required");
});

test("maps official speeds to the manually calibrated centreline order", () => {
  const reference = buildOfficialLaneReference({ laneCount: 3, savedAt: "yes", vdLaneMap: { 1: "2", 2: "0", 3: "1" }, vdMappingConfirmed: true }, observation);
  assert.equal(reference.state, "ready");
  assert.deepEqual(reference.lanes.map((lane) => lane.speedKph), [78, 92, 81]);
  assert.equal(reference.flowReference.bestLaneIndex, 2);
});

test("recalculates the recommendation after screen lane mapping", () => {
  const reference = buildOfficialLaneReference({ laneCount: 3, savedAt: "yes", vdLaneMap: { 1: "0", 2: "1", 3: "2" }, vdMappingConfirmed: true }, {
    ...observation,
    lanes: [
      { laneId: "0", speedKph: 42, occupancy: 47, volume: 25 },
      { laneId: "1", speedKph: 36, occupancy: 36, volume: 18 },
      { laneId: "2", speedKph: 27, occupancy: 59, volume: 20 },
    ],
    // This mimics an upstream index that does not match screen lane order.
    flowReference: { state: "reference", bestLaneId: "1", detail: "ignored after mapping" },
  });
  assert.equal(reference.flowReference.bestLaneIndex, 1);
  assert.match(reference.flowReference.detail, /第 1 車道 42 km\/h/);
});

test("keeps the fastest lane as a low-confidence reference when official speeds are similar", () => {
  const reference = buildOfficialLaneReference({ laneCount: 3, savedAt: "yes", vdLaneMap: { 1: "0", 2: "1", 3: "2" }, vdMappingConfirmed: true }, {
    ...observation,
    lanes: [
      { laneId: "0", speedKph: 39, occupancy: 47, volume: 25 },
      { laneId: "1", speedKph: 36, occupancy: 36, volume: 18 },
      { laneId: "2", speedKph: 27, occupancy: 59, volume: 20 },
    ],
  });
  assert.equal(reference.flowReference.state, "reference");
  assert.equal(reference.flowReference.bestLaneIndex, 1);
  assert.equal(reference.flowReference.confidence, "minor");
});

test("does not select an arbitrary lane when the fastest official speeds are tied", () => {
  const reference = buildOfficialLaneReference({ laneCount: 3, savedAt: "yes", vdLaneMap: { 1: "0", 2: "1", 3: "2" }, vdMappingConfirmed: true }, {
    ...observation,
    lanes: [
      { laneId: "0", speedKph: 57, occupancy: 20, volume: 12 },
      { laneId: "1", speedKph: 50, occupancy: 20, volume: 12 },
      { laneId: "2", speedKph: 57, occupancy: 20, volume: 12 },
    ],
  });
  assert.equal(reference.flowReference.state, "tie");
  assert.equal(reference.flowReference.bestLaneIndex, null);
});

test("retains mapped lane speeds and the last reference when the official source timestamp is stale", () => {
  const reference = buildOfficialLaneReference({ laneCount: 3, savedAt: "yes", vdLaneMap: { 1: "0", 2: "1", 3: "2" }, vdMappingConfirmed: true }, {
    ...observation,
    vd: { ...observation.vd, dataCollectTime: new Date(Date.now() - 3 * 60 * 1000).toISOString() },
  });
  assert.equal(reference.state, "stale");
  assert.deepEqual(reference.lanes.map((lane) => lane.speedKph), [92, 81, 78]);
  assert.equal(reference.flowReference.state, "last_reference");
  assert.equal(reference.flowReference.bestLaneIndex, 1);
});

test("keeps a provisional mapping out of the official speed output", () => {
  const reference = buildOfficialLaneReference({ laneCount: 3, savedAt: "yes", vdLaneMap: { 1: "0", 2: "1", 3: "2" } }, observation);
  assert.equal(reference.state, "mapping_review_required");
});

test("allows a manually excluded VD shoulder when the remaining lanes are fully mapped", () => {
  const withShoulder = {
    ...observation,
    mainLaneCount: 4,
    lanes: [...observation.lanes, { laneId: "3", speedKph: 0, occupancy: 0, volume: 0 }],
  };
  const reference = buildOfficialLaneReference({
    laneCount: 3,
    savedAt: "yes",
    vdLaneMap: { 1: "0", 2: "1", 3: "2" },
    excludedVdLaneIds: ["3"],
    vdMappingConfirmed: true,
  }, withShoulder);
  assert.equal(reference.state, "ready");
  assert.deepEqual(reference.lanes.map((lane) => lane.vdLaneId), ["0", "1", "2"]);
});

test("keeps a confirmed mapping when Relay has already excluded the shoulder", () => {
  const reference = buildOfficialLaneReference({
    laneCount: 3,
    savedAt: "yes",
    vdLaneMap: { 1: "0", 2: "1", 3: "2" },
    excludedVdLaneIds: ["3"],
    vdMappingConfirmed: true,
  }, observation);
  assert.equal(reference.state, "ready");
  assert.deepEqual(reference.lanes.map((lane) => lane.vdLaneId), ["0", "1", "2"]);
});

test("rejects a lane-count mismatch instead of guessing a speed mapping", () => {
  assert.equal(buildOfficialLaneReference({ laneCount: 4, vdLaneMap: {} }, observation).state, "lane_count_mismatch");
});
