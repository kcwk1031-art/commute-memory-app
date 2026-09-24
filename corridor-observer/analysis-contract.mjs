export const ANALYSIS_SCHEMA_VERSION = 1;
// Coordinates are normalized to the image. A vehicle must be close enough to a
// manually drawn mainline centreline; otherwise it may belong to the opposite
// carriageway, a ramp, or a parallel road and is intentionally ignored.
export const MAX_MAINLINE_CENTRELINE_DISTANCE = 0.12;

function finiteUnit(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

export function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}

export function distanceToLaneCenterline(point, points) {
  if (!Array.isArray(points) || points.length < 2) return Infinity;
  let distance = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(point, points[index - 1], points[index]));
  }
  return distance;
}

export function detectionRoadContactPoint(detection) {
  const x = finiteUnit(detection?.bbox?.x);
  const y = finiteUnit(detection?.bbox?.y);
  const width = finiteUnit(detection?.bbox?.width);
  const height = finiteUnit(detection?.bbox?.height);
  if ([x, y, width, height].some((value) => value === null)) return null;
  const centerX = x + width / 2;
  const bottomY = y + height;
  if (centerX > 1 || bottomY > 1) return null;
  return { x: centerX, y: bottomY };
}

export function assignDetectionLane(detection, calibration) {
  const point = detectionRoadContactPoint(detection);
  if (!point) return null;
  const laneCount = Number(calibration?.laneCount);
  if (!Number.isInteger(laneCount) || laneCount < 1) return null;
  // The pilot's four green points describe the driveable centreline from the
  // near field to the vanishing point; they are intentionally not a polygon.
  const candidates = Array.from({ length: laneCount }, (_, laneIndex) => ({
    laneIndex: laneIndex + 1,
    distance: distanceToLaneCenterline(point, calibration?.lanes?.[laneIndex]),
  })).filter((candidate) => Number.isFinite(candidate.distance));
  candidates.sort((left, right) => left.distance - right.distance);
  const nearest = candidates[0];
  return nearest && nearest.distance <= MAX_MAINLINE_CENTRELINE_DISTANCE ? nearest.laneIndex : null;
}

export function normaliseDetection(raw, calibration) {
  const x = finiteUnit(raw?.bbox?.x);
  const y = finiteUnit(raw?.bbox?.y);
  const width = finiteUnit(raw?.bbox?.width);
  const height = finiteUnit(raw?.bbox?.height);
  const confidence = Number(raw?.confidence);
  if ([x, y, width, height].some((value) => value === null) || x + width > 1 || y + height > 1) return null;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const detection = {
    id: typeof raw.id === "string" ? raw.id.slice(0, 80) : null,
    className: typeof raw.className === "string" ? raw.className.slice(0, 40) : "vehicle",
    confidence: Math.round(confidence * 1000) / 1000,
    bbox: { x, y, width, height },
  };
  return { ...detection, laneIndex: assignDetectionLane(detection, calibration) };
}

export function summariseLaneDetections(detections, laneCount) {
  const lanes = Array.from({ length: laneCount }, (_, index) => ({
    laneIndex: index + 1,
    vehicleCount: 0,
    classes: { car: 0, bus: 0, truck: 0, motorcycle: 0, other: 0 },
  }));
  for (const detection of detections) {
    if (!detection?.laneIndex || !lanes[detection.laneIndex - 1]) continue;
    const lane = lanes[detection.laneIndex - 1];
    lane.vehicleCount += 1;
    const className = Object.hasOwn(lane.classes, detection.className) ? detection.className : "other";
    lane.classes[className] += 1;
  }
  return lanes;
}

export function createCameraAnalysis({ cameraId, sourceCapturedAt, calibration, detections = [], modelId = "unavailable", inferenceMs = null, analysedAt = new Date().toISOString() }) {
  const laneCount = Number(calibration?.laneCount);
  const validCalibration = Number.isInteger(laneCount) && laneCount > 0 && Boolean(calibration?.savedAt);
  if (!validCalibration) {
    return {
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      cameraId,
      status: "calibration_required",
      analysedAt,
      sourceCapturedAt: sourceCapturedAt || null,
      model: { id: modelId, inferenceMs },
      detections: [],
      lanes: [],
    };
  }
  const normalised = detections.map((detection) => normaliseDetection(detection, calibration)).filter(Boolean);
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    cameraId,
    status: "ready",
    analysedAt,
    sourceCapturedAt: sourceCapturedAt || null,
    model: { id: modelId, inferenceMs: Number.isFinite(Number(inferenceMs)) ? Number(inferenceMs) : null },
    detections: normalised,
    unassignedDetectionCount: normalised.filter((detection) => !detection.laneIndex).length,
    lanes: summariseLaneDetections(normalised, laneCount),
  };
}
