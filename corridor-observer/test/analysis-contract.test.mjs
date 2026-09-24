import assert from "node:assert/strict";
import test from "node:test";
import { assignDetectionLane, createCameraAnalysis, distanceToLaneCenterline } from "../analysis-contract.mjs";

const calibration = {
  laneCount: 2,
  savedAt: "2026-09-24T00:00:00.000Z",
  lanes: {
    0: [{ x: 0.2, y: 1 }, { x: 0.25, y: 0.7 }, { x: 0.3, y: 0.4 }, { x: 0.35, y: 0.1 }],
    1: [{ x: 0.7, y: 1 }, { x: 0.65, y: 0.7 }, { x: 0.6, y: 0.4 }, { x: 0.55, y: 0.1 }],
  },
};

test("assigns a vehicle by the nearest manually calibrated lane centreline", () => {
  const detection = { bbox: { x: 0.56, y: 0.2, width: 0.1, height: 0.45 } };
  assert.equal(assignDetectionLane(detection, calibration), 2);
});

test("does not assign a vehicle from the opposite carriageway to a mainline lane", () => {
  const opposingVehicle = { bbox: { x: 0.01, y: 0.42, width: 0.08, height: 0.08 } };
  assert.equal(assignDetectionLane(opposingVehicle, calibration), null);
});

test("measures the nearest segment of a lane centreline", () => {
  assert.equal(distanceToLaneCenterline({ x: 0.275, y: 0.55 }, calibration.lanes[0]) < 0.001, true);
});

test("returns only lane counts until camera speed calibration is validated", () => {
  const analysis = createCameraAnalysis({
    cameraId: "CCTV-N3-S-27.900-M",
    sourceCapturedAt: "2026-09-24T00:00:00.000Z",
    calibration,
    modelId: "opencv-yolov8n",
    inferenceMs: 54,
    detections: [
      { id: "a", className: "car", confidence: 0.92, bbox: { x: 0.1, y: 0.2, width: 0.2, height: 0.4 } },
      { id: "b", className: "truck", confidence: 0.88, bbox: { x: 0.62, y: 0.2, width: 0.18, height: 0.4 } },
      { id: "bad", className: "car", confidence: 1.1, bbox: { x: 0, y: 0, width: 0.2, height: 0.2 } },
    ],
  });
  assert.equal(analysis.status, "ready");
  assert.equal(analysis.detections.length, 2);
  assert.deepEqual(analysis.lanes.map((lane) => lane.vehicleCount), [1, 1]);
  assert.equal(analysis.unassignedDetectionCount, 0);
  assert.equal(Object.hasOwn(analysis.lanes[0], "speedKph"), false);
});
