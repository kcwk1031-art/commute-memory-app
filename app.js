const storageKey = "commute-memory-trips-v2";
const legacyStorageKey = "commute-memory-trips-v1";
const draftStorageKey = "commute-memory-trip-draft-v1";
const uploadEndpointKey = "commute-memory-upload-endpoint";
const defaultUploadEndpoint = "https://script.google.com/macros/s/AKfycbxyCTrMum6RvHmj2n0O5Yh4In8w4uUiGshhLI1ByLx0skZpJJbGQivfBJIl91LtDmc/exec";
const minVisionConfidence = 45;
const expectedCommuteMeters = 47000;
const maxReliableAccuracyMeters = 180;
const maxReliableSpeedKmh = 170;

const els = {
  floatingRecorder: document.querySelector("#floatingRecorder"),
  modeRecord: document.querySelector("#modeRecord"),
  modeGuidance: document.querySelector("#modeGuidance"),
  modeDashboard: document.querySelector("#modeDashboard"),
  recordViews: document.querySelectorAll(".record-view"),
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
  pendingDraft: null,
  uploadEndpoint: loadUploadEndpoint(),
  trips: loadTrips(),
};

const commuteAnchors = {
  yangmei: { lat: 24.9186, lng: 121.1458, radiusMeters: 8500, label: "楊梅區域" },
  xindian: { lat: 24.9676, lng: 121.5414, radiusMeters: 6500, label: "新店區域" },
};

state.trips = normalizeTrips(state.trips);

function loadTrips() {
  try {
    const current = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(current)) return current;
  } catch {}

  try {
    const legacy = JSON.parse(localStorage.getItem(legacyStorageKey));
    return Array.isArray(legacy) ? legacy : [];
  } catch {
    return [];
  }
}

function saveTrips() {
  state.trips = normalizeTrips(state.trips);
  localStorage.setItem(storageKey, JSON.stringify(state.trips.slice(0, 80)));
}

function saveTripDraft(force = false) {
  if (!state.trip) return;
  const now = Date.now();
  if (!force && now - state.lastDraftSavedAt < 15000 && (state.trip.points.length % 5 !== 0)) return;
  state.trip.summary = summarizeTrip(state.trip);
  localStorage.setItem(draftStorageKey, JSON.stringify({
    savedAt: new Date().toISOString(),
    trip: state.trip,
    manualState: currentManualState(),
  }));
  state.lastDraftSavedAt = now;
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
    els.restoreText.textContent = `上一趟約 ${summary.minutes} 分鐘、${summary.km} km、${summary.points} 點，尚未正常結束。`;
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
  setStatus("已恢復紀錄", "GPS 軌跡正在續寫", true);
  updateElapsed();
  updateRecordingOverlay();
  drawRoute();
  saveTripDraft(true);
  els.restoreBanner?.classList.add("is-hidden");
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
  if (!trip) return false;
  const points = trip.points || [];
  const hasGpsTrace = points.length >= 2;
  const hasLaneData = (trip.laneSamples || []).length > 0;
  const hasEvents = (trip.events || []).length > 1;
  return hasGpsTrace || hasLaneData || hasEvents;
}

function loadUploadEndpoint() {
  return defaultUploadEndpoint;
}

function saveUploadEndpoint() {
  if (!els.uploadEndpoint) return;
  state.uploadEndpoint = els.uploadEndpoint.value.trim();
  if (state.uploadEndpoint) {
    localStorage.setItem(uploadEndpointKey, state.uploadEndpoint);
    setUploadStatus("已儲存上傳網址；之後結束行程會自動上傳。");
  } else {
    localStorage.removeItem(uploadEndpointKey);
    setUploadStatus("已清除上傳網址。");
  }
}

function toggleAutoMode() {
  if (state.autoMode) {
    stopAutoMode();
    return;
  }

  if (!navigator.geolocation) {
    setRouteNote("此瀏覽器不支援定位功能。");
    return;
  }

  state.autoMode = true;
  state.autoWatchId = navigator.geolocation.watchPosition(handleAutoPosition, handleGeoError, {
    enableHighAccuracy: true,
    maximumAge: 1500,
    timeout: 12000,
  });

  els.autoMode.textContent = "關閉自動模式";
  setStatus("自動監看中", "接近通勤情境會自動開筆", true);
  setRouteNote("自動模式已啟動：離開楊梅區域並往新店方向移動時會自動開始紀錄。");
  updateRecordingOverlay();
}

function stopAutoMode() {
  if (state.autoWatchId !== null) navigator.geolocation.clearWatch(state.autoWatchId);
  state.autoWatchId = null;
  state.autoMode = false;
  state.lastAutoPoint = null;
  els.autoMode.textContent = "啟動自動模式";

  if (!state.trip) setStatus("尚未紀錄", "等待啟動定位", false);
  setRouteNote("自動模式已關閉。");
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
      setRouteNote(`自動監看中：距楊梅約 ${(distanceFromYangmei / 1000).toFixed(1)} 公里，距新店約 ${(distanceFromXindian / 1000).toFixed(1)} 公里。`);
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
    setRouteNote("此瀏覽器不支援定位功能。");
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
  setStatus("紀錄中", options.source === "auto" ? "自動模式已開筆" : "GPS 軌跡正在寫入", true);
  updateElapsed();

  if (options.source !== "auto") {
    try {
      state.watchId = navigator.geolocation.watchPosition(handlePosition, handleGeoError, {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 12000,
      });
    } catch (err) {
      setRouteNote(`定位啟動失敗，但草稿已建立：${err.message}`);
      setStatus("定位未啟動", "可稍後重試；目前草稿已保留", true);
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
  const shouldSave = isValidTrip(finishedTrip);
  if (shouldSave) {
    state.trips.unshift(finishedTrip);
    saveTrips();
  }
  if (shouldSave && state.uploadEndpoint) {
    void uploadTrip(finishedTrip, "結束後自動上傳");
  }
  if (shouldSave) clearTripDraft();

  state.trip = null;
  state.watchId = null;
  state.elapsedTimer = null;
  state.targetAnchor = null;
  state.targetDwellStartedAt = null;
  els.startTrip.disabled = false;
  els.stopTrip.disabled = false;

  if (!shouldSave) {
    showRestoreDraft();
    setStatus("尚未保存", "資料不足，草稿已保留，可用救援保存或匯出", false);
  } else if (state.autoMode && source === "auto") {
    setStatus("自動監看中", "上一趟已保存，等待下一趟", true);
  } else {
    setStatus("已完成紀錄", "已保存到本機歷史資料", false);
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
    saveTripDraft();
  }

  updateMetrics(point);
  drawRoute();
  updateRecordingOverlay();
}

function gpsPointFromPosition(pos) {
  return {
    at: new Date().toISOString(),
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    speed: typeof pos.coords.speed === "number" ? pos.coords.speed : null,
    heading: null,
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
  setRouteNote(`定位無法啟動：${err.message}`);
  els.startTrip.disabled = Boolean(state.trip);
  els.stopTrip.disabled = false;
  if (state.trip) {
    saveTripDraft(true);
    setStatus("定位暫時失敗", "草稿已保留，可結束保存或救援", true);
  } else {
    setStatus("定位失敗", "請確認瀏覽器定位權限", false);
  }
}

async function toggleCamera() {
  if (state.cameraStream) {
    stopCamera();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    els.laneReason.textContent = "此瀏覽器不支援相機權限。";
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
    els.cameraToggle.textContent = "關閉相機實驗";
    await refreshCameraDevices();
    setupZoomControl();
    analyzeLaneFrame();
  } catch (err) {
    els.laneResult.textContent = "相機未啟動";
    els.laneReason.textContent = `請確認相機權限：${err.message}`;
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
  els.cameraToggle.textContent = "相機實驗功能";
  els.laneResult.textContent = getEffectiveLane()?.label || "尚無資料";
  els.laneConfidence.textContent = "信心度 --";
  els.zoomControl.classList.add("is-hidden");
  updateRecordingOverlay();
}

async function refreshCameraDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  state.cameraDevices = devices.filter((device) => device.kind === "videoinput");
  const currentTrack = state.cameraStream?.getVideoTracks()[0];
  const currentDeviceId = currentTrack?.getSettings?.().deviceId || state.selectedDeviceId;

  els.cameraSelect.innerHTML = `<option value="">自動後鏡頭</option>`;
  state.cameraDevices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `鏡頭 ${index + 1}`;
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
    els.laneReason.textContent = "此鏡頭不支援瀏覽器縮放控制，可改選其他鏡頭。";
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
  let lane = "影像信心不足";
  if (valid) {
    lane = "中線或車道中央";
    if (offset > .18) lane = "偏外線／右側車道";
    if (offset < -.18) lane = "偏內線／左側車道";
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
  els.laneConfidence.textContent = `信心度 ${result.confidence}%`;

  if (state.currentLaneIndex) {
    els.laneReason.textContent = `目前以手動車道為準；影像只做輔助。可見線數 ${result.visibleLineCount}，影像信心 ${result.confidence}%。`;
  } else if (result.valid) {
    els.laneReason.textContent = `影像偵測可用；可見線數 ${result.visibleLineCount}。`;
  } else {
    els.laneReason.textContent = `影像信心不足，未寫入有效車道。建議改鏡頭、調縮放，或用手動車道按鈕。`;
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
    els.laneReason.textContent = "已切換手動車道標記，後續 GPS 點會一併保存。";
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
  if (!index) return "未標記";
  const side = index === 1 ? "內側" : index === count ? "外側" : "中間";
  return `第 ${index}/${count} 車道（${side}）`;
}

function flowLabel(flow) {
  return {
    left_faster: "左線較快",
    same: "差不多",
    right_faster: "右線較快",
  }[flow] || "";
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
    button.textContent = `${count} 線`;
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
  if (index === 1) return "內";
  if (index === count) return "外";
  if (count === 3) return "中";
  return `中${index - 1}`;
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
  const laneText = point.effectiveLane ? `；目前車道：${point.effectiveLane.label}` : "";
  setRouteNote(`最近定位精度約 ${Math.round(point.accuracy)} 公尺${laneText}`);
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
      els.recordingOverlay.textContent = "尚未紀錄";
      els.recordingOverlay.classList.remove("is-recording");
    }
    updateFloatingRecorder(false, "未紀錄", state.autoMode ? "自動模式待命" : "GPS 待命");
    updateDriveConsole();
    return;
  }

  const seconds = Math.floor((Date.now() - new Date(state.trip.startedAt).getTime()) / 1000);
  const min = String(Math.floor(seconds / 60)).padStart(2, "0");
  const sec = String(seconds % 60).padStart(2, "0");
  const km = (state.trip.distanceMeters / 1000).toFixed(1);
  const points = state.trip.points.length;
  const lane = getEffectiveLane()?.label || "車道未標記";
  const detail = `${min}:${sec}｜${km} km｜${points} 點｜${lane}`;
  if (els.recordingOverlay) {
    els.recordingOverlay.textContent = `紀錄中 ${detail}`;
    els.recordingOverlay.classList.add("is-recording");
  }
  updateFloatingRecorder(true, "紀錄中", detail);
  updateDriveConsole();
}

function updateDriveConsole() {
  if (!els.driveStatusMain) return;

  if (!state.trip) {
    els.driveStatusMain.textContent = state.autoMode ? "自動待命" : "待命";
    els.driveStatusDetail.textContent = state.autoMode ? "接近通勤起點後會自動開始" : "按下開始後會保存 GPS 與車道紀錄";
    els.driveLaneMain.textContent = "未標記";
    els.driveLaneDetail.textContent = "可用下方按鈕手動標記內／中／外線";
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
  els.driveStatusMain.textContent = "紀錄中";
  els.driveStatusDetail.textContent = lastPoint
    ? `最近定位精度約 ${Math.round(lastPoint.accuracy || 0)} 公尺`
    : "等待第一個 GPS 定位點";
  els.driveLaneMain.textContent = lane?.label || "未標記";
  els.driveLaneDetail.textContent = lane
    ? `${sourceLabel(lane.source)}｜${state.roadLaneCount} 線道`
    : "建議手動標記，避免相機低信心誤判";
  els.driveTime.textContent = `${min}:${sec}`;
  els.driveKm.textContent = `${(state.trip.distanceMeters / 1000).toFixed(1)} km`;
  els.drivePoints.textContent = String(state.trip.points.length);
}

function updateFloatingRecorder(active, title, detail) {
  if (!els.floatingRecorder) return;
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

function drawRoute() {
  const canvas = els.routeCanvas;
  const ctx = canvas.getContext("2d");
  const points = state.trip?.points || [];
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
    acc[sample.lane] = (acc[sample.lane] || 0) + 1;
    return acc;
  }, {});
  const mainLane = Object.entries(laneCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "無有效車道資料";
  const manualSamples = (trip.laneSamples || []).filter((sample) => sample.source === "manual").length;
  const visionSamples = (trip.laneSamples || []).filter((sample) => sample.source === "vision").length;
  const lastPoint = trip.points?.at?.(-1);
  return {
    minutes,
    km: Number(((trip.distanceMeters || 0) / 1000).toFixed(1)),
    points: trip.points?.length || 0,
    laneSamples: trip.laneSamples?.length || 0,
    manualSamples,
    visionSamples,
    mainLane,
    roadLaneCount: lastPoint?.roadLaneCount || "",
    lastFlow: lastPoint?.trafficFlow || "",
  };
}

function renderHistory() {
  if (!state.trips.length) {
    els.historyList.innerHTML = `<div class="empty-history">目前沒有歷史資料。完成第一趟後會顯示在這裡。</div>`;
    renderDashboard();
    return;
  }

  els.historyList.innerHTML = state.trips.map((trip) => {
    const started = new Date(trip.startedAt);
    const summary = trip.summary || summarizeTrip(trip);
    return `
      <div class="history-row">
        <strong>${formatDate(started)}</strong>
        <span>${summary.minutes} 分鐘</span>
        <span>${summary.km} 公里</span>
        <span>${summary.mainLane}</span>
      </div>
    `;
  }).join("");
  renderDashboard();
}

function setViewMode(mode) {
  const showRecord = mode === "record";
  const showGuidance = mode === "guidance";
  const showDashboard = mode === "dashboard";
  els.modeRecord?.classList.toggle("is-active", showRecord);
  els.modeGuidance?.classList.toggle("is-active", showGuidance);
  els.modeDashboard?.classList.toggle("is-active", showDashboard);
  els.recordViews.forEach((view) => view.classList.toggle("is-hidden", !showRecord));
  els.guidanceView?.classList.toggle("is-hidden", !showGuidance);
  els.dashboardView?.classList.toggle("is-hidden", !showDashboard);
  if (showDashboard) renderDashboard();
}

function renderDashboard() {
  if (!els.dashboardSummary || !els.dashboardDirections) return;

  const model = buildDashboardModel(normalizeTrips(state.trips));
  els.dashboardVerdict.textContent = model.verdict;
  els.dashboardSummary.innerHTML = [
    dashboardCard("有效趟數", `${model.totalTrips} 趟`),
    dashboardCard("車道樣本", `${model.totalLaneSamples.toLocaleString("zh-TW")} 筆`),
    dashboardCard("建議狀態", model.readyDirections >= 1 ? "可參考趨勢" : "先累積資料"),
    dashboardCard("除錯資料", `${model.totalPoints.toLocaleString("zh-TW")} GPS 點`),
  ].join("");

  if (!model.totalTrips) {
    els.dashboardDirections.innerHTML = `<div class="direction-card"><h3>尚無資料</h3><div class="recommendation">完成並保存第一趟後，這裡會開始整理方向、時間與車道趨勢。</div></div>`;
    return;
  }

  els.dashboardDirections.innerHTML = model.directions.map((direction) => `
    <article class="direction-card">
      <div>
        <span>${direction.label}</span>
        <h3>${direction.tripCount} 趟｜平均 ${direction.avgMinutes} 分｜${direction.avgKm} km</h3>
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
    manual: "手動鎖定",
    history: "歷史統計",
    vision: "相機推估",
    system: "系統判斷",
  }[source] || "系統判斷";
  const levelLabel = {
    insufficient: "資料不足",
    low: "低可信",
    medium: "中可信",
    high: "高可信",
    manual: "手動確認",
  }[normalizedLevel];

  return {
    level: normalizedLevel,
    source: source || "system",
    sourceLabel,
    levelLabel,
    samples,
    tripCount,
    visionShare,
    text: `${levelLabel}｜${sourceLabel}`,
  };
}

function recommendLaneForSegmentV2(direction, segmentIndex) {
  const currentLane = getEffectiveLane();
  if (currentLane?.source === "manual") {
    const confidence = confidenceContract({ level: "manual", source: "manual", samples: 1 });
    return {
      title: `鎖定 ${currentLane.label}`,
      detail: "這是你當下手動標記的車道，優先於歷史統計與相機推估。",
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
      title: "先照路況",
      detail: `同方向同路段目前只有 ${tripIds.size} 趟、${samples} 筆可用車道資料；不顯示暫定車道，避免誤導。`,
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
  const titlePrefix = level === "high" || level === "medium" ? "參考" : "觀察到";
  const detailParts = [
    `依 ${tripIds.size} 趟、${samples} 筆同路段資料統計。`,
    avgSpeed ? `有效平均速度約 ${avgSpeed} km/h。` : "",
    level === "low" ? "可信度仍低，請不要只因本提示變換車道。" : "可作為同方向同路段參考。",
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
      title: "此瀏覽器不支援定位",
      subtitle: "請改用 Safari 或 Chrome 開啟，並允許定位權限。",
      directionLabel: "--",
      segmentLabel: "--",
      speedLabel: "-- km/h",
      confidenceLabel: "--",
      recommendation: "無法啟動",
      detail: "目前拿不到 GPS 定位功能。",
      level: "warn",
    });
    return;
  }

  state.guidanceActive = true;
  state.lastGuidancePoint = null;
  els.guidanceToggle.textContent = "停止即時定位";
  updateGuidanceView({
    title: "正在定位中",
    subtitle: "請保持此頁開啟，系統會依 GPS 更新即時建議。",
    directionLabel: "判斷中",
    segmentLabel: "判斷中",
    speedLabel: "-- km/h",
    confidenceLabel: "--",
    recommendation: "定位中",
    detail: "取得第一筆 GPS 後會開始判斷方向與路段。",
    level: "warn",
  });

  state.guidanceWatchId = navigator.geolocation.watchPosition(handleGuidancePosition, handleGuidanceError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 12000,
  });
  updateFloatingRecorder(true, "即時建議中", "GPS 定位啟動");
}

function stopGuidance() {
  if (state.guidanceWatchId !== null) navigator.geolocation.clearWatch(state.guidanceWatchId);
  state.guidanceWatchId = null;
  state.lastGuidancePoint = null;
  state.guidanceActive = false;
  if (els.guidanceToggle) els.guidanceToggle.textContent = "啟動即時定位";
  updateGuidanceView({
    title: "即時建議已停止",
    subtitle: "再次啟動後會重新依 GPS 判斷目前路段。",
    directionLabel: "--",
    segmentLabel: "--",
    speedLabel: "-- km/h",
    confidenceLabel: "--",
    recommendation: "尚未啟動",
    detail: "啟動後會判斷方向、路段與建議車道。",
    level: "",
  });
  if (!state.trip) updateFloatingRecorder(false, "待命", state.autoMode ? "自動模式待命" : "GPS 待命");
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
      title: "GPS 精度不足",
      subtitle: `目前定位精度約 ${Math.round(point.accuracy || 0)} 公尺，先暫停建議。`,
      directionLabel: directionLabel || "判斷中",
      segmentLabel: segment?.label || "--",
      speedLabel: Number.isFinite(speedKmh) ? `${Math.round(speedKmh)} km/h` : "-- km/h",
      confidenceLabel: "資料不足",
      recommendation: "先照路況",
      detail: "定位誤差太大時容易抓錯方向與路段，暫不提供車道建議。",
      level: "warn",
    });
  } else if (!direction || !segment) {
    updateGuidanceView({
      title: "正在判斷方向",
      subtitle: "車輛移動一小段後，方向會更準。",
      directionLabel: directionLabel || "判斷中",
      segmentLabel: "--",
      speedLabel: Number.isFinite(speedKmh) ? `${Math.round(speedKmh)} km/h` : "-- km/h",
      confidenceLabel: "低",
      recommendation: "先照路況",
      detail: "目前 GPS 尚不足以判斷你是在楊梅往新店，或新店往楊梅。",
      level: "warn",
    });
  } else {
    updateGuidanceView({
      title: "即時建議運作中",
      subtitle: `目前定位精度約 ${Math.round(point.accuracy || 0)} 公尺`,
      directionLabel,
      segmentLabel: segment.label,
      speedLabel: Number.isFinite(speedKmh) ? `${Math.round(speedKmh)} km/h` : "-- km/h",
      confidenceLabel: recommendation.confidenceLabel,
      recommendation: recommendation.title,
      detail: recommendation.detail,
      level: recommendation.level,
    });
    updateFloatingRecorder(true, "即時建議中", `${directionLabel}｜${segment.label}｜${recommendation.title}`);
  }

  state.lastGuidancePoint = point;
}

function handleGuidanceError(error) {
  updateGuidanceView({
    title: "定位失敗",
    subtitle: "請確認手機瀏覽器已允許定位，且頁面保持開啟。",
    directionLabel: "--",
    segmentLabel: "--",
    speedLabel: "-- km/h",
    confidenceLabel: "--",
    recommendation: "無法建議",
    detail: error?.message || "目前無法取得 GPS。",
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
    ? ["楊梅端", "中壢/桃園段", "北桃園/隧道前後", "新店端"]
    : ["新店端", "北桃園/隧道前後", "桃園/中壢段", "楊梅端"];
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
    ? ["楊梅端", "中壢/桃園段", "北桃園/隧道前後", "新店端"]
    : ["新店端", "北桃園/隧道前後", "桃園/中壢段", "楊梅端"];
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
      title: `目前 ${currentLane.label}`,
      detail: "已偵測到你有手動標記目前車道，即時畫面先以手動標記為主，避免歷史資料誤判。",
      confidenceLabel: "手動",
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
      title: "先照路況",
      detail: "這個方向與路段還沒有足夠車道紀錄，先繼續累積資料。",
      confidenceLabel: "資料不足",
      level: "warn",
    };
  }

  const share = topLane[1] / samples;
  const avgSpeed = speedCount ? Math.round(speedTotal / speedCount) : null;
  const confidenceLabel = tripIds.size >= 3 && samples >= 80 && share >= .45
    ? "中"
    : "低";
  const title = confidenceLabel === "中" ? `建議 ${topLane[0]}` : `暫定 ${topLane[0]}`;
  const detailParts = [
    `依 ${tripIds.size} 趟、${samples} 筆同路段紀錄推估。`,
    avgSpeed ? `該路段平均約 ${avgSpeed} km/h。` : "",
    confidenceLabel === "低" ? "資料仍少，請以即時路況與安全為主。" : "可作為目前路段參考。",
  ].filter(Boolean);

  return {
    title,
    detail: detailParts.join(" "),
    confidenceLabel,
    level: confidenceLabel === "中" ? "good" : "warn",
  };
}

function directionLabelText(direction) {
  if (direction === "yangmei_to_xindian") return "楊梅 → 新店";
  if (direction === "xindian_to_yangmei") return "新店 → 楊梅";
  return "";
}

function buildDashboardModel(trips) {
  const validTrips = normalizeTrips(trips);
  const directions = [
    buildDirectionModel(validTrips, "yangmei_to_xindian", "楊梅 → 新店"),
    buildDirectionModel(validTrips, "xindian_to_yangmei", "新店 → 楊梅"),
  ];
  const totalTrips = directions.reduce((sum, item) => sum + item.tripCount, 0);
  const totalPoints = validTrips.reduce((sum, trip) => sum + (trip.points?.length || 0), 0);
  const totalLaneSamples = validTrips.reduce((sum, trip) => sum + (trip.laneSamples?.length || 0), 0);
  const readyDirections = directions.filter((item) => item.isReady).length;
  const verdict = readyDirections
    ? "已有方向可初步參考"
    : totalTrips
      ? "資料仍偏少，先看趨勢"
      : "尚無有效行程";

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
  const mainLane = laneCounts[0]?.[0] || "尚無車道資料";
  const isReady = tripCount >= 3 && laneCounts.length > 0;
  const recommendationTitle = isReady ? `目前可先參考：${mainLane}` : "目前不建議下定論";
  const recommendationDetail = isReady
    ? `此方向已有 ${tripCount} 趟紀錄，可先用主要車道當基準；後續還要累積尖峰、雨天、事故與不同出發時間資料。`
    : tripCount
      ? `目前只有 ${tripCount} 趟有效紀錄，適合看趨勢，不適合直接判定最佳車道或最佳路線。`
      : "此方向尚未有有效紀錄。";

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
    { label: "前段", laneCounts: {}, speeds: [] },
    { label: "中前", laneCounts: {}, speeds: [] },
    { label: "中後", laneCounts: {}, speeds: [] },
    { label: "後段", laneCounts: {}, speeds: [] },
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
    const lane = Object.entries(bucket.laneCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "資料不足";
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
    setUploadStatus("目前沒有可救援保存的定位或車道資料。");
    setStatus("沒有可救援資料", "目前草稿沒有定位點或車道事件", false);
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
  setStatus("已救援保存", "資料已寫入本機歷史紀錄", false);
  setUploadStatus("已救援保存到本機；建議立刻按「匯出完整 CSV」或「上傳最新」。");
}

function exportRecoverableTrip() {
  const recoveredTrip = prepareRecoveredTrip(getRecoverableTrip());
  if (!recoveredTrip) {
    setUploadStatus("目前沒有可匯出的草稿資料。");
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
  setUploadStatus("已匯出救援草稿 JSON；若要 Excel 明細，請先按「救援保存目前資料」再匯出完整 CSV。");
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
    setUploadStatus("目前沒有可上傳的紀錄。");
    return;
  }
  await uploadTrip(state.trips[0], "手動上傳最新一趟");
}

async function uploadAllTrips() {
  state.trips = normalizeTrips(state.trips);
  if (!state.trips.length) {
    setUploadStatus("目前沒有可上傳的紀錄。");
    return;
  }
  await uploadPayload({
    type: "commute_trips_batch",
    exportedAt: new Date().toISOString(),
    app: "commute-memory",
    version: 4,
    trips: state.trips,
  }, `已送出全部 ${state.trips.length} 趟紀錄。`);
}

async function uploadTrip(trip, reason) {
  await uploadPayload({
    type: "commute_trip",
    uploadedAt: new Date().toISOString(),
    reason,
    app: "commute-memory",
    version: 4,
    trip,
  }, `已送出 ${formatDate(new Date(trip.startedAt))} 這趟紀錄。`);
}

async function uploadPayload(payload, successMessage) {
  const endpoint = state.uploadEndpoint || els.uploadEndpoint?.value.trim() || defaultUploadEndpoint;
  if (!endpoint) {
    setUploadStatus("尚未設定上傳網址。");
    return;
  }

  setUploadStatus("上傳中...");
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    const text = await response.text();
    if (!response.ok || text.includes("錯誤") || text.includes("找不到以下指令碼函式")) {
      const error = new Error(extractGoogleScriptError(text) || `HTTP ${response.status}`);
      error.confirmedFailure = true;
      throw error;
    }
    setUploadStatus(successMessage);
  } catch (err) {
    if (err.confirmedFailure) {
      setUploadStatus(`上傳失敗：${err.message}`);
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
      setUploadStatus(`${successMessage}（瀏覽器不回報接收結果，請確認 Google Sheet）`);
    } catch {
      setUploadStatus(`上傳失敗：${err.message}`);
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
  if (state.trip && !window.confirm("目前正在紀錄，確定要清除本機歷史、草稿與目前軌跡嗎？")) return;
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
  setRouteNote("已清除本機歷史、草稿與目前軌跡。");
  setStatus("已清除紀錄", "可重新開始累積資料", false);
  updateRecordingOverlay();
  updateDriveConsole();
  drawRoute();
  renderHistory();
  renderDashboard();
}

els.autoMode.addEventListener("click", toggleAutoMode);
els.modeRecord?.addEventListener("click", () => setViewMode("record"));
els.modeGuidance?.addEventListener("click", () => setViewMode("guidance"));
els.modeDashboard?.addEventListener("click", () => setViewMode("dashboard"));
els.guidanceToggle?.addEventListener("click", toggleGuidance);
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
setUploadStatus("已內建 Google Sheet 上傳位置；結束行程會自動上傳。");
updateRecordingOverlay();
updateDriveConsole();
drawRouteGrid(els.routeCanvas.getContext("2d"), els.routeCanvas.width, els.routeCanvas.height);
renderHistory();
renderDashboard();
showRestoreDraft();
