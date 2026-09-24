const JPEG_START = Buffer.from([0xff, 0xd8]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

export function splitMjpegFrames(buffer, maxBufferBytes) {
  const frames = [];
  let remaining = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  while (true) {
    const start = remaining.indexOf(JPEG_START);
    if (start < 0) {
      // Preserve an opening marker that may span two network chunks.
      remaining = remaining.length && remaining[remaining.length - 1] === 0xff ? remaining.subarray(-1) : Buffer.alloc(0);
      break;
    }
    const end = remaining.indexOf(JPEG_END, start + JPEG_START.length);
    if (end < 0) {
      remaining = remaining.subarray(start);
      break;
    }
    frames.push(remaining.subarray(start, end + JPEG_END.length));
    remaining = remaining.subarray(end + JPEG_END.length);
  }
  return {
    frames,
    remainder: remaining.length > maxBufferBytes ? remaining.subarray(-maxBufferBytes) : remaining,
  };
}
