#!/usr/bin/env python3
"""Small local HTTP worker for vehicle-only CCTV inference.

The Observer owns lane polygons and traffic-policy decisions. This worker only
turns one JPEG into bounded, normalised vehicle detections.
"""

import argparse
import json
import shutil
import tempfile
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import cv2
import numpy as np


MODEL_SIZE = 640
# The relay source is currently 352x240. A higher 0.35 threshold misses most
# distant cars, so this pilot starts at 0.20 and is gated by visual QA.
CONFIDENCE_THRESHOLD = 0.20
NMS_THRESHOLD = 0.45
COCO_CLASSES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
    "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
    "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
    "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
    "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
    "hair drier", "toothbrush",
]
VEHICLE_CLASS_IDS = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}


class VehicleDetector:
    def __init__(self, model_path: Path):
        self.model_path = model_path
        # OpenCV on Windows can fail to open ONNX paths that contain CJK characters.
        # Its byte-buffer loader is unstable in the installed runtime, so stage the
        # verified model under the user's ASCII-only temp directory instead.
        runtime_path = Path(tempfile.gettempdir()) / "corridor-observer-yolov8n.onnx"
        if not runtime_path.exists() or runtime_path.stat().st_size != model_path.stat().st_size:
            shutil.copyfile(model_path, runtime_path)
        self.runtime_model_path = runtime_path
        self.net = cv2.dnn.readNetFromONNX(str(runtime_path))
        self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)

    @staticmethod
    def _letterbox(image):
        height, width = image.shape[:2]
        scale = min(MODEL_SIZE / width, MODEL_SIZE / height)
        resized_width = round(width * scale)
        resized_height = round(height * scale)
        resized = cv2.resize(image, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)
        canvas = np.full((MODEL_SIZE, MODEL_SIZE, 3), 114, dtype=np.uint8)
        pad_x = (MODEL_SIZE - resized_width) // 2
        pad_y = (MODEL_SIZE - resized_height) // 2
        canvas[pad_y:pad_y + resized_height, pad_x:pad_x + resized_width] = resized
        return canvas, scale, pad_x, pad_y

    @staticmethod
    def _normalise_output(output):
        values = np.squeeze(output)
        if values.ndim != 2:
            raise ValueError(f"unexpected_output_shape:{list(output.shape)}")
        if values.shape[0] in (84, 85) and values.shape[1] > values.shape[0]:
            values = values.T
        if values.shape[1] < 84:
            raise ValueError(f"unexpected_prediction_shape:{list(values.shape)}")
        return values

    def detect(self, jpeg: bytes):
        source = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
        if source is None:
            raise ValueError("invalid_jpeg")
        source_height, source_width = source.shape[:2]
        image, scale, pad_x, pad_y = self._letterbox(source)
        blob = cv2.dnn.blobFromImage(image, scalefactor=1 / 255.0, size=(MODEL_SIZE, MODEL_SIZE), swapRB=True, crop=False)
        started = time.perf_counter()
        self.net.setInput(blob)
        predictions = self._normalise_output(self.net.forward())
        inference_ms = round((time.perf_counter() - started) * 1000, 1)

        boxes, scores, class_ids = [], [], []
        for row in predictions:
            class_id = int(np.argmax(row[4:]))
            confidence = float(row[4 + class_id])
            if class_id not in VEHICLE_CLASS_IDS or confidence < CONFIDENCE_THRESHOLD:
                continue
            center_x, center_y, box_width, box_height = map(float, row[:4])
            left = (center_x - box_width / 2 - pad_x) / scale
            top = (center_y - box_height / 2 - pad_y) / scale
            width = box_width / scale
            height = box_height / scale
            left = max(0.0, min(left, source_width - 1.0))
            top = max(0.0, min(top, source_height - 1.0))
            width = max(1.0, min(width, source_width - left))
            height = max(1.0, min(height, source_height - top))
            boxes.append([round(left), round(top), round(width), round(height)])
            scores.append(confidence)
            class_ids.append(class_id)

        indices = cv2.dnn.NMSBoxes(boxes, scores, CONFIDENCE_THRESHOLD, NMS_THRESHOLD)
        detections = []
        for index in np.array(indices).reshape(-1).tolist() if len(indices) else []:
            left, top, width, height = boxes[index]
            detections.append({
                "className": VEHICLE_CLASS_IDS[class_ids[index]],
                "confidence": round(scores[index], 3),
                "bbox": {
                    "x": round(left / source_width, 6),
                    "y": round(top / source_height, 6),
                    "width": round(width / source_width, 6),
                    "height": round(height / source_height, 6),
                },
            })
        return {
            "ok": True,
            "modelId": "opencv-yolov8n-coco",
            "inferenceMs": inference_ms,
            "frame": {"width": source_width, "height": source_height},
            "detections": detections,
        }


def send_json(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def handler_factory(detector):
    class AnalysisHandler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            return

        def do_OPTIONS(self):
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Source-Captured-At")
            self.end_headers()

        def do_GET(self):
            if urlparse(self.path).path != "/health":
                return send_json(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
            return send_json(self, HTTPStatus.OK, {"ok": True, "modelId": "opencv-yolov8n-coco", "modelPath": detector.model_path.name})

        def do_POST(self):
            query = urlparse(self.path)
            if query.path != "/analyze":
                return send_json(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
            camera_id = parse_qs(query.query).get("cameraId", [""])[0]
            if not camera_id:
                return send_json(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "camera_id_required"})
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                if content_length < 500 or content_length > 5 * 1024 * 1024:
                    raise ValueError("invalid_image_length")
                response = detector.detect(self.rfile.read(content_length))
                response["cameraId"] = camera_id
                response["analysedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                response["sourceCapturedAt"] = self.headers.get("X-Source-Captured-At")
                return send_json(self, HTTPStatus.OK, response)
            except Exception as error:
                return send_json(self, HTTPStatus.UNPROCESSABLE_ENTITY, {"ok": False, "error": str(error)[:180]})

    return AnalysisHandler


def main():
    parser = argparse.ArgumentParser(description="Local OpenCV vehicle detector for Corridor Observer")
    parser.add_argument("--port", type=int, default=10001)
    parser.add_argument("--model", type=Path, default=Path(__file__).with_name("models") / "yolov8n.onnx")
    parser.add_argument("--image", type=Path, help="Run one image through the detector and print JSON")
    args = parser.parse_args()
    detector = VehicleDetector(args.model)
    if args.image:
        print(json.dumps(detector.detect(args.image.read_bytes()), ensure_ascii=False))
        return
    print(f"Analysis worker listening on :{args.port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), handler_factory(detector)).serve_forever()


if __name__ == "__main__":
    main()
