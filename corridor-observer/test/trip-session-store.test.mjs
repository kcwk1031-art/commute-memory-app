import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTripSessionStore } from "../trip-session-store.mjs";

const output = { cameras: [{
  id: "camera-1", sequence: 1, mile: "27K+900", label: "測試主線",
  cctv: { state: "ready", ageMs: 300, sourceFps: 4.8 },
  road: { state: "ready", sourceDataTime: "2026-09-24T08:00:00.000Z", sourceDataAgeMs: 30000, lanes: [{ laneIndex: 1, speedKph: 72 }], recommendation: { laneIndex: 1, detail: "較順" } },
}, {
  id: "camera-2", sequence: 2, mile: "32K+940", label: "延遲主線",
  cctv: { state: "ready", ageMs: 500, sourceFps: 4.1 },
  road: { state: "stale", sourceDataTime: "2026-09-24T07:55:00.000Z", sourceDataAgeMs: 300000, lastKnownLanes: [{ laneIndex: 1, speedKph: 67 }], recommendation: { laneIndex: 1, detail: "must not retain" } },
}] };

test("captures an audit record from server output and does not retain a stale recommendation", () => {
  const store = createTripSessionStore(() => "2026-09-24T08:01:00.000Z");
  const session = store.create();
  const captured = store.capture(session.id, output, "camera-1", { simulatedElapsedSeconds: 90 });
  const stale = store.capture(session.id, output, "camera-2", { simulatedElapsedSeconds: 180 });
  assert.equal(captured.events[0].road.recommendation.laneIndex, 1);
  assert.equal(stale.events[1].road.recommendation, null);
  assert.equal(stale.events[1].road.lanes[0].speedKph, 67);
  assert.equal(stale.summary.delayedOfficialDataSegments, 1);
});

test("does not accept more capture events after a session finishes", () => {
  const store = createTripSessionStore();
  const session = store.create();
  store.finish(session.id);
  assert.equal(store.capture(session.id, output, "camera-1").error, "trip_session_finished");
});

test("loads completed local test sessions after an Observer restart", () => {
  const filePath = join(tmpdir(), `corridor-trip-session-${process.pid}-${Date.now()}.json`);
  try {
    const first = createTripSessionStore({ now: () => "2026-09-24T08:01:00.000Z", filePath });
    const session = first.create();
    first.capture(session.id, output, "camera-1");
    first.finish(session.id);
    assert.equal(existsSync(filePath), true);
    const restored = createTripSessionStore({ filePath });
    assert.equal(restored.list()[0].summary.capturedSegments, 1);
    assert.equal(restored.list()[0].state, "finished");
  } finally {
    if (existsSync(filePath)) rmSync(filePath, { force: true });
  }
});
