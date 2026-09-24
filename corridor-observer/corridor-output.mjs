function roadReference(camera) {
  const official = camera.analysis?.officialVd;
  const sourceDataTime = official?.vd?.dataCollectTime || null;
  const collectedAt = Date.parse(String(sourceDataTime || ""));
  const sourceDataAgeMs = Number.isFinite(collectedAt) ? Math.max(0, Date.now() - collectedAt) : null;
  const hasVerifiedLanes = ["ready", "stale"].includes(official?.state) && Array.isArray(official?.lanes) && official.lanes.length > 0;
  if (!hasVerifiedLanes) {
    return {
      state: official?.state || "unavailable",
      detail: official?.detail || "尚未取得可安全交付的官方車道速度。",
      sourceDataTime,
      sourceDataAgeMs,
      lanes: [],
      lastKnownLanes: official?.lastKnownLanes?.map((lane) => ({
        laneIndex: lane.laneIndex,
        speedKph: lane.speedKph,
        occupancy: lane.occupancy,
        volume: lane.volume,
      })) || [],
      recommendation: null,
    };
  }

  const isStale = official.state === "stale";
  const flowReference = official.flowReference;
  return {
    state: isStale ? "stale" : "ready",
    detail: isStale ? official.detail : "已依人工中心線與官方 VD 對位，可作為車道流況參考。",
    sourceDataTime,
    sourceDataAgeMs,
    lanes: official.lanes.map((lane) => ({
      laneIndex: lane.laneIndex,
      speedKph: lane.speedKph,
      occupancy: lane.occupancy,
      volume: lane.volume,
    })),
    lastKnownLanes: [],
    recommendation: ["reference", "last_reference"].includes(flowReference?.state)
      ? { laneIndex: flowReference.bestLaneIndex, detail: flowReference.detail, freshness: isStale ? "delayed" : "current", confidence: flowReference.confidence || null }
      : null,
  };
}

export function buildCorridorOutput(status, { corridorId, label, relayBase }) {
  const cameras = (status.cameras || []).map((camera) => {
    const road = roadReference(camera);
    return {
      id: camera.id,
      sequence: camera.sequence,
      mile: camera.mile,
      label: camera.label,
      cctv: {
        state: camera.state,
        ageMs: camera.ageMs,
        sourceFps: camera.sourceFps,
        consecutiveFailures: camera.consecutiveFailures || 0,
        lastError: camera.lastError || null,
        mjpegUrl: `${relayBase}/mjpeg/${encodeURIComponent(camera.id)}`,
      },
      road,
      vehicleCounts: camera.analysis?.state === "ready"
        ? camera.analysis.lanes.map((lane) => ({ laneIndex: lane.laneIndex, vehicleCount: lane.vehicleCount }))
        : [],
      visualFlow: camera.analysis?.state === "ready" ? camera.analysis.visualFlow || null : null,
    };
  });
  const count = (state) => cameras.filter((camera) => camera.road.state === state).length;
  const verifiedMapping = cameras.filter((camera) => ["ready", "stale"].includes(camera.road.state));
  const delayedOfficialData = cameras.filter((camera) => camera.road.state === "stale");
  const reportIssues = cameras.flatMap((camera) => {
    const issues = [];
    if (camera.cctv.state !== "ready") {
      issues.push({ cameraId: camera.id, mile: camera.mile, label: camera.label, severity: "high", type: "cctv_unavailable", detail: camera.cctv.lastError || "鏡頭未取得新畫面。", action: "確認 Relay 與官方鏡頭來源，保留上一張成功畫面。" });
    }
    if (camera.road.state === "stale" && delayedOfficialData.length === 1) {
      issues.push({ cameraId: camera.id, mile: camera.mile, label: camera.label, severity: "medium", type: "official_data_delayed", detail: camera.road.detail, action: "保留最後已對位車道資料並標示時間，等待下一筆官方 VD 原始資料。" });
    }
    if (["mapping_required", "mapping_review_required", "lane_count_mismatch"].includes(camera.road.state)) {
      issues.push({ cameraId: camera.id, mile: camera.mile, label: camera.label, severity: "medium", type: camera.road.state, detail: camera.road.detail, action: "在校正台確認主線車道與官方 VD 對位後重新輸出。" });
    }
    if (camera.road.state === "unavailable") {
      issues.push({ cameraId: camera.id, mile: camera.mile, label: camera.label, severity: "medium", type: "official_data_unavailable", detail: camera.road.detail, action: "檢查 TDX / Relay 後於下一輪重新讀取。" });
    }
    return issues;
  });
  if (delayedOfficialData.length > 1) {
    const oldestAgeMs = Math.max(...delayedOfficialData.map((camera) => Number(camera.road.sourceDataAgeMs) || 0));
    reportIssues.unshift({
      cameraId: null,
      mile: `${delayedOfficialData.length} 支鏡頭`,
      label: "官方 VD 共同來源",
      severity: "medium",
      type: "official_data_delayed",
      detail: `官方 VD 原始資料同步延遲，最久 ${Math.floor(oldestAgeMs / 60000)} 分鐘；目前保留最後已對位的車道速度與資料年齡。`,
      action: "等待下一筆官方 VD 原始資料；不需逐支重新校正。",
    });
  }

  return {
    ok: Boolean(status.ok),
    corridorId,
    label,
    updatedAt: status.updatedAt,
    summary: {
      cameraCount: cameras.length,
      readyCameras: cameras.filter((camera) => camera.cctv.state === "ready").length,
      verifiedLaneSpeedCameras: count("ready"),
      mappingRequiredCameras: count("mapping_required"),
      laneCountMismatchCameras: count("lane_count_mismatch"),
      unavailableVdCameras: count("unavailable"),
      delayedOfficialDataCameras: count("stale"),
      verifiedMappingCameras: verifiedMapping.length,
      visualFlowReadyCameras: cameras.filter((camera) => camera.visualFlow?.state === "ready").length,
      reportIssueCount: reportIssues.length,
      liveFpsRange: (() => {
        const values = cameras.filter((camera) => camera.cctv.state === "ready" && camera.cctv.sourceFps > 0).map((camera) => camera.cctv.sourceFps);
        return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
      })(),
    },
    cameras,
    reportIssues,
  };
}
