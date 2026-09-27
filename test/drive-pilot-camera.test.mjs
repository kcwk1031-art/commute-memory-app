import assert from "node:assert/strict";
import test from "node:test";
import { shouldAdvancePilotCamera } from "../drive-pilot-camera.js";

test("advances when the vehicle reaches the active calibrated camera", () => {
  assert.equal(shouldAdvancePilotCamera({ currentDistanceMeters: 420, nextDistanceMeters: 5100 }), true);
});

test("advances after the active camera is behind the vehicle", () => {
  assert.equal(shouldAdvancePilotCamera({
    currentDistanceMeters: 1300,
    nextDistanceMeters: 4200,
    courseHeading: 180,
    bearingToCurrent: 0,
  }), true);
});

test("does not advance while still approaching the active camera", () => {
  assert.equal(shouldAdvancePilotCamera({
    currentDistanceMeters: 1300,
    nextDistanceMeters: 4200,
    courseHeading: 180,
    bearingToCurrent: 178,
  }), false);
});
