const TDX_CCTV_URL = "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Freeway?$format=JSON";
const CAMERA_CACHE_MS = 6 * 60 * 60 * 1000;
const ROAD_REFRESH_MS = 15 * 1000;
const LANE_REFRESH_MS = 60 * 1000;
const LANE_DATA_MAX_AGE_MS = 3 * 60 * 1000;
const MAX_CAMERA_DISTANCE_METERS = 5000;
const CAMERA_SWITCH_METERS = 500;
const CAMERA_BEARING_MAX_DELTA = 75;
const CAMERA_DIRECTION_MAX_DELTA = 65;
const RAMP_CAMERA_PENALTY = 650;
const MAX_LOCATION_ACCURACY_METERS = 150;
const STREAM_CONNECT_TIMEOUT_MS = 18000;
const MIN_HEADING_DISTANCE_METERS = 18;
const MIN_SPEED_INTERVAL_SECONDS = 2;
const MAX_SPEED_INTERVAL_SECONDS = 20;
const MAX_ESTIMATED_SPEED_KPH = 160;
const LOCATION_OPTIONS = { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 };
const proxyStorageKey = "commute-cctv-proxy-base-v1";
const relayStorageKey = "commute-cctv-relay-base-v1";

const el = {
  locationState: document.querySelector("#locationState"),
  sourceChip: document.querySelector("#sourceChip"),
  roadLabel: document.querySelector("#roadLabel"),
  roadDetail: document.querySelector("#roadDetail"),
  cameraStage: document.querySelector("#cameraStage"),
  cctvImage: document.querySelector("#cctvImage"),
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
};

const state = {
  active: false,
  watchId: null,
  cctvs: [],
  cctvsLoadedAt: 0,
  currentCamera: null,
  displayedCamera: null,
  lastPoint: null,
  imageLoadedAt: 0,
  refreshTimer: null,
  reconnectTimer: null,
  streamConnectTimer: null,
  reconnectAttempts: 0,
  imageToken: 0,
  streamTransport: "",
  laneCameraId: "",
  laneObservation: null,
  laneFetchedAt: 0,
  laneRequestToken: 0,
  proxyBase: normalizeProxyBase(localStorage.getItem(proxyStorageKey)) || getDefaultProxyBase(),
  relayBase: normalizeRelayBase(localStorage.getItem(relayStorageKey)) || getDefaultRelayBase(),
};

function normalizeProxyBase(value) {
  const base = String(value || "").trim().replace(/\/$/, "");
  return /^https:\/\//i.test(base) ? base : "";
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

function setSource(label, level = "waiting") {
  el.sourceChip.textContent = label;
  el.sourceChip.dataset.level = level;
}

function setObservation(title, detail, level = "waiting") {
  el.observationTitle.textContent = title;
  el.observationDetail.textContent = detail;
  el.observation.dataset.level = level;
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

function laneTypeLabel(type) {
  return ({ 1: "一般車道", 2: "快速車道", 3: "慢速車道" })[Number(type)] || "車道";
}

function formatLaneDataAge() {
  const collectedAt = Date.parse(state.laneObservation?.vd?.dataCollectTime || "");
  if (!Number.isFinite(collectedAt)) return "更新時間待確認";
  const seconds = Math.max(0, Math.round((Date.now() - collectedAt) / 1000));
  return seconds < 90 ? `${seconds} 秒前` : `${Math.floor(seconds / 60)} 分前`;
}

function updateLaneDataAge() {
  if (!state.laneObservation?.ok) return;
  const collectedAt = Date.parse(state.laneObservation.vd?.dataCollectTime || "");
  if (Number.isFinite(collectedAt) && Date.now() - collectedAt > LANE_DATA_MAX_AGE_MS) {
    clearLaneCards();
    setLaneReference("官方 VD 資料已過期", "車道資料超過 3 分鐘，系統暫停顯示車道比較。", "warning");
    el.laneDataAge.textContent = formatLaneDataAge();
    return;
  }
  el.laneDataAge.textContent = formatLaneDataAge();
}

function renderLaneObservation(observation) {
  state.laneObservation = observation?.ok ? observation : null;
  if (!observation?.ok) {
    clearLaneCards();
    el.laneDataAge.textContent = "--";
    setLaneReference("附近無可用主線 VD", "此路段目前沒有可確認的同向每車道官方資料，僅顯示影像參考。", "warning");
    return;
  }

  const collectedAt = Date.parse(observation.vd?.dataCollectTime || "");
  if (Number.isFinite(collectedAt) && Date.now() - collectedAt > LANE_DATA_MAX_AGE_MS) {
    clearLaneCards();
    el.laneDataAge.textContent = formatLaneDataAge();
    setLaneReference("官方 VD 資料已過期", "車道資料超過 3 分鐘，系統暫停顯示車道比較。", "warning");
    return;
  }

  const reference = observation.flowReference || {};
  const level = reference.state === "reference" ? "reference" : reference.state === "similar" ? "waiting" : "warning";
  const mainLaneCount = Number(observation.mainLaneCount);
  const laneCountLabel = Number.isInteger(mainLaneCount) && mainLaneCount > 0 ? `主線 ${mainLaneCount} 線道` : "主線車道資料";
  setLaneReference(`${laneCountLabel}｜${reference.label || "官方 VD 資料"}`, reference.detail || "官方 VD 資料待確認。", level);
  el.laneDataAge.textContent = formatLaneDataAge();
  const cards = observation.lanes
    .filter((lane) => [1, 2, 3].includes(Number(lane.laneType)) && Number.isFinite(Number(lane.speedKph)))
    .map((lane) => {
      const card = document.createElement("article");
      card.className = "lane-card";
      if (reference.state === "reference" && String(reference.bestLaneId) === String(lane.laneId)) card.dataset.state = "reference";
      const volume = Number.isFinite(Number(lane.volume)) ? `${Math.round(lane.volume)} 輛/分` : "流量待確認";
      const occupancy = Number.isFinite(Number(lane.occupancy)) ? `占有率 ${Math.round(lane.occupancy)}%` : "占有率待確認";
      const title = document.createElement("span");
      title.textContent = `第 ${lane.laneId} 車道｜${laneTypeLabel(lane.laneType)}`;
      const speed = document.createElement("strong");
      speed.append(String(Math.round(lane.speedKph)));
      const unit = document.createElement("small");
      unit.textContent = "km/h";
      speed.append(unit);
      const detail = document.createElement("small");
      detail.textContent = `${occupancy}｜${volume}`;
      card.append(title, speed, detail);
      return card;
    });
  el.laneCards.replaceChildren(...cards);
  el.laneCards.hidden = !cards.length;
}

function setCameraPlaceholder(title, detail, stage = "waiting") {
  el.cameraStage.dataset.state = stage;
  el.cctvImage.hidden = true;
  el.cameraPlaceholder.hidden = false;
  el.cameraPlaceholder.querySelector("strong").textContent = title;
  el.cameraPlaceholder.querySelector("small").textContent = detail;
  el.cameraOverlay.hidden = true;
}

function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function formatDirection(direction) {
  const heading = directionHeading(direction);
  if (heading === 0) return "北向";
  if (heading === 180) return "南向";
  if (heading === 90) return "東向";
  if (heading === 270) return "西向";
  return "方向待確認";
}

function directionHeading(direction) {
  const normalized = String(direction || "").trim().toUpperCase();
  if (/北|NORTH|(?:^|[-_\s])N(?:$|[-_\s])/.test(normalized)) return 0;
  if (/南|SOUTH|(?:^|[-_\s])S(?:$|[-_\s])/.test(normalized)) return 180;
  if (/東|EAST|(?:^|[-_\s])E(?:$|[-_\s])/.test(normalized)) return 90;
  if (/西|WEST|(?:^|[-_\s])W(?:$|[-_\s])/.test(normalized)) return 270;
  return NaN;
}

function headingLabel(heading) {
  if (!Number.isFinite(heading)) return "方向待確認";
  if (heading >= 315 || heading < 45) return "北向";
  if (heading < 135) return "東向";
  if (heading < 225) return "南向";
  return "西向";
}

function roadKey(camera) {
  return String(camera?.road || "").replace(/\s/g, "").toUpperCase();
}

function isRampCamera(camera) {
  return /匝道|入口|出口|引道|連絡道/.test(String(camera.section || ""));
}

function timeoutFetch(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => window.clearTimeout(timer));
}

async function getCctvList() {
  if (state.cctvs.length && Date.now() - state.cctvsLoadedAt < CAMERA_CACHE_MS) return state.cctvs;
  const listUrl = state.proxyBase ? `${state.proxyBase}/v1/cameras` : TDX_CCTV_URL;
  const response = await timeoutFetch(listUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`CCTV 清單讀取失敗 (${response.status})`);
  const payload = await response.json();
  const rawCameras = state.proxyBase ? (payload.cameras || []) : (payload.CCTVs || []);
  state.cctvs = rawCameras
    .filter((camera) => {
      const id = state.proxyBase ? camera.id : camera.CCTVID;
      const mediaUrl = state.proxyBase ? camera.mediaUrl : camera.VideoStreamURL;
      return id && mediaUrl && Number(camera.lat ?? camera.PositionLat) && Number(camera.lng ?? camera.PositionLon);
    })
    .map((camera) => ({
      id: state.proxyBase ? camera.id : camera.CCTVID,
      road: camera.road || camera.RoadName || camera.RoadID || "國道路段",
      direction: camera.direction || camera.Direction || "",
      mile: camera.mile || camera.LocationMile || camera.Mile || "",
      section: camera.section || camera.LocationName || "",
      lat: Number(camera.lat ?? camera.PositionLat),
      lng: Number(camera.lng ?? camera.PositionLon),
      mediaUrl: camera.mediaUrl || camera.VideoStreamURL,
    }));
  state.cctvsLoadedAt = Date.now();
  return state.cctvs;
}

function radians(value) { return value * Math.PI / 180; }

function distanceBetween(a, b) {
  const earth = 6371000;
  const deltaLat = radians(b.lat - a.lat);
  const deltaLng = radians(b.lng - a.lng);
  const latA = radians(a.lat);
  const latB = radians(b.lat);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earth * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearingBetween(a, b) {
  const latA = radians(a.lat);
  const latB = radians(b.lat);
  const deltaLng = radians(b.lng - a.lng);
  const y = Math.sin(deltaLng) * Math.cos(latB);
  const x = Math.cos(latA) * Math.sin(latB) - Math.sin(latA) * Math.cos(latB) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angleDelta(a, b) {
  return ((a - b + 540) % 360) - 180;
}

function deriveHeading(point) {
  if (Number.isFinite(point.heading) && point.heading >= 0) return point.heading;
  if (state.lastPoint && distanceBetween(state.lastPoint, point) >= MIN_HEADING_DISTANCE_METERS) return bearingBetween(state.lastPoint, point);
  return NaN;
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

function selectForwardCamera(point, heading) {
  const candidates = state.cctvs
    .map((camera) => {
      const distance = distanceBetween(point, camera);
      const bearing = bearingBetween(point, camera);
      const bearingDelta = Number.isFinite(heading) ? Math.abs(angleDelta(heading, bearing)) : 0;
      const cameraHeading = directionHeading(camera.direction);
      const directionDelta = Number.isFinite(heading) && Number.isFinite(cameraHeading)
        ? Math.abs(angleDelta(heading, cameraHeading))
        : NaN;
      const rampPenalty = isRampCamera(camera) ? RAMP_CAMERA_PENALTY : 0;
      const score = distance + bearingDelta * 12 + (Number.isFinite(directionDelta) ? directionDelta * 16 : 80) + rampPenalty;
      return { ...camera, distance, bearingDelta, cameraHeading, directionDelta, score };
    })
    .filter((camera) => camera.distance <= MAX_CAMERA_DISTANCE_METERS)
    .filter((camera) => !Number.isFinite(heading) || camera.bearingDelta <= CAMERA_BEARING_MAX_DELTA)
    .filter((camera) => !Number.isFinite(camera.directionDelta) || camera.directionDelta <= CAMERA_DIRECTION_MAX_DELTA)
    .sort((a, b) => a.score - b.score);

  const current = candidates.find((camera) => camera.id === state.currentCamera?.id);
  if (current && current.distance >= CAMERA_SWITCH_METERS) return current;
  const currentRoad = roadKey(state.currentCamera);
  const sameRoadAhead = candidates.find((camera) => roadKey(camera) === currentRoad && camera.distance >= CAMERA_SWITCH_METERS);
  if (sameRoadAhead) return sameRoadAhead;
  return candidates.find((camera) => camera.distance >= CAMERA_SWITCH_METERS) || candidates[0] || null;
}

function streamSources(camera) {
  const sources = [];
  const officialUrl = String(camera.mediaUrl || "").trim();
  if (/^https:\/\//i.test(officialUrl)) sources.push({ kind: "official", label: "官方原生串流", url: officialUrl });
  if (state.relayBase) sources.push({ kind: "relay", label: "Relay 串流", url: `${state.relayBase}/mjpeg/${encodeURIComponent(camera.id)}` });
  if (state.proxyBase) sources.push({ kind: "proxy", label: "Proxy 串流", url: `${state.proxyBase}/v1/stream?id=${encodeURIComponent(camera.id)}` });
  return sources.filter((source, index, list) => list.findIndex((candidate) => candidate.url === source.url) === index);
}

function renderCameraContext(camera) {
  el.roadLabel.textContent = `${camera.road} ${formatDirection(camera.direction)}｜${camera.mile || "里程待確認"}`;
  el.roadDetail.textContent = camera.section || "附近前方國道 CCTV";
  el.cameraDistance.textContent = formatDistance(camera.distance);
}

async function refreshLaneObservation(camera) {
  if (!state.proxyBase || !camera?.id) return;
  const isCurrent = state.laneCameraId === camera.id;
  if (isCurrent && Date.now() - state.laneFetchedAt < LANE_REFRESH_MS) {
    updateLaneDataAge();
    return;
  }
  const token = ++state.laneRequestToken;
  if (!isCurrent) {
    state.laneCameraId = camera.id;
    state.laneObservation = null;
    clearLaneCards();
    el.laneDataAge.textContent = "讀取中";
    setLaneReference("正在讀取官方 VD", "正在比對同向主線偵測器的每車道資料。", "waiting");
  }
  try {
    const response = await timeoutFetch(`${state.proxyBase}/v1/lanes/${encodeURIComponent(camera.id)}`, { cache: "no-store" }, 12000);
    const observation = await response.json();
    if (token !== state.laneRequestToken || camera.id !== state.currentCamera?.id) return;
    state.laneFetchedAt = Date.now();
    renderLaneObservation(observation);
  } catch (_) {
    if (token !== state.laneRequestToken || camera.id !== state.currentCamera?.id) return;
    state.laneFetchedAt = Date.now();
    renderLaneObservation({ ok: false });
  }
}

function updateImageAge() {
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

function handleStreamFailure(camera, token, hadVisibleImage, sourceIndex) {
  if (token !== state.imageToken) return;
  clearStreamConnectTimer();
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
  const sources = streamSources(camera);
  const stream = sources[sourceIndex];
  if (!stream) {
    handleStreamFailure(camera, state.imageToken, !el.cctvImage.hidden && Boolean(state.displayedCamera), sourceIndex);
    return;
  }
  const token = ++state.imageToken;
  state.streamTransport = stream.kind;
  const hadVisibleImage = !el.cctvImage.hidden && Boolean(state.displayedCamera);
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
    el.cameraOverlay.hidden = true;
    el.cameraPlaceholder.hidden = false;
    el.cameraPlaceholder.querySelector("strong").textContent = "正在連線前方影像";
    el.cameraPlaceholder.querySelector("small").textContent = "確認鏡頭連線後才會顯示畫面。";
  }
  el.cctvImage.onload = () => {
    if (token !== state.imageToken) return;
    clearStreamConnectTimer();
    state.reconnectAttempts = 0;
    el.cctvImage.hidden = false;
    el.cameraPlaceholder.hidden = true;
    state.displayedCamera = camera;
    renderCameraContext(camera);
    el.cameraOverlay.textContent = `${camera.road} ${formatDirection(camera.direction)}｜${camera.mile || "里程待確認"}`;
    el.cameraOverlay.hidden = false;
    el.cameraStage.dataset.state = "ready";
    state.imageLoadedAt = Date.now();
    el.cameraStatus.textContent = stream.label;
    updateImageAge();
  };
  el.cctvImage.onerror = () => handleStreamFailure(camera, token, hadVisibleImage, sourceIndex);
  state.streamConnectTimer = window.setTimeout(() => handleStreamFailure(camera, token, hadVisibleImage, sourceIndex), STREAM_CONNECT_TIMEOUT_MS);
  el.cctvImage.src = `${stream.url}${stream.url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

async function refreshRoadInformation(point) {
  const heading = deriveHeading(point);
  try {
    await getCctvList();
    const selected = selectForwardCamera(point, heading);
    if (!selected) {
      setSource("前方無可確認鏡頭", "warning");
      if (state.displayedCamera && !el.cctvImage.hidden) {
        // Do not replace a confirmed frame with an unrelated nearest camera when GPS data is ambiguous.
        setObservation("正在重新確認道路方向", "保留目前影像，直到能確認同向前方鏡頭後才會切換。", "warning");
      } else {
        el.roadLabel.textContent = "目前位置前方沒有可確認國道影像";
        el.roadDetail.textContent = "未確認道路與方向時，不改抓平行道路的最近鏡頭。";
        el.cameraDistance.textContent = "--";
        setCameraPlaceholder("前方無可確認影像", "保持定位後會自動再找。", "waiting");
        setObservation("資料不足", "位置或方向尚未足以確認同向前方鏡頭。", "warning");
      }
      return;
    }
    const changed = selected.id !== state.currentCamera?.id;
    state.currentCamera = selected;
    if (!state.displayedCamera || state.displayedCamera.id === selected.id) renderCameraContext(selected);
    const directionVerified = Number.isFinite(heading) && Number.isFinite(selected.directionDelta);
    setSource(directionVerified ? "同向前方影像" : Number.isFinite(heading) ? "前方影像參考" : "方向待確認", directionVerified ? "live" : Number.isFinite(heading) ? "reference" : "warning");
    setObservation("前方道路影像", directionVerified
      ? `GPS 行駛方向與鏡頭方向一致；已選擇 ${formatDistance(selected.distance)} 前方鏡頭。`
      : Number.isFinite(heading)
        ? `已取得行駛方向；此鏡頭方向資料待補強，先作前方影像參考。`
        : "定位已取得，等待移動方向確認後提高鏡頭比對可信度。", "reference");
    if (changed || !state.imageLoadedAt) loadCameraStream(selected);
    void refreshLaneObservation(selected);
  } catch (error) {
    setSource("CCTV 清單失敗", "error");
    setObservation("道路資料暫不可用", error.name === "AbortError" ? "讀取逾時，將在下一次定位更新時重試。" : "無法讀取 CCTV 清單，請確認網路後重試。", "error");
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
  const heading = deriveHeading(point);
  const speed = deriveSpeed(point);
  el.locationState.textContent = `定位正常｜誤差 ${Math.round(point.accuracy)} m`;
  el.locationAccuracy.textContent = String(Math.round(point.accuracy));
  el.gpsSpeed.textContent = Number.isFinite(speed.value) ? String(speed.value) : "--";
  el.gpsSpeedNote.textContent = Number.isFinite(speed.value) ? `${speed.source} km/h` : speed.source;
  el.travelDirection.textContent = Number.isFinite(heading) ? headingLabel(heading) : "--";
  el.travelDirectionNote.textContent = Number.isFinite(heading) ? "GPS 連續定位" : "待移動確認";
  if (point.accuracy > MAX_LOCATION_ACCURACY_METERS) {
    setSource("位置確認中", "warning");
    setObservation("定位誤差較大", "目前不切換鏡頭，避免顯示錯誤道路或匝道影像。", "warning");
    state.lastPoint = point;
    return;
  }
  void refreshRoadInformation(point);
  state.lastPoint = point;
}

function handleLocationError(error) {
  const messages = {
    1: "定位權限未允許。請在 Safari 網站設定中允許定位。",
    2: "目前無法取得位置。請確認手機定位服務已開啟。",
    3: "定位逾時，保持畫面開啟後會自動重試。",
  };
  el.locationState.textContent = "定位暫不可用";
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
  state.active = true;
  el.startDrive.hidden = true;
  el.stopDrive.hidden = false;
  el.locationState.textContent = "正在確認定位";
  setSource("定位啟動中", "waiting");
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
  state.watchId = null;
  state.refreshTimer = null;
  state.reconnectTimer = null;
  state.reconnectAttempts = 0;
  state.active = false;
  state.imageToken += 1;
  state.imageLoadedAt = 0;
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
  setCameraPlaceholder("即時道路資訊已停止", "再次啟動後，會重新確認定位與前方鏡頭。", "waiting");
  el.cameraStatus.textContent = "影像待命";
  el.cameraAge.textContent = "--";
  el.startDrive.hidden = false;
  el.stopDrive.hidden = true;
  el.locationState.textContent = "定位已停止";
  setSource("資料待命", "waiting");
  setObservation("即時道路資訊已停止", "影像不再自動更新。", "waiting");
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
  el.settingsDialog.close();
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
  state.laneCameraId = "";
  state.laneObservation = null;
  state.laneFetchedAt = 0;
  state.laneRequestToken += 1;
  clearLaneCards();
  el.laneDataAge.textContent = "--";
  setLaneReference("等待同向偵測器", "定位與前方鏡頭確認後，才會讀取最近同向主線的官方車道速度資料。", "waiting");
  refreshSettingsServiceStatus();
  el.settingsDialog.close();
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
  el.settingsDialog.showModal();
});
el.saveSettings.addEventListener("click", saveProxySetting);
el.resetSettings.addEventListener("click", resetServiceSettings);
el.startDrive.addEventListener("click", startDrive);
el.stopDrive.addEventListener("click", stopDrive);
window.setInterval(() => {
  updateImageAge();
  updateLaneDataAge();
}, 1000);

if (!state.proxyBase) {
  setSource("影像服務未設定", "warning");
  setObservation("請先設定影像服務", "設定完成後，才會讀取定位並載入前方道路影像。", "warning");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
