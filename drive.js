import {
  angleDelta,
  bearingBetween,
  buildRouteSegments,
  cameraForwardHeading,
  cameraRouteKey,
  directionHeading,
  directionLabel,
  distanceBetween,
  findCourseAnchor,
  matchRoadCorridor,
  normalizeDirectionCode,
} from "./drive-direction.js";
import { resolveDestinationIntent } from "./drive-destination.js";
import { buildLaneGuidance } from "./drive-guidance.js";
import { STARTER_CCTV } from "./drive-starter-catalog.js";

const TDX_CCTV_URL = "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Freeway?$format=JSON";
const CAMERA_CATALOG_REFRESH_MS = 15 * 60 * 1000;
const PERSISTED_CAMERA_CATALOG_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const ROAD_REFRESH_MS = 15 * 1000;
const LANE_REFRESH_MS = 60 * 1000;
const MAX_CAMERA_DISTANCE_METERS = 5000;
const CAMERA_SWITCH_METERS = 500;
const DESTINATION_CANDIDATE_MAX_DISTANCE_METERS = 15000;
const CAMERA_BEARING_MAX_DELTA = 85;
const CAMERA_DIRECTION_MAX_DELTA = 75;
const RAMP_CAMERA_PENALTY = 650;
const MAX_LOCATION_ACCURACY_METERS = 50;
const OFFICIAL_STREAM_CONNECT_TIMEOUT_MS = 7500;
const RELAY_STREAM_CONNECT_TIMEOUT_MS = 8500;
const SNAPSHOT_CONNECT_TIMEOUT_MS = 5000;
const SNAPSHOT_FALLBACK_REFRESH_MS = 4000;
const MIN_COURSE_DISTANCE_METERS = 32;
const MIN_COURSE_INTERVAL_SECONDS = 2;
const MAX_COURSE_INTERVAL_SECONDS = 75;
const COURSE_SAMPLE_MAX_AGE_MS = 90 * 1000;
const COURSE_SAMPLE_MAX_COUNT = 48;
const COURSE_HOLD_MS = 45 * 1000;
const MIN_NATIVE_HEADING_SPEED_KPH = 7;
const MIN_SPEED_INTERVAL_SECONDS = 2;
const MAX_SPEED_INTERVAL_SECONDS = 20;
const MAX_ESTIMATED_SPEED_KPH = 160;
const LOCATION_OPTIONS = { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 };
const proxyStorageKey = "commute-cctv-proxy-base-v1";
const relayStorageKey = "commute-cctv-relay-base-v1";
const cameraCatalogStorageKey = "commute-cctv-catalog-v1";
const destinationStorageKey = "commute-drive-destination-v1";
const bundledCameraCatalogUrl = "./official-cctv-catalog.json";

const el = {
  locationState: document.querySelector("#locationState"),
  sourceChip: document.querySelector("#sourceChip"),
  retryRoadData: document.querySelector("#retryRoadData"),
  roadLabel: document.querySelector("#roadLabel"),
  roadDetail: document.querySelector("#roadDetail"),
  cameraStage: document.querySelector("#cameraStage"),
  cctvImage: document.querySelector("#cctvImage"),
  cctvPreview: document.querySelector("#cctvPreview"),
  cameraPlaceholder: document.querySelector("#cameraPlaceholder"),
  cameraOverlay: document.querySelector("#cameraOverlay"),
  cameraStatus: document.querySelector("#cameraStatus"),
  cameraAge: document.querySelector("#cameraAge"),
  gpsSpeed: document.querySelector("#gpsSpeed"),
  gpsSpeedNote: document.querySelector("#gpsSpeedNote"),
  cameraDistance: document.querySelector("#cameraDistance"),
  travelDirection: document.querySelector("#travelDirection"),
  travelDirectionNote: document.querySelector("#travelDirectionNote"),
  locationAccuracy: document.querySelector("#locationAccuracy"),
  routeSummary: document.querySelector("#routeSummary"),
  routeSummaryDetail: document.querySelector("#routeSummaryDetail"),
  routeSummaryState: document.querySelector("#routeSummaryState"),
  tripPlan: document.querySelector("#tripPlan"),
  destinationName: document.querySelector("#destinationName"),
  destinationMeta: document.querySelector("#destinationMeta"),
  routeDecision: document.querySelector("#routeDecision"),
  routeDecisionDetail: document.querySelector("#routeDecisionDetail"),
  routeEta: document.querySelector("#routeEta"),
  routeEtaNote: document.querySelector("#routeEtaNote"),
  routeAlternative: document.querySelector("#routeAlternative"),
  routeAlternativeNote: document.querySelector("#routeAlternativeNote"),
  editDestination: document.querySelector("#editDestination"),
  destinationDialog: document.querySelector("#destinationDialog"),
  destinationForm: document.querySelector("#destinationForm"),
  destinationInput: document.querySelector("#destinationInput"),
  saveDestination: document.querySelector("#saveDestination"),
  clearDestination: document.querySelector("#clearDestination"),
  cancelDestination: document.querySelector("#cancelDestination"),
  laneReference: document.querySelector("#laneReference"),
  laneReferenceTitle: document.querySelector("#laneReferenceTitle"),
  laneReferenceDetail: document.querySelector("#laneReferenceDetail"),
  laneDataAge: document.querySelector("#laneDataAge"),
  laneCards: document.querySelector("#laneCards"),
  observation: document.querySelector("#observation"),
  observationTitle: document.querySelector("#observationTitle"),
  observationDetail: document.querySelector("#observationDetail"),
  startDrive: document.querySelector("#startDrive"),
  stopDrive: document.querySelector("#stopDrive"),
  openSettings: document.querySelector("#openSettings"),
  settingsDialog: document.querySelector("#settingsDialog"),
  proxyEndpoint: document.querySelector("#proxyEndpoint"),
  relayEndpoint: document.querySelector("#relayEndpoint"),
  settingsServiceStatus: document.querySelector("#settingsServiceStatus"),
  saveSettings: document.querySelector("#saveSettings"),
  resetSettings: document.querySelector("#resetSettings"),
  cancelSettings: document.querySelector("#cancelSettings"),
};

const state = {
  active: false,
  watchId: null,
  cctvs: [],
  cctvsLoadedAt: 0,
  cctvCatalogRefresh: null,
  cctvSeedLoad: null,
  routeSegments: [],
  routeSegmentsForCctvs: null,
  currentCamera: null,
  displayedCamera: null,
  lastPoint: null,
  course: null,
  courseSamples: [],
  imageLoadedAt: 0,
  previewLoadedAt: 0,
  refreshTimer: null,
  reconnectTimer: null,
  streamConnectTimer: null,
  snapshotRefreshTimer: null,
  reconnectAttempts: 0,
  imageToken: 0,
  streamTransport: "",
  laneCameraId: "",
  laneObservation: null,
  laneFetchedAt: 0,
  laneRequestToken: 0,
  roadRequestToken: 0,
  prefetchedLaneObservations: new Map(),
  prefetchLaneRequests: new Set(),
  destination: normalizeDestination(localStorage.getItem(destinationStorageKey)),
  proxyBase: normalizeProxyBase(localStorage.getItem(proxyStorageKey)) || getDefaultProxyBase(),
  relayBase: normalizeRelayBase(localStorage.getItem(relayStorageKey)) || getDefaultRelayBase(),
};

function normalizeProxyBase(value) {
  const base = String(value || "").trim().replace(/\/$/, "");
  return /^https:\/\//i.test(base) ? base : "";
}

function normalizeDestination(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 100);
}

function normalizeRelayBase(value) {
  const base = String(value || "").trim().replace(/\/$/, "");
  try {
    const url = new URL(base);
    if (url.protocol === "https:") return base;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return base;
  } catch (_) {
    // Invalid values are treated as not configured.
  }
  return "";
}

function getDefaultProxyBase() {
  return normalizeProxyBase(window.DRIVE_CONFIG?.cctvProxyBase || "");
}

function getDefaultRelayBase() {
  return normalizeRelayBase(window.DRIVE_CONFIG?.cctvRelayBase || "");
}

function getProxyBases() {
  return [...new Set([state.proxyBase, getDefaultProxyBase()].filter(Boolean))];
}

function getRelayBases() {
  // A stale custom value must not block a driver from the configured production Relay.
  return [...new Set([state.relayBase, getDefaultRelayBase()].filter(Boolean))];
}

function setSource(label, level = "waiting") {
  el.sourceChip.textContent = label;
  el.sourceChip.dataset.level = level;
  el.retryRoadData.hidden = level !== "error" || !state.active;
}

function setObservation(title, detail, level = "waiting") {
  el.observationTitle.textContent = title;
  el.observationDetail.textContent = detail;
  el.observation.dataset.level = level;
}

function setRouteSummary(title, detail, stateLabel = "待確認", level = "waiting") {
  if (!el.routeSummary || !el.routeSummaryDetail || !el.routeSummaryState) return;
  el.routeSummary.textContent = title;
  el.routeSummaryDetail.textContent = detail;
  el.routeSummaryState.textContent = stateLabel;
  el.routeSummaryState.dataset.level = level;
  el.routeSummary.closest(".route-summary")?.setAttribute("data-level", level);
}

function showAppDialog(dialog) {
  if (typeof dialog?.showModal === "function") {
    dialog.showModal();
    return;
  }
  document.body.dataset.dialogOpen = dialog.id;
  dialog.setAttribute("open", "");
}

function closeAppDialog(dialog) {
  if (typeof dialog?.close === "function" && dialog.open) {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
  if (document.body.dataset.dialogOpen === dialog.id) delete document.body.dataset.dialogOpen;
}

function renderTripPlan() {
  if (!el.tripPlan) return;
  const destination = state.destination;
  if (!destination) {
    el.tripPlan.dataset.level = "waiting";
    el.destinationName.textContent = "尚未設定目的地";
    el.destinationMeta.textContent = "設定目的地後，比較即時交通與替代路線。";
    el.routeDecision.textContent = "等待目的地";
    el.routeDecisionDetail.textContent = "尚未取得目的地，因此不比較路線。";
    el.routeEta.textContent = "--";
    el.routeEtaNote.textContent = "尚未計算";
    el.routeAlternative.textContent = "--";
    el.routeAlternativeNote.textContent = "尚未比較";
    el.editDestination.textContent = "設定";
    return;
  }

  el.tripPlan.dataset.level = "warning";
  el.destinationName.textContent = destination;
  el.destinationMeta.textContent = "目的地已儲存於此裝置。";
  el.routeDecision.textContent = "等待即時導航服務";
  el.routeDecisionDetail.textContent = "尚未取得交通感知 ETA 與替代路線，不提供改道建議。";
  el.routeEta.textContent = "--";
  el.routeEtaNote.textContent = "服務待串接";
  el.routeAlternative.textContent = "--";
  el.routeAlternativeNote.textContent = "不建議改道";
  el.editDestination.textContent = "編輯";
}

function openDestinationDialog() {
  el.destinationInput.value = state.destination;
  showAppDialog(el.destinationDialog);
  window.setTimeout(() => el.destinationInput.focus(), 0);
}

function saveDestination() {
  const destination = normalizeDestination(el.destinationInput.value);
  if (!destination) {
    el.destinationInput.setCustomValidity("請輸入目的地名稱或地址。");
    el.destinationInput.reportValidity();
    return;
  }
  el.destinationInput.setCustomValidity("");
  state.destination = destination;
  localStorage.setItem(destinationStorageKey, destination);
  renderTripPlan();
  if (state.lastPoint) void refreshRoadInformation(state.lastPoint);
  closeAppDialog(el.destinationDialog);
}

function clearDestination() {
  state.destination = "";
  localStorage.removeItem(destinationStorageKey);
  el.destinationInput.value = "";
  renderTripPlan();
  if (state.lastPoint) void refreshRoadInformation(state.lastPoint);
  closeAppDialog(el.destinationDialog);
}

function setLaneReference(title, detail, level = "waiting") {
  el.laneReferenceTitle.textContent = title;
  el.laneReferenceDetail.textContent = detail;
  el.laneReference.dataset.level = level;
}

function clearLaneCards() {
  el.laneCards.replaceChildren();
  el.laneCards.hidden = true;
}

function updateLaneDataAge() {
  if (!state.laneObservation?.ok) return;
  renderLaneObservation(state.laneObservation);
}

function laneFailureCopy(observation) {
  const error = String(observation?.error || "");
  if (error === "nearby_vd_not_available") {
    return ["附近無可用主線 VD", "此路段 3 公里內暫時沒有可確認的同向主線每車道資料，僅顯示影像參考。"];
  }
  if (error === "camera_route_not_resolved") {
    return ["鏡頭道路資料待確認", "此鏡頭尚未能對應國道方向與里程，因此不顯示可能錯誤的車道速度。"];
  }
  if (error === "camera_not_found") {
    return ["鏡頭目錄更新中", "影像鏡頭尚未出現在官方目錄快取，系統會在下一次更新時重試。"];
  }
  if (error === "lane_data_unavailable") {
    return ["官方 VD 暫時不可用", "官方每車道資料暫時未回傳；系統不會以影像推測車道速度。"];
  }
  return ["官方 VD 讀取失敗", "無法取得同向主線每車道資料，系統會在下一次定位更新時重試。"];
}

function renderLaneObservation(observation) {
  state.laneObservation = observation?.ok ? observation : null;
  if (!observation?.ok) {
    clearLaneCards();
    el.laneDataAge.textContent = "--";
    const [title, detail] = laneFailureCopy(observation);
    setLaneReference(title, detail, "warning");
    return;
  }

  const guidance = buildLaneGuidance(observation);
  el.laneDataAge.textContent = guidance.freshness.label;
  if (!guidance.freshness.canDisplay) {
    clearLaneCards();
    setLaneReference(guidance.title, guidance.detail, guidance.level);
    return;
  }

  setLaneReference(guidance.title, guidance.detail, guidance.level);
  const cards = guidance.lanes.map((lane) => {
      const card = document.createElement("article");
      card.className = "lane-card";
      if (lane.isRecommended) card.dataset.state = "reference";
      const occupancy = Number.isFinite(Number(lane.occupancy)) ? `占有率 ${Math.round(lane.occupancy)}%` : "占有率待確認";
      const volume = Number.isFinite(Number(lane.volume)) ? `流量 ${Math.round(lane.volume)} 輛/分` : "流量待確認";
      const heading = document.createElement("div");
      heading.className = "lane-card-heading";
      const title = document.createElement("span");
      title.textContent = `第 ${lane.displayNumber} 車道`;
      heading.append(title);
      const speed = document.createElement("strong");
      speed.append(String(Math.round(lane.speedKph)));
      const unit = document.createElement("small");
      unit.textContent = "km/h";
      speed.append(unit);
      const detail = document.createElement("small");
      detail.textContent = occupancy;
      detail.title = volume;
      card.append(heading, speed, detail);
      return card;
  });
  el.laneCards.replaceChildren(...cards);
  el.laneCards.hidden = !cards.length;
}

function setCameraPlaceholder(title, detail, stage = "waiting") {
  el.cameraStage.dataset.state = stage;
  el.cctvImage.hidden = true;
  el.cctvPreview.hidden = true;
  el.cctvPreview.removeAttribute("src");
  el.cameraPlaceholder.hidden = false;
  el.cameraPlaceholder.querySelector("strong").textContent = title;
  el.cameraPlaceholder.querySelector("small").textContent = detail;
  el.cameraOverlay.hidden = true;
}

function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function headingLabel(heading) {
  if (!Number.isFinite(heading)) return "方向待確認";
  if (heading >= 315 || heading < 45) return "北向";
  if (heading < 135) return "東向";
  if (heading < 225) return "南向";
  return "西向";
}

function roadKey(camera) {
  return cameraRouteKey(camera);
}

function isRampCamera(camera) {
  return /匝道|入口|出口|引道|連絡道/.test(`${camera.id || ""} ${camera.section || ""}`);
}

function selectDestinationCandidateCamera(point, intent) {
  if (!intent || !state.cctvs.length) return null;
  return state.cctvs
    .filter((camera) => intent.routes.includes(cameraRouteKey(camera)))
    .filter((camera) => normalizeDirectionCode(camera.direction, camera.id) === intent.direction)
    .filter((camera) => !isRampCamera(camera))
    .map((camera) => ({ ...camera, distance: distanceBetween(point, camera) }))
    .filter((camera) => camera.distance <= DESTINATION_CANDIDATE_MAX_DISTANCE_METERS)
    .sort((left, right) => left.distance - right.distance)[0] || null;
}

function readPrefetchedLaneObservation(cameraId) {
  const cached = state.prefetchedLaneObservations.get(cameraId);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt >= LANE_REFRESH_MS) {
    state.prefetchedLaneObservations.delete(cameraId);
    return null;
  }
  return cached.observation;
}

function prefetchLaneObservation(camera) {
  if (!getProxyBases().length || !camera?.id) return;
  if (readPrefetchedLaneObservation(camera.id) || state.prefetchLaneRequests.has(camera.id)) return;
  state.prefetchLaneRequests.add(camera.id);
  void fetchFromServiceBases(getProxyBases(), `/v1/lanes/${encodeURIComponent(camera.id)}`, { cache: "no-store" }, 12000)
    .then(async (response) => {
      const observation = await response.json().catch(() => ({ ok: false, error: "lane_response_invalid" }));
      state.prefetchedLaneObservations.set(camera.id, {
        fetchedAt: Date.now(),
        observation: response.ok ? observation : { ...observation, ok: false },
      });
    })
    .catch(() => {})
    .finally(() => state.prefetchLaneRequests.delete(camera.id));
}

function prepareDestinationCandidate(point) {
  const intent = resolveDestinationIntent(state.destination, point);
  if (!intent || !state.cctvs.length) return null;
  const camera = selectDestinationCandidateCamera(point, intent);
  if (camera) prefetchLaneObservation(camera);
  return { intent, camera };
}

function timeoutFetch(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => window.clearTimeout(timer));
}

async function fetchFromServiceBases(bases, path, options = {}, timeout = 8000) {
  let lastError = new Error("影像服務尚未設定");
  for (const base of bases) {
    try {
      const response = await timeoutFetch(`${base}${path}`, options, timeout);
      if (response.ok) return response;
      lastError = new Error(`服務讀取失敗 (${response.status})`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function normalizeCctvList(rawCameras) {
  return rawCameras
    .filter((camera) => {
      const id = state.proxyBase ? camera.id : camera.CCTVID;
      const mediaUrl = state.proxyBase ? camera.mediaUrl : camera.VideoStreamURL;
      return id && mediaUrl && Number(camera.lat ?? camera.PositionLat) && Number(camera.lng ?? camera.PositionLon);
    })
    .map((camera) => {
      const id = state.proxyBase ? camera.id : camera.CCTVID;
      return {
        id,
        road: camera.road || camera.RoadName || camera.RoadID || "國道路段",
        // Some catalog records contain an unusable Direction value. CCTVID carries the official N/S/E/W marker.
        direction: normalizeDirectionCode(camera.direction || camera.Direction, id),
        mile: camera.mile || camera.LocationMile || camera.Mile || "",
        section: camera.section || camera.LocationName || "",
        lat: Number(camera.lat ?? camera.PositionLat),
        lng: Number(camera.lng ?? camera.PositionLon),
        mediaUrl: camera.mediaUrl || camera.VideoStreamURL,
      };
    });
}

function persistCctvList(cctvs, loadedAt) {
  try {
    localStorage.setItem(cameraCatalogStorageKey, JSON.stringify({ loadedAt, cctvs }));
  } catch (_) {
    // Safari private mode or a full local store must not prevent the road screen from working.
  }
}

function hydratePersistedCctvList() {
  if (state.cctvs.length) return state.cctvs;
  try {
    const cached = JSON.parse(localStorage.getItem(cameraCatalogStorageKey) || "null");
    const loadedAt = Number(cached?.loadedAt);
    const cctvs = Array.isArray(cached?.cctvs) ? cached.cctvs : [];
    if (!Number.isFinite(loadedAt) || Date.now() - loadedAt > PERSISTED_CAMERA_CATALOG_MAX_AGE_MS || !cctvs.length) return [];
    state.cctvs = cctvs.filter((camera) => camera?.id && camera?.mediaUrl && Number(camera?.lat) && Number(camera?.lng));
    state.cctvsLoadedAt = loadedAt;
  } catch (_) {
    // A bad cache is ignored and refreshed from the public catalog when needed.
  }
  return state.cctvs;
}

function hydrateBundledCctvList() {
  if (state.cctvs.length) return Promise.resolve(state.cctvs);
  if (state.cctvSeedLoad) return state.cctvSeedLoad;
  const starterCctvs = normalizeCctvList(STARTER_CCTV);
  if (starterCctvs.length) {
    // Keep the initial New Taipei-to-Yangmei corridor independent from a large catalog parse or Relay availability.
    state.cctvs = starterCctvs;
    state.cctvsLoadedAt = 0;
    persistCctvList(starterCctvs, Date.now());
    return Promise.resolve(starterCctvs);
  }
  state.cctvSeedLoad = fetch(bundledCameraCatalogUrl, { cache: "force-cache" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`內建鏡頭目錄讀取失敗 (${response.status})`);
      const payload = await response.json();
      const cctvs = normalizeCctvList(payload.cameras || []);
      if (!cctvs.length) throw new Error("內建鏡頭目錄沒有可用鏡頭");
      state.cctvs = cctvs;
      // A bundled catalog is only a startup fallback. Keep its age at zero so the Relay refreshes it in the background.
      state.cctvsLoadedAt = 0;
      persistCctvList(cctvs, Date.now());
      return cctvs;
    })
    .catch(() => [])
    .finally(() => {
      state.cctvSeedLoad = null;
    });
  return state.cctvSeedLoad;
}

function refreshCctvList() {
  if (state.cctvCatalogRefresh) return state.cctvCatalogRefresh;
  const proxyBases = getProxyBases();
  const request = proxyBases.length
    ? fetchFromServiceBases(proxyBases, "/v1/cameras", { cache: "no-store" })
    : timeoutFetch(TDX_CCTV_URL, { cache: "no-store" });
  state.cctvCatalogRefresh = request
    .then(async (response) => {
      if (!response.ok) throw new Error(`CCTV 清單讀取失敗 (${response.status})`);
      const payload = await response.json();
      const rawCameras = proxyBases.length ? (payload.cameras || []) : (payload.CCTVs || []);
      const cctvs = normalizeCctvList(rawCameras);
      if (!cctvs.length) throw new Error("CCTV 清單沒有可用鏡頭");
      state.cctvs = cctvs;
      state.cctvsLoadedAt = Date.now();
      persistCctvList(cctvs, state.cctvsLoadedAt);
      return cctvs;
    })
    .finally(() => {
      state.cctvCatalogRefresh = null;
    });
  return state.cctvCatalogRefresh;
}

async function getCctvList() {
  hydratePersistedCctvList();
  if (!state.cctvs.length) await hydrateBundledCctvList();
  if (state.cctvs.length) {
    if (Date.now() - state.cctvsLoadedAt >= CAMERA_CATALOG_REFRESH_MS) {
      void refreshCctvList().catch(() => {});
    }
    return state.cctvs;
  }
  return refreshCctvList();
}

function resetCourse() {
  state.course = null;
  state.courseSamples = [];
}

function appendCourseSample(point) {
  const cutoff = point.timestamp - COURSE_SAMPLE_MAX_AGE_MS;
  state.courseSamples = state.courseSamples.filter((sample) => sample.timestamp >= cutoff);
  const previous = state.courseSamples.at(-1);
  if (!previous || point.timestamp - previous.timestamp >= 1000 || distanceBetween(previous, point) >= 6) {
    state.courseSamples.push(point);
  }
  if (state.courseSamples.length > COURSE_SAMPLE_MAX_COUNT) {
    state.courseSamples.splice(0, state.courseSamples.length - COURSE_SAMPLE_MAX_COUNT);
  }
}

function updateCourse(point) {
  appendCourseSample(point);
  const nativeSpeedKph = Number.isFinite(point.speed) ? point.speed * 3.6 : NaN;
  const hasNativeHeading = Number.isFinite(point.heading)
    && point.heading >= 0
    && (!Number.isFinite(nativeSpeedKph) || nativeSpeedKph >= MIN_NATIVE_HEADING_SPEED_KPH);
  let heading = hasNativeHeading ? point.heading : NaN;
  let source = hasNativeHeading ? "GPS 航向" : "";
  let distance = 0;

  if (!Number.isFinite(heading)) {
    const accuracy = Math.max(0, Number(point.accuracy) || 0);
    const minDistanceMeters = Math.max(MIN_COURSE_DISTANCE_METERS, Math.min(90, accuracy * 3));
    const anchor = findCourseAnchor(state.courseSamples, point, {
      minDistanceMeters,
      minElapsedSeconds: MIN_COURSE_INTERVAL_SECONDS,
      maxElapsedSeconds: MAX_COURSE_INTERVAL_SECONDS,
    });
    if (anchor) {
      heading = bearingBetween(anchor.point, point);
      source = "GPS 連續路徑";
      distance = anchor.distance;
    }
  }

  if (Number.isFinite(heading)) {
    state.course = { heading, source, distance, updatedAt: point.timestamp };
    return state.course;
  }

  if (state.course && point.timestamp - state.course.updatedAt <= COURSE_HOLD_MS) {
    return { ...state.course, source: "GPS 已確認" };
  }
  state.course = null;
  return null;
}

function deriveSpeed(point) {
  if (Number.isFinite(point.speed) && point.speed >= 0) {
    return { value: Math.round(point.speed * 3.6), source: "GPS" };
  }
  if (!state.lastPoint) return { value: NaN, source: "等待移動" };
  const elapsedSeconds = (point.timestamp - state.lastPoint.timestamp) / 1000;
  if (elapsedSeconds < MIN_SPEED_INTERVAL_SECONDS || elapsedSeconds > MAX_SPEED_INTERVAL_SECONDS) {
    return { value: NaN, source: "等待定位" };
  }
  const distance = distanceBetween(state.lastPoint, point);
  const accuracyFloor = Math.max(10, Math.min(35, Math.max(point.accuracy || 0, state.lastPoint.accuracy || 0) * 0.75));
  if (distance <= accuracyFloor) return { value: 0, source: "GPS 推估" };
  const estimatedKph = distance / elapsedSeconds * 3.6;
  if (estimatedKph > MAX_ESTIMATED_SPEED_KPH) return { value: NaN, source: "定位確認中" };
  return { value: Math.round(estimatedKph), source: "GPS 推估" };
}

function getRouteSegments() {
  if (state.routeSegmentsForCctvs !== state.cctvs) {
    state.routeSegments = buildRouteSegments(state.cctvs);
    state.routeSegmentsForCctvs = state.cctvs;
  }
  return state.routeSegments;
}

function selectForwardCamera(point, course) {
  const heading = course?.heading;
  if (!Number.isFinite(heading)) return null;
  const corridor = matchRoadCorridor(getRouteSegments(), point, heading);
  const nearby = state.cctvs
    .map((camera) => {
      const distance = distanceBetween(point, camera);
      const bearing = bearingBetween(point, camera);
      const bearingDelta = Math.abs(angleDelta(heading, bearing));
      return { ...camera, distance, bearingDelta };
    })
    .filter((camera) => camera.distance <= MAX_CAMERA_DISTANCE_METERS)
    .filter((camera) => camera.bearingDelta <= CAMERA_BEARING_MAX_DELTA);
  const corridorCandidates = corridor && corridor.confidence !== "low"
    ? nearby.filter((camera) => cameraRouteKey(camera) === corridor.route
      && normalizeDirectionCode(camera.direction, camera.id) === corridor.direction)
    : [];
  const candidates = (corridorCandidates.length ? corridorCandidates : nearby)
    .map((camera) => {
      const localRoadHeading = cameraForwardHeading(state.cctvs, camera);
      const fallbackDirectionHeading = directionHeading(camera.direction, camera.id);
      const corridorHeading = corridor
        && cameraRouteKey(camera) === corridor.route
        && normalizeDirectionCode(camera.direction, camera.id) === corridor.direction
        ? corridor.heading
        : NaN;
      const routeHeading = Number.isFinite(localRoadHeading)
        ? localRoadHeading
        : Number.isFinite(corridorHeading)
          ? corridorHeading
          : fallbackDirectionHeading;
      const directionDelta = Number.isFinite(routeHeading) ? Math.abs(angleDelta(heading, routeHeading)) : NaN;
      const rampPenalty = isRampCamera(camera) ? RAMP_CAMERA_PENALTY : 0;
      const score = distance + bearingDelta * 12 + (Number.isFinite(directionDelta) ? directionDelta * 16 : 200) + rampPenalty;
      return { ...camera, routeHeading, directionDelta, score, corridor };
    })
    .filter((camera) => !Number.isFinite(camera.directionDelta) || camera.directionDelta <= CAMERA_DIRECTION_MAX_DELTA)
    .sort((a, b) => a.score - b.score);

  const current = candidates.find((camera) => camera.id === state.currentCamera?.id);
  if (current && current.distance >= CAMERA_SWITCH_METERS) return current;
  const currentRoad = state.currentCamera ? roadKey(state.currentCamera) : "";
  const sameRoadAhead = currentRoad
    ? candidates.find((camera) => roadKey(camera) === currentRoad && camera.distance >= CAMERA_SWITCH_METERS)
    : null;
  if (sameRoadAhead) return sameRoadAhead;
  return candidates.find((camera) => camera.distance >= CAMERA_SWITCH_METERS) || candidates[0] || null;
}

function selectNearbyReferenceCamera(point) {
  const candidates = state.cctvs
    .map((camera) => ({ ...camera, distance: distanceBetween(point, camera) }))
    .filter((camera) => camera.distance <= MAX_CAMERA_DISTANCE_METERS * 2)
    .filter((camera) => !isRampCamera(camera))
    .sort((a, b) => a.distance - b.distance);
  const camera = candidates[0];
  if (!camera) return null;
  return {
    ...camera,
    bearingDelta: NaN,
    routeHeading: NaN,
    directionDelta: NaN,
    corridor: null,
    isReferenceFallback: true,
  };
}

function streamSources(camera) {
  const sources = [];
  const officialUrl = String(camera.mediaUrl || "").trim();
  if (/^https:\/\//i.test(officialUrl)) sources.push({ kind: "official", label: "官方原生串流", url: officialUrl });
  const relayBases = getRelayBases();
  relayBases.forEach((relayBase, index) => {
    sources.push({
      kind: "relay",
      label: index === 0 ? "Relay 串流" : "預設 Relay 串流",
      url: `${relayBase}/mjpeg/${encodeURIComponent(camera.id)}`,
    });
  });
  // The bundled Relay has no /v1/stream endpoint. Keep this only for a separately configured legacy proxy.
  if (state.proxyBase && state.proxyBase !== state.relayBase) {
    sources.push({ kind: "proxy", label: "Proxy 串流", url: `${state.proxyBase}/v1/stream?id=${encodeURIComponent(camera.id)}` });
  }
  relayBases.forEach((relayBase, index) => {
    sources.push({
      kind: "snapshot",
      label: index === 0 ? "官方快照備援" : "預設 Relay 快照備援",
      url: `${relayBase}/latest/${encodeURIComponent(camera.id)}`,
    });
  });
  return sources.filter((source, index, list) => list.findIndex((candidate) => candidate.url === source.url) === index);
}

function renderCameraContext(camera) {
  el.roadLabel.textContent = `${camera.road} ${directionLabel(camera.direction, camera.id)}｜${camera.mile || "里程待確認"}`;
  el.roadDetail.textContent = camera.section || "附近前方國道 CCTV";
  el.cameraDistance.textContent = formatDistance(camera.distance);
}

function renderRouteSummary(camera, directionVerified) {
  const road = `${camera.road} ${directionLabel(camera.direction, camera.id)} 主線`;
  const mile = camera.mile || "里程待確認";
  const cameraDistance = formatDistance(camera.distance);
  if (directionVerified) {
    const corridorLabel = camera.corridor?.confidence === "high" ? "道路走廊已確認" : "同向主線已確認";
    setRouteSummary(road, `${mile}｜前方官方 CCTV ${cameraDistance}`, corridorLabel, "live");
    return;
  }
  setRouteSummary(road, `${mile}｜鏡頭方向資料待進一步確認`, "影像參考", "reference");
}

async function refreshLaneObservation(camera, roadToken = state.roadRequestToken) {
  if (!getProxyBases().length || !camera?.id) return;
  const isCurrent = state.laneCameraId === camera.id;
  if (isCurrent && Date.now() - state.laneFetchedAt < LANE_REFRESH_MS) {
    updateLaneDataAge();
    return;
  }
  const prefetched = readPrefetchedLaneObservation(camera.id);
  const token = ++state.laneRequestToken;
  if (!isCurrent) {
    state.laneCameraId = camera.id;
    state.laneObservation = null;
    clearLaneCards();
    el.laneDataAge.textContent = "讀取中";
    setLaneReference("正在讀取官方 VD", "正在比對同向主線偵測器的每車道資料。", "waiting");
  }
  if (prefetched) {
    state.laneFetchedAt = Date.now();
    renderLaneObservation(prefetched);
    return;
  }
  try {
    const response = await fetchFromServiceBases(getProxyBases(), `/v1/lanes/${encodeURIComponent(camera.id)}`, { cache: "no-store" }, 12000);
    const observation = await response.json().catch(() => ({ ok: false, error: "lane_response_invalid" }));
    if (roadToken !== state.roadRequestToken || token !== state.laneRequestToken || camera.id !== state.currentCamera?.id) return;
    state.laneFetchedAt = Date.now();
    renderLaneObservation(response.ok ? observation : { ...observation, ok: false });
  } catch (_) {
    if (roadToken !== state.roadRequestToken || token !== state.laneRequestToken || camera.id !== state.currentCamera?.id) return;
    state.laneFetchedAt = Date.now();
    renderLaneObservation({ ok: false, error: "lane_request_failed" });
  }
}

function pauseRoadDataForLowAccuracy(point) {
  state.laneRequestToken += 1;
  state.laneCameraId = "";
  state.laneObservation = null;
  clearLaneCards();
  el.laneDataAge.textContent = "--";
  setLaneReference("等待較精確定位", `目前定位誤差 ${Math.round(point.accuracy)} m，需在 ${MAX_LOCATION_ACCURACY_METERS} m 內才會顯示同向車道速度。`, "warning");
  if (state.currentCamera) {
    el.cameraStatus.textContent = "定位精度不足｜保留已確認影像";
    setRouteSummary(
      `${state.currentCamera.road} ${directionLabel(state.currentCamera.direction, state.currentCamera.id)} 主線`,
      `定位誤差 ${Math.round(point.accuracy)} m，暫停更新道路、車道速度與推薦。`,
      "定位精度不足",
      "warning",
    );
  } else {
    setRouteSummary("道路走廊待確認", `定位誤差需在 ${MAX_LOCATION_ACCURACY_METERS} m 內，才會判讀道路與方向。`, "定位精度不足", "warning");
  }
  setSource("定位精度不足", "warning");
  setObservation("定位精度不足", "目前不切換鏡頭或提供車道建議，避免顯示錯誤道路、方向或匝道資料。", "warning");
}

function updateImageAge() {
  if (el.cctvImage.hidden && !el.cctvPreview.hidden && state.previewLoadedAt) {
    const age = Math.max(0, Math.floor((Date.now() - state.previewLoadedAt) / 1000));
    el.cameraAge.textContent = `快照備援｜${age} 秒前`;
    return;
  }
  if (state.streamTransport === "snapshot" && state.imageLoadedAt) {
    const age = Math.max(0, Math.floor((Date.now() - state.imageLoadedAt) / 1000));
    el.cameraAge.textContent = `備援快照｜${age} 秒前`;
    return;
  }
  if (state.imageLoadedAt && (state.proxyBase || state.relayBase) && el.cameraStage.dataset.state === "ready") {
    // MJPEG <img> does not expose a per-frame heartbeat, so do not claim the feed is live.
    el.cameraAge.textContent = "串流已連線";
    return;
  }
  if (!state.imageLoadedAt) {
    el.cameraAge.textContent = "--";
    return;
  }
  const age = Math.max(0, Math.floor((Date.now() - state.imageLoadedAt) / 1000));
  el.cameraAge.textContent = age < 60 ? `${age} 秒前` : `${Math.floor(age / 60)} 分前`;
}

function clearStreamConnectTimer() {
  if (state.streamConnectTimer !== null) window.clearTimeout(state.streamConnectTimer);
  state.streamConnectTimer = null;
}

function clearSnapshotRefreshTimer() {
  if (state.snapshotRefreshTimer !== null) window.clearTimeout(state.snapshotRefreshTimer);
  state.snapshotRefreshTimer = null;
}

function hasVisibleCameraImage() {
  return Boolean(state.displayedCamera) && (!el.cctvImage.hidden || !el.cctvPreview.hidden);
}

function preloadCameraSnapshot(camera, token, sourceIndex = 0) {
  const relayBase = getRelayBases()[sourceIndex];
  if (!relayBase) return;
  const preview = el.cctvPreview;
  preview.onload = () => {
    if (token !== state.imageToken || !state.active || state.currentCamera?.id !== camera.id || !el.cctvImage.hidden) return;
    preview.hidden = false;
    el.cameraPlaceholder.hidden = true;
    state.displayedCamera = camera;
    state.previewLoadedAt = Date.now();
    renderCameraContext(camera);
    el.cameraOverlay.textContent = `${camera.road} ${directionLabel(camera.direction, camera.id)}｜${camera.mile || "里程待確認"}`;
    el.cameraOverlay.hidden = false;
    el.cameraStage.dataset.state = "ready";
    el.cameraStatus.textContent = "快照已顯示，串流連線中";
    updateImageAge();
  };
  preview.onerror = () => {
    if (token === state.imageToken && state.active && state.currentCamera?.id === camera.id) {
      preloadCameraSnapshot(camera, token, sourceIndex + 1);
    }
  };
  preview.hidden = true;
  preview.src = `${relayBase}/latest/${encodeURIComponent(camera.id)}?t=${Date.now()}`;
}

function streamConnectTimeout(source) {
  if (source?.kind === "official") return OFFICIAL_STREAM_CONNECT_TIMEOUT_MS;
  if (source?.kind === "snapshot") return SNAPSHOT_CONNECT_TIMEOUT_MS;
  return RELAY_STREAM_CONNECT_TIMEOUT_MS;
}

function handleStreamFailure(camera, token, hadVisibleImage, sourceIndex) {
  if (token !== state.imageToken) return;
  clearStreamConnectTimer();
  clearSnapshotRefreshTimer();
  const sources = streamSources(camera);
  const fallbackIndex = sourceIndex + 1;
  if (state.active && state.currentCamera?.id === camera.id && sources[fallbackIndex]) {
    // The official source is the lowest-latency option; the Relay is retained as an automatic compatibility fallback.
    state.streamTransport = sources[fallbackIndex].kind;
    el.cameraStatus.textContent = `改用${sources[fallbackIndex].label}`;
    loadCameraStream(camera, true, fallbackIndex);
    return;
  }
  if (!hadVisibleImage) state.imageLoadedAt = 0;
  if (state.active && state.currentCamera?.id === camera.id && state.reconnectAttempts < 3) {
    state.reconnectAttempts += 1;
    const delay = state.reconnectAttempts * 2500;
    if (hadVisibleImage) {
      // A reconnect must never blank an already confirmed camera frame during driving.
      el.cameraStage.dataset.state = "ready";
      el.cameraPlaceholder.hidden = true;
      el.cameraStatus.textContent = "保留畫面並重新連線";
    } else {
      el.cameraStage.dataset.state = "loading";
      el.cameraPlaceholder.hidden = false;
      el.cameraPlaceholder.querySelector("strong").textContent = "正在重新連線影像";
      el.cameraPlaceholder.querySelector("small").textContent = `第 ${state.reconnectAttempts} 次重試，確認串流是否恢復。`;
      el.cameraStatus.textContent = "影像重新連線中";
    }
    window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = window.setTimeout(() => {
      if (state.active && state.currentCamera?.id === camera.id) loadCameraStream(camera, true, 0);
    }, delay);
    return;
  }
  if (hadVisibleImage) {
    el.cameraStage.dataset.state = "ready";
    el.cameraPlaceholder.hidden = true;
    el.cameraStatus.textContent = "影像更新失敗";
  } else {
    el.cameraStage.dataset.state = "error";
    setCameraPlaceholder("影像暫不可用", state.relayBase ? "影像服務目前無法取得此鏡頭，系統會在下一次定位更新時重試。" : "此鏡頭目前無法直接在手機顯示。", "error");
    el.cameraStatus.textContent = "影像讀取失敗";
  }
  setSource("影像暫不可用", "error");
  setObservation("影像串流暫時中斷", "已保留最後確認畫面；系統會在下一次更新時自動重新連線。", "warning");
}

function loadCameraStream(camera, isReconnect = false, sourceIndex = 0) {
  if (!isReconnect && sourceIndex === 0) state.reconnectAttempts = 0;
  clearStreamConnectTimer();
  clearSnapshotRefreshTimer();
  const sources = streamSources(camera);
  const stream = sources[sourceIndex];
  if (!stream) {
    handleStreamFailure(camera, state.imageToken, hasVisibleCameraImage(), sourceIndex);
    return;
  }
  const token = ++state.imageToken;
  state.streamTransport = stream.kind;
  const hadVisibleImage = hasVisibleCameraImage();
  if (hadVisibleImage) {
    // Keep the last confirmed frame visible while a new camera is connecting.
    el.cameraStage.dataset.state = "ready";
    el.cameraStatus.textContent = "切換影像中";
    el.cameraPlaceholder.hidden = true;
  } else {
    state.imageLoadedAt = 0;
    el.cameraStage.dataset.state = "loading";
    el.cameraStatus.textContent = `連線${stream.label}`;
    el.cctvImage.hidden = true;
    el.cctvPreview.hidden = true;
    el.cameraOverlay.hidden = true;
    el.cameraPlaceholder.hidden = false;
    el.cameraPlaceholder.querySelector("strong").textContent = "正在連線前方影像";
    el.cameraPlaceholder.querySelector("small").textContent = "確認鏡頭連線後才會顯示畫面。";
    if (sourceIndex === 0) preloadCameraSnapshot(camera, token);
  }
  el.cctvImage.onload = () => {
    if (token !== state.imageToken) return;
    clearStreamConnectTimer();
    state.reconnectAttempts = 0;
    el.cctvImage.hidden = false;
    el.cctvPreview.hidden = true;
    el.cctvPreview.removeAttribute("src");
    state.previewLoadedAt = 0;
    el.cameraPlaceholder.hidden = true;
    state.displayedCamera = camera;
    renderCameraContext(camera);
    el.cameraOverlay.textContent = `${camera.road} ${directionLabel(camera.direction, camera.id)}｜${camera.mile || "里程待確認"}`;
    el.cameraOverlay.hidden = false;
    el.cameraStage.dataset.state = "ready";
    state.imageLoadedAt = Date.now();
    el.cameraStatus.textContent = stream.kind === "snapshot" ? "官方快照備援" : stream.label;
    updateImageAge();
    if (stream.kind === "snapshot" && state.active && state.currentCamera?.id === camera.id) {
      state.snapshotRefreshTimer = window.setTimeout(() => {
        if (state.active && state.currentCamera?.id === camera.id) loadCameraStream(camera, true, sourceIndex);
      }, SNAPSHOT_FALLBACK_REFRESH_MS);
    }
  };
  el.cctvImage.onerror = () => handleStreamFailure(camera, token, hadVisibleImage, sourceIndex);
  state.streamConnectTimer = window.setTimeout(
    () => handleStreamFailure(camera, token, hadVisibleImage, sourceIndex),
    streamConnectTimeout(stream),
  );
  el.cctvImage.src = `${stream.url}${stream.url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

async function refreshRoadInformation(point) {
  const roadToken = ++state.roadRequestToken;
  const isCurrentRequest = () => roadToken === state.roadRequestToken;
  if (Number(point?.accuracy) > MAX_LOCATION_ACCURACY_METERS) {
    pauseRoadDataForLowAccuracy(point);
    return;
  }
  let course;
  try {
    await getCctvList();
    if (!isCurrentRequest()) return;
    course = state.course && point.timestamp - state.course.updatedAt <= COURSE_HOLD_MS ? state.course : null;
  } catch (error) {
    if (!isCurrentRequest()) return;
    setSource("CCTV 清單失敗", "error");
    setRouteSummary("道路資料暫不可用", "目前無法讀取鏡頭目錄；保留既有道路資訊並在下一次定位時重試。", "讀取失敗", "error");
    setObservation("道路資料暫不可用", error.name === "AbortError" ? "讀取逾時，將在下一次定位更新時重試。" : "無法讀取 CCTV 清單，請確認網路後重試。", "error");
    return;
  }
  if (!state.laneObservation && !state.laneCameraId) {
    el.laneDataAge.textContent = "更新中";
    setLaneReference("正在確認同向偵測器", "定位已更新；正在比對前方鏡頭與官方 VD。", "waiting");
  }
  if (!course || !Number.isFinite(course.heading)) {
    const candidate = prepareDestinationCandidate(point);
    const nearbyReference = selectNearbyReferenceCamera(point);
    state.laneRequestToken += 1;
    state.laneCameraId = "";
    state.laneObservation = null;
    clearLaneCards();
    el.laneDataAge.textContent = "--";
    setLaneReference(
      candidate ? `${candidate.intent.directionLabel}候選已預載` : "等待實際行駛方向",
      candidate
        ? `目的地「${state.destination}」已預讀 ${candidate.intent.corridorLabel} 的候選資料；GPS 確認主線後才會顯示正式同向車道速度。`
        : "需要累積足夠的 GPS 移動距離後，才會比對同向主線的官方車道速度資料。",
      "waiting",
    );
    setSource(candidate ? `${candidate.intent.directionLabel}候選預載` : "方向確認中", candidate ? "reference" : "warning");
    if (nearbyReference) {
      const changed = nearbyReference.id !== state.currentCamera?.id;
      state.currentCamera = nearbyReference;
      if (!state.displayedCamera || state.displayedCamera.id === nearbyReference.id) renderCameraContext(nearbyReference);
      renderRouteSummary(nearbyReference, false);
      setSource("附近道路影像參考", "reference");
      setObservation("附近道路影像參考", "GPS 航向仍在確認；先顯示最近非匝道的道路影像，不提供方向、車道速度或車道建議。", "reference");
      if (changed || !state.imageLoadedAt) {
        try {
          loadCameraStream(nearbyReference);
        } catch (error) {
          console.error("Nearby camera reference initialization failed", error);
          setCameraPlaceholder("影像重新連線中", "正在改用備援影像來源。", "waiting");
        }
      }
    } else if (state.displayedCamera && !el.cctvImage.hidden) {
      setRouteSummary(
        `${state.displayedCamera.road} ${directionLabel(state.displayedCamera.direction, state.displayedCamera.id)} 主線`,
        "正在重新確認 GPS 連續航向，暫停更新道路與車道推薦。",
        "方向確認中",
        "waiting",
      );
      setObservation("持續確認行駛方向", "保留已確認影像；未取得連續 GPS 航向前不切換到其他方向的鏡頭。", "warning");
    } else {
      el.roadLabel.textContent = candidate ? `${candidate.intent.corridorLabel} 候選已預載` : "正在確認實際行駛方向";
      el.roadDetail.textContent = candidate
        ? `目的地「${state.destination}」預判；正在以 GPS 航向確認實際主線。`
        : "累積 GPS 移動距離後，才會選擇同向前方鏡頭。";
      el.cameraDistance.textContent = "--";
      setRouteSummary(
        candidate ? `${candidate.intent.corridorLabel} 候選走廊已預載` : "道路走廊待確認",
        candidate
          ? `${candidate.camera ? `最近候選主線約 ${formatDistance(candidate.camera.distance)}；` : ""}GPS 航向確認後，立即切換為同向前方影像與官方 VD。`
          : "累積約 32 至 90 公尺的 GPS 連續移動後，才會顯示道路、方向與車道資料。",
        candidate ? "GPS確認中" : "方向確認中",
        candidate ? "reference" : "waiting",
      );
      setCameraPlaceholder(
        candidate ? "已預載候選道路資料" : "正在確認行駛方向",
        candidate ? "正在以 GPS 航向確認主線；不會先顯示可能反向的畫面。" : "車輛移動一小段距離後，系統才會載入同向前方影像。",
        "waiting",
      );
      setObservation(
        candidate ? "目的地候選走廊已預載" : "等待 GPS 連續定位",
        candidate ? `已依目的地「${state.destination}」預讀 ${candidate.intent.corridorLabel}；正式道路與車道資訊仍須 GPS 航向確認。` : "尚未取得可判定的實際航向，因此不顯示可能反向的鏡頭。",
        candidate ? "reference" : "warning",
      );
    }
    return;
  }
  try {
    let selected;
    let selectionError = null;
    try {
      selected = selectForwardCamera(point, course);
    } catch (error) {
      selectionError = error;
      console.error("Precise road matching failed; using nearby camera reference", error);
      selected = selectNearbyReferenceCamera(point);
    }
    if (!selected) {
      setSource("前方無可確認鏡頭", "warning");
      if (state.displayedCamera && !el.cctvImage.hidden) {
        setRouteSummary(
          `${state.displayedCamera.road} ${directionLabel(state.displayedCamera.direction, state.displayedCamera.id)} 主線`,
          "正在重新確認道路走廊；保留目前已確認影像。",
          "道路確認中",
          "waiting",
        );
        // Do not replace a confirmed frame with an unrelated nearest camera when GPS data is ambiguous.
        setObservation("正在重新確認道路方向", "保留目前影像，直到能確認同向前方鏡頭後才會切換。", "warning");
      } else {
        el.roadLabel.textContent = "目前位置前方沒有可確認國道影像";
        el.roadDetail.textContent = "未確認道路與方向時，不改抓平行道路的最近鏡頭。";
        el.cameraDistance.textContent = "--";
        setRouteSummary("道路走廊待確認", "目前位置尚未能對應同向國道主線，因此不顯示可能錯誤的車道資料。", "道路確認中", "warning");
        setCameraPlaceholder("前方無可確認影像", "保持定位後會自動再找。", "waiting");
        setObservation("資料不足", "位置或方向尚未足以確認同向前方鏡頭。", "warning");
      }
      return;
    }
    const changed = selected.id !== state.currentCamera?.id;
    state.currentCamera = selected;
    if (!state.displayedCamera || state.displayedCamera.id === selected.id) renderCameraContext(selected);
    const corridorVerified = !selected.corridor || ["high", "medium"].includes(selected.corridor.confidence);
    const directionVerified = !selectionError && !selected.isReferenceFallback
      && Number.isFinite(selected.routeHeading) && Number.isFinite(selected.directionDelta) && corridorVerified;
    renderRouteSummary(selected, directionVerified);
    setSource(directionVerified ? "同向前方影像" : "附近道路影像參考", directionVerified ? "live" : "reference");
    setObservation(directionVerified ? "前方道路影像" : "附近道路影像參考", directionVerified
      ? `${selected.corridor ? "道路走廊與 GPS 航向已比對" : "GPS 實際行駛方向已比對"} ${selected.road} ${directionLabel(selected.direction, selected.id)} 主線；已選擇 ${formatDistance(selected.distance)} 前方鏡頭。`
      : "精準道路比對仍在背景重試；目前先顯示最近非匝道的道路影像參考，不提供車道速度或車道建議。", "reference");
    if (changed || !state.imageLoadedAt) {
      try {
        loadCameraStream(selected);
      } catch (error) {
        console.error("CCTV stream initialization failed", error);
        setCameraPlaceholder("影像重新連線中", "道路與方向已確認，正在改用備援影像來源。", "waiting");
        el.cameraStatus.textContent = "影像連線重試中";
      }
    }
    if (directionVerified) void refreshLaneObservation(selected, roadToken);
  } catch (error) {
    if (!isCurrentRequest()) return;
    setSource("道路判讀暫不可用", "error");
    setRouteSummary("道路資料暫不可用", "目前無法完成前方鏡頭比對；保留既有道路資訊並在下一次定位時重試。", "判讀重試中", "error");
    setObservation("道路判讀暫不可用", error.name === "AbortError" ? "道路比對逾時，將在下一次定位更新時重試。" : "前方鏡頭道路比對暫時失敗，系統會自動重試。", "error");
  }
}

function handlePosition(position) {
  const point = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    heading: position.coords.heading,
    speed: position.coords.speed,
    timestamp: Number(position.timestamp) || Date.now(),
  };
  const speed = deriveSpeed(point);
  if (state.lastPoint && point.timestamp < state.lastPoint.timestamp) return;
  state.lastPoint = point;
  el.locationState.textContent = `${point.accuracy <= MAX_LOCATION_ACCURACY_METERS ? "定位正常" : "定位精度不足"}｜誤差 ${Math.round(point.accuracy)} m`;
  el.locationAccuracy.textContent = String(Math.round(point.accuracy));
  el.gpsSpeed.textContent = Number.isFinite(speed.value) ? String(speed.value) : "--";
  el.gpsSpeedNote.textContent = Number.isFinite(speed.value) ? `${speed.source} km/h` : speed.source;
  if (point.accuracy > MAX_LOCATION_ACCURACY_METERS) {
    el.travelDirection.textContent = "--";
    el.travelDirectionNote.textContent = `需在 ${MAX_LOCATION_ACCURACY_METERS} m 內`;
    pauseRoadDataForLowAccuracy(point);
    return;
  }
  const course = updateCourse(point);
  el.travelDirection.textContent = Number.isFinite(course?.heading) ? headingLabel(course.heading) : "--";
  el.travelDirectionNote.textContent = Number.isFinite(course?.heading)
    ? `${course.source}${course.distance ? `｜${Math.round(course.distance)} m` : ""}`
    : "累積移動距離中";
  void refreshRoadInformation(point);
}

function handleLocationError(error) {
  const messages = {
    1: "定位權限未允許。請在 Safari 網站設定中允許定位。",
    2: "目前無法取得位置。請確認手機定位服務已開啟。",
    3: "定位逾時，保持畫面開啟後會自動重試。",
  };
  el.locationState.textContent = "定位暫不可用";
  setRouteSummary("道路走廊待確認", messages[error.code] || "定位服務暫時失敗。", "定位失敗", "error");
  setSource("定位失敗", "error");
  setObservation("未啟動道路判讀", messages[error.code] || "定位服務暫時失敗。", "error");
}

function startDrive() {
  if (!navigator.geolocation) {
    setObservation("此瀏覽器不支援定位", "請改用 Safari 或已安裝的原生 App。", "error");
    return;
  }
  if (!state.proxyBase) {
    setSource("影像服務未設定", "warning");
    setObservation("請先設定影像服務", "此測試版需要 CCTV Proxy 網址，才能在 iPhone 顯示國道即時畫面。", "warning");
    el.openSettings.focus();
    return;
  }
  if (state.active) return;
  state.lastPoint = null;
  state.currentCamera = null;
  state.displayedCamera = null;
  resetCourse();
  state.active = true;
  // Start from the bundled catalog before the first GPS callback so destination candidates can be prepared immediately.
  void getCctvList().catch(() => {});
  el.startDrive.hidden = true;
  el.stopDrive.hidden = false;
  el.locationState.textContent = "正在確認定位";
  setSource("定位啟動中", "waiting");
  setRouteSummary("道路走廊待確認", "定位與實際行駛方向確認後，將顯示國道、方向、里程與官方車道流況。", "定位啟動中", "waiting");
  setObservation("正在尋找前方影像", "定位確認後會自動選擇前方候選鏡頭。", "waiting");
  setLaneReference("等待同向偵測器", "定位與前方鏡頭確認後，才會讀取最近同向主線的官方車道速度資料。", "waiting");
  state.watchId = navigator.geolocation.watchPosition(handlePosition, handleLocationError, LOCATION_OPTIONS);
  state.refreshTimer = window.setInterval(() => {
    if (state.lastPoint) void refreshRoadInformation(state.lastPoint);
    updateImageAge();
    updateLaneDataAge();
  }, ROAD_REFRESH_MS);
}

function stopDrive() {
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  if (state.refreshTimer !== null) window.clearInterval(state.refreshTimer);
  if (state.reconnectTimer !== null) window.clearTimeout(state.reconnectTimer);
  clearStreamConnectTimer();
  clearSnapshotRefreshTimer();
  state.watchId = null;
  state.refreshTimer = null;
  state.reconnectTimer = null;
  state.reconnectAttempts = 0;
  state.active = false;
  state.lastPoint = null;
  state.currentCamera = null;
  state.displayedCamera = null;
  resetCourse();
  state.imageToken += 1;
  state.imageLoadedAt = 0;
  state.previewLoadedAt = 0;
  state.streamTransport = "";
  state.laneRequestToken += 1;
  state.laneCameraId = "";
  state.laneObservation = null;
  state.laneFetchedAt = 0;
  clearLaneCards();
  el.laneDataAge.textContent = "--";
  setLaneReference("車道資料待命", "再次啟動後，才會依目前位置讀取同向主線的官方 VD 資料。", "waiting");
  el.cctvImage.onload = null;
  el.cctvImage.onerror = null;
  el.cctvImage.removeAttribute("src");
  el.cctvPreview.onload = null;
  el.cctvPreview.onerror = null;
  setCameraPlaceholder("即時道路資訊已停止", "再次啟動後，會重新確認定位與前方鏡頭。", "waiting");
  el.cameraStatus.textContent = "影像待命";
  el.cameraAge.textContent = "--";
  el.startDrive.hidden = false;
  el.stopDrive.hidden = true;
  el.locationState.textContent = "定位已停止";
  el.travelDirection.textContent = "--";
  el.travelDirectionNote.textContent = "待移動確認";
  setSource("資料待命", "waiting");
  setRouteSummary("道路資料待命", "再次啟動後，將依 GPS 顯示國道、方向、里程與同向車道流況。", "定位已停止", "waiting");
  setObservation("即時道路資訊已停止", "影像不再自動更新。", "waiting");
}

function retryRoadData() {
  if (!state.active || !state.lastPoint) return;
  setSource("重新讀取道路資料", "waiting");
  // Do not make the driver wait for the remote full catalog. The compact starter
  // catalog can resume same-corridor matching even while the Relay is recovering.
  void getCctvList()
    .catch(() => [])
    .finally(() => void refreshRoadInformation(state.lastPoint));
}

function refreshSettingsServiceStatus() {
  const defaultProxy = getDefaultProxyBase();
  const defaultRelay = getDefaultRelayBase();
  if (!state.proxyBase || !state.relayBase) {
    el.settingsServiceStatus.dataset.level = "error";
    el.settingsServiceStatus.querySelector("strong").textContent = "影像服務尚未完成設定";
    el.settingsServiceStatus.querySelector("small").textContent = "請使用預設服務，或輸入可用的 HTTPS 服務網址。";
    return;
  }
  const usingDefaults = state.proxyBase === defaultProxy && state.relayBase === defaultRelay;
  el.settingsServiceStatus.dataset.level = "ready";
  el.settingsServiceStatus.querySelector("strong").textContent = usingDefaults ? "影像服務已自動設定" : "使用自訂影像服務";
  el.settingsServiceStatus.querySelector("small").textContent = usingDefaults
    ? "一般使用不需要輸入網址；啟動後會依定位連接前方官方 CCTV。"
    : "目前使用進階設定；若無法顯示影像，可改回預設服務。";
}

function resetServiceSettings() {
  localStorage.removeItem(proxyStorageKey);
  localStorage.removeItem(relayStorageKey);
  state.proxyBase = getDefaultProxyBase();
  state.relayBase = getDefaultRelayBase();
  state.cctvs = [];
  state.cctvsLoadedAt = 0;
  state.currentCamera = null;
  state.imageLoadedAt = 0;
  state.streamTransport = "";
  clearSnapshotRefreshTimer();
  state.laneCameraId = "";
  state.laneObservation = null;
  state.laneFetchedAt = 0;
  state.laneRequestToken += 1;
  clearLaneCards();
  el.laneDataAge.textContent = "--";
  setLaneReference("等待同向偵測器", "定位與前方鏡頭確認後，才會讀取最近同向主線的官方車道速度資料。", "waiting");
  el.proxyEndpoint.value = state.proxyBase;
  el.relayEndpoint.value = state.relayBase;
  refreshSettingsServiceStatus();
  closeAppDialog(el.settingsDialog);
  if (state.lastPoint) void refreshRoadInformation(state.lastPoint);
}

function saveProxySetting() {
  const customProxyBase = normalizeProxyBase(el.proxyEndpoint.value);
  const customRelayBase = normalizeRelayBase(el.relayEndpoint.value);
  const defaultProxyBase = getDefaultProxyBase();
  const defaultRelayBase = getDefaultRelayBase();
  state.proxyBase = customProxyBase || defaultProxyBase;
  state.relayBase = customRelayBase || defaultRelayBase;
  if (customProxyBase && customProxyBase !== defaultProxyBase) localStorage.setItem(proxyStorageKey, customProxyBase);
  else localStorage.removeItem(proxyStorageKey);
  if (customRelayBase && customRelayBase !== defaultRelayBase) localStorage.setItem(relayStorageKey, customRelayBase);
  else localStorage.removeItem(relayStorageKey);
  state.cctvs = [];
  state.cctvsLoadedAt = 0;
  state.currentCamera = null;
  state.imageLoadedAt = 0;
  state.streamTransport = "";
  clearSnapshotRefreshTimer();
  state.laneCameraId = "";
  state.laneObservation = null;
  state.laneFetchedAt = 0;
  state.laneRequestToken += 1;
  clearLaneCards();
  el.laneDataAge.textContent = "--";
  setLaneReference("等待同向偵測器", "定位與前方鏡頭確認後，才會讀取最近同向主線的官方車道速度資料。", "waiting");
  refreshSettingsServiceStatus();
  closeAppDialog(el.settingsDialog);
  if (state.lastPoint) void refreshRoadInformation(state.lastPoint);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) updateImageAge();
  if (!document.hidden && state.active && state.lastPoint) void refreshRoadInformation(state.lastPoint);
});

el.openSettings.addEventListener("click", () => {
  el.proxyEndpoint.value = state.proxyBase;
  el.relayEndpoint.value = state.relayBase;
  refreshSettingsServiceStatus();
  showAppDialog(el.settingsDialog);
});
el.saveSettings.addEventListener("click", saveProxySetting);
el.resetSettings.addEventListener("click", resetServiceSettings);
el.cancelSettings.addEventListener("click", () => closeAppDialog(el.settingsDialog));
el.editDestination.addEventListener("click", openDestinationDialog);
el.destinationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveDestination();
});
el.destinationInput.addEventListener("input", () => el.destinationInput.setCustomValidity(""));
el.saveDestination.addEventListener("click", saveDestination);
el.clearDestination.addEventListener("click", clearDestination);
el.cancelDestination.addEventListener("click", () => closeAppDialog(el.destinationDialog));
el.startDrive.addEventListener("click", startDrive);
el.stopDrive.addEventListener("click", stopDrive);
el.retryRoadData.addEventListener("click", retryRoadData);
window.setInterval(() => {
  updateImageAge();
  updateLaneDataAge();
}, 1000);

if (!state.proxyBase) {
  setSource("影像服務未設定", "warning");
  setObservation("請先設定影像服務", "設定完成後，才會讀取定位並載入前方道路影像。", "warning");
}

renderTripPlan();

// Camera positions rarely change. Keeping the last verified catalog lets a returning driver
// select the direct official image even while a sleeping relay is warming up.
hydratePersistedCctvList();
window.addEventListener("load", () => {
  // Keep a same-origin catalogue ready before GPS starts selecting a road.
  // This avoids making a live Relay request the only path to first use.
  void hydrateBundledCctvList().catch(() => {});
  if (state.proxyBase) void refreshCctvList().catch(() => {});
}, { once: true });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
