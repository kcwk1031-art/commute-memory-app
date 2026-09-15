export function radians(value) {
  return value * Math.PI / 180;
}

export function distanceBetween(a, b) {
  const earth = 6371000;
  const deltaLat = radians(b.lat - a.lat);
  const deltaLng = radians(b.lng - a.lng);
  const latA = radians(a.lat);
  const latB = radians(b.lat);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earth * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function bearingBetween(a, b) {
  const latA = radians(a.lat);
  const latB = radians(b.lat);
  const deltaLng = radians(b.lng - a.lng);
  const y = Math.sin(deltaLng) * Math.cos(latB);
  const x = Math.cos(latA) * Math.sin(latB) - Math.sin(latA) * Math.cos(latB) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function angleDelta(a, b) {
  return ((a - b + 540) % 360) - 180;
}

function cameraIdDirection(id) {
  return String(id || "").toUpperCase().match(/-(N|S|E|W)-/)?.[1] || "";
}

export function normalizeDirectionCode(value, id = "") {
  const text = String(value || "").trim().toUpperCase();
  if (/北|NORTH|(?:^|[-_\s])N(?:$|[-_\s])/.test(text)) return "N";
  if (/南|SOUTH|(?:^|[-_\s])S(?:$|[-_\s])/.test(text)) return "S";
  if (/東|EAST|(?:^|[-_\s])E(?:$|[-_\s])/.test(text)) return "E";
  if (/西|WEST|(?:^|[-_\s])W(?:$|[-_\s])/.test(text)) return "W";
  // CCTVID is more dependable than some non-standard Direction values from the catalog.
  return cameraIdDirection(id);
}

export function directionHeading(value, id = "") {
  return ({ N: 0, E: 90, S: 180, W: 270 })[normalizeDirectionCode(value, id)] ?? NaN;
}

export function directionLabel(value, id = "") {
  return ({ N: "北向", E: "東向", S: "南向", W: "西向" })[normalizeDirectionCode(value, id)] || "方向待確認";
}

export function parseRouteMile(value) {
  const text = String(value || "").trim().toUpperCase();
  const kilometerMatch = text.match(/(\d+(?:\.\d+)?)\s*K\s*\+\s*(\d+(?:\.\d+)?)/);
  if (kilometerMatch) return Number(kilometerMatch[1]) + Number(kilometerMatch[2]) / 1000;
  const decimalMatch = text.match(/(\d+(?:\.\d+)?)/);
  return decimalMatch ? Number(decimalMatch[1]) : NaN;
}

export function cameraRouteKey(camera) {
  const idMatch = String(camera?.id || "").toUpperCase().match(/^CCTV-(N\d+[A-Z]?)-/);
  return idMatch?.[1] || String(camera?.road || "").replace(/\s/g, "").toUpperCase();
}

export function directionProgressSign(value, id = "") {
  const direction = normalizeDirectionCode(value, id);
  if (direction === "S" || direction === "E") return 1;
  if (direction === "N" || direction === "W") return -1;
  return 0;
}

export function cameraForwardHeading(cameras, camera) {
  const route = cameraRouteKey(camera);
  const direction = normalizeDirectionCode(camera?.direction, camera?.id);
  const mile = parseRouteMile(camera?.mile);
  const progressSign = directionProgressSign(direction, camera?.id);
  if (!route || !direction || !Number.isFinite(mile) || !progressSign) return NaN;

  const neighbors = cameras
    .filter((candidate) => candidate.id !== camera.id)
    .filter((candidate) => cameraRouteKey(candidate) === route)
    .filter((candidate) => normalizeDirectionCode(candidate.direction, candidate.id) === direction)
    .map((candidate) => ({ ...candidate, mile: parseRouteMile(candidate.mile) }))
    .filter((candidate) => Number.isFinite(candidate.mile))
    .map((candidate) => ({ ...candidate, progress: (candidate.mile - mile) * progressSign }))
    .filter((candidate) => Math.abs(candidate.progress) <= 10)
    .sort((left, right) => Math.abs(left.progress) - Math.abs(right.progress));

  const ahead = neighbors.find((candidate) => candidate.progress > 0.005);
  if (ahead) return bearingBetween(camera, ahead);
  const behind = neighbors.find((candidate) => candidate.progress < -0.005);
  return behind ? bearingBetween(behind, camera) : NaN;
}

export function findCourseAnchor(samples, point, { minDistanceMeters, minElapsedSeconds, maxElapsedSeconds }) {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const candidate = samples[index];
    const elapsedSeconds = (point.timestamp - candidate.timestamp) / 1000;
    if (elapsedSeconds < minElapsedSeconds) continue;
    if (elapsedSeconds > maxElapsedSeconds) break;
    const distance = distanceBetween(candidate, point);
    if (distance >= minDistanceMeters) return { point: candidate, distance, elapsedSeconds };
  }
  return null;
}
