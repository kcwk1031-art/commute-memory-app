// Do not present a multi-minute-old detector average as an immediate driving cue.
export const LANE_RECOMMEND_MAX_AGE_MS = 2 * 60 * 1000;
// TDX can lag its published detector record by several minutes. Keep the
// last official reading visible for diagnosis, but never present it as a live
// lane-change reference once it passes the stricter recommendation threshold.
export const LANE_DISPLAY_MAX_AGE_MS = 5 * 60 * 1000;

function laneSpeedIsUsable(lane) {
  return Number.isFinite(Number(lane?.speedKph));
}

function laneIdValue(lane) {
  const value = Number(lane?.laneId);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function formatAge(ageMs) {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  return seconds < 90 ? `${seconds} 秒前` : `${Math.floor(seconds / 60)} 分鐘前`;
}

function vdDistanceLabel(distanceKm) {
  const value = Number(distanceKm);
  if (!Number.isFinite(value) || value < 0) return "同向主線 VD";
  return value < 1 ? `VD 距鏡頭 ${Math.round(value * 1000)} m` : `VD 距鏡頭 ${value.toFixed(1)} km`;
}

export function getLaneDataFreshness(dataCollectTime, now = Date.now()) {
  const collectedAt = Date.parse(String(dataCollectTime || ""));
  if (!Number.isFinite(collectedAt)) {
    return {
      state: "unknown",
      ageMs: null,
      label: "更新時間待確認",
      canDisplay: true,
      canRecommend: false,
    };
  }

  const ageMs = Math.max(0, now - collectedAt);
  if (ageMs <= LANE_RECOMMEND_MAX_AGE_MS) {
    return { state: "fresh", ageMs, label: formatAge(ageMs), canDisplay: true, canRecommend: true };
  }
  if (ageMs <= LANE_DISPLAY_MAX_AGE_MS) {
    return { state: "delayed", ageMs, label: formatAge(ageMs), canDisplay: true, canRecommend: false };
  }
  return { state: "expired", ageMs, label: formatAge(ageMs), canDisplay: false, canRecommend: false };
}

export function buildLaneGuidance(observation, now = Date.now()) {
  const hasConfirmedScreenMapping = observation?.screenLaneMapping?.state === "confirmed" && Array.isArray(observation?.screenLanes);
  const laneSource = hasConfirmedScreenMapping ? observation.screenLanes : observation?.lanes;
  const lanes = Array.isArray(laneSource)
    ? laneSource
      .filter((lane) => [1, 2, 3].includes(Number(lane?.laneType)) && laneSpeedIsUsable(lane))
      .sort((left, right) => hasConfirmedScreenMapping
        ? Number(left.displayNumber) - Number(right.displayNumber)
        : laneIdValue(left) - laneIdValue(right))
      .map((lane, index) => ({ ...lane, displayNumber: Number(lane.displayNumber) || index + 1 }))
    : [];
  const freshness = getLaneDataFreshness(observation?.vd?.dataCollectTime, now);
  const mainLaneCount = lanes.length || Number(observation?.mainLaneCount) || 0;
  const vdLabel = vdDistanceLabel(observation?.vd?.distanceKm);
  const reference = hasConfirmedScreenMapping ? observation?.screenFlowReference || {} : observation?.flowReference || {};
  const bestLaneIndex = lanes.findIndex((lane) => String(lane.laneId) === String(reference.bestLaneId));
  const bestLane = bestLaneIndex >= 0 ? lanes[bestLaneIndex] : null;

  if (!lanes.length) {
    return {
      freshness,
      lanes,
      title: "主線車道資料不足",
      detail: "官方 VD 未回傳足夠的同向主線車道速度，因此不提供車道推薦。",
      level: "warning",
    };
  }

  if (!freshness.canDisplay) {
    return {
      freshness,
      lanes,
      title: "官方 VD 資料已過期",
      detail: `最後一筆官方車道資料為 ${freshness.label}；已停止顯示速度與車道推薦。`,
      level: "warning",
    };
  }

  if (!freshness.canRecommend) {
    return {
      freshness,
      lanes,
      title: `主線 ${mainLaneCount} 線｜資料延遲 ${freshness.label}`,
      detail: `${vdLabel}｜最後更新 ${freshness.label}。顯示最後速度，不提供車道推薦。`,
      level: "warning",
    };
  }

  if (reference.state === "reference" && bestLane) {
    return {
      freshness,
      lanes: lanes.map((lane) => ({ ...lane, isRecommended: lane.laneId === bestLane.laneId })),
      title: `主線 ${mainLaneCount} 線｜第 ${bestLane.displayNumber} 車道車流較順`,
      detail: `${vdLabel}｜${freshness.label}。${reference.detail || `第 ${bestLane.displayNumber} 車道流況相對較順。`}`,
      level: "reference",
    };
  }

  if (reference.state === "similar") {
    return {
      freshness,
      lanes,
      title: `主線 ${mainLaneCount} 線｜各車道差異不明顯`,
      detail: `${vdLabel}｜${freshness.label}。未有明顯差異，維持目前車道較合適。`,
      level: "waiting",
    };
  }

  return {
      freshness,
      lanes,
      title: `主線 ${mainLaneCount} 線｜不提供車道推薦`,
      detail: `${vdLabel}｜${freshness.label}。官方資料不足以比較各車道，僅顯示目前可用速度。`,
    level: "warning",
  };
}
