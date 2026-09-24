import assert from "node:assert/strict";
import test from "node:test";
import { summariseTestEvents } from "../drive-test-log.js";

test("summarises GPS quality, camera transitions, and official lane-reference availability", () => {
  const summary = summariseTestEvents([
    { position: { accuracyMeters: 8 }, selection: { cameraId: "a" }, laneReference: { referenceState: "reference", officialAgeSeconds: 30 } },
    { position: { accuracyMeters: 24 }, selection: { cameraId: "a" }, laneReference: { referenceState: "unavailable" } },
    { position: { accuracyMeters: 12 }, selection: { cameraId: "b" }, laneReference: { referenceState: "reference", officialAgeSeconds: 50 } },
  ]);
  assert.equal(summary.eventCount, 3);
  assert.equal(summary.gpsAccuracy.within20MetersPercent, 67);
  assert.equal(summary.gpsAccuracy.medianMeters, 12);
  assert.equal(summary.camera.distinctCount, 2);
  assert.equal(summary.camera.changeCount, 1);
  assert.equal(summary.officialLaneReference.availablePercent, 67);
  assert.equal(summary.officialLaneReference.medianAgeSeconds, 40);
});
