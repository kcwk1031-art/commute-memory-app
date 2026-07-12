const storageKey = "commute-memory-trips-v2";
const legacyStorageKey = "commute-memory-trips-v1";
const draftStorageKey = "commute-memory-trip-draft-v1";
const uploadEndpointKey = "commute-memory-upload-endpoint";
const defaultUploadEndpoint = "https://script.google.com/macros/s/AKfycbxyCTrMum6RvHmj2n0O5Yh4In8w4uUiGshhLI1ByLx0skZpJJbGQivfBJIl91LtDmc/exec";
const seedTrips = Array.isArray(window.COMMUTE_SEED_TRIPS) ? window.COMMUTE_SEED_TRIPS : [];
const maxStoredTrips = 30;
const maxStoredPoints = 900;
const maxDraftPoints = 700;
const cctvEndpoint = "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Freeway?$format=JSON";
const vdStaticEndpoint = "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/VD/Freeway?$format=JSON";
const vdLiveEndpoint = "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/VD/Freeway?$format=JSON";
const cctvCacheMs = 6 * 60 * 60 * 1000;
const vdStaticCacheMs = 6 * 60 * 60 * 1000;
const vdLiveCacheMs = 60 * 1000;
const cctvMaxDistanceMeters = 1200;
const cctvFallbackDistanceMeters = 5000;
const cctvForwardBearingTolerance = 80;
const cctvAdvanceSwitchMeters = 500;
const minVisionConfidence = 45;
const expectedCommuteMeters = 47000;
const maxReliableAccuracyMeters = 180;
const maxReliableSpeedKmh = 170;

const els = {
  floatingRecorder: document.querySelector("#floatingRecorder"),
  modeRecord: document.querySelector("#modeRecord"),
  modeDrive: document.querySelector("#modeDrive"),
  modeGuidance: document.querySelector("#modeGuidance"),
  modeDashboard: document.querySelector("#modeDashboard"),
  recordViews: document.querySelectorAll(".record-view"),
  driveAssistView: document.querySelector("#driveAssistView"),
  driveAssistRecommendation: document.querySelector("#driveAssistRecommendation"),
  driveAssistDetail: document.querySelector("#driveAssistDetail"),
  driveAssistAlert: document.querySelector("#driveAssistAlert"),
  driveAssistGpsSpeed: document.querySelector("#driveAssistGpsSpeed"),
  driveAssistSpeedLimit: document.querySelector("#driveAssistSpeedLimit"),
  driveAssistVdSpeed: document.querySelector("#driveAssistVdSpeed"),
  driveAssistCctvDistance: document.querySelector("#driveAssistCctvDistance"),
  driveAssistRoad: document.querySelector("#driveAssistRoad"),
  driveAssistCctvFrame: document.querySelector("#driveAssistCctvFrame"),
  driveAssistLaneSpeeds: document.querySelector("#driveAssistLaneSpeeds"),
  guidanceView: document.querySelector("#guidanceView"),
  guidanceToggle: document.querySelector("#guidanceToggle"),
  guidanceTitle: document.querySelector("#guidanceTitle"),
  guidanceSubtitle: document.querySelector("#guidanceSubtitle"),
  guidanceRecommendation: document.querySelector("#guidanceRecommendation"),
  guidanceDirection: document.querySelector("#guidanceDirection"),
  guidanceSegment: document.querySelector("#guidanceSegment"),
  guidanceSpeed: document.querySelector("#guidanceSpeed"),
  guidanceConfidence: document.querySelector("#guidanceConfidence"),
  guidanceNote: document.querySelector("#guidanceNote"),
  loadCctv: document.querySelector("#loadCctv"),
  analyzeCctv: document.querySelector("#analyzeCctv"),
  clearCctv: document.querySelector("#clearCctv"),
  cctvStatus: document.querySelector("#cctvStatus"),
  cctvFrame: document.querySelector("#cctvFrame"),
  cctvAnalysis: document.querySelector("#cctvAnalysis"),
  cctvMeta: document.querySelector("#cctvMeta"),
  restoreBanner: document.querySelector("#restoreBanner"),
  restoreText: document.querySelector("#restoreText"),
  restoreTrip: document.querySelector("#restoreTrip"),
  saveDraftTrip: document.querySelector("#saveDraftTrip"),
  exportDraft: document.querySelector("#exportDraft"),
  discardDraft: document.querySelector("#discardDraft"),
  dashboardView: document.querySelector("#dashboardView"),
  dashboardVerdict: document.querySelector("#dashboardVerdict"),
  dashboardSummary: document.querySelector("#dashboardSummary"),
  dashboardDirections: document.querySelector("#dashboardDirections"),
  autoMode: document.querySelector("#autoMode"),
  driveStatusMain: document.querySelector("#driveStatusMain"),
  driveStatusDetail: document.querySelector("#driveStatusDetail"),
  driveLaneMain: document.querySelector("#driveLaneMain"),
  driveLaneDetail: document.querySelector("#driveLaneDetail"),
  driveTime: document.querySelector("#driveTime"),
  driveKm: document.querySelector("#driveKm"),
  drivePoints: document.querySelector("#drivePoints"),
  startTrip: document.querySelector("#startTrip"),
  stopTrip: document.querySelector("#stopTrip"),
  forceSaveTrip: document.querySelector("#forceSaveTrip"),
  cameraToggle: document.querySelector("#cameraToggle"),
  clearHistory: document.querySelector("#clearHistory"),
  exportJson: document.querySelector("#exportJson"),
  exportCsv: document.querySelector("#exportCsv"),
  uploadLatest: document.querySelector("#uploadLatest"),
  uploadAll: document.querySelector("#uploadAll"),
  uploadEndpoint: document.querySelector("#uploadEndpoint"),
  saveUploadEndpoint: document.querySelector("#saveUploadEndpoint"),
  uploadStatus: document.querySelector("#uploadStatus"),
  recordStatus: document.querySelector("#recordStatus"),
  elapsed: document.querySelector("#elapsed"),
  speed: document.querySelector("#speed"),
  distance: document.querySelector("#distance"),
  pointCount: document.querySelector("#pointCount"),
  cameraFeed: document.querySelector("#cameraFeed"),
  laneCanvas: document.querySelector("#laneCanvas"),
  recordingOverlay: document.querySelector("#recordingOverlay"),
  cameraEmpty: document.querySelector("#cameraEmpty"),
  laneResult: document.querySelector("#laneResult"),
  laneReason: document.querySelector("#laneReason"),
  laneConfidence: document.querySelector("#laneConfidence"),
  cameraSelect: document.querySelector("#cameraSelect"),
  zoomControl: document.querySelector("#zoomControl"),
  zoomSlider: document.querySelector("#zoomSlider"),
  laneCountButtons: document.querySelector("#laneCountButtons"),
  manualLaneButtons: document.querySelector("#manualLaneButtons"),
  flowButtons: document.querySelector("#flowButtons"),
  routeCanvas: document.querySelector("#routeCanvas"),
  routeNote: document.querySelector("#routeNote"),
  historyList: document.querySelector("#historyList"),
};

const state = {
  trip: null,
  watchId: null,
  guidanceWatchId: null,
  autoWatchId: null,
  autoMode: false,
  lastAutoPoint: null,
  lastGuidancePoint: null,
  guidanceActive: false,
  cctvList: [],
  cctvLoadedAt: 0,
  cctvLoading: false,
  lastCctvPoint: null,
  currentCctvId: "",
  currentCctv: null,
  cctvAnalysisBusy: false,
  vdList: [],
  vdLives: new Map(),
  vdLoadedAt: 0,
  vdLiveLoadedAt: 0,
  vdLoading: false,
  vdLiveLoading: false,
  currentVd: null,
  lastDrivePoint: null,
  elapsedTimer: null,
  cameraStream: null,
  laneAnimation: null,
  cameraDevices: [],
  selectedDeviceId: "",
  roadLaneCount: 3,
  currentLaneIndex: null,
  trafficFlow: null,
  lastVisionLane: null,
  targetAnchor: null,
  targetDwellStartedAt: null,
  lastDraftSavedAt: 0,
  lastRouteDrawAt: 0,
  lastFloatingSignature: "",
  pendingDraft: null,
  uploadEndpoint: loadUploadEndpoint(),
  trips: loadTrips(),
};

const commuteAnchors = {
  yangmei: { lat: 24.9186, lng: 121.1458, radiusMeters: 8500, label: "璆???? },
  xindian: { lat: 24.9676, lng: 121.5414, radiusMeters: 6500, label: "?啣???? },
};

state.trips = normalizeTrips(state.trips);

function loadTrips() {
  let storedTrips = [];
  try {
    const current = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(current)) storedTrips = current;
  } catch {}

  if (!storedTrips.length) {
    try {
      const legacy = JSON.parse(localStorage.getItem(legacyStorageKey));
      if (Array.isArray(legacy)) storedTrips = legacy;
    } catch {}
  }

  return mergeTrips(storedTrips, seedTrips);
}

function saveTrips() {
  state.trips = normalizeTrips(state.trips);
  const localTrips = state.trips.filter((trip) => !trip.imported).slice(0, maxStoredTrips);
  const compactTrips = localTrips.map((trip) => compactTripForStorage(trip, maxStoredPoints));
  try {
    localStorage.setItem(storageKey, JSON.stringify(compactTrips));
  } catch (err) {
    const emergencyTrips = compactTrips.slice(0, 12).map((trip) => compactTripForStorage(trip, 350));
    try {
      localStorage.setItem(storageKey, JSON.stringify(emergencyTrips));
      setStatus("撌脖?摮移蝪∠???, "??摰寥?銝雲嚗歇靽?頠?霈??璅??頝?, false);
      setRouteNote("???脣?蝛粹?銝雲嚗甈∪歇?孵?蝎曄陛??撱箄降?菟?敺?箸?銝??);
    } catch {
      setStatus("靽?憭望?", "???汗?典摮征??頞喉?隢??臬?瑼?, true);
      setRouteNote(`靽?憭望?嚗?{err.message || "?汗?典摮征??頞?}`);
      throw err;
    }
  }
}

function saveTripDraft(force = false) {
  if (!state.trip) return;
  const now = Date.now();
  if (!force && now - state.lastDraftSavedAt < 30000 && (state.trip.points.length % 20 !== 0)) return;
  state.trip.summary = summarizeTrip(state.trip);
  try {
    localStorage.setItem(draftStorageKey, JSON.stringify({
      savedAt: new Date().toISOString(),
      trip: compactTripForStorage(state.trip, maxDraftPoints),
      manualState: currentManualState(),
    }));
    state.lastDraftSavedAt = now;
  } catch (err) {
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({
        savedAt: new Date().toISOString(),
        trip: compactTripForStorage(state.trip, 250),
        manualState: currentManualState(),
      }));
      state.lastDraftSavedAt = now;
      setRouteNote("???脣?蝛粹??遛嚗?蝔踹歇?孵?蝎曄陛??);
    } catch {
      setRouteNote(`?阮?怠?憭望?嚗?{err.message || "?汗?典摮征??頞?}`);
    }
  }
}

function loadTripDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(draftStorageKey));
    if (!draft?.trip || isValidTrip(draft.trip)) return draft;
    if ((draft.trip.points || []).length > 0) return draft;
  } catch {}
  return null;
}

function clearTripDraft() {
  localStorage.removeItem(draftStorageKey);
  state.pendingDraft = null;
  state.lastDraftSavedAt = 0;
  els.restoreBanner?.classList.add("is-hidden");
}

function showRestoreDraft() {
  const draft = loadTripDraft();
  if (!draft || state.trip) return;
  state.pendingDraft = draft;
  const trip = draft.trip;
  const summary = trip.summary || summarizeTrip(trip);
  if (els.restoreText) {
    els.restoreText.textContent = `銝?頞? ${summary.minutes} ????{summary.km} km??{summary.points} 暺?撠甇?虜蝯??;
  }
  els.restoreBanner?.classList.remove("is-hidden");
}

function restoreDraftTrip() {
  if (!state.pendingDraft?.trip || state.trip) return;
  const draft = state.pendingDraft;
  state.trip = draft.trip;
  state.trip.summary = summarizeTrip(state.trip);
  state.roadLaneCount = draft.manualState?.roadLaneCount || state.trip.points?.at?.(-1)?.roadLaneCount || state.roadLaneCount;
  state.currentLaneIndex = draft.manualState?.currentLaneIndex || state.trip.points?.at?.(-1)?.manualLane?.laneIndex || null;
  state.trafficFlow = draft.manualState?.trafficFlow || state.trip.points?.at?.(-1)?.trafficFlow || null;
  state.watchId = navigator.geolocation.watchPosition(handlePosition, handleGeoError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 12000,
  });
  state.elapsedTimer = window.setInterval(updateElapsed, 1000);
  els.startTrip.disabled = true;
  els.stopTrip.disabled = false;
  buildManualLaneButtons();
  updateSegmentedState();
  setStatus("撌脫敺拍???, "GPS 頠楚甇?蝥神", true);
  updateElapsed();
  updateRecordingOverlay();
  drawRoute();
  saveTripDraft(true);
  els.restoreBanner?.classList.add("is-hidden");
}

function mergeTrips(primaryTrips, secondaryTrips) {
  const seen = new Set();
  return [...(primaryTrips || []), ...(secondaryTrips || [])].filter((trip) => {
    const id = String(trip?.id || trip?.startedAt || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function compactTripForStorage(trip, maxPoints = maxStoredPoints) {
  const copy = {
    ...trip,
    points: samplePoints(trip.points || [], maxPoints),
    laneSamples: compactLaneSamples(trip.laneSamples || []),
    events: (trip.events || []).slice(-250),
  };
  copy.summary = summarizeTrip(copy);
  return copy;
}

function samplePoints(points, maxPoints) {
  if (!Array.isArray(points) || points.length <= maxPoints) return points || [];
  const step = Math.ceil(points.length / maxPoints);
  const sampled = points.filter((_, index) => index % step === 0);
  const last = points.at(-1);
  if (last && sampled.at(-1) !== last) sampled.push(last);
  return sampled;
}

function compactLaneSamples(samples) {
  const compacted = [];
  for (const sample of samples || []) {
    const previous = compacted.at(-1);
    if (
      previous &&
      previous.lane === sample.lane &&
      previous.flow === sample.flow &&
      previous.roadLaneCount === sample.roadLaneCount &&
      previous.source === sample.source
    ) {
      previous.until = sample.at;
      previous.count = (previous.count || 1) + 1;
      continue;
    }
    compacted.push({ ...sample, count: 1 });
  }
  return compacted.slice(-900);
}

function normalizeTrips(trips) {
  const seen = new Set();
  return (trips || []).filter((trip) => {
    if (!isValidTrip(trip)) return false;
    const id = String(trip.id || trip.startedAt || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    trip.direction = inferTripDirection(trip);
    trip.summary = summarizeTrip(trip);
    return true;
  });
}

function isValidTrip(trip) {
  return Boolean(trip?.startedAt || trip?.id);
}

function loadUploadEndpoint() {
  return defaultUploadEndpoint;
}

function saveUploadEndpoint() {
  if (!els.uploadEndpoint) return;
  state.uploadEndpoint = els.uploadEndpoint.value.trim();
  if (state.uploadEndpoint) {
    localStorage.setItem(uploadEndpointKey, state.uploadEndpoint);
    setUploadStatus("撌脣摮??喟雯?嚗?敺???蝔??芸?銝??);
  } else {
    localStorage.removeItem(uploadEndpointKey);
    setUploadStatus("撌脫??支??喟雯???);
  }
}

function toggleAutoMode() {
  if (state.autoMode) {
    stopAutoMode();
    return;
  }

  if (!navigator.geolocation) {
    setRouteNote("甇斤汗?其??舀摰????);
    return;
  }

  state.autoMode = true;
  state.autoWatchId = navigator.geolocation.watchPosition(handleAutoPosition, handleGeoError, {
    enableHighAccuracy: true,
    maximumAge: 1500,
    timeout: 12000,
  });

  els.autoMode.textContent = "???芸?璅∪?";
  setStatus("?芸????銝?, "?亥???????蝑?, true);
  setRouteNote("?芸?璅∪?撌脣????ａ?璆???蒂敺?啣??孵?蝘餃????芸???蝝??);
  updateRecordingOverlay();
}

function stopAutoMode() {
  if (state.autoWatchId !== null) navigator.geolocation.clearWatch(state.autoWatchId);
  state.autoWatchId = null;
  state.autoMode = false;
  state.lastAutoPoint = null;
  els.autoMode.textContent = "???芸?璅∪?";

  if (!state.trip) setStatus("撠蝝??, "蝑???摰?", false);
  setRouteNote("?芸?璅∪?撌脤???);
  updateRecordingOverlay();
}

function handleAutoPosition(pos) {
  const point = gpsPointFromPosition(pos);
  const kmh = point.speed === null && state.lastAutoPoint
    ? estimatePointSpeed(state.lastAutoPoint, point)
    : (point.speed || 0) * 3.6;
  const distanceFromYangmei = distanceBetween(commuteAnchors.yangmei, point);
  const distanceFromXindian = distanceBetween(commuteAnchors.xindian, point);
  const movingToXindian = state.lastAutoPoint
    ? distanceBetween(state.lastAutoPoint, commuteAnchors.xindian) > distanceFromXindian
    : true;
  const movingToYangmei = state.lastAutoPoint
    ? distanceBetween(state.lastAutoPoint, commuteAnchors.yangmei) > distanceFromYangmei
    : true;

  if (!state.trip) {
    const nearYangmei = distanceFromYangmei <= commuteAnchors.yangmei.radiusMeters;
    const nearXindian = distanceFromXindian <= commuteAnchors.xindian.radiusMeters;
    if (nearYangmei && movingToXindian && kmh >= 8) {
      state.targetAnchor = "xindian";
      state.targetDwellStartedAt = null;
      startTrip({ source: "auto", direction: "yangmei_to_xindian", targetAnchor: "xindian" });
      handlePosition(pos);
    } else if (nearXindian && movingToYangmei && kmh >= 8) {
      state.targetAnchor = "yangmei";
      state.targetDwellStartedAt = null;
      startTrip({ source: "auto", direction: "xindian_to_yangmei", targetAnchor: "yangmei" });
      handlePosition(pos);
    } else {
      setRouteNote(`?芸????銝哨?頝?璇? ${(distanceFromYangmei / 1000).toFixed(1)} ?祇?嚗??啣?蝝?${(distanceFromXindian / 1000).toFixed(1)} ?祇??);
    }
  } else {
    handlePosition(pos);
    if (shouldAutoStop(point, kmh)) {
      stopTrip("auto");
    }
  }

  state.lastAutoPoint = point;
}

function shouldAutoStop(point, kmh) {
  if (!state.trip?.targetAnchor) return false;
  const target = commuteAnchors[state.trip.targetAnchor];
  if (!target) return false;

  const elapsedMs = Date.now() - new Date(state.trip.startedAt).getTime();
  const farEnough = state.trip.distanceMeters > 3000;
  const longEnough = elapsedMs > 5 * 60 * 1000;
  const nearTarget = distanceBetween(target, point) <= target.radiusMeters;

  if (!nearTarget || !farEnough || !longEnough) {
    state.targetDwellStartedAt = null;
    return false;
  }

  const slowEnough = kmh < 8;
  if (!slowEnough) {
    state.targetDwellStartedAt = null;
    return false;
  }

  if (!state.targetDwellStartedAt) state.targetDwellStartedAt = Date.now();
  return Date.now() - state.targetDwellStartedAt > 2 * 60 * 1000;
}

function startTrip(options = {}) {
  if (!navigator.geolocation) {
    setRouteNote("甇斤汗?其??舀摰????);
    return;
  }

  state.trip = {
    id: Date.now(),
    startedAt: new Date().toISOString(),
    source: options.source || "manual",
    direction: options.direction || "manual",
    targetAnchor: options.targetAnchor || null,
    endedAt: null,
    points: [],
    laneSamples: [],
    events: [],
    distanceMeters: 0,
  };

  recordEvent("settings", currentManualState());
  saveTripDraft(true);
  els.startTrip.disabled = true;
  els.stopTrip.disabled = false;
  setStatus("蝝?葉", options.source === "auto" ? "?芸?璅∪?撌脤?蝑? : "GPS 頠楚甇?撖怠", true);
  updateElapsed();

  if (options.source !== "auto") {
    try {
      state.watchId = navigator.geolocation.watchPosition(handlePosition, handleGeoError, {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 12000,
      });
    } catch (err) {
      setRouteNote(`摰???憭望?嚗??阮撌脣遣蝡?${err.message}`);
      setStatus("摰??芸???, "?舐?敺?閰佗??桀??阮撌脖???, true);
    }
  }

  state.elapsedTimer = window.setInterval(updateElapsed, 1000);
}

function stopTrip(source = "manual") {
  if (!state.trip) {
    saveRecoverableTrip();
    return;
  }
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  window.clearInterval(state.elapsedTimer);

  saveTripDraft(true);
  state.trip.endedAt = new Date().toISOString();
  state.trip.direction = inferTripDirection(state.trip);
  state.trip.summary = summarizeTrip(state.trip);
  const finishedTrip = state.trip;
  state.trips.unshift(finishedTrip);
  try {
    saveTrips();
  } catch {
    saveTripDraft(true);
    els.startTrip.disabled = false;
    els.stopTrip.disabled = false;
    setStatus("撠靽?", "???脣?蝛粹?銝雲嚗?蝔蹂?靽?嚗?????臬", true);
    renderHistory();
    drawRoute(true);
    updateRecordingOverlay();
    return;
  }
  if (state.uploadEndpoint) {
    void uploadTrip(finishedTrip, "蝯?敺????);
  }
  clearTripDraft();

  state.trip = null;
  state.watchId = null;
  state.elapsedTimer = null;
  state.targetAnchor = null;
  state.targetDwellStartedAt = null;
  els.startTrip.disabled = false;
  els.stopTrip.disabled = false;

  if (state.autoMode && source === "auto") {
    setStatus("?芸????銝?, "銝?頞歇靽?嚗?敺?銝頞?, true);
  } else {
    setStatus("撌脣?????, "撌脖?摮?祆?甇瑕鞈?", false);
  }
  renderHistory();
  drawRoute();
  updateRecordingOverlay();
}

function handlePosition(pos) {
  if (!state.trip) return;

  const point = gpsPointFromPosition(pos);
  const effectiveLane = getEffectiveLane();
  const lastPoint = state.trip.points.at(-1);
  enrichMovementPoint(point, lastPoint);
  point.visionLane = state.lastVisionLane;
  point.manualLane = state.currentLaneIndex ? manualLaneSnapshot() : null;
  point.effectiveLane = effectiveLane;
  point.roadLaneCount = state.roadLaneCount;
  point.trafficFlow = state.trafficFlow;

  if (lastPoint) {
    const gap = distanceBetween(lastPoint, point);
    if (gap < 350) state.trip.distanceMeters += gap;
  }

  state.trip.points.push(point);
  saveTripDraft();
  if (effectiveLane) {
    state.trip.laneSamples.push({
      at: point.at,
      lane: effectiveLane.label,
      source: effectiveLane.source,
      confidence: effectiveLane.confidence,
      roadLaneCount: state.roadLaneCount,
      laneIndex: effectiveLane.laneIndex ?? null,
      flow: state.trafficFlow,
    });
  }

  updateMetrics(point);
  drawRoute();
  updateRecordingOverlay();
  state.lastDrivePoint = point;
  if (state.cctvList.length && state.currentCctvId) {
    const direction = inferTripDirection(state.trip);
    renderNearestCctv(point, direction);
  }
  void refreshDriveAssist(point, inferTripDirection(state.trip));
}

function gpsPointFromPosition(pos) {
  return {
    at: new Date().toISOString(),
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    speed: typeof pos.coords.speed === "number" ? pos.coords.speed : null,
    heading: typeof pos.coords.heading === "number" && pos.coords.heading >= 0 ? pos.coords.heading : null,
    movementStatus: "unknown",
    possibleLaneShift: "none",
    shiftConfidence: "",
  };
}

function enrichMovementPoint(point, lastPoint) {
  const rawKmh = point.speed === null || point.speed === undefined
    ? (lastPoint ? estimatePointSpeed(lastPoint, point) : 0)
    : point.speed * 3.6;
  const kmh = isReliableSpeed(rawKmh) ? rawKmh : NaN;

  point.movementStatus = movementStatus(kmh);
  if (!lastPoint) return;

  const meters = distanceBetween(lastPoint, point);
  if (meters > 450) return;
  point.heading = Number(bearingBetween(lastPoint, point).toFixed(1));

  if (lastPoint.heading === null || lastPoint.heading === undefined) return;
  if (point.accuracy > 25 || meters < 6 || meters > 120 || kmh < 15) return;

  const delta = angleDelta(lastPoint.heading, point.heading);
  if (Math.abs(delta) < 8) return;

  point.possibleLaneShift = delta > 0 ? "right" : "left";
  point.shiftConfidence = Math.abs(delta) >= 15 && point.accuracy <= 15 ? "medium" : "low";
}

function movementStatus(kmh) {
  if (!Number.isFinite(kmh)) return "unknown";
  if (kmh < 3) return "stopped";
  if (kmh < 15) return "slow";
  return "moving";
}

function handleGeoError(err) {
  setRouteNote(`摰??⊥???嚗?{err.message}`);
  els.startTrip.disabled = Boolean(state.trip);
  els.stopTrip.disabled = false;
  if (state.trip) {
    saveTripDraft(true);
    setStatus("摰??急?憭望?", "?阮撌脖????舐???摮??", true);
  } else {
    setStatus("摰?憭望?", "隢Ⅱ隤汗?典?雿???, false);
  }
}

async function toggleCamera() {
  if (state.cameraStream) {
    stopCamera();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    els.laneReason.textContent = "甇斤汗?其??舀?豢?甈???;
    return;
  }

  await startCamera();
}

async function startCamera() {
  try {
    const video = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    };
    if (state.selectedDeviceId) {
      video.deviceId = { exact: state.selectedDeviceId };
    } else {
      video.facingMode = { ideal: "environment" };
    }

    state.cameraStream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    els.cameraToggle.closest(".lane-panel")?.classList.add("camera-active");
    els.cameraFeed.srcObject = state.cameraStream;
    await els.cameraFeed.play();
    els.cameraEmpty.style.display = "none";
    els.cameraToggle.textContent = "???豢?撖阡?";
    await refreshCameraDevices();
    setupZoomControl();
    analyzeLaneFrame();
  } catch (err) {
    els.laneResult.textContent = "?豢??芸???;
    els.laneReason.textContent = `隢Ⅱ隤璈???${err.message}`;
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
  }
  state.cameraStream = null;
  window.cancelAnimationFrame(state.laneAnimation);
  els.cameraFeed.srcObject = null;
  els.cameraToggle.closest(".lane-panel")?.classList.remove("camera-active");
  els.cameraEmpty.style.display = "grid";
  els.cameraToggle.textContent = "?豢?撖阡??";
  els.laneResult.textContent = getEffectiveLane()?.label || "撠鞈?";
  els.laneConfidence.textContent = "靽∪?摨?--";
  els.zoomControl.classList.add("is-hidden");
  updateRecordingOverlay();
}

async function refreshCameraDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  state.cameraDevices = devices.filter((device) => device.kind === "videoinput");
  const currentTrack = state.cameraStream?.getVideoTracks()[0];
  const currentDeviceId = currentTrack?.getSettings?.().deviceId || state.selectedDeviceId;

  els.cameraSelect.innerHTML = `<option value="">?芸?敺??/option>`;
  state.cameraDevices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `?⊿ ${index + 1}`;
    if (device.deviceId === currentDeviceId) option.selected = true;
    els.cameraSelect.appendChild(option);
  });
}

function setupZoomControl() {
  const track = state.cameraStream?.getVideoTracks()[0];
  const capabilities = track?.getCapabilities?.();
  const settings = track?.getSettings?.();
  if (!capabilities?.zoom) {
    els.zoomControl.classList.add("is-hidden");
    return;
  }

  els.zoomControl.classList.remove("is-hidden");
  els.zoomSlider.min = capabilities.zoom.min ?? 1;
  els.zoomSlider.max = capabilities.zoom.max ?? 4;
  els.zoomSlider.step = capabilities.zoom.step ?? 0.1;
  els.zoomSlider.value = settings?.zoom ?? capabilities.zoom.min ?? 1;
}

async function applyZoom() {
  const track = state.cameraStream?.getVideoTracks()[0];
  if (!track?.applyConstraints) return;
  try {
    await track.applyConstraints({ advanced: [{ zoom: Number(els.zoomSlider.value) }] });
  } catch {
    els.laneReason.textContent = "甇日?凋??舀?汗?函葬?暹?塚??舀?詨隞?准?;
  }
}

async function switchCamera() {
  state.selectedDeviceId = els.cameraSelect.value;
  if (!state.cameraStream) return;
  stopCamera();
  await startCamera();
}

function analyzeLaneFrame() {
  if (!state.cameraStream) return;
  const video = els.cameraFeed;
  const canvas = els.laneCanvas;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width));
  const height = Math.max(200, Math.round(rect.height));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  drawVideoContained(ctx, video, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const result = detectLanePosition(image, width, height);
  drawLaneOverlay(ctx, width, height, result);
  setLaneResult(result);

  state.laneAnimation = window.requestAnimationFrame(analyzeLaneFrame);
}

function drawVideoContained(ctx, video, width, height) {
  ctx.fillStyle = "#111b18";
  ctx.fillRect(0, 0, width, height);

  const sourceWidth = video.videoWidth || width;
  const sourceHeight = video.videoHeight || height;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const offsetX = (width - drawWidth) / 2;
  const offsetY = (height - drawHeight) / 2;
  ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
}

function detectLanePosition(image, width, height) {
  const data = image.data;
  const yStart = Math.floor(height * 0.48);
  const yEnd = Math.floor(height * 0.90);
  const xStart = Math.floor(width * 0.08);
  const xEnd = Math.floor(width * 0.92);
  const bucketCount = 36;
  const buckets = Array.from({ length: bucketCount }, () => 0);
  const center = width / 2;

  for (let y = yStart + 2; y < yEnd; y += 2) {
    const weight = 1 + ((y - yStart) / (yEnd - yStart));
    for (let x = xStart + 2; x < xEnd - 2; x += 2) {
      const idx = (y * width + x) * 4;
      const leftIdx = (y * width + x - 2) * 4;
      const rightIdx = (y * width + x + 2) * 4;
      const lum = luminance(data, idx);
      const leftLum = luminance(data, leftIdx);
      const rightLum = luminance(data, rightIdx);
      const contrast = Math.abs(lum - leftLum) + Math.abs(lum - rightLum);
      const isWhiteLine = lum > 145 && contrast > 42;
      const isYellowLine = data[idx] > 135 && data[idx + 1] > 105 && data[idx + 2] < 105 && contrast > 35;
      if (isWhiteLine || isYellowLine) {
        const bucket = Math.min(bucketCount - 1, Math.floor((x / width) * bucketCount));
        buckets[bucket] += weight;
      }
    }
  }

  const peaks = buckets
    .map((score, index) => ({ score, index, x: ((index + .5) / bucketCount) * width }))
    .filter((item) => item.score > 18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .sort((a, b) => a.x - b.x);

  let left = null;
  let right = null;
  for (const peak of peaks) {
    if (peak.x < center && (!left || peak.x > left.x)) left = peak;
    if (peak.x > center && (!right || peak.x < right.x)) right = peak;
  }

  const scoreTotal = peaks.reduce((sum, item) => sum + item.score, 0);
  let offset = 0;
  if (left && right) {
    const laneCenter = (left.x + right.x) / 2;
    offset = (center - laneCenter) / Math.max(1, right.x - left.x);
  } else if (left) {
    offset = -0.28;
  } else if (right) {
    offset = 0.28;
  }

  const pairedBonus = left && right ? 36 : 10;
  const peakBonus = Math.min(28, scoreTotal / 16);
  const symmetryPenalty = left && right ? Math.min(16, Math.abs(offset) * 24) : 8;
  const confidence = Math.max(0, Math.min(92, Math.round(pairedBonus + peakBonus - symmetryPenalty)));
  const valid = confidence >= minVisionConfidence;
  let lane = "敶勗?靽∪?銝雲";
  if (valid) {
    lane = "銝剔????葉憭?;
    if (offset > .18) lane = "??蝺??喳頠?";
    if (offset < -.18) lane = "?蝺?撌血頠?";
  }

  return {
    left,
    right,
    peaks,
    offset,
    lane,
    confidence,
    valid,
    visibleLineCount: peaks.length,
  };
}

function luminance(data, idx) {
  return data[idx] * .299 + data[idx + 1] * .587 + data[idx + 2] * .114;
}

function drawLaneOverlay(ctx, width, height, result) {
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(els.cameraFeed, 0, 0, width, height);
  ctx.fillStyle = "rgba(0, 0, 0, .20)";
  ctx.fillRect(0, Math.floor(height * .48), width, Math.floor(height * .42));

  ctx.strokeStyle = result.valid ? "#f2c94c" : "rgba(242, 201, 76, .45)";
  ctx.lineWidth = 4;
  for (const peak of result.peaks) {
    ctx.beginPath();
    ctx.moveTo(peak.x, height * .48);
    ctx.lineTo(peak.x, height * .90);
    ctx.stroke();
  }

  ctx.strokeStyle = "#39d2a5";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(width / 2, height * .52);
  ctx.lineTo(width / 2, height * .94);
  ctx.stroke();

  const label = getEffectiveLane()?.label || result.lane;
  ctx.fillStyle = result.valid || state.currentLaneIndex ? "rgba(8, 78, 67, .92)" : "rgba(163, 61, 47, .9)";
  ctx.fillRect(12, 12, Math.min(390, width - 24), 58);
  ctx.fillStyle = "#fff";
  ctx.font = "700 18px Microsoft JhengHei, sans-serif";
  ctx.fillText(label, 26, 47);
}

function setLaneResult(result) {
  state.lastVisionLane = {
    lane: result.lane,
    valid: result.valid,
    confidence: result.confidence,
    offset: Number(result.offset.toFixed(2)),
    visibleLineCount: result.visibleLineCount,
  };

  const effective = getEffectiveLane();
  els.laneResult.textContent = effective?.label || result.lane;
  els.laneConfidence.textContent = `靽∪?摨?${result.confidence}%`;

  if (state.currentLaneIndex) {
    els.laneReason.textContent = `?桀?隞交????皞?敶勗??芸?頛?閬???${result.visibleLineCount}嚗蔣?縑敹?${result.confidence}%?;
  } else if (result.valid) {
    els.laneReason.textContent = `敶勗??菜葫?舐嚗閬???${result.visibleLineCount}?;
  } else {
    els.laneReason.textContent = `敶勗?靽∪?銝雲嚗撖怠??頠??遣霅唳?⊿?矽蝮格嚗??冽??????;
  }
}

function setRoadLaneCount(count) {
  state.roadLaneCount = count;
  if (state.currentLaneIndex && state.currentLaneIndex > count) state.currentLaneIndex = count;
  buildManualLaneButtons();
  updateSegmentedState();
  recordEvent("road_lane_count", { count });
  saveTripDraft(true);
}

function setManualLane(index) {
  state.currentLaneIndex = state.currentLaneIndex === index ? null : index;
  updateSegmentedState();
  recordEvent("manual_lane", state.currentLaneIndex ? manualLaneSnapshot() : null);
  const effective = getEffectiveLane();
  if (effective) {
    els.laneResult.textContent = effective.label;
    els.laneReason.textContent = "撌脣???????閮?敺? GPS 暺?銝雿萎?摮?;
  }
  saveTripDraft(true);
}

function setTrafficFlow(flow) {
  state.trafficFlow = state.trafficFlow === flow ? null : flow;
  updateSegmentedState();
  recordEvent("traffic_flow", { flow: state.trafficFlow });
  saveTripDraft(true);
}

function currentManualState() {
  return {
    roadLaneCount: state.roadLaneCount,
    manualLane: state.currentLaneIndex ? manualLaneSnapshot() : null,
    trafficFlow: state.trafficFlow,
  };
}

function manualLaneSnapshot() {
  return {
    laneIndex: state.currentLaneIndex,
    roadLaneCount: state.roadLaneCount,
    label: manualLaneLabel(state.currentLaneIndex, state.roadLaneCount),
  };
}

function getEffectiveLane() {
  if (state.currentLaneIndex) {
    return {
      label: manualLaneLabel(state.currentLaneIndex, state.roadLaneCount),
      source: "manual",
      confidence: 100,
      laneIndex: state.currentLaneIndex,
    };
  }
  if (state.lastVisionLane?.valid) {
    return {
      label: state.lastVisionLane.lane,
      source: "vision",
      confidence: state.lastVisionLane.confidence,
      laneIndex: null,
    };
  }
  return null;
}

function manualLaneLabel(index, count) {
  if (!index) return "?芣?閮?;
  const side = index === 1 ? "?批" : index === count ? "憭" : "銝剝?";
  return `蝚?${index}/${count} 頠?嚗?{side}嚗;
}

function flowLabel(flow) {
  return {
    left_faster: "撌衣?頛翰",
    same: "撌桐?憭?,
    right_faster: "?喟?頛翰",
  }[flow] || "";
}

function sourceLabel(source) {
  return {
    manual: "??",
    vision: "敶勗?",
    history: "甇瑕",
    system: "蝟餌絞",
  }[source] || "鞈?";
}

function recordEvent(type, value) {
  if (!state.trip) return;
  state.trip.events.push({
    at: new Date().toISOString(),
    type,
    value,
  });
}

function buildLaneCountButtons() {
  els.laneCountButtons.innerHTML = "";
  els.laneCountButtons.style.setProperty("--button-count", "5");
  [2, 3, 4, 5, 6].forEach((count) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${count} 蝺;
    button.dataset.laneCount = String(count);
    button.addEventListener("click", () => setRoadLaneCount(count));
    els.laneCountButtons.appendChild(button);
  });
}

function buildManualLaneButtons() {
  els.manualLaneButtons.innerHTML = "";
  els.manualLaneButtons.style.setProperty("--button-count", String(state.roadLaneCount));
  for (let i = 1; i <= state.roadLaneCount; i += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = laneButtonLabel(i, state.roadLaneCount);
    button.dataset.laneIndex = String(i);
    button.addEventListener("click", () => setManualLane(i));
    els.manualLaneButtons.appendChild(button);
  }
}

function laneButtonLabel(index, count) {
  if (index === 1) return "??;
  if (index === count) return "憭?;
  if (count === 3) return "銝?;
  return `銝?{index - 1}`;
}

function updateSegmentedState() {
  els.laneCountButtons.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.laneCount) === state.roadLaneCount);
  });
  els.manualLaneButtons.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.laneIndex) === state.currentLaneIndex);
  });
  els.flowButtons.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.flow === state.trafficFlow);
  });
}

function updateMetrics(point) {
  const rawSpeedKmh = point.speed === null ? estimateSpeed() : point.speed * 3.6;
  const speedKmh = isReliableSpeed(rawSpeedKmh) ? rawSpeedKmh : NaN;
  els.speed.textContent = Number.isFinite(speedKmh) ? `${speedKmh.toFixed(0)} km/h` : "-- km/h";
  els.distance.textContent = `${(state.trip.distanceMeters / 1000).toFixed(1)} km`;
  els.pointCount.textContent = String(state.trip.points.length);
  const laneText = point.effectiveLane ? `嚗????${point.effectiveLane.label}` : "";
  setRouteNote(`?餈?雿移摨衣? ${Math.round(point.accuracy)} ?砍偕${laneText}`);
  updateDriveConsole();
}

function updateElapsed() {
  if (!state.trip) return;
  const seconds = Math.floor((Date.now() - new Date(state.trip.startedAt).getTime()) / 1000);
  const min = String(Math.floor(seconds / 60)).padStart(2, "0");
  const sec = String(seconds % 60).padStart(2, "0");
  els.elapsed.textContent = `${min}:${sec}`;
  updateRecordingOverlay();
}

function updateRecordingOverlay() {
  if (!state.trip) {
    if (els.recordingOverlay) {
      els.recordingOverlay.textContent = "撠蝝??;
      els.recordingOverlay.classList.remove("is-recording");
    }
    updateFloatingRecorder(false, "?芰???, state.autoMode ? "?芸?璅∪?敺" : "GPS 敺");
    updateDriveConsole();
    return;
  }

  const seconds = Math.floor((Date.now() - new Date(state.trip.startedAt).getTime()) / 1000);
  const min = String(Math.floor(seconds / 60)).padStart(2, "0");
  const sec = String(seconds % 60).padStart(2, "0");
  const km = (state.trip.distanceMeters / 1000).toFixed(1);
  const points = state.trip.points.length;
  const lane = getEffectiveLane()?.label || "頠??芣?閮?;
  const detail = `${min}:${sec}嚚?{km} km嚚?{points} 暺?${lane}`;
  if (els.recordingOverlay) {
    els.recordingOverlay.textContent = `蝝?葉 ${detail}`;
    els.recordingOverlay.classList.add("is-recording");
  }
  updateFloatingRecorder(true, "蝝?葉", detail);
  updateDriveConsole();
}

function updateDriveConsole() {
  if (!els.driveStatusMain) return;

  if (!state.trip) {
    els.driveStatusMain.textContent = state.autoMode ? "?芸?敺" : "敺";
    els.driveStatusDetail.textContent = state.autoMode ? "?亥??韏琿?敺??芸???" : "????敺?靽? GPS ??????;
    els.driveLaneMain.textContent = "?芣?閮?;
    els.driveLaneDetail.textContent = "?舐銝????璅??改?銝哨?憭?";
    els.driveTime.textContent = "00:00";
    els.driveKm.textContent = "0.0 km";
    els.drivePoints.textContent = "0";
    return;
  }

  const seconds = Math.floor((Date.now() - new Date(state.trip.startedAt).getTime()) / 1000);
  const min = String(Math.floor(seconds / 60)).padStart(2, "0");
  const sec = String(seconds % 60).padStart(2, "0");
  const lane = getEffectiveLane();
  const lastPoint = state.trip.points.at(-1);
  els.driveStatusMain.textContent = "蝝?葉";
  els.driveStatusDetail.textContent = lastPoint
    ? `?餈?雿移摨衣? ${Math.round(lastPoint.accuracy || 0)} ?砍偕`
    : "蝑?蝚砌???GPS 摰?暺?;
  els.driveLaneMain.textContent = lane?.label || "?芣?閮?;
  els.driveLaneDetail.textContent = lane
    ? `${sourceLabel(lane.source)}嚚?{state.roadLaneCount} 蝺?`
    : "撱箄降??璅?嚗?璈?靽∪?隤文";
  els.driveTime.textContent = `${min}:${sec}`;
  els.driveKm.textContent = `${(state.trip.distanceMeters / 1000).toFixed(1)} km`;
  els.drivePoints.textContent = String(state.trip.points.length);
}

function updateFloatingRecorder(active, title, detail) {
  if (!els.floatingRecorder) return;
  const signature = `${active}|${title}|${detail}`;
  if (state.lastFloatingSignature === signature) return;
  state.lastFloatingSignature = signature;
  els.floatingRecorder.classList.toggle("is-recording", active);
  els.floatingRecorder.querySelector("strong").textContent = title;
  els.floatingRecorder.querySelector("small").textContent = detail;
}

function estimateSpeed() {
  const points = state.trip?.points || [];
  if (points.length < 2) return NaN;
  const a = points.at(-2);
  const b = points.at(-1);
  return reliablePointSpeed(a, b);
}

function estimatePointSpeed(a, b) {
  return reliablePointSpeed(a, b);
}

function reliablePointSpeed(a, b) {
  const meters = distanceBetween(a, b);
  const seconds = (new Date(b.at).getTime() - new Date(a.at).getTime()) / 1000;
  if (seconds <= 0 || seconds < 1) return NaN;
  if (meters > 450) return NaN;
  const kmh = (meters / seconds) * 3.6;
  return isReliableSpeed(kmh) ? kmh : NaN;
}

function isReliableSpeed(kmh) {
  return Number.isFinite(kmh) && kmh >= 0 && kmh <= maxReliableSpeedKmh;
}

function bearingBetween(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const deltaLng = toRad(b.lng - a.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angleDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function distanceBetween(a, b) {
  const earth = 6371000;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const deltaLat = toRad(b.lat - a.lat);
  const deltaLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return earth * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(value) {
  return value * Math.PI / 180;
}

function inferTripDirection(trip) {
  if (trip.direction && trip.direction !== "manual") return trip.direction;
  const points = trip.points || [];
  if (points.length < 2) return trip.direction || "manual";

  const first = points[0];
  const last = points[points.length - 1];
  const startYangmei = distanceBetween(first, commuteAnchors.yangmei);
  const startXindian = distanceBetween(first, commuteAnchors.xindian);
  const endYangmei = distanceBetween(last, commuteAnchors.yangmei);
  const endXindian = distanceBetween(last, commuteAnchors.xindian);
  const startAnchor = startYangmei <= startXindian ? "yangmei" : "xindian";
  const endAnchor = endYangmei <= endXindian ? "yangmei" : "xindian";

  if (startAnchor === "yangmei" && endAnchor === "xindian") return "yangmei_to_xindian";
  if (startAnchor === "xindian" && endAnchor === "yangmei") return "xindian_to_yangmei";
  return trip.direction || "manual";
}

function drawRoute(force = false) {
  const canvas = els.routeCanvas;
  const ctx = canvas.getContext("2d");
  const points = state.trip?.points || [];
  const now = Date.now();
  if (!force && points.length > 80 && now - state.lastRouteDrawAt < 1500) return;
  state.lastRouteDrawAt = now;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawRouteGrid(ctx, canvas.width, canvas.height);

  if (points.length < 2) return;

  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const pad = 28;
  const lngSpan = maxLng - minLng || .001;
  const latSpan = maxLat - minLat || .001;
  const project = (point) => ({
    x: pad + ((point.lng - minLng) / lngSpan) * (canvas.width - pad * 2),
    y: canvas.height - pad - ((point.lat - minLat) / latSpan) * (canvas.height - pad * 2),
  });

  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#0b6f5c";
  ctx.beginPath();
  points.forEach((point, index) => {
    const pos = project(point);
    if (index === 0) ctx.moveTo(pos.x, pos.y);
    else ctx.lineTo(pos.x, pos.y);
  });
  ctx.stroke();

  for (const point of points) {
    const speed = point.speed === null ? null : point.speed * 3.6;
    if (speed !== null && speed < 12) {
      const pos = project(point);
      ctx.fillStyle = "rgba(163, 61, 47, .75)";
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawRouteGrid(ctx, width, height) {
  ctx.fillStyle = "#eef3ed";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#d5ddd4";
  ctx.lineWidth = 1;
  for (let x = 40; x < width; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 40; y < height; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function summarizeTrip(trip) {
  const started = new Date(trip.startedAt).getTime();
  const ended = trip.endedAt ? new Date(trip.endedAt).getTime() : Date.now();
  const minutes = Math.max(0, Math.round((ended - started) / 60000));
  const laneCounts = (trip.laneSamples || []).reduce((acc, sample) => {
    acc[sample.lane] = (acc[sample.lane] || 0) + (sample.count || 1);
    return acc;
  }, {});
  const mainLane = Object.entries(laneCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "?⊥???????;
  const manualSamples = (trip.laneSamples || [])
    .filter((sample) => sample.source === "manual")
    .reduce((sum, sample) => sum + (sample.count || 1), 0);
  const visionSamples = (trip.laneSamples || [])
    .filter((sample) => sample.source === "vision")
    .reduce((sum, sample) => sum + (sample.count || 1), 0);
  const lastPoint = trip.points?.at?.(-1);
  return {
    minutes,
    km: Number(((trip.distanceMeters || 0) / 1000).toFixed(1)),
    points: trip.points?.length || 0,
    laneSamples: (trip.laneSamples || []).reduce((sum, sample) => sum + (sample.count || 1), 0),
    manualSamples,
    visionSamples,
    mainLane,
    roadLaneCount: lastPoint?.roadLaneCount || "",
    lastFlow: lastPoint?.trafficFlow || "",
  };
}

function renderHistory() {
  if (!state.trips.length) {
    els.historyList.innerHTML = `<div class="empty-history">?桀?瘝?甇瑕鞈????洵銝頞??＊蝷箏?ㄐ??/div>`;
    renderDashboard();
    return;
  }

  els.historyList.innerHTML = state.trips.map((trip) => {
    const started = new Date(trip.startedAt);
    const summary = trip.summary || summarizeTrip(trip);
    return `
      <div class="history-row">
        <strong>${formatDate(started)}</strong>
        <span>${summary.minutes} ??</span>
        <span>${summary.km} ?祇?</span>
        <span>${summary.mainLane}</span>
      </div>
    `;
  }).join("");
  renderDashboard();
}

function setViewMode(mode) {
  const showRecord = mode === "record";
  const showDrive = mode === "drive";
  const showGuidance = mode === "guidance";
  const showDashboard = mode === "dashboard";
  els.modeRecord?.classList.toggle("is-active", showRecord);
  els.modeDrive?.classList.toggle("is-active", showDrive);
  els.modeGuidance?.classList.toggle("is-active", showGuidance);
  els.modeDashboard?.classList.toggle("is-active", showDashboard);
  els.recordViews.forEach((view) => view.classList.toggle("is-hidden", !showRecord));
  els.driveAssistView?.classList.toggle("is-hidden", !showDrive);
  els.guidanceView?.classList.toggle("is-hidden", !showGuidance);
  els.dashboardView?.classList.toggle("is-hidden", !showDashboard);
  if (showDashboard) renderDashboard();
  if (showDrive) renderDriveAssist();
}

function renderDashboard() {
  if (!els.dashboardSummary || !els.dashboardDirections) return;

  const model = buildDashboardModel(normalizeTrips(state.trips));
  els.dashboardVerdict.textContent = model.verdict;
  els.dashboardSummary.innerHTML = [
    dashboardCard("??頞", `${model.totalTrips} 頞),
    dashboardCard("頠?璅?", `${model.totalLaneSamples.toLocaleString("zh-TW")} 蝑),
    dashboardCard("撱箄降???, model.readyDirections >= 1 ? "?臬??隅?? : "?敞蝛???),
    dashboardCard("?日鞈?", `${model.totalPoints.toLocaleString("zh-TW")} GPS 暺),
  ].join("");

  if (!model.totalTrips) {
    els.dashboardDirections.innerHTML = `<div class="direction-card"><h3>撠鞈?</h3><div class="recommendation">摰?銝虫?摮洵銝頞?嚗ㄐ??憪?????頠?頞典??/div></div>`;
    return;
  }

  els.dashboardDirections.innerHTML = model.directions.map((direction) => `
    <article class="direction-card">
      <div>
        <span>${direction.label}</span>
        <h3>${direction.tripCount} 頞?撟喳? ${direction.avgMinutes} ??${direction.avgKm} km</h3>
      </div>
      <div class="recommendation">
        <strong>${direction.recommendationTitle}</strong><br>
        ${direction.recommendationDetail}
      </div>
      <div class="segment-list">
        ${direction.segments.map((segment) => `
          <div class="segment-row">
            <span>${segment.label}</span>
            <strong>${segment.lane}</strong>
            <span>${segment.speed}</span>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
}

function dashboardCard(label, value) {
  return `<article class="dashboard-card"><span>${label}</span><strong>${value}</strong></article>`;
}

function confidenceContract({ level, source, samples = 0, tripCount = 0, visionShare = 0 }) {
  const normalizedLevel = ["insufficient", "low", "medium", "high", "manual"].includes(level)
    ? level
    : level === "good"
      ? "medium"
      : level === "warn"
        ? "low"
        : "insufficient";
  const sourceLabel = {
    manual: "????",
    history: "甇瑕蝯梯?",
    vision: "?豢??其摯",
    system: "蝟餌絞?斗",
  }[source] || "蝟餌絞?斗";
  const levelLabel = {
    insufficient: "鞈?銝雲",
    low: "雿靽?,
    medium: "銝剖靽?,
    high: "擃靽?,
    manual: "??蝣箄?",
  }[normalizedLevel];

  return {
    level: normalizedLevel,
    source: source || "system",
    sourceLabel,
    levelLabel,
    samples,
    tripCount,
    visionShare,
    text: `${levelLabel}嚚?{sourceLabel}`,
  };
}

function recommendLaneForSegmentV2(direction, segmentIndex) {
  const currentLane = getEffectiveLane();
  if (currentLane?.source === "manual") {
    const confidence = confidenceContract({ level: "manual", source: "manual", samples: 1 });
    return {
      title: `?? ${currentLane.label}`,
      detail: "?雿銝???閮?頠?嚗?甇瑕蝯梯??璈隡啜?,
      confidenceLabel: confidence.text,
      confidence,
      level: confidence.level,
    };
  }

  const trips = normalizeTrips(state.trips).filter((trip) => trip.direction === direction);
  const laneStats = {};
  const tripIds = new Set();
  let samples = 0;
  let speedTotal = 0;
  let speedCount = 0;
  let visionSamples = 0;

  for (const trip of trips) {
    const points = trip.points || [];
    if (points.length < 2) continue;
    for (const point of points) {
      const segment = getRouteSegment(point, direction);
      if (!segment || segment.index !== segmentIndex) continue;
      const lane = point.manualLane?.label || point.effectiveLane?.label || "";
      if (!lane) continue;
      const source = point.manualLane?.label ? "manual" : point.effectiveLane?.source || "";
      if (source === "vision") visionSamples += 1;
      laneStats[lane] = (laneStats[lane] || 0) + 1;
      tripIds.add(trip.id);
      samples += 1;
      const pointSpeed = typeof point.speed === "number" && point.speed >= 0 ? point.speed * 3.6 : NaN;
      if (isReliableSpeed(pointSpeed)) {
        speedTotal += pointSpeed;
        speedCount += 1;
      }
    }
  }

  const topLane = Object.entries(laneStats).sort((a, b) => b[1] - a[1])[0];
  if (!topLane || tripIds.size < 2 || samples < 40) {
    const confidence = confidenceContract({ level: "insufficient", source: "history", samples, tripCount: tripIds.size });
    return {
      title: "?頝舀?",
      detail: `???頝舀挾?桀??芣? ${tripIds.size} 頞?{samples} 蝑?刻?????銝＊蝷箸摰????踹?隤文??,
      confidenceLabel: confidence.text,
      confidence,
      level: confidence.level,
    };
  }

  const share = topLane[1] / samples;
  const visionShare = samples ? visionSamples / samples : 0;
  let level = "low";
  if (tripIds.size >= 3 && samples >= 80 && share >= .45 && visionShare <= .35) level = "medium";
  if (tripIds.size >= 6 && samples >= 180 && share >= .6 && visionShare <= .2) level = "high";
  const confidence = confidenceContract({
    level,
    source: "history",
    samples,
    tripCount: tripIds.size,
    visionShare,
  });
  const avgSpeed = speedCount ? Math.round(speedTotal / speedCount) : null;
  const titlePrefix = level === "high" || level === "medium" ? "?? : "閫撖";
  const detailParts = [
    `靘?${tripIds.size} 頞?{samples} 蝑?頝舀挾鞈?蝯梯??,
    avgSpeed ? `??撟喳??漲蝝?${avgSpeed} km/h? : "",
    level === "low" ? "?臭縑摨虫?雿?隢?閬??內霈?頠??? : "?臭??箏??孵??楝畾萄???,
  ].filter(Boolean);

  return {
    title: `${titlePrefix} ${topLane[0]}`,
    detail: detailParts.join(" "),
    confidenceLabel: confidence.text,
    confidence,
    level: confidence.level,
  };
}

function toggleGuidance() {
  if (state.guidanceActive) {
    stopGuidance();
    return;
  }

  if (!navigator.geolocation) {
    updateGuidanceView({
      title: "甇斤汗?其??舀摰?",
      subtitle: "隢??Safari ??Chrome ??嚗蒂?迂摰?甈???,
      directionLabel: "--",
      segmentLabel: "--",
      speedLabel: "-- km/h",
      confidenceLabel: "--",
      recommendation: "?⊥???",
      detail: "?桀??蹂???GPS 摰????,
      level: "warn",
    });
    return;
  }

  state.guidanceActive = true;
  state.lastGuidancePoint = null;
  els.guidanceToggle.textContent = "?迫?單?摰?";
  updateGuidanceView({
    title: "甇?摰?銝?,
    subtitle: "隢??迨????蝟餌絞?? GPS ?湔?單?撱箄降??,
    directionLabel: "?斗銝?,
    segmentLabel: "?斗銝?,
    speedLabel: "-- km/h",
    confidenceLabel: "--",
    recommendation: "摰?銝?,
    detail: "??蝚砌?蝑?GPS 敺????斗?孵??楝畾萸?,
    level: "warn",
  });

  state.guidanceWatchId = navigator.geolocation.watchPosition(handleGuidancePosition, handleGuidanceError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 12000,
  });
  if (!state.trip) updateFloatingRecorder(true, "?單?撱箄降銝?, "GPS 摰???");
}

function stopGuidance() {
  if (state.guidanceWatchId !== null) navigator.geolocation.clearWatch(state.guidanceWatchId);
  state.guidanceWatchId = null;
  state.lastGuidancePoint = null;
  state.guidanceActive = false;
  if (els.guidanceToggle) els.guidanceToggle.textContent = "???單?摰?";
  updateGuidanceView({
    title: "?單?撱箄降撌脣?甇?,
    subtitle: "?活??敺??靘?GPS ?斗?桀?頝舀挾??,
    directionLabel: "--",
    segmentLabel: "--",
    speedLabel: "-- km/h",
    confidenceLabel: "--",
    recommendation: "撠??",
    detail: "??敺??斗?孵??楝畾菔?撱箄降頠???,
    level: "",
  });
  if (!state.trip) updateFloatingRecorder(false, "敺", state.autoMode ? "?芸?璅∪?敺" : "GPS 敺");
}

function handleGuidancePosition(pos) {
  const point = gpsPointFromPosition(pos);
  enrichMovementPoint(point, state.lastGuidancePoint);
  const rawSpeedKmh = point.speed === null
    ? (state.lastGuidancePoint ? estimatePointSpeed(state.lastGuidancePoint, point) : NaN)
    : point.speed * 3.6;
  const speedKmh = isReliableSpeed(rawSpeedKmh) ? rawSpeedKmh : NaN;
  const direction = inferLiveDirection(point, state.lastGuidancePoint);
  const segment = direction ? getLiveRouteSegment(point, direction) : null;
  const recommendation = segment ? recommendLaneForSegmentV2(direction, segment.index) : null;
  const directionLabel = directionLabelText(direction);

  if ((point.accuracy || 0) > maxReliableAccuracyMeters) {
    updateGuidanceView({
      title: "GPS 蝎曉漲銝雲",
      subtitle: `?桀?摰?蝎曉漲蝝?${Math.round(point.accuracy || 0)} ?砍偕嚗??怠?撱箄降?,
      directionLabel: directionLabel || "?斗銝?,
      segmentLabel: segment?.label || "--",
      speedLabel: Number.isFinite(speedKmh) ? `${Math.round(speedKmh)} km/h` : "-- km/h",
      confidenceLabel: "鞈?銝雲",
      recommendation: "?頝舀?",
      detail: "摰?隤文榆憭芸之?捆???舀??頝舀挾嚗銝?靘??遣霅啜?,
      level: "warn",
    });
  } else if (!direction || !segment) {
    updateGuidanceView({
      title: "甇??斗?孵?",
      subtitle: "頠?蝘餃?銝撠挾敺??孵??皞?,
      directionLabel: directionLabel || "?斗銝?,
      segmentLabel: "--",
      speedLabel: Number.isFinite(speedKmh) ? `${Math.round(speedKmh)} km/h` : "-- km/h",
      confidenceLabel: "雿?,
      recommendation: "?頝舀?",
      detail: "?桀? GPS 撠?頞喃誑?斗雿?冽?璇??啣?嚗??啣?敺璆???,
      level: "warn",
    });
  } else {
    updateGuidanceView({
      title: "?單?撱箄降??銝?,
      subtitle: `?桀?摰?蝎曉漲蝝?${Math.round(point.accuracy || 0)} ?砍偕`,
      directionLabel,
      segmentLabel: segment.label,
      speedLabel: Number.isFinite(speedKmh) ? `${Math.round(speedKmh)} km/h` : "-- km/h",
      confidenceLabel: recommendation.confidenceLabel,
      recommendation: recommendation.title,
      detail: recommendation.detail,
      level: recommendation.level,
    });
    if (!state.trip) updateFloatingRecorder(true, "?單?撱箄降銝?, `${directionLabel}嚚?{segment.label}嚚?{recommendation.title}`);
  }

  state.lastGuidancePoint = point;
  state.lastCctvPoint = point;
  state.lastDrivePoint = point;
  if (state.cctvList.length && state.currentCctvId) {
    renderNearestCctv(point, direction);
  }
  void refreshDriveAssist(point, direction);
}

function handleGuidanceError(error) {
  updateGuidanceView({
    title: "摰?憭望?",
    subtitle: "隢Ⅱ隤?璈汗?典歇?迂摰?嚗??靽?????,
    directionLabel: "--",
    segmentLabel: "--",
    speedLabel: "-- km/h",
    confidenceLabel: "--",
    recommendation: "?⊥?撱箄降",
    detail: error?.message || "?桀??⊥??? GPS??,
    level: "warn",
  });
}

function updateGuidanceView(view) {
  const confidence = view.confidence || confidenceContract({
    level: view.level,
    source: view.source || "system",
  });
  if (els.guidanceTitle) els.guidanceTitle.textContent = view.title;
  if (els.guidanceSubtitle) els.guidanceSubtitle.textContent = view.subtitle;
  if (els.guidanceDirection) els.guidanceDirection.textContent = view.directionLabel;
  if (els.guidanceSegment) els.guidanceSegment.textContent = view.segmentLabel;
  if (els.guidanceSpeed) els.guidanceSpeed.textContent = view.speedLabel;
  if (els.guidanceConfidence) els.guidanceConfidence.textContent = confidence.levelLabel;
  if (els.guidanceRecommendation) {
    els.guidanceRecommendation.classList.remove("good", "warn", "insufficient", "low", "medium", "high", "manual");
    els.guidanceRecommendation.classList.add(confidence.level);
    els.guidanceRecommendation.innerHTML = `
      <span class="confidence-chip ${confidence.level}">${confidence.text}</span>
      <strong>${view.recommendation}</strong>
      <small>${view.detail}</small>
    `;
  }
}

async function loadForwardCctv() {
  const point = state.lastGuidancePoint || state.trip?.points?.at?.(-1);
  if (!point) {
    setCctvStatus("撠?? GPS 雿蔭嚗??????雿???憪??????乓?);
    return;
  }
  if ((point.accuracy || 0) > maxReliableAccuracyMeters) {
    setCctvStatus(`GPS 蝎曉漲蝝?${Math.round(point.accuracy || 0)} ?砍偕嚗?賣?舫?哨?隢?摰?蝛拙?敺?閰艾);
    return;
  }

  try {
    setCctvStatus("甇?霈????CCTV 皜...");
    const cctvs = await fetchCctvList();
    if (!cctvs.length) {
      setCctvStatus("?桀?霈銝 CCTV 皜嚗?敺?閰艾?);
      clearCctvFrame("撠?舐敶勗?");
      return;
    }
    renderNearestCctv(point, inferLiveDirection(point, state.lastGuidancePoint));
    void refreshDriveAssist(point, inferLiveDirection(point, state.lastGuidancePoint));
  } catch (err) {
    setCctvStatus(`CCTV 霈?仃??${err.message || "鞈?皞???舐"}`);
    clearCctvFrame("敶勗?鞈??急??⊥?頛");
  }
}

async function fetchCctvList() {
  const now = Date.now();
  if (state.cctvList.length && now - state.cctvLoadedAt < cctvCacheMs) return state.cctvList;
  if (state.cctvLoading) return state.cctvList;

  state.cctvLoading = true;
  try {
    const response = await fetch(cctvEndpoint, { cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.cctvList = (payload.CCTVs || [])
      .filter((camera) => camera.PositionLat && camera.PositionLon)
      .map((camera) => ({
        id: camera.CCTVID,
        url: extractCctvUrl(camera),
        lat: Number(camera.PositionLat),
        lng: Number(camera.PositionLon),
        road: camera.RoadName || camera.RoadID || "??",
        direction: camera.RoadDirection || "",
        section: `${camera.RoadSection?.Start || ""}${camera.RoadSection?.End ? ` ??${camera.RoadSection.End}` : ""}`.trim(),
        mile: camera.LocationMile || "",
      }));
    state.cctvLoadedAt = now;
    return state.cctvList;
  } finally {
    state.cctvLoading = false;
  }
}

function extractCctvUrl(camera) {
  const directFields = [
    camera.VideoStreamURL,
    camera.VideoImageURL,
    camera.ImageURL,
    camera.SnapshotURL,
    camera.LiveStreamURL,
    camera.VideoURL,
    camera.CCTVURL,
    camera.CctvURL,
    camera.Url,
    camera.URL,
    camera.MediaURL,
  ];
  const directMatch = directFields.find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
  if (directMatch) return directMatch;

  const nestedStreams = Array.isArray(camera.VideoStreams) ? camera.VideoStreams
    : Array.isArray(camera.Streams) ? camera.Streams
      : Array.isArray(camera.Media) ? camera.Media
        : [];

  for (const stream of nestedStreams) {
    const nestedMatch = [
      stream?.url,
      stream?.URL,
      stream?.VideoStreamURL,
      stream?.ImageURL,
      stream?.SnapshotURL,
    ].find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
    if (nestedMatch) return nestedMatch;
  }

  return "";
}

function renderNearestCctv(point, direction) {
  const selected = selectForwardCctv(point, direction);
  if (!selected) {
    state.currentCctvId = "";
    state.currentCctv = null;
    clearCctvFrame("??瘝??舐??敶勗?");
    setCctvStatus("?桀?雿蔭??瘝??舐????CCTV??);
    return;
  }

  const distanceLabel = selected.distance < 1000
    ? `${Math.round(selected.distance)} m`
    : `${(selected.distance / 1000).toFixed(1)} km`;
  const directionText = selected.direction ? `嚚?{selected.direction}` : "";
  const scopeLabel = selected.matchType === "forward" ? "?" : "???餈?;
  if (els.cctvFrame && state.currentCctvId !== selected.id) {
    els.cctvFrame.innerHTML = `
      <img class="cctv-image" crossorigin="anonymous" src="${selected.url}" alt="${selected.road} ${selected.mile} CCTV ?單?敶勗?">
    `;
    resetCctvAnalysis("撌脫??⊿嚗??芷??啣???);
  }
  state.currentCctvId = selected.id;
  state.currentCctv = selected;
  setCctvStatus(`撌脰???{scopeLabel}?⊿嚗?{selected.road}${directionText} ${selected.mile || ""}嚗??Ｙ? ${distanceLabel}??敺??芸???銝?胯);
  renderDriveCctv(selected);
  if (els.cctvMeta) {
    els.cctvMeta.textContent = selected.section
      ? `${selected.section}嚚???皞?鈭日 TDX ?? CCTV ?鞈??
      : "鞈?靘?嚗漱? TDX ?? CCTV ?鞈???;
  }
}

function selectForwardCctv(point, direction) {
  const heading = getEffectiveHeading(point, direction);
  const candidates = state.cctvList
    .map((camera) => {
      const distance = distanceBetween(point, { lat: camera.lat, lng: camera.lng });
      const bearing = bearingBetween(point, { lat: camera.lat, lng: camera.lng });
      const bearingDelta = Number.isFinite(heading) ? Math.abs(angleDelta(heading, bearing)) : 0;
      return { ...camera, distance, bearingDelta };
    })
    .filter((camera) => camera.distance <= cctvFallbackDistanceMeters);

  const forwardCandidates = candidates
    .filter((camera) => !Number.isFinite(heading) || camera.bearingDelta <= cctvForwardBearingTolerance)
    .sort((a, b) => {
      const scoreA = a.distance + a.bearingDelta * 8;
      const scoreB = b.distance + b.bearingDelta * 8;
      return scoreA - scoreB;
    });

  const nearbyForwardCandidates = forwardCandidates.filter((camera) => camera.distance <= cctvMaxDistanceMeters);
  const nextForward = forwardCandidates.find((camera) => camera.distance >= cctvAdvanceSwitchMeters);
  if (nearbyForwardCandidates[0] && nearbyForwardCandidates[0].distance < cctvAdvanceSwitchMeters && nextForward) {
    return { ...nextForward, matchType: "forward" };
  }
  if (nearbyForwardCandidates[0]) return { ...nearbyForwardCandidates[0], matchType: "forward" };
  if (nextForward) return { ...nextForward, matchType: "forward" };

  const nearest = candidates.sort((a, b) => a.distance - b.distance)[0];
  return nearest ? { ...nearest, matchType: "nearest" } : null;
}

function getEffectiveHeading(point, direction) {
  if (typeof point.heading === "number" && point.heading >= 0) return point.heading;
  if (direction === "yangmei_to_xindian") return bearingBetween(point, commuteAnchors.xindian);
  if (direction === "xindian_to_yangmei") return bearingBetween(point, commuteAnchors.yangmei);
  if (state.lastGuidancePoint && distanceBetween(state.lastGuidancePoint, point) >= 20) {
    return bearingBetween(state.lastGuidancePoint, point);
  }
  return NaN;
}

function clearCctv() {
  state.currentCctvId = "";
  state.currentCctv = null;
  clearCctvFrame("撠頛敶勗?");
  renderDriveCctv(null);
  resetCctvAnalysis("頛敶勗?敺?函??????臭縑頠??斗??);
  setCctvStatus("撌脫??文蔣???閬??舫??啗??亙???CCTV??);
  if (els.cctvMeta) els.cctvMeta.textContent = "鞈?靘?嚗漱? TDX ?? CCTV ?鞈??蔣??賢辣?脫??急??⊥??剜??;
}

function clearCctvFrame(message) {
  if (els.cctvFrame) els.cctvFrame.innerHTML = `<div class="cctv-empty">${message}</div>`;
}

function setCctvStatus(message) {
  if (els.cctvStatus) els.cctvStatus.textContent = message;
}

async function refreshDriveAssist(point, direction) {
  if (!point) {
    renderDriveAssist();
    return;
  }
  const [vdListResult, vdLiveResult, cctvResult] = await Promise.allSettled([
    fetchVdList(),
    fetchVdLives(),
    fetchCctvList(),
  ]);

  if (vdListResult.status === "fulfilled" && vdLiveResult.status === "fulfilled") {
    state.currentVd = selectNearestVd(point, direction);
  }

  if (cctvResult.status === "fulfilled" && state.cctvList.length) {
    renderNearestCctv(point, direction);
  } else if (cctvResult.status === "rejected") {
    state.currentCctvId = "";
    state.currentCctv = null;
    setCctvStatus(`CCTV 靘??急?銝?剁?${cctvResult.reason?.message || "霈?仃??}`);
    renderDriveCctv(null);
  }

  renderDriveAssist(point, direction);
}

async function fetchVdList() {
  const now = Date.now();
  if (state.vdList.length && now - state.vdLoadedAt < vdStaticCacheMs) return state.vdList;
  if (state.vdLoading) return state.vdList;

  state.vdLoading = true;
  try {
    const response = await fetch(vdStaticEndpoint, { cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.vdList = (payload.VDs || [])
      .filter((vd) => vd.VDID && vd.PositionLat && vd.PositionLon)
      .map((vd) => ({
        id: vd.VDID,
        lat: Number(vd.PositionLat),
        lng: Number(vd.PositionLon),
        road: vd.RoadName || vd.RoadID || "??",
        roadId: vd.RoadID || "",
        direction: vd.DetectionLinks?.[0]?.RoadDirection || "",
        laneNum: vd.DetectionLinks?.[0]?.ActualLaneNum || vd.DetectionLinks?.[0]?.LaneNum || "",
        section: `${vd.RoadSection?.Start || ""}${vd.RoadSection?.End ? ` ??${vd.RoadSection.End}` : ""}`.trim(),
        mile: vd.LocationMile || "",
      }));
    state.vdLoadedAt = now;
    return state.vdList;
  } finally {
    state.vdLoading = false;
  }
}

async function fetchVdLives() {
  const now = Date.now();
  if (state.vdLives.size && now - state.vdLiveLoadedAt < vdLiveCacheMs) return state.vdLives;
  if (state.vdLiveLoading) return state.vdLives;

  state.vdLiveLoading = true;
  try {
    const response = await fetch(vdLiveEndpoint, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.vdLives = new Map((payload.VDLives || []).map((live) => [live.VDID, live]));
    state.vdLiveLoadedAt = now;
    return state.vdLives;
  } finally {
    state.vdLiveLoading = false;
  }
}

function selectNearestVd(point, direction) {
  const heading = getEffectiveHeading(point, direction);
  const candidates = state.vdList
    .map((vd) => {
      const distance = distanceBetween(point, { lat: vd.lat, lng: vd.lng });
      const bearing = bearingBetween(point, { lat: vd.lat, lng: vd.lng });
      const bearingDelta = Number.isFinite(heading) ? Math.abs(angleDelta(heading, bearing)) : 0;
      const live = state.vdLives.get(vd.id);
      return { ...vd, distance, bearingDelta, live };
    })
    .filter((vd) => vd.distance <= 5000);

  const forward = candidates
    .filter((vd) => !Number.isFinite(heading) || vd.bearingDelta <= cctvForwardBearingTolerance)
    .sort((a, b) => (a.distance + a.bearingDelta * 8) - (b.distance + b.bearingDelta * 8));
  return forward[0] || candidates.sort((a, b) => a.distance - b.distance)[0] || null;
}

function renderDriveAssist(point = state.lastDrivePoint, direction = null) {
  if (!els.driveAssistView) return;
  const speedKmh = point?.speed === null || point?.speed === undefined ? NaN : point.speed * 3.6;
  const speedLimit = estimateSpeedLimit(state.currentCctv) || estimateSpeedLimit(state.currentVd);
  const vdSummary = summarizeVdLive(state.currentVd?.live);
  const road = roadContextLabel(state.currentCctv || state.currentVd);
  const cctvDistance = state.currentCctv?.distance;

  if (els.driveAssistGpsSpeed) els.driveAssistGpsSpeed.textContent = Number.isFinite(speedKmh) ? `${Math.round(speedKmh)} km/h` : "-- km/h";
  if (els.driveAssistSpeedLimit) els.driveAssistSpeedLimit.textContent = speedLimit ? `${speedLimit} km/h` : "-- km/h";
  if (els.driveAssistVdSpeed) els.driveAssistVdSpeed.textContent = vdSummary.averageSpeed ? `${vdSummary.averageSpeed} km/h` : "-- km/h";
  if (els.driveAssistCctvDistance) {
    els.driveAssistCctvDistance.textContent = typeof cctvDistance === "number"
      ? (cctvDistance < 1000 ? `${Math.round(cctvDistance)} m` : `${(cctvDistance / 1000).toFixed(1)} km`)
      : "--";
  }
  if (els.driveAssistRoad) els.driveAssistRoad.textContent = road || "撠??頝舀挾鞈?";

  const overSpeed = speedLimit && Number.isFinite(speedKmh) && speedKmh > speedLimit + 5;
  if (els.driveAssistAlert) {
    els.driveAssistAlert.textContent = overSpeed ? `?撮頞?+${Math.round(speedKmh - speedLimit)} km/h` : "?漲甇?虜";
    els.driveAssistAlert.classList.toggle("danger", Boolean(overSpeed));
  }

  const laneSuggestion = vdSummary.fastestLane
    ? `VD 憿舐內 ${vdSummary.fastestLane.label} 頛?`
    : "?頝舀?";
  if (els.driveAssistRecommendation) els.driveAssistRecommendation.textContent = laneSuggestion;
  if (els.driveAssistDetail) {
    els.driveAssistDetail.textContent = vdSummary.fastestLane
      ? `甇斤?菜葫?刻??漲嚗?蝑?撠?誘嚗?隞亙??刻??Ｚ??曉璅??箸??
      : `蝑? VD ?漲??CCTV ??敺???靘?摰??;
  }
  renderDriveLaneSpeeds(vdSummary);
}

function renderDriveCctv(camera) {
  if (!els.driveAssistCctvFrame) return;
  if (!camera) {
    els.driveAssistCctvFrame.innerHTML = `<div class="cctv-empty">尚未載入監視器畫面</div>`;
    return;
  }
  if (!camera.url) {
    els.driveAssistCctvFrame.innerHTML = `<div class="cctv-empty">此監視器未提供公開畫面</div>`;
    return;
  }
  els.driveAssistCctvFrame.innerHTML = `
    <img class="cctv-image" crossorigin="anonymous" src="${camera.url}" alt="${camera.road} ${camera.mile} CCTV 即時畫面">
  `;
}

function renderDriveLaneSpeeds(summary) {
  if (!els.driveAssistLaneSpeeds) return;
  if (!summary.lanes.length) {
    els.driveAssistLaneSpeeds.textContent = "VD 頠??漲撠頛";
    return;
  }
  els.driveAssistLaneSpeeds.innerHTML = summary.lanes.map((lane) => `
    <div>
      <strong>${lane.label}</strong>
      <span>${lane.speed ? `${lane.speed} km/h` : "-- km/h"}</span>
      <small>????${lane.occupancy ?? "--"}%</small>
    </div>
  `).join("");
}

function summarizeVdLive(live) {
  const lanes = (live?.LinkFlows || [])
    .flatMap((flow) => flow.Lanes || [])
    .filter((lane) => lane.LaneType === 1)
    .map((lane, index) => ({
      label: `蝚?${index + 1} 頠?`,
      speed: Math.round(lane.Speed || 0),
      occupancy: lane.Occupancy ?? null,
    }))
    .filter((lane) => lane.speed > 0);
  const averageSpeed = lanes.length
    ? Math.round(lanes.reduce((sum, lane) => sum + lane.speed, 0) / lanes.length)
    : null;
  const fastestLane = lanes.slice().sort((a, b) => b.speed - a.speed)[0] || null;
  return { lanes, averageSpeed, fastestLane };
}

function roadContextLabel(source) {
  if (!source) return "";
  const direction = directionText(source.direction);
  const section = source.section ? `嚚?{source.section}` : "";
  const mile = source.mile ? `嚚?{source.mile}` : "";
  return `${source.road || "??"}${direction ? ` ${direction}` : ""}${mile}${section}`;
}

function directionText(direction) {
  return ({ N: "??", S: "??", E: "?勗?", W: "镼踹?" })[direction] || direction || "";
}

function estimateSpeedLimit(source) {
  if (!source?.road && !source?.roadId) return null;
  if ((source.road || "").includes("??") || String(source.roadId || "").startsWith("0000")) return 100;
  return null;
}

async function analyzeCctvFlow() {
  if (state.cctvAnalysisBusy) return;
  const image = els.cctvFrame?.querySelector?.(".cctv-image");
  if (!image) {
    setCctvAnalysis("撠頛敶勗?", "隢????亙??孵蔣???銵?瘚???, []);
    return;
  }
  if (!image.complete) {
    setCctvAnalysis("敶勗?隞頛", "隢? CCTV ?恍?箇敺?????, []);
    return;
  }

  state.cctvAnalysisBusy = true;
  if (els.analyzeCctv) els.analyzeCctv.disabled = true;
  setCctvAnalysis("??銝?, "甇??瑕??拙?????ｇ?瘥?????憛???, []);

  try {
    const first = captureCctvFrame(image);
    await wait(1400);
    const second = captureCctvFrame(image);
    const laneCount = Math.min(6, Math.max(2, state.roadLaneCount || 3));
    const result = analyzeLaneMotion(first, second, laneCount);
    renderCctvAnalysis(result);
  } catch (err) {
    setCctvAnalysis(
      "?⊥???甇文蔣??,
      "甇?CCTV 靘??航銝?閮勗?蝡航??蔣??蝝?隞鈭箏極?亦??恍嚗??急?銝?芸??斗頠??漲??,
      []
    );
  } finally {
    state.cctvAnalysisBusy = false;
    if (els.analyzeCctv) els.analyzeCctv.disabled = false;
  }
}

function captureCctvFrame(image) {
  const width = 240;
  const height = Math.max(120, Math.round(width * ((image.naturalHeight || 9) / (image.naturalWidth || 16))));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  return {
    width,
    height,
    data: ctx.getImageData(0, 0, width, height).data,
  };
}

function analyzeLaneMotion(first, second, laneCount) {
  const startY = Math.floor(first.height * .38);
  const endY = Math.floor(first.height * .92);
  const laneWidth = first.width / laneCount;
  const lanes = [];

  for (let lane = 0; lane < laneCount; lane += 1) {
    const startX = Math.floor(lane * laneWidth);
    const endX = Math.floor((lane + 1) * laneWidth);
    let motion = 0;
    let darkPixels = 0;
    let edgePixels = 0;
    let total = 0;

    for (let y = startY; y < endY; y += 2) {
      for (let x = startX; x < endX; x += 2) {
        const idx = (y * first.width + x) * 4;
        const r1 = first.data[idx];
        const g1 = first.data[idx + 1];
        const b1 = first.data[idx + 2];
        const r2 = second.data[idx];
        const g2 = second.data[idx + 1];
        const b2 = second.data[idx + 2];
        const lum1 = (r1 * .299) + (g1 * .587) + (b1 * .114);
        const lum2 = (r2 * .299) + (g2 * .587) + (b2 * .114);
        motion += Math.abs(lum2 - lum1);
        if (lum1 < 95) darkPixels += 1;

        const nextIdx = (y * first.width + Math.min(first.width - 1, x + 2)) * 4;
        const nextLum = (first.data[nextIdx] * .299) + (first.data[nextIdx + 1] * .587) + (first.data[nextIdx + 2] * .114);
        if (Math.abs(lum1 - nextLum) > 28) edgePixels += 1;
        total += 1;
      }
    }

    const motionScore = total ? motion / total : 0;
    const occupancy = total ? darkPixels / total : 0;
    const edgeDensity = total ? edgePixels / total : 0;
    const flowScore = (motionScore * 1.25) + (edgeDensity * 25) - (occupancy * 12);
    lanes.push({
      laneIndex: lane + 1,
      label: cameraLaneLabel(lane, laneCount),
      motionScore,
      occupancy,
      edgeDensity,
      flowScore,
    });
  }

  const ranked = lanes
    .map((lane) => ({ ...lane }))
    .sort((a, b) => b.flowScore - a.flowScore);
  const spread = ranked[0]?.flowScore - ranked.at(-1)?.flowScore;
  const confidence = spread > 9 ? "雿靽? : "鞈?銝雲";
  return { lanes, ranked, confidence };
}

function cameraLaneLabel(index, laneCount) {
  if (laneCount === 2) return index === 0 ? "?恍撌血" : "?恍?喳";
  if (index === 0) return "?恍撌血";
  if (index === laneCount - 1) return "?恍?喳";
  return laneCount > 3 ? `?恍銝剝? ${index}` : "?恍銝剝?";
}

function renderCctvAnalysis(result) {
  if (!result.ranked.length) {
    setCctvAnalysis("鞈?銝雲", "敶勗??臬????云撠??思?????, []);
    return;
  }
  const top = result.ranked[0];
  const order = result.ranked.map((lane) => lane.label).join(" > ");
  const rows = result.ranked.map((lane) => ({
    label: lane.label,
    value: `${Math.max(0, Math.round(lane.flowScore))}`,
    note: `霈? ${lane.motionScore.toFixed(1)}嚚???${(lane.occupancy * 100).toFixed(0)}%`,
  }));
  setCctvAnalysis(
    `${result.confidence}嚗?{top.label}頛?`,
    `?恍?憛??摨?${order}?迨?斗?芯誨銵?CCTV ?恍?憛?銝?摰??澆祕?/憭??,
    rows
  );
}

function setCctvAnalysis(title, detail, rows) {
  if (!els.cctvAnalysis) return;
  const list = rows?.length
    ? `<div class="cctv-analysis-list">${rows.map((row) => `
        <div>
          <strong>${row.label}</strong>
          <span>? ${row.value}</span>
          <small>${row.note}</small>
        </div>
      `).join("")}</div>`
    : "";
  els.cctvAnalysis.innerHTML = `
    <strong>${title}</strong>
    <span>${detail}</span>
    ${list}
  `;
}

function resetCctvAnalysis(detail) {
  setCctvAnalysis("撠??", detail, []);
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function inferLiveDirection(point, previousPoint) {
  if (state.trip?.direction && state.trip.direction !== "manual") return state.trip.direction;
  const activeTripDirection = inferActiveTripDirection(point);
  if (activeTripDirection) return activeTripDirection;

  if (previousPoint && distanceBetween(previousPoint, point) >= 20) {
    const previousToXindian = distanceBetween(previousPoint, commuteAnchors.xindian);
    const currentToXindian = distanceBetween(point, commuteAnchors.xindian);
    const previousToYangmei = distanceBetween(previousPoint, commuteAnchors.yangmei);
    const currentToYangmei = distanceBetween(point, commuteAnchors.yangmei);
    if (currentToXindian + 15 < previousToXindian && currentToYangmei > previousToYangmei) return "yangmei_to_xindian";
    if (currentToYangmei + 15 < previousToYangmei && currentToXindian > previousToXindian) return "xindian_to_yangmei";
  }

  if (typeof point.heading === "number" && point.heading >= 0) {
    const toXindian = bearingBetween(point, commuteAnchors.xindian);
    const toYangmei = bearingBetween(point, commuteAnchors.yangmei);
    if (Math.abs(angleDelta(point.heading, toXindian)) < 70) return "yangmei_to_xindian";
    if (Math.abs(angleDelta(point.heading, toYangmei)) < 70) return "xindian_to_yangmei";
  }

  const nearYangmei = distanceBetween(point, commuteAnchors.yangmei) <= commuteAnchors.yangmei.radiusMeters;
  const nearXindian = distanceBetween(point, commuteAnchors.xindian) <= commuteAnchors.xindian.radiusMeters;
  if (nearYangmei) return "yangmei_to_xindian";
  if (nearXindian) return "xindian_to_yangmei";
  return "";
}

function inferActiveTripDirection(point) {
  const points = state.trip?.points || [];
  const first = points[0];
  if (!first) return "";

  const firstToYangmei = distanceBetween(first, commuteAnchors.yangmei);
  const firstToXindian = distanceBetween(first, commuteAnchors.xindian);
  const currentToYangmei = distanceBetween(point, commuteAnchors.yangmei);
  const currentToXindian = distanceBetween(point, commuteAnchors.xindian);

  if (firstToYangmei <= firstToXindian && currentToXindian < firstToXindian) return "yangmei_to_xindian";
  if (firstToXindian < firstToYangmei && currentToYangmei < firstToYangmei) return "xindian_to_yangmei";

  if ((state.trip.distanceMeters || 0) > 3000) {
    const tripDirection = inferTripDirection({ ...state.trip, points: [first, point], direction: "manual" });
    if (tripDirection !== "manual") return tripDirection;
  }
  return "";
}

function getRouteSegment(point, direction) {
  const progress = routeProgress(point, direction);
  if (!Number.isFinite(progress)) return null;
  const labels = direction === "yangmei_to_xindian"
    ? ["璆?蝡?, "銝剖ㄑ/獢?畾?, "?????折???", "?啣?蝡?]
    : ["?啣?蝡?, "?????折???", "獢?/銝剖ㄑ畾?, "璆?蝡?];
  const index = Math.max(0, Math.min(3, Math.floor(progress * 4)));
  return {
    index,
    progress,
    label: labels[index],
  };
}

function getLiveRouteSegment(point, direction) {
  const activeDirection = inferActiveTripDirection(point);
  if (state.trip && activeDirection === direction && (state.trip.distanceMeters || 0) > 1000) {
    const progress = Math.max(0, Math.min(0.999, (state.trip.distanceMeters || 0) / expectedCommuteMeters));
    return routeSegmentFromProgress(progress, direction);
  }
  return getRouteSegment(point, direction);
}

function routeSegmentFromProgress(progress, direction) {
  const labels = direction === "yangmei_to_xindian"
    ? ["璆?蝡?, "銝剖ㄑ/獢?畾?, "?????折???", "?啣?蝡?]
    : ["?啣?蝡?, "?????折???", "獢?/銝剖ㄑ畾?, "璆?蝡?];
  const index = Math.max(0, Math.min(3, Math.floor(progress * 4)));
  return {
    index,
    progress,
    label: labels[index],
  };
}

function routeProgress(point, direction) {
  const start = direction === "yangmei_to_xindian" ? commuteAnchors.yangmei : commuteAnchors.xindian;
  const end = direction === "yangmei_to_xindian" ? commuteAnchors.xindian : commuteAnchors.yangmei;
  const total = distanceBetween(start, end);
  if (!total) return NaN;
  const fromStart = distanceBetween(start, point);
  const toEnd = distanceBetween(point, end);
  return Math.max(0, Math.min(0.999, fromStart / (fromStart + toEnd)));
}

function recommendLaneForSegment(direction, segmentIndex) {
  const currentLane = getEffectiveLane();
  if (currentLane?.source === "manual") {
    return {
      title: `?桀? ${currentLane.label}`,
      detail: "撌脣皜砍雿???璅??桀?頠?嚗??Ｗ?隞交???閮銝鳴??踹?甇瑕鞈?隤文??,
      confidenceLabel: "??",
      level: "good",
    };
  }

  const trips = normalizeTrips(state.trips).filter((trip) => trip.direction === direction);
  const laneStats = {};
  const tripIds = new Set();
  let samples = 0;
  let speedTotal = 0;
  let speedCount = 0;

  for (const trip of trips) {
    const points = trip.points || [];
    if (points.length < 2) continue;
    for (const point of points) {
      const segment = getRouteSegment(point, direction);
      if (!segment || segment.index !== segmentIndex) continue;
      const lane = point.effectiveLane?.label || point.manualLane?.label || "";
      if (!lane) continue;
      laneStats[lane] = (laneStats[lane] || 0) + 1;
      tripIds.add(trip.id);
      samples += 1;
      const pointSpeed = typeof point.speed === "number" && point.speed >= 0 ? point.speed * 3.6 : NaN;
      if (isReliableSpeed(pointSpeed)) {
        speedTotal += pointSpeed;
        speedCount += 1;
      }
    }
  }

  const topLane = Object.entries(laneStats).sort((a, b) => b[1] - a[1])[0];
  if (!topLane) {
    return {
      title: "?頝舀?",
      detail: "???頝舀挾???雲憭??????匱蝥敞蝛???,
      confidenceLabel: "鞈?銝雲",
      level: "warn",
    };
  }

  const share = topLane[1] / samples;
  const avgSpeed = speedCount ? Math.round(speedTotal / speedCount) : null;
  const confidenceLabel = tripIds.size >= 3 && samples >= 80 && share >= .45
    ? "銝?
    : "雿?;
  const title = confidenceLabel === "銝? ? `撱箄降 ${topLane[0]}` : `?怠? ${topLane[0]}`;
  const detailParts = [
    `靘?${tripIds.size} 頞?{samples} 蝑?頝舀挾蝝?隡啜,
    avgSpeed ? `閰脰楝畾萄像?? ${avgSpeed} km/h? : "",
    confidenceLabel === "雿? ? "鞈?隞?嚗?隞亙?楝瘜?摰?箔蜓?? : "?臭??箇?楝畾萄???,
  ].filter(Boolean);

  return {
    title,
    detail: detailParts.join(" "),
    confidenceLabel,
    level: confidenceLabel === "銝? ? "good" : "warn",
  };
}

function directionLabelText(direction) {
  if (direction === "yangmei_to_xindian") return "璆? ???啣?";
  if (direction === "xindian_to_yangmei") return "?啣? ??璆?";
  return "";
}

function buildDashboardModel(trips) {
  const validTrips = normalizeTrips(trips);
  const directions = [
    buildDirectionModel(validTrips, "yangmei_to_xindian", "璆? ???啣?"),
    buildDirectionModel(validTrips, "xindian_to_yangmei", "?啣? ??璆?"),
  ];
  const totalTrips = directions.reduce((sum, item) => sum + item.tripCount, 0);
  const totalPoints = validTrips.reduce((sum, trip) => sum + (trip.points?.length || 0), 0);
  const totalLaneSamples = validTrips.reduce((sum, trip) => sum + (trip.laneSamples?.length || 0), 0);
  const readyDirections = directions.filter((item) => item.isReady).length;
  const verdict = readyDirections
    ? "撌脫??孵??臬?甇亙???
    : totalTrips
      ? "鞈?隞?撠???頞典"
      : "撠??銵?";

  return {
    totalTrips,
    totalPoints,
    totalLaneSamples,
    readyDirections,
    verdict,
    directions,
  };
}

function buildDirectionModel(trips, directionKey, label) {
  const directionTrips = trips.filter((trip) => trip.direction === directionKey);
  const tripCount = directionTrips.length;
  const avgMinutes = tripCount ? Math.round(directionTrips.reduce((sum, trip) => sum + (trip.summary?.minutes || summarizeTrip(trip).minutes), 0) / tripCount) : 0;
  const avgKm = tripCount ? Number((directionTrips.reduce((sum, trip) => sum + ((trip.distanceMeters || 0) / 1000), 0) / tripCount).toFixed(1)) : 0;
  const laneCounts = countLanes(directionTrips);
  const mainLane = laneCounts[0]?.[0] || "撠頠?鞈?";
  const isReady = tripCount >= 3 && laneCounts.length > 0;
  const recommendationTitle = isReady ? `?桀??臬???${mainLane}` : "?桀?銝遣霅唬?摰?";
  const recommendationDetail = isReady
    ? `甇斗?歇??${tripCount} 頞????臬??其蜓閬???箸?嚗?蝥?閬敞蝛?撜啜憭押???銝??箇??鞈??
    : tripCount
      ? `?桀??芣? ${tripCount} 頞??????拙??隅?ｇ?銝??亙摰?雿唾????雿唾楝蝺
      : "甇斗???芣???蝝??;

  return {
    key: directionKey,
    label,
    tripCount,
    avgMinutes,
    avgKm,
    isReady,
    recommendationTitle,
    recommendationDetail,
    segments: buildSegmentModels(directionTrips),
  };
}

function countLanes(trips) {
  const counts = {};
  for (const trip of trips) {
    for (const sample of trip.laneSamples || []) {
      if (!sample?.lane) continue;
      counts[sample.lane] = (counts[sample.lane] || 0) + 1;
    }
    for (const point of trip.points || []) {
      const label = point.effectiveLane?.label || point.manualLane?.label || "";
      if (!label) continue;
      counts[label] = (counts[label] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function buildSegmentModels(trips) {
  const buckets = [
    { label: "?挾", laneCounts: {}, speeds: [] },
    { label: "銝剖?", laneCounts: {}, speeds: [] },
    { label: "銝剖?", laneCounts: {}, speeds: [] },
    { label: "敺挾", laneCounts: {}, speeds: [] },
  ];

  for (const trip of trips) {
    const points = trip.points || [];
    if (points.length < 2 || !(trip.distanceMeters > 0)) continue;

    let runningMeters = 0;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      runningMeters += distanceBetween(previous, point);
      const bucketIndex = Math.min(3, Math.floor((runningMeters / trip.distanceMeters) * 4));
      const bucket = buckets[bucketIndex];
      const lane = point.effectiveLane?.label || point.manualLane?.label || "";
      if (lane) bucket.laneCounts[lane] = (bucket.laneCounts[lane] || 0) + 1;
      if (typeof point.speed === "number" && point.speed >= 0) bucket.speeds.push(point.speed * 3.6);
    }
  }

  return buckets.map((bucket) => {
    const lane = Object.entries(bucket.laneCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "鞈?銝雲";
    const speed = bucket.speeds.length
      ? `${Math.round(bucket.speeds.reduce((sum, value) => sum + value, 0) / bucket.speeds.length)} km/h`
      : "-- km/h";
    return { label: bucket.label, lane, speed };
  });
}

function exportJson() {
  const trips = normalizeTrips(state.trips);
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "commute-memory",
    version: 4,
    trips,
  };
  downloadFile(`commute-records-${fileStamp()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
}

function getRecoverableTrip() {
  if (state.trip) return state.trip;
  if (state.pendingDraft?.trip) return state.pendingDraft.trip;
  return loadTripDraft()?.trip || null;
}

function prepareRecoveredTrip(rawTrip) {
  if (!rawTrip) return null;
  const trip = JSON.parse(JSON.stringify(rawTrip));
  trip.id = trip.id || Date.now();
  trip.startedAt = trip.startedAt || new Date().toISOString();
  trip.endedAt = trip.endedAt || new Date().toISOString();
  trip.direction = inferTripDirection(trip);
  trip.summary = summarizeTrip(trip);
  return isValidTrip(trip) ? trip : null;
}

function resetActiveTripUi() {
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  window.clearInterval(state.elapsedTimer);
  state.trip = null;
  state.watchId = null;
  state.elapsedTimer = null;
  state.targetAnchor = null;
  state.targetDwellStartedAt = null;
  els.startTrip.disabled = false;
  els.stopTrip.disabled = false;
  updateRecordingOverlay();
  drawRoute();
}

function saveRecoverableTrip() {
  const recoveredTrip = prepareRecoveredTrip(getRecoverableTrip());
  if (!recoveredTrip) {
    setUploadStatus("?桀?瘝??舀??港?摮?摰???????);
    setStatus("瘝??舀??渲???, "?桀??阮瘝?摰?暺?頠?鈭辣", false);
    return;
  }

  state.trips = normalizeTrips([
    recoveredTrip,
    ...state.trips.filter((trip) => String(trip.id) !== String(recoveredTrip.id)),
  ]);
  saveTrips();
  clearTripDraft();
  resetActiveTripUi();
  renderHistory();
  renderDashboard();
  setStatus("撌脫??港?摮?, "鞈?撌脣神?交璈風?脩???, false);
  setUploadStatus("撌脫??港?摮?祆?嚗遣霅啁??餅???箏???CSV?????單??啜?);
}

function exportRecoverableTrip() {
  const recoveredTrip = prepareRecoveredTrip(getRecoverableTrip());
  if (!recoveredTrip) {
    setUploadStatus("?桀?瘝??臬?箇??阮鞈???);
    return;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    app: "commute-memory",
    version: 5,
    type: "recovered_trip",
    trip: recoveredTrip,
  };
  downloadFile(`commute-recovered-${fileStamp()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  setUploadStatus("撌脣?箸??渲?蝔?JSON嚗閬?Excel ?敦嚗??????港?摮?????臬摰 CSV??);
}

function exportCsv() {
  const trips = normalizeTrips(state.trips);
  const rows = [
    [
      "recordType",
      "tripId",
      "tripStartedAt",
      "tripEndedAt",
      "direction",
      "source",
      "minutes",
      "km",
      "points",
      "laneSamples",
      "mainLane",
      "segmentStartAt",
      "segmentEndAt",
      "durationSeconds",
      "segmentDistanceKm",
      "pointAt",
      "lat",
      "lng",
      "accuracy",
      "speedKmh",
      "distanceFromStartKm",
      "heading",
      "movementStatus",
      "possibleLaneShift",
      "shiftConfidence",
      "effectiveLane",
      "manualLane",
      "visionLane",
      "laneIndex",
      "roadLaneCount",
      "flow",
    ],
  ];

  for (const trip of trips) {
    const summary = trip.summary || summarizeTrip(trip);
    rows.push([
      "SUMMARY",
      trip.id,
      trip.startedAt,
      trip.endedAt || "",
      trip.direction || "",
      trip.source || "",
      summary.minutes,
      summary.km,
      summary.points,
      summary.laneSamples,
      summary.mainLane,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      summary.roadLaneCount,
      flowLabel(summary.lastFlow),
    ]);

    const segments = buildLaneSegments(trip);
    for (const segment of segments) {
      rows.push([
        "LANE_SEGMENT",
        trip.id,
        trip.startedAt,
        trip.endedAt || "",
        trip.direction || "",
        trip.source || "",
        "",
        "",
        "",
        "",
        "",
        segment.startAt,
        segment.endAt,
        segment.durationSeconds,
        segment.distanceKm,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        segment.lane,
        "",
        "",
        segment.laneIndex ?? "",
        segment.roadLaneCount ?? "",
        flowLabel(segment.flow),
      ]);
    }

    let distanceMeters = 0;
    let lastPoint = null;
    for (const point of trip.points || []) {
      if (lastPoint) distanceMeters += distanceBetween(lastPoint, point);
      const effectiveLane = point.effectiveLane || null;
      rows.push([
        "GPS_POINT",
        trip.id,
        trip.startedAt,
        trip.endedAt || "",
        trip.direction || "",
        trip.source || "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        point.at,
        point.lat,
        point.lng,
        Math.round(point.accuracy ?? 0),
        point.speed === null || point.speed === undefined ? "" : Math.round(point.speed * 3.6),
        Number((distanceMeters / 1000).toFixed(3)),
        point.heading ?? "",
        point.movementStatus || "",
        point.possibleLaneShift || "",
        point.shiftConfidence || "",
        effectiveLane?.label || "",
        point.manualLane?.label || "",
        point.visionLane?.label || "",
        effectiveLane?.laneIndex ?? point.manualLane?.laneIndex ?? "",
        point.roadLaneCount ?? "",
        flowLabel(point.trafficFlow),
      ]);
      lastPoint = point;
    }
  }

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadFile(`commute-full-${fileStamp()}.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
}

function exportLaneChangeCsv() {
  const rows = [
    [
      "tripId",
      "tripStartedAt",
      "direction",
      "segmentStartAt",
      "segmentEndAt",
      "durationSeconds",
      "distanceKm",
      "lane",
      "laneIndex",
      "roadLaneCount",
      "source",
      "flow",
      "pointCount",
    ],
  ];

  for (const trip of state.trips) {
    const segments = buildLaneSegments(trip);
    for (const segment of segments) {
      rows.push([
        trip.id,
        trip.startedAt,
        trip.direction || "",
        segment.startAt,
        segment.endAt,
        segment.durationSeconds,
        segment.distanceKm,
        segment.lane,
        segment.laneIndex ?? "",
        segment.roadLaneCount ?? "",
        segment.source || "",
        flowLabel(segment.flow),
        segment.pointCount,
      ]);
    }
  }

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadFile(`commute-lane-changes-${fileStamp()}.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
}

function exportPointCsv() {
  const rows = [
    [
      "tripId",
      "tripStartedAt",
      "direction",
      "at",
      "lat",
      "lng",
      "accuracy",
      "speedKmh",
      "distanceFromStartKm",
      "effectiveLane",
      "manualLane",
      "visionLane",
      "laneIndex",
      "roadLaneCount",
      "flow",
    ],
  ];

  for (const trip of state.trips) {
    let distanceMeters = 0;
    let lastPoint = null;
    for (const point of trip.points || []) {
      if (lastPoint) distanceMeters += distanceBetween(lastPoint, point);
      const effectiveLane = point.effectiveLane || null;
      rows.push([
        trip.id,
        trip.startedAt,
        trip.direction || "",
        point.at,
        point.lat,
        point.lng,
        Math.round(point.accuracy ?? 0),
        point.speed === null || point.speed === undefined ? "" : Math.round(point.speed * 3.6),
        Number((distanceMeters / 1000).toFixed(3)),
        effectiveLane?.label || "",
        point.manualLane?.label || "",
        point.visionLane?.label || "",
        effectiveLane?.laneIndex ?? point.manualLane?.laneIndex ?? "",
        point.roadLaneCount ?? "",
        flowLabel(point.trafficFlow),
      ]);
      lastPoint = point;
    }
  }

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadFile(`commute-points-${fileStamp()}.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
}

function buildLaneSegments(trip) {
  const points = (trip.points || []).filter((point) => point.effectiveLane);
  const segments = [];
  let current = null;
  let lastPoint = null;
  let runningDistance = 0;

  for (const point of points) {
    const lane = point.effectiveLane;
    const key = [
      lane.label,
      lane.laneIndex ?? "",
      point.roadLaneCount ?? "",
      lane.source || "",
      point.trafficFlow || "",
    ].join("|");

    if (lastPoint) runningDistance += distanceBetween(lastPoint, point);

    if (!current || current.key !== key) {
      if (current) {
        current.endAt = lastPoint.at;
        current.durationSeconds = secondsBetween(current.startAt, current.endAt);
        current.distanceKm = Number(((runningDistance - current.startDistanceMeters) / 1000).toFixed(3));
        segments.push(current);
      }
      current = {
        key,
        startAt: point.at,
        endAt: point.at,
        startDistanceMeters: runningDistance,
        durationSeconds: 0,
        distanceKm: 0,
        lane: lane.label,
        laneIndex: lane.laneIndex ?? "",
        roadLaneCount: point.roadLaneCount ?? "",
        source: lane.source || "",
        flow: point.trafficFlow || "",
        pointCount: 0,
      };
    }

    current.pointCount += 1;
    lastPoint = point;
  }

  if (current) {
    current.endAt = lastPoint.at;
    current.durationSeconds = secondsBetween(current.startAt, current.endAt);
    current.distanceKm = Number(((runningDistance - current.startDistanceMeters) / 1000).toFixed(3));
    segments.push(current);
  }

  return segments;
}

function secondsBetween(startAt, endAt) {
  return Math.max(0, Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 1000));
}

async function uploadLatestTrip() {
  state.trips = normalizeTrips(state.trips);
  if (!state.trips.length) {
    setUploadStatus("?桀?瘝??臭??喟?蝝??);
    return;
  }
  await uploadTrip(state.trips[0], "??銝??唬?頞?);
}

async function uploadAllTrips() {
  state.trips = normalizeTrips(state.trips);
  if (!state.trips.length) {
    setUploadStatus("?桀?瘝??臭??喟?蝝??);
    return;
  }
  await uploadPayload({
    type: "commute_trips_batch",
    exportedAt: new Date().toISOString(),
    app: "commute-memory",
    version: 4,
    trips: state.trips,
  }, `撌脤?券 ${state.trips.length} 頞??);
}

async function uploadTrip(trip, reason) {
  await uploadPayload({
    type: "commute_trip",
    uploadedAt: new Date().toISOString(),
    reason,
    app: "commute-memory",
    version: 4,
    trip,
  }, `撌脤 ${formatDate(new Date(trip.startedAt))} ??蝝?);
}

async function uploadPayload(payload, successMessage) {
  const endpoint = state.uploadEndpoint || els.uploadEndpoint?.value.trim() || defaultUploadEndpoint;
  if (!endpoint) {
    setUploadStatus("撠閮剖?銝蝬脣???);
    return;
  }

  setUploadStatus("銝銝?..");
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    const text = await response.text();
    if (!response.ok || text.includes("?航炊") || text.includes("?曆??唬誑銝?隞斤Ⅳ?賢?")) {
      const error = new Error(extractGoogleScriptError(text) || `HTTP ${response.status}`);
      error.confirmedFailure = true;
      throw error;
    }
    setUploadStatus(successMessage);
  } catch (err) {
    if (err.confirmedFailure) {
      setUploadStatus(`銝憭望?嚗?{err.message}`);
      return;
    }
    try {
      await fetch(endpoint, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      setUploadStatus(`${successMessage}嚗汗?其???交蝯?嚗?蝣箄? Google Sheet嚗);
    } catch {
      setUploadStatus(`銝憭望?嚗?{err.message}`);
    }
  }
}

function extractGoogleScriptError(html) {
  const match = String(html || "").match(/<div style="text-align:center[^>]*>(.*?)<\/div>/);
  return match ? match[1].replace(/<[^>]+>/g, "") : "";
}

function setUploadStatus(text) {
  if (els.uploadStatus) els.uploadStatus.textContent = text;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function fileStamp() {
  const pad = (value) => String(value).padStart(2, "0");
  const now = new Date();
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function setRouteNote(text) {
  els.routeNote.textContent = text;
}

function setStatus(title, detail, active) {
  els.recordStatus.classList.toggle("active", active);
  els.recordStatus.querySelector("strong").textContent = title;
  els.recordStatus.querySelector("small").textContent = detail;
}

function clearAllLocalRecords() {
  if (state.trip && !window.confirm("?桀?甇?蝝??蝣箏?閬??斗璈風?脯?蝔輯??桀?頠楚??")) return;
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  window.clearInterval(state.elapsedTimer);
  state.trips = [];
  state.trip = null;
  state.watchId = null;
  state.elapsedTimer = null;
  state.targetAnchor = null;
  state.targetDwellStartedAt = null;
  state.pendingDraft = null;
  localStorage.removeItem(storageKey);
  localStorage.removeItem(legacyStorageKey);
  localStorage.removeItem(draftStorageKey);
  els.startTrip.disabled = false;
  els.stopTrip.disabled = false;
  els.restoreBanner?.classList.add("is-hidden");
  els.elapsed.textContent = "00:00";
  els.speed.textContent = "-- km/h";
  els.distance.textContent = "0.0 km";
  els.pointCount.textContent = "0";
  setRouteNote("撌脫??斗璈風?脯?蝔輯??桀?頠楚??);
  setStatus("撌脫??斤???, "?舫??圈?憪敞蝛???, false);
  updateRecordingOverlay();
  updateDriveConsole();
  drawRoute();
  renderHistory();
  renderDashboard();
}

els.autoMode.addEventListener("click", toggleAutoMode);
els.modeRecord?.addEventListener("click", () => setViewMode("record"));
els.modeDrive?.addEventListener("click", () => setViewMode("drive"));
els.modeGuidance?.addEventListener("click", () => setViewMode("guidance"));
els.modeDashboard?.addEventListener("click", () => setViewMode("dashboard"));
els.guidanceToggle?.addEventListener("click", toggleGuidance);
els.loadCctv?.addEventListener("click", loadForwardCctv);
els.analyzeCctv?.addEventListener("click", analyzeCctvFlow);
els.clearCctv?.addEventListener("click", clearCctv);
els.restoreTrip?.addEventListener("click", restoreDraftTrip);
els.saveDraftTrip?.addEventListener("click", saveRecoverableTrip);
els.exportDraft?.addEventListener("click", exportRecoverableTrip);
els.discardDraft?.addEventListener("click", clearTripDraft);
els.startTrip.addEventListener("click", () => startTrip());
els.stopTrip.addEventListener("click", () => stopTrip());
els.forceSaveTrip?.addEventListener("click", saveRecoverableTrip);
els.cameraToggle.addEventListener("click", toggleCamera);
els.cameraSelect.addEventListener("change", switchCamera);
els.zoomSlider.addEventListener("input", applyZoom);
els.exportJson.addEventListener("click", exportJson);
els.exportCsv.addEventListener("click", exportCsv);
els.uploadLatest.addEventListener("click", uploadLatestTrip);
els.uploadAll.addEventListener("click", uploadAllTrips);
els.saveUploadEndpoint?.addEventListener("click", saveUploadEndpoint);
els.clearHistory.addEventListener("click", clearAllLocalRecords);
els.flowButtons.querySelectorAll("button").forEach((button) => {
  button.addEventListener("click", () => setTrafficFlow(button.dataset.flow));
});

buildLaneCountButtons();
buildManualLaneButtons();
updateSegmentedState();
els.zoomControl.classList.add("is-hidden");
if (els.uploadEndpoint) els.uploadEndpoint.value = state.uploadEndpoint;
setUploadStatus("撌脣撱?Google Sheet 銝雿蔭嚗???蝔??芸?銝??);
updateRecordingOverlay();
updateDriveConsole();
renderDriveAssist();
drawRouteGrid(els.routeCanvas.getContext("2d"), els.routeCanvas.width, els.routeCanvas.height);
renderHistory();
renderDashboard();
showRestoreDraft();

