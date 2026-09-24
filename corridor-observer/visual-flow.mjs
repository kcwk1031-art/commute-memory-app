export const VISUAL_FLOW_WINDOW_MS = 2 * 60 * 1000;
const MIN_VISUAL_FLOW_SAMPLES = 3;
const MIN_VISUAL_FLOW_SPAN_MS = 20 * 1000;

function finiteTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function normaliseSample(analysis, receivedAt) {
  if (analysis?.status !== "ready" || !Array.isArray(analysis.lanes)) return null;
  const capturedAt = finiteTimestamp(analysis.sourceCapturedAt) || receivedAt;
  return {
    capturedAt,
    lanes: analysis.lanes.map((lane) => ({
      laneIndex: Number(lane.laneIndex),
      vehicleCount: Math.max(0, Number(lane.vehicleCount) || 0),
    })).filter((lane) => Number.isInteger(lane.laneIndex) && lane.laneIndex > 0),
  };
}

export function appendVisualFlowSample(history, analysis, now = Date.now()) {
  const sample = normaliseSample(analysis, now);
  const retained = Array.isArray(history) ? history.filter((entry) => entry?.capturedAt >= now - VISUAL_FLOW_WINDOW_MS) : [];
  if (!sample || retained.at(-1)?.capturedAt === sample.capturedAt) return retained;
  return [...retained, sample].filter((entry) => entry.capturedAt >= now - VISUAL_FLOW_WINDOW_MS);
}

function laneTrend(samples, laneIndex) {
  const counts = samples.map((sample) => sample.lanes.find((lane) => lane.laneIndex === laneIndex)?.vehicleCount ?? 0);
  const spanMs = samples.length > 1 ? samples.at(-1).capturedAt - samples[0].capturedAt : 0;
  const latestVehicleCount = counts.at(-1) ?? null;
  if (counts.length < MIN_VISUAL_FLOW_SAMPLES || spanMs < MIN_VISUAL_FLOW_SPAN_MS) {
    return { laneIndex, latestVehicleCount, trend: "insufficient", sampleCount: counts.length };
  }
  const split = Math.ceil(counts.length / 2);
  const earlierAverage = average(counts.slice(0, split));
  const recentAverage = average(counts.slice(split));
  const delta = Math.round((recentAverage - earlierAverage) * 10) / 10;
  const trend = delta >= 1 ? "increasing" : delta <= -1 ? "decreasing" : "stable";
  return { laneIndex, latestVehicleCount, trend, delta, sampleCount: counts.length };
}

export function summariseVisualFlow(history, laneCount) {
  const samples = Array.isArray(history) ? history : [];
  const lanes = Array.from({ length: Number(laneCount) || 0 }, (_, index) => laneTrend(samples, index + 1));
  const ready = lanes.some((lane) => lane.trend !== "insufficient");
  return {
    state: ready ? "ready" : "collecting",
    sourceSampleCount: samples.length,
    capturedAt: samples.at(-1) ? new Date(samples.at(-1).capturedAt).toISOString() : null,
    detail: "影像觀測為人工主線中心線內的車輛數趨勢，不是車速，也不作為單獨換道指令。",
    lanes,
  };
}
