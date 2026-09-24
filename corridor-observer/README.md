# Corridor Observer: N3 Southbound Pilot

This is an isolated test service for the National 3 southbound corridor from Xindian to Yangmei. It is not part of the public driving app until the acceptance checks below are passed.

## What it does

- Keeps one shared MJPEG subscription per fixed, mainline-only camera and retains the latest valid frame in service memory.
- Returns the last successful image while the next collection attempt is retried.
- Collects official VD lane observations independently of the image cache.
- Sends the latest retained frame to a local OpenCV worker and returns only calibrated lane vehicle counts. It does not publish CCTV-derived speed.
- Provides a test dashboard with time simulation and a deliberate camera-failure scenario.

The service never presents an uncalibrated camera or an adjacent VD as a driver instruction. A VD observation is shown only as a data-match candidate until the camera's mainline centreline and lane mapping are manually verified.

## Local QA

```powershell
Set-Location E:\chihwei.kuo\Desktop\CLO\通勤路線紀錄\github-commute-memory-app\corridor-observer
npm run check
npm start
```

Open `http://127.0.0.1:10000/pilot` and validate the following while parked:

1. `/health` reports all ten cameras as ready after the initial collection cycle.
2. Every snapshot endpoint returns `image/jpeg`.
3. In time simulation, the next camera is already ready before the active camera changes.
4. With `模擬第 4 支失敗` enabled, the event text reports that the next camera took over; no blank image is treated as a success.
5. In `人工車道校正`, choose the mainline lane count and mark four points along the centreline of each driveable lane, from near field toward the vanishing point. Save only when every lane is complete.
6. Export the JSON calibration file after each completed camera group; the Observer validates all ten before it accepts the upload.
7. Start `python analysis-worker.py --port 10001`, then confirm each `/analysis/{cameraId}` result reports `status: ready` and its boxes match the image.
8. Run the collector for at least 30 minutes before staging it for the driving app.

## API

- `GET /health`
- `GET /v1/corridors/n3-south-xindian-yangmei`
- `GET /v1/corridors/n3-south-xindian-yangmei/snapshots/{cameraId}`
- `GET /v1/corridors/n3-south-xindian-yangmei/analysis/{cameraId}`
- `GET /pilot`

## Manual lane calibration

The test dashboard stores draft markers in the local browser until `儲存本鏡頭校正` is pressed. This allows each camera's perspective to be calibrated independently. A completed lane is a four-point centreline, not a lane count guessed from the image. Use the export button to produce the JSON artefact for review before it is loaded into the hosted database.

## Hosted-pilot requirements

Use a separate always-on service from the existing media relay. The service needs a health check at `/health`, a fixed monthly cost limit, log retention, and persistent storage before it can become an app dependency.

The supplied `Dockerfile` starts both `analysis-worker.py` and `server.mjs`. For a hosted pilot, set `CALIBRATION_FILE` to a persistent disk path such as `/var/data/n3-south-xindian-yangmei-lane-calibration.json`. The image seeds only the reviewed ten-camera calibration JSON when that path is empty; it never overwrites a later reviewed calibration on the persistent volume. Runtime observations and trip records remain outside the image.

The next data layer is PostgreSQL plus object storage:

- `camera_config`: manually verified mainline centreline, direction, lane count, and VD mapping.
- `snapshot_health`: capture timestamp, source latency, retry count, and failure reason.
- `lane_observation`: raw official VD values and matching confidence.
- Object storage: only short-lived test snapshots needed for diagnostics, with a defined retention policy.

Do not retain identifiable vehicle imagery or claim per-vehicle speed from these CCTV feeds without legal review, fixed-camera calibration, and a validation dataset.
