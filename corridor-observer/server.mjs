import { createServer } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { CORRIDOR_CAMERAS, CORRIDOR_ID, CORRIDOR_LABEL } from "./corridor-config.mjs";
import { createCameraAnalysis } from "./analysis-contract.mjs";
import { buildOfficialLaneReference } from "./official-lane-reference.mjs";
import { corridorStatus, createCorridorState, recordAnalysis, recordAnalysisFailure, recordFailure, recordLaneObservation, recordSnapshot } from "./corridor-state.mjs";
import { validateCalibrationPayload } from "./calibration-store.mjs";
import { splitMjpegFrames } from "./mjpeg-parser.mjs";
import { buildCorridorOutput } from "./corridor-output.mjs";
import { createTripSessionStore } from "./trip-session-store.mjs";

const port = Number(process.env.PORT || 10000);
const relayBase = String(process.env.RELAY_BASE || "https://commute-cctv-relay.onrender.com").replace(/\/$/, "");
const snapshotPollMs = Math.max(2000, Number(process.env.SNAPSHOT_POLL_MS || 2500));
const lanePollMs = Math.max(30000, Number(process.env.LANE_POLL_MS || 60000));
const analysisBase = String(process.env.ANALYSIS_BASE || "http://127.0.0.1:10001").replace(/\/$/, "");
const analysisPollMs = Math.max(5000, Number(process.env.ANALYSIS_POLL_MS || 10000));
const mjpegReconnectMs = Math.max(1000, Number(process.env.MJPEG_RECONNECT_MS || 2500));
const mjpegMaxBufferBytes = Math.max(512 * 1024, Number(process.env.MJPEG_MAX_BUFFER_BYTES || 4 * 1024 * 1024));
const staleAfterMs = Math.max(6000, Number(process.env.SNAPSHOT_STALE_MS || 9000));
const requestTimeoutMs = Math.max(3000, Number(process.env.REQUEST_TIMEOUT_MS || 8000));
const pilotHtml = join(dirname(fileURLToPath(import.meta.url)), "pilot.html");
const reportHtml = join(dirname(fileURLToPath(import.meta.url)), "report.html");
const tripReportHtml = join(dirname(fileURLToPath(import.meta.url)), "trip-report.html");
const defaultCalibrationDirectory = join(dirname(fileURLToPath(import.meta.url)), "data", "calibrations");
const defaultTripSessionFile = join(dirname(fileURLToPath(import.meta.url)), "data", "trip-sessions.json");
const calibrationFile = process.env.CALIBRATION_FILE
  ? resolve(process.env.CALIBRATION_FILE)
  : join(defaultCalibrationDirectory, `${CORRIDOR_ID}-lane-calibration.json`);
const calibrationDirectory = dirname(calibrationFile);
const state = createCorridorState(CORRIDOR_CAMERAS);
let collecting = false;
let lanesUpdatedAt = 0;
let analysisUpdatedAt = 0;
const mjpegCollectors = new Map();
const tripSessions = createTripSessionStore({ filePath: process.env.TRIP_SESSION_FILE || defaultTripSessionFile });

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  response.end(JSON.stringify(payload));
}

function sendJpeg(response, jpeg) {
  response.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store, no-cache, must-revalidate", "Access-Control-Allow-Origin": "*" });
  response.end(jpeg);
}

function readJsonBody(request, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) { reject(new Error("payload_too_large")); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error("invalid_json")); }
    });
    request.on("error", reject);
  });
}

function writeCalibrationExport(payload) {
  const summary = validateCalibrationPayload(payload, CORRIDOR_CAMERAS);
  mkdirSync(calibrationDirectory, { recursive: true });
  const temporary = `${calibrationFile}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...payload, storedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  renameSync(temporary, calibrationFile);
  return summary;
}

function readCalibrations() {
  try {
    const payload = JSON.parse(readFileSync(calibrationFile, "utf8"));
    validateCalibrationPayload(payload, CORRIDOR_CAMERAS);
    return payload.calibrations;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}) {
  const signal = AbortSignal.timeout(requestTimeoutMs);
  const response = await fetch(url, {
    ...options,
    signal,
    headers: { Accept: "image/jpeg,application/json", ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`upstream_${response.status}`);
  return response;
}

async function collectSnapshot(camera) {
  try {
    const response = await fetchWithTimeout(`${relayBase}/latest/${encodeURIComponent(camera.id)}?t=${Date.now()}`);
    const jpeg = Buffer.from(await response.arrayBuffer());
    if (jpeg.length < 500 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("invalid_jpeg");
    recordSnapshot(state, camera.id, jpeg);
  } catch (error) {
    recordFailure(state, camera.id, error);
  }
}

function consumeJpegs(buffer, camera) {
  const parsed = splitMjpegFrames(buffer, mjpegMaxBufferBytes);
  parsed.frames.forEach((jpeg) => recordSnapshot(state, camera.id, jpeg));
  return parsed.remainder;
}

async function runMjpegCollector(camera) {
  try {
    const response = await fetch(`${relayBase}/mjpeg/${encodeURIComponent(camera.id)}`, {
      headers: { Accept: "multipart/x-mixed-replace,image/jpeg,*/*" },
    });
    if (!response.ok || !response.body) throw new Error(`mjpeg_upstream_${response.status}`);
    const reader = response.body.getReader();
    let buffer = Buffer.alloc(0);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer = consumeJpegs(Buffer.concat([buffer, Buffer.from(value)]), camera);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    throw new Error("mjpeg_stream_ended");
  } catch (error) {
    recordFailure(state, camera.id, error);
  } finally {
    const current = mjpegCollectors.get(camera.id);
    if (current?.active) current.timer = setTimeout(() => void runMjpegCollector(camera), mjpegReconnectMs);
  }
}

function startMjpegCollectors() {
  for (const camera of CORRIDOR_CAMERAS) {
    if (mjpegCollectors.has(camera.id)) continue;
    mjpegCollectors.set(camera.id, { active: true, timer: null });
    void runMjpegCollector(camera);
  }
}

async function collectLane(camera, calibrations) {
  try {
    const expectedMainLaneCount = Number(calibrations?.[camera.id]?.laneCount);
    const laneCountQuery = Number.isInteger(expectedMainLaneCount) && expectedMainLaneCount > 0
      ? `?mainLaneCount=${expectedMainLaneCount}`
      : "";
    const response = await fetchWithTimeout(`${relayBase}/v1/lanes/${encodeURIComponent(camera.id)}${laneCountQuery}`);
    recordLaneObservation(state, camera.id, await response.json());
  } catch (error) {
    recordLaneObservation(state, camera.id, { ok: false, error: String(error?.message || error) });
  }
}

async function collectAnalysis(camera, calibrations) {
  if (!camera.latestJpeg) return;
  const calibration = calibrations?.[camera.id];
  if (!calibration) {
    return recordAnalysis(state, camera.id, createCameraAnalysis({
      cameraId: camera.id,
      sourceCapturedAt: camera.latestAt ? new Date(camera.latestAt).toISOString() : null,
      calibration: null,
    }));
  }
  try {
    const response = await fetchWithTimeout(`${analysisBase}/analyze?cameraId=${encodeURIComponent(camera.id)}`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Source-Captured-At": new Date(camera.latestAt).toISOString(),
      },
      body: camera.latestJpeg,
    });
    const worker = await response.json();
    if (!worker?.ok) throw new Error(worker?.error || "analysis_rejected");
    const analysis = createCameraAnalysis({
      cameraId: camera.id,
      sourceCapturedAt: worker.sourceCapturedAt || new Date(camera.latestAt).toISOString(),
      calibration,
      detections: worker.detections,
      modelId: worker.modelId,
      inferenceMs: worker.inferenceMs,
      analysedAt: worker.analysedAt,
    });
    analysis.officialVd = buildOfficialLaneReference(calibration, camera.laneObservation);
    recordAnalysis(state, camera.id, analysis);
  } catch (error) {
    recordAnalysisFailure(state, camera.id, error);
  }
}

async function runCollector() {
  if (collecting) return;
  collecting = true;
  try {
    const now = Date.now();
    const calibrations = readCalibrations();
    // A persistent relay subscription provides new frames between polls. Only
    // fall back to a one-shot snapshot when the shared stream is not ready.
    await Promise.all(CORRIDOR_CAMERAS
      .filter((camera) => !state.cameras.get(camera.id)?.latestAt || now - state.cameras.get(camera.id).latestAt > staleAfterMs)
      .map(collectSnapshot));
    if (now - lanesUpdatedAt >= lanePollMs) {
      lanesUpdatedAt = now;
      await Promise.all(CORRIDOR_CAMERAS.map((camera) => collectLane(camera, calibrations)));
    }
    if (now - analysisUpdatedAt >= analysisPollMs) {
      analysisUpdatedAt = now;
      for (const camera of state.cameras.values()) await collectAnalysis(camera, calibrations);
    }
    state.pollCycles += 1;
  } finally {
    collecting = false;
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const basePath = `/v1/corridors/${CORRIDOR_ID}`;
  if (url.pathname === "/health") {
    const status = corridorStatus(state, staleAfterMs);
    return sendJson(response, 200, { ok: status.ok, corridorId: CORRIDOR_ID, collecting, ...status });
  }
  if (url.pathname === basePath) {
    return sendJson(response, 200, { ok: true, corridorId: CORRIDOR_ID, label: CORRIDOR_LABEL, relayBase, analysisBase, ...corridorStatus(state, staleAfterMs) });
  }
  if (url.pathname === `${basePath}/output`) {
    const status = corridorStatus(state, staleAfterMs);
    return sendJson(response, 200, buildCorridorOutput(status, { corridorId: CORRIDOR_ID, label: CORRIDOR_LABEL, relayBase }));
  }
  if (url.pathname === `${basePath}/trip-sessions` && request.method === "GET") {
    return sendJson(response, 200, { ok: true, sessions: tripSessions.list() });
  }
  if (url.pathname === `${basePath}/trip-sessions` && request.method === "POST") {
    return void readJsonBody(request)
      .then((payload) => sendJson(response, 201, { ok: true, session: tripSessions.create(payload) }))
      .catch((error) => sendJson(response, 400, { ok: false, error: String(error?.message || error) }));
  }
  const tripSessionMatch = url.pathname.match(new RegExp(`^${basePath}/trip-sessions/([A-Za-z0-9-]+)$`));
  if (tripSessionMatch && request.method === "GET") {
    const session = tripSessions.get(tripSessionMatch[1]);
    return session ? sendJson(response, 200, { ok: true, session }) : sendJson(response, 404, { ok: false, error: "trip_session_not_found" });
  }
  const tripCaptureMatch = url.pathname.match(new RegExp(`^${basePath}/trip-sessions/([A-Za-z0-9-]+)/capture$`));
  if (tripCaptureMatch && request.method === "POST") {
    return void readJsonBody(request)
      .then((payload) => {
        const output = buildCorridorOutput(corridorStatus(state, staleAfterMs), { corridorId: CORRIDOR_ID, label: CORRIDOR_LABEL, relayBase });
        const session = tripSessions.capture(tripCaptureMatch[1], output, String(payload?.cameraId || ""), payload);
        return session.error ? sendJson(response, 409, { ok: false, error: session.error }) : sendJson(response, 200, { ok: true, session });
      })
      .catch((error) => sendJson(response, 400, { ok: false, error: String(error?.message || error) }));
  }
  const tripFinishMatch = url.pathname.match(new RegExp(`^${basePath}/trip-sessions/([A-Za-z0-9-]+)/finish$`));
  if (tripFinishMatch && request.method === "POST") {
    const session = tripSessions.finish(tripFinishMatch[1]);
    return session.error ? sendJson(response, 404, { ok: false, error: session.error }) : sendJson(response, 200, { ok: true, session });
  }
  if (url.pathname === `${basePath}/calibrations` && request.method === "GET") {
    try {
      const payload = JSON.parse(readFileSync(calibrationFile, "utf8"));
      const summary = validateCalibrationPayload(payload, CORRIDOR_CAMERAS);
      return sendJson(response, 200, { ok: true, ...summary, storedAt: payload.storedAt || null });
    } catch (error) {
      return sendJson(response, 404, { ok: false, error: String(error?.message || error) });
    }
  }
  if (url.pathname === `${basePath}/calibrations` && request.method === "POST") {
    return void readJsonBody(request)
      .then((payload) => sendJson(response, 201, { ok: true, ...writeCalibrationExport(payload), file: "data/calibrations/n3-south-xindian-yangmei-lane-calibration.json" }))
      .catch((error) => sendJson(response, 400, { ok: false, error: String(error?.message || error) }));
  }
  const analysisMatch = url.pathname.match(new RegExp(`^${basePath}/analysis/([A-Za-z0-9_.-]+)$`));
  if (analysisMatch) {
    const camera = state.cameras.get(analysisMatch[1]);
    if (!camera?.analysis) return sendJson(response, 503, { ok: false, error: "analysis_not_ready" });
    return sendJson(response, 200, { ok: true, ...camera.analysis });
  }
  const snapshotMatch = url.pathname.match(new RegExp(`^${basePath}/snapshots/([A-Za-z0-9_.-]+)$`));
  if (snapshotMatch) {
    const camera = state.cameras.get(snapshotMatch[1]);
    if (!camera?.latestJpeg) return sendJson(response, 503, { ok: false, error: "snapshot_not_ready" });
    return sendJpeg(response, camera.latestJpeg);
  }
  if (url.pathname === "/pilot") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return response.end(readFileSync(pilotHtml));
  }
  if (url.pathname === "/report") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return response.end(readFileSync(reportHtml));
  }
  if (url.pathname === "/trip-report") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return response.end(readFileSync(tripReportHtml));
  }
  return sendJson(response, 404, { ok: false, error: "not_found" });
});

startMjpegCollectors();
runCollector().catch(() => {});
setInterval(() => void runCollector(), snapshotPollMs).unref();
server.listen(port, () => console.log(`Corridor Observer listening on :${port}`));
