import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function cloneLanes(road) {
  const lanes = road?.state === "ready" ? road.lanes : road?.lastKnownLanes;
  return (lanes || []).map((lane) => ({
    laneIndex: lane.laneIndex,
    speedKph: lane.speedKph,
    occupancy: lane.occupancy,
    volume: lane.volume,
  }));
}

function snapshotCamera(camera, simulatedElapsedSeconds, capturedAt) {
  const road = camera.road || {};
  const recommendation = road.state === "ready" ? road.recommendation : null;
  return {
    capturedAt,
    simulatedElapsedSeconds: Number.isFinite(Number(simulatedElapsedSeconds)) ? Math.max(0, Number(simulatedElapsedSeconds)) : null,
    cameraId: camera.id,
    sequence: camera.sequence,
    mile: camera.mile,
    label: camera.label,
    cctv: {
      state: camera.cctv?.state || "waiting",
      ageMs: camera.cctv?.ageMs ?? null,
      sourceFps: camera.cctv?.sourceFps ?? 0,
    },
    road: {
      state: road.state || "unavailable",
      sourceDataTime: road.sourceDataTime || null,
      sourceDataAgeMs: road.sourceDataAgeMs ?? null,
      lanes: cloneLanes(road),
      recommendation: recommendation ? { laneIndex: recommendation.laneIndex, detail: recommendation.detail } : null,
      detail: road.detail || "",
    },
  };
}

function summarize(session) {
  const events = session.events;
  return {
    capturedSegments: events.length,
    uniqueCameras: new Set(events.map((event) => event.cameraId)).size,
    readyCctvSegments: events.filter((event) => event.cctv.state === "ready").length,
    delayedOfficialDataSegments: events.filter((event) => event.road.state === "stale").length,
    unavailableOfficialDataSegments: events.filter((event) => !["ready", "stale"].includes(event.road.state)).length,
    recommendationSegments: events.filter((event) => event.road.recommendation).length,
  };
}

function normalizeOptions(input) {
  if (typeof input === "function") return { now: input };
  return input && typeof input === "object" ? input : {};
}

export function createTripSessionStore(input = {}) {
  const { now = () => new Date().toISOString(), filePath = "" } = normalizeOptions(input);
  const sessions = new Map();
  let sequence = 0;

  function persist() {
    if (!filePath) return;
    mkdirSync(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ version: 1, sessions: [...sessions.values()] }, null, 2)}\n`, "utf8");
    renameSync(temporary, filePath);
  }

  function load() {
    if (!filePath || !existsSync(filePath)) return;
    try {
      const saved = JSON.parse(readFileSync(filePath, "utf8"));
      const savedSessions = Array.isArray(saved?.sessions) ? saved.sessions : [];
      savedSessions.slice(-30).forEach((session) => {
        if (!session?.id || !Array.isArray(session.events)) return;
        sessions.set(String(session.id), { ...session, events: session.events });
        const match = String(session.id).match(/trip-(\d+)/);
        if (match) sequence = Math.max(sequence, Number(match[1]));
      });
    } catch {
      // A malformed local test log must not stop CCTV collection.
    }
  }

  function present(session) {
    if (!session) return null;
    return { ...session, events: [...session.events], summary: summarize(session) };
  }

  load();

  return {
    create({ mode = "time_simulation" } = {}) {
      sequence += 1;
      const session = {
        id: `trip-${String(sequence).padStart(4, "0")}`,
        mode: mode === "drive" ? "drive" : "time_simulation",
        state: "active",
        startedAt: now(),
        finishedAt: null,
        events: [],
      };
      sessions.set(session.id, session);
      persist();
      return present(session);
    },
    capture(id, output, cameraId, options = {}) {
      const session = sessions.get(String(id || ""));
      if (!session) return { error: "trip_session_not_found" };
      if (session.state !== "active") return { error: "trip_session_finished" };
      const camera = output?.cameras?.find((item) => item.id === cameraId);
      if (!camera) return { error: "camera_not_in_corridor" };
      session.events.push(snapshotCamera(camera, options.simulatedElapsedSeconds, now()));
      persist();
      return present(session);
    },
    finish(id) {
      const session = sessions.get(String(id || ""));
      if (!session) return { error: "trip_session_not_found" };
      if (session.state === "active") {
        session.state = "finished";
        session.finishedAt = now();
        persist();
      }
      return present(session);
    },
    get(id) { return present(sessions.get(String(id || ""))); },
    list() { return [...sessions.values()].map(present).sort((left, right) => right.startedAt.localeCompare(left.startedAt)); },
  };
}
