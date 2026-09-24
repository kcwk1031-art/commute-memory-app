export function validateCalibrationPayload(payload, cameras) {
  if (!payload || payload.corridorId !== "n3-south-xindian-yangmei") throw new Error("invalid_corridor");
  const calibrations = payload.calibrations;
  if (!calibrations || typeof calibrations !== "object") throw new Error("calibrations_required");

  const cameraIds = cameras.map((camera) => camera.id);
  const missing = cameraIds.filter((id) => !calibrations[id]);
  if (missing.length) throw new Error(`calibration_missing:${missing.join(",")}`);

  for (const id of cameraIds) {
    const calibration = calibrations[id];
    const laneCount = Number(calibration?.laneCount);
    if (!Number.isInteger(laneCount) || laneCount < 1 || laneCount > 6) throw new Error(`invalid_lane_count:${id}`);
    if (!calibration?.savedAt) throw new Error(`calibration_not_saved:${id}`);
    for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
      const points = calibration?.lanes?.[laneIndex];
      if (!Array.isArray(points) || points.length !== 4) throw new Error(`invalid_lane_points:${id}:${laneIndex + 1}`);
      if (points.some((point) => !Number.isFinite(Number(point?.x)) || !Number.isFinite(Number(point?.y)) || Number(point.x) < 0 || Number(point.x) > 1 || Number(point.y) < 0 || Number(point.y) > 1)) {
        throw new Error(`invalid_lane_coordinate:${id}:${laneIndex + 1}`);
      }
    }
  }

  return {
    corridorId: payload.corridorId,
    exportedAt: payload.exportedAt || new Date().toISOString(),
    calibrationCount: cameraIds.length,
    cameraIds,
  };
}
