import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pilotSource = readFileSync(new URL("../pilot.html", import.meta.url), "utf8");

test("pilot provides manual lane-count and centreline calibration controls", () => {
  assert.match(pilotSource, /人工車道校正/);
  assert.match(pilotSource, /id="laneCountPicker"/);
  assert.match(pilotSource, /四個中心線點/);
  assert.match(pilotSource, /lane-centreline/);
  assert.match(pilotSource, /id="vdLaneMapping"/);
  assert.match(pilotSource, /function renderVdLaneMapping\(camera, calibration\)/);
  assert.match(pilotSource, /十支鏡頭共用串流已連線/);
  assert.match(pilotSource, /function captureCalibrationPoint\(event\)/);
  assert.match(pilotSource, /function calibrationContentBox\(\)/);
  assert.match(pilotSource, /function positionCalibrationOverlay\(\)/);
  assert.match(pilotSource, /function calibrationIsComplete\(calibration\)/);
  assert.match(pilotSource, /calibration\.savedAt=calibrationIsComplete\(calibration\)/);
  assert.match(pilotSource, /人工車道校正已自動儲存在此瀏覽器/);
  assert.match(pilotSource, /fetch\(`\$\{statusUrl\}\/calibrations`,\{method:'POST'/);
  assert.match(pilotSource, /校正 JSON 已交付本機 Observer/);
  assert.match(pilotSource, /calibrationImage'\)\.addEventListener\('load',renderCalibration\)/);
  assert.match(pilotSource, /points\.length >= 4/);
  assert.match(pilotSource, /id="saveCalibration"/);
  assert.match(pilotSource, /id="exportCalibrations"/);
  assert.match(pilotSource, /id="liveStreamImage"/);
  assert.match(pilotSource, /function renderLiveStream\(\)/);
  assert.match(pilotSource, /\/mjpeg\//);
  assert.match(pilotSource, /下方校正區刻意使用固定快照/);
  assert.match(pilotSource, /new URLSearchParams\(window\.location\.search\)\.get\('camera'\)/);
  assert.match(pilotSource, /url\.searchParams\.set\('camera',cameraId\)/);
  assert.match(pilotSource, /依畫面左至右暫定填入/);
  assert.match(pilotSource, /確認此鏡頭對位並交付速度/);
  assert.match(pilotSource, /不納入主線（路肩／匝道／輔助車道）/);
  assert.match(pilotSource, /畫面最左車道/);
});
