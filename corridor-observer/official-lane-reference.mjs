const MAX_OFFICIAL_VD_AGE_MS = 2 * 60 * 1000;

function officialDataAgeMs(observation, now = Date.now()) {
  const collectedAt = Date.parse(String(observation?.vd?.dataCollectTime || ""));
  return Number.isFinite(collectedAt) ? Math.max(0, now - collectedAt) : null;
}

function formatOfficialDataAge(ageMs) {
  const seconds = Math.round(ageMs / 1000);
  return seconds < 90 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分鐘`;
}

function mainlineOfficialLaneIds(calibration, observation) {
  const laneCount = Number(calibration?.laneCount);
  const officialLanes = observation?.lanes || [];
  if (!observation?.ok || !Number.isInteger(laneCount) || officialLanes.length < laneCount) return null;
  const knownIds = new Set(officialLanes.map((lane) => String(lane.laneId)));
  const excluded = new Set((calibration?.excludedVdLaneIds || []).map(String));
  // Relay may already remove a shoulder or auxiliary lane before returning the
  // selected mainline VD. Keep the human exclusion as provenance, but do not
  // reject a complete mapping merely because that lane is no longer present.
  const activeExclusions = new Set([...excluded].filter((laneId) => knownIds.has(laneId)));
  const mainlineIds = officialLanes.map((lane) => String(lane.laneId)).filter((laneId) => !activeExclusions.has(laneId));
  return mainlineIds.length === laneCount ? new Set(mainlineIds) : null;
}

function validMapping(calibration, observation) {
  const laneCount = Number(calibration?.laneCount);
  const mainlineIds = mainlineOfficialLaneIds(calibration, observation);
  if (!mainlineIds) return null;
  const mapping = calibration?.vdLaneMap;
  if (!mapping || typeof mapping !== "object") return null;
  const mapped = Array.from({ length: laneCount }, (_, index) => String(mapping[index + 1] ?? ""));
  if (mapped.some((laneId) => !mainlineIds.has(laneId)) || new Set(mapped).size !== laneCount) return null;
  return mapped;
}

function buildMappedFlowReference(lanes) {
  const comparable = lanes
    .filter((lane) => Number.isFinite(Number(lane.speedKph)))
    .map((lane) => ({ ...lane, speedKph: Number(lane.speedKph) }))
    .sort((left, right) => right.speedKph - left.speedKph || left.laneIndex - right.laneIndex);
  if (comparable.length < 2) {
    return { state: "unavailable", bestLaneIndex: null, detail: "官方 VD 車道速度不足，暫不提供車道參考。" };
  }
  const [best, next] = comparable;
  const gap = best.speedKph - next.speedKph;
  if (gap <= 0) {
    const tiedLanes = comparable.filter((lane) => lane.speedKph === best.speedKph).map((lane) => `第 ${lane.laneIndex}`).join("、");
    return {
      state: "tie",
      bestLaneIndex: null,
      confidence: "none",
      detail: `官方 VD 顯示 ${tiedLanes} 車道同為 ${best.speedKph} km/h，沒有速度優勢，不建議為了速度變換車道。`,
    };
  }
  return {
    state: "reference",
    bestLaneIndex: best.laneIndex,
    confidence: gap >= 5 ? "clear" : "minor",
    detail: gap >= 5
      ? `官方 VD 顯示畫面第 ${best.laneIndex} 車道 ${best.speedKph} km/h，較次快車道快 ${gap} km/h。僅供路況參考，不構成變換車道指令。`
      : `官方 VD 顯示畫面第 ${best.laneIndex} 車道 ${best.speedKph} km/h 為目前最快，僅快 ${gap} km/h；差距小，維持行車安全為先。`,
  };
}

export function buildOfficialLaneReference(calibration, observation) {
  const laneCount = Number(calibration?.laneCount);
  if (!observation?.ok) return { state: "unavailable", detail: "尚未取得同向官方 VD 車道資料。" };
  if (!Number.isInteger(laneCount) || (observation?.lanes || []).length < laneCount) {
    return {
      state: "lane_count_mismatch",
      detail: `人工校正 ${Number.isInteger(laneCount) ? laneCount : 0} 線，官方 VD ${observation.mainLaneCount || 0} 線，暫不轉換車道速度。`,
    };
  }
  const mappedIds = validMapping(calibration, observation);
  if (!mappedIds) {
    const extraLaneCount = (observation.lanes || []).length - laneCount;
    return {
      state: "mapping_required",
      detail: extraLaneCount > 0
        ? `官方 VD 多 ${extraLaneCount} 筆，請先標註路肩、匝道或輔助車道並確認其餘主線車道對位。`
        : "請先確認各人工中心線對應的官方 VD 車道。",
    };
  }
  if (calibration?.vdMappingConfirmed !== true) {
    return {
      state: "mapping_review_required",
      detail: "目前為暫定畫面順序對位；確認後才會輸出為官方車道速度參考。",
    };
  }
  const byId = new Map(observation.lanes.map((lane) => [String(lane.laneId), lane]));
  const lanes = mappedIds.map((laneId, index) => {
    const lane = byId.get(laneId);
    return {
      laneIndex: index + 1,
      vdLaneId: laneId,
      speedKph: lane.speedKph,
      occupancy: lane.occupancy,
      volume: lane.volume,
    };
  });
  const sourceAgeMs = officialDataAgeMs(observation);
  // Calculate in screen order before applying freshness policy, so the UI can
  // retain the last verified reference with its exact official data age.
  const flowReference = buildMappedFlowReference(lanes);
  if (sourceAgeMs !== null && sourceAgeMs > MAX_OFFICIAL_VD_AGE_MS) {
    return {
      state: "stale",
      updatedAt: observation.updatedAt || null,
      vd: observation.vd || null,
      lanes,
      lastKnownLanes: [],
      flowReference: { ...flowReference, state: flowReference.state === "reference" ? "last_reference" : flowReference.state },
      detail: `官方 VD 原始資料已延遲 ${formatOfficialDataAge(sourceAgeMs)}；保留最後已對位的速度與最快車道參考，等待新資料。`,
    };
  }
  // The Relay recommendation is based on its own VD ordering. Recalculate it
  // after applying the human screen-left-to-right calibration.
  return {
    state: "ready",
    updatedAt: observation.updatedAt || null,
    vd: observation.vd || null,
    lanes,
    flowReference,
  };
}
