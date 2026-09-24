import assert from "node:assert/strict";
import test from "node:test";
import { splitMjpegFrames } from "../mjpeg-parser.mjs";

test("extracts complete JPEGs and retains an incomplete trailing frame", () => {
  const first = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  const partial = Buffer.from([0xff, 0xd8, 3]);
  const result = splitMjpegFrames(Buffer.concat([Buffer.from("headers"), first, partial]), 1024);
  assert.deepEqual(result.frames, [first]);
  assert.deepEqual(result.remainder, partial);
});

test("preserves a JPEG start marker split across chunks", () => {
  const first = splitMjpegFrames(Buffer.from([1, 0xff]), 1024);
  const second = splitMjpegFrames(Buffer.concat([first.remainder, Buffer.from([0xd8, 9, 0xff, 0xd9])]), 1024);
  assert.equal(second.frames.length, 1);
  assert.deepEqual(second.frames[0], Buffer.from([0xff, 0xd8, 9, 0xff, 0xd9]));
});
