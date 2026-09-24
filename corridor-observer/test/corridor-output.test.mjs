import assert from "node:assert/strict";
import test from "node:test";
import { buildCorridorOutput } from "../corridor-output.mjs";

test("only exposes lane speeds after a verified official VD mapping", () => {
  const status = {
    ok: true,
    updatedAt: "2026-09-24T00:00:00.000Z",
    cameras: [
      {
        id: "verified", sequence: 1, mile: "1K", label: "主線", state: "ready", ageMs: 80, sourceFps: 10,
        analysis: {
          state: "ready", lanes: [{ laneIndex: 1, vehicleCount: 2 }],
          officialVd: {
            state: "ready", lanes: [{ laneIndex: 1, speedKph: 76, occupancy: 12, volume: 8 }],
            flowReference: { state: "reference", bestLaneIndex: 1, detail: "較順" },
          },
        },
      },
      { id: "unmapped", sequence: 2, mile: "2K", label: "主線", state: "ready", ageMs: 90, sourceFps: 9, analysis: { state: "ready", lanes: [], officialVd: { state: "mapping_required", detail: "待確認" } } },
    ],
  };
  const output = buildCorridorOutput(status, { corridorId: "test", label: "測試", relayBase: "https://relay.example.com" });
  assert.equal(output.summary.verifiedLaneSpeedCameras, 1);
  assert.equal(output.summary.mappingRequiredCameras, 1);
  assert.equal(output.summary.verifiedMappingCameras, 1);
  assert.equal(output.summary.reportIssueCount, 1);
  assert.deepEqual(output.cameras[0].road.lanes, [{ laneIndex: 1, speedKph: 76, occupancy: 12, volume: 8 }]);
  assert.deepEqual(output.cameras[1].road.lanes, []);
  assert.equal(output.cameras[0].cctv.mjpegUrl, "https://relay.example.com/mjpeg/verified");
  assert.equal(output.reportIssues[0].type, "mapping_required");
});
