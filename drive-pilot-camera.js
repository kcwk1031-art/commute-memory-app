function headingDelta(left, right) {
  return Math.abs(((left - right + 540) % 360) - 180);
}

// The pilot keeps a camera until the vehicle is close to it. Once it has been
// passed, the next calibrated camera must be selected even though the distance
// back to the old camera starts increasing again.
export function shouldAdvancePilotCamera({
  currentDistanceMeters,
  nextDistanceMeters,
  courseHeading,
  bearingToCurrent,
  switchMeters = 500,
} = {}) {
  if (!Number.isFinite(currentDistanceMeters)) return false;
  if (currentDistanceMeters <= switchMeters) return true;

  if (Number.isFinite(courseHeading) && Number.isFinite(bearingToCurrent)) {
    return headingDelta(courseHeading, bearingToCurrent) >= 105;
  }

  // A GPS heading may be unavailable at low speed. If the next calibrated
  // camera is now closer than the active one, treat the active camera as passed.
  return Number.isFinite(nextDistanceMeters)
    && nextDistanceMeters + switchMeters < currentDistanceMeters;
}
