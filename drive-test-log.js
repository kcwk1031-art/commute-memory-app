export const TEST_LOG_STORAGE_KEY = "commute-drive-test-log-v1";
export const TEST_LOG_ENABLED_KEY = "commute-drive-test-log-enabled-v1";
const MAX_TEST_EVENTS = 2400;

function safeRead(storage) {
  try {
    const value = JSON.parse(storage.getItem(TEST_LOG_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

export function testLoggingEnabled(storage) {
  try {
    return storage.getItem(TEST_LOG_ENABLED_KEY) === "true";
  } catch (_) {
    return false;
  }
}

export function setTestLoggingEnabled(storage, enabled) {
  try {
    storage.setItem(TEST_LOG_ENABLED_KEY, enabled ? "true" : "false");
    return true;
  } catch (_) {
    return false;
  }
}

export function appendTestEvent(storage, event) {
  const timestamp = Number(event?.timestamp);
  if (!Number.isFinite(timestamp)) return { stored: false, count: safeRead(storage).length };
  const events = safeRead(storage);
  events.push(event);
  const retained = events.slice(-MAX_TEST_EVENTS);
  try {
    storage.setItem(TEST_LOG_STORAGE_KEY, JSON.stringify(retained));
    return { stored: true, count: retained.length };
  } catch (_) {
    return { stored: false, count: events.length };
  }
}

export function readTestEvents(storage) {
  return safeRead(storage);
}

export function clearTestEvents(storage) {
  try {
    storage.removeItem(TEST_LOG_STORAGE_KEY);
    return true;
  } catch (_) {
    return false;
  }
}

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : Math.round((ordered[middle - 1] + ordered[middle]) / 2);
}

// This is a diagnostic summary, not a driving score. It helps the pilot
// separate GPS, stream, and official-data delays before making product claims.
export function summariseTestEvents(events) {
  const records = Array.isArray(events) ? events : [];
  const positions = records.filter((event) => event?.position && Number.isFinite(Number(event.position.accuracyMeters)));
  const accuracies = positions.map((event) => Number(event.position.accuracyMeters));
  const accuratePositions = accuracies.filter((accuracy) => accuracy <= 20);
  const cameraSelections = records.map((event) => String(event?.selection?.cameraId || "")).filter(Boolean);
  const cameraChanges = cameraSelections.reduce((count, cameraId, index) => (
    index > 0 && cameraId !== cameraSelections[index - 1] ? count + 1 : count
  ), 0);
  const referenceEvents = records.filter((event) => event?.laneReference?.referenceState === "reference");
  const officialAges = records.map((event) => Number(event?.laneReference?.officialAgeSeconds)).filter((age) => Number.isFinite(age) && age >= 0);

  return {
    eventCount: records.length,
    positionSampleCount: positions.length,
    gpsAccuracy: {
      medianMeters: median(accuracies),
      within20MetersCount: accuratePositions.length,
      within20MetersPercent: accuracies.length ? Math.round(accuratePositions.length * 100 / accuracies.length) : null,
    },
    camera: {
      selectedCount: cameraSelections.length,
      distinctCount: new Set(cameraSelections).size,
      changeCount: cameraChanges,
    },
    officialLaneReference: {
      availableCount: referenceEvents.length,
      availablePercent: records.length ? Math.round(referenceEvents.length * 100 / records.length) : null,
      medianAgeSeconds: median(officialAges),
    },
  };
}
