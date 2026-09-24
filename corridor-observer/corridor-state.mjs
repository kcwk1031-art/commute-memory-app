import { appendVisualFlowSample, summariseVisualFlow } from "./visual-flow.mjs";

export function createCorridorState(cameras, now = Date.now()) {
  return {
    startedAt: now,
    updatedAt: 0,
    pollCycles: 0,
    cameras: new Map(cameras.map((camera, index) => [camera.id, {
      ...camera,
      sequence: index + 1,
      latestJpeg: null,
      latestAt: 0,
      frameTimes: [],
      lastAttemptAt: 0,
      consecutiveFailures: 0,
      lastError: "",
      laneObservation: null,
      laneUpdatedAt: 0,
      laneLastAttemptAt: 0,
      consecutiveLaneFailures: 0,
      lastLaneError: "",
      analysis: null,
      visualFlowSamples: [],
      analysisUpdatedAt: 0,
      consecutiveAnalysisFailures: 0,
      lastAnalysisError: "",
    }])),
  };
}

export function recordSnapshot(state, id, jpeg, now = Date.now()) {
  const camera = state.cameras.get(id);
  if (!camera) return;
  camera.latestJpeg = jpeg;
  camera.latestAt = now;
  camera.frameTimes.push(now);
  const cutoff = now - 10000;
  while (camera.frameTimes.length && camera.frameTimes[0] < cutoff) camera.frameTimes.shift();
  camera.lastAttemptAt = now;
  camera.consecutiveFailures = 0;
  camera.lastError = "";
  state.updatedAt = now;
}

export function recordFailure(state, id, error, now = Date.now()) {
  const camera = state.cameras.get(id);
  if (!camera) return;
  camera.lastAttemptAt = now;
  camera.consecutiveFailures += 1;
  camera.lastError = String(error?.message || error || "snapshot_failed").slice(0, 180);
  state.updatedAt = now;
}

export function recordLaneObservation(state, id, observation, now = Date.now()) {
  const camera = state.cameras.get(id);
  if (!camera) return;
  camera.laneLastAttemptAt = now;
  if (observation?.ok) {
    camera.laneObservation = observation;
    camera.laneUpdatedAt = now;
    camera.consecutiveLaneFailures = 0;
    camera.lastLaneError = "";
  } else {
    camera.consecutiveLaneFailures += 1;
    camera.lastLaneError = String(observation?.error || "lane_observation_failed").slice(0, 180);
    // Do not erase a recent, confirmed VD observation just because one upstream poll failed.
    if (!camera.laneObservation?.ok) camera.laneObservation = observation;
  }
  state.updatedAt = now;
}

export function recordAnalysis(state, id, analysis, now = Date.now()) {
  const camera = state.cameras.get(id);
  if (!camera) return;
  camera.visualFlowSamples = appendVisualFlowSample(camera.visualFlowSamples, analysis, now);
  if (analysis?.status === "ready") analysis.visualFlow = summariseVisualFlow(camera.visualFlowSamples, analysis.lanes.length);
  camera.analysis = analysis;
  camera.analysisUpdatedAt = now;
  camera.consecutiveAnalysisFailures = 0;
  camera.lastAnalysisError = "";
}

export function recordAnalysisFailure(state, id, error, now = Date.now()) {
  const camera = state.cameras.get(id);
  if (!camera) return;
  camera.analysisUpdatedAt = now;
  camera.consecutiveAnalysisFailures += 1;
  camera.lastAnalysisError = String(error?.message || error || "analysis_failed").slice(0, 180);
}

export function corridorStatus(state, staleAfterMs, now = Date.now()) {
  const cameras = [...state.cameras.values()].map((camera) => {
    const ageMs = camera.latestAt ? Math.max(0, now - camera.latestAt) : null;
    const ready = ageMs !== null && ageMs <= staleAfterMs;
    const sampleMs = camera.frameTimes.length > 1 ? Math.max(1, camera.frameTimes.at(-1) - camera.frameTimes[0]) : 0;
    const sourceFps = sampleMs ? Number(((camera.frameTimes.length - 1) * 1000 / sampleMs).toFixed(1)) : 0;
    return {
      id: camera.id,
      sequence: camera.sequence,
      mile: camera.mile,
      label: camera.label,
      state: ready ? "ready" : camera.latestAt ? "stale" : "waiting",
      ageMs,
      sourceFps,
      lastAttemptAt: camera.lastAttemptAt ? new Date(camera.lastAttemptAt).toISOString() : null,
      consecutiveFailures: camera.consecutiveFailures,
      lastError: camera.lastError || null,
      lane: camera.laneObservation?.ok ? {
        updatedAt: camera.laneObservation.updatedAt || null,
        ageMs: camera.laneUpdatedAt ? Math.max(0, now - camera.laneUpdatedAt) : null,
        mainLaneCount: camera.laneObservation.mainLaneCount,
        lanes: camera.laneObservation.lanes,
        flowReference: camera.laneObservation.flowReference,
        consecutiveFailures: camera.consecutiveLaneFailures,
        lastError: camera.lastLaneError || null,
      } : null,
      analysis: camera.analysis ? {
        state: camera.analysis.status,
        updatedAt: camera.analysis.analysedAt,
        sourceCapturedAt: camera.analysis.sourceCapturedAt,
        detectionCount: camera.analysis.detections.length,
        lanes: camera.analysis.lanes,
        model: camera.analysis.model,
        officialVd: camera.analysis.officialVd || null,
        visualFlow: camera.analysis.visualFlow || null,
        consecutiveFailures: camera.consecutiveAnalysisFailures,
        lastError: camera.lastAnalysisError || null,
      } : null,
    };
  });
  return {
    ok: cameras.every((camera) => camera.state === "ready"),
    startedAt: new Date(state.startedAt).toISOString(),
    updatedAt: state.updatedAt ? new Date(state.updatedAt).toISOString() : null,
    pollCycles: state.pollCycles,
    cameras,
  };
}
