import assert from "node:assert/strict";
import test from "node:test";
import { CORRIDOR_CAMERAS } from "../corridor-config.mjs";
import { validateCalibrationPayload } from "../calibration-store.mjs";

function completePayload() {
  return {
    corridorId: "n3-south-xindian-yangmei",
    exportedAt: "2026-09-24T12:00:00.000Z",
    calibrations: Object.fromEntries(CORRIDOR_CAMERAS.map((camera) => [camera.id, {
      laneCount: 2,
      savedAt: "2026-09-24T12:00:00.000Z",
      lanes: {
        0: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.9 }, { x: 0.1, y: 0.9 }],
        1: [{ x: 0.3, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.9 }, { x: 0.3, y: 0.9 }],
      },
    }])),
  };
}

test("accepts a complete calibration only when every corridor camera is saved", () => {
  const summary = validateCalibrationPayload(completePayload(), CORRIDOR_CAMERAS);
  assert.equal(summary.calibrationCount, 10);
});

test("rejects a partial or unsaved calibration export", () => {
  const payload = completePayload();
  delete payload.calibrations[CORRIDOR_CAMERAS[9].id];
  assert.throws(() => validateCalibrationPayload(payload, CORRIDOR_CAMERAS), /calibration_missing/);
});
