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
