#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEO_DIR="${VIDEO_DIR:-"$SCRIPT_DIR/video"}"
AUDIO_DIR="${AUDIO_DIR:-"$SCRIPT_DIR/audio"}"
VIDEO_CHUNK_SECONDS="${VIDEO_CHUNK_SECONDS:-60}"
VIDEO_PROBE_DURATIONS="${VIDEO_PROBE_DURATIONS:-0}"
LOOKBACK_SECONDS="${LOOKBACK_SECONDS:-3600}"
VIDEO_ENCODER="${VIDEO_ENCODER:-libx264}"
VIDEO_PRESET="${VIDEO_PRESET:-ultrafast}"
VIDEO_CRF="${VIDEO_CRF:-23}"
AUDIO_ENCODER="${AUDIO_ENCODER:-aac}"
AUDIO_BITRATE="${AUDIO_BITRATE:-128k}"
OUTPUT_TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTPUT_PATH="${OUTPUT_PATH:-"$SCRIPT_DIR/output_${OUTPUT_TIMESTAMP}.mp4"}"
WORK_DIR="$(mktemp -d)"
PLAN_PATH="$WORK_DIR/segments.tsv"
CONCAT_PATH="$WORK_DIR/concat.txt"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

escape_concat_path() {
  printf "%s" "$1" | sed "s/'/'\\\\''/g"
}

require_command ffmpeg
require_command ffprobe
require_command python3

python3 - \
  "$VIDEO_DIR" \
  "$AUDIO_DIR" \
  "$VIDEO_CHUNK_SECONDS" \
  "$VIDEO_PROBE_DURATIONS" \
  "$LOOKBACK_SECONDS" \
  "$WORK_DIR" \
  "$PLAN_PATH" <<'PY'
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

video_dir = Path(sys.argv[1])
audio_dir = Path(sys.argv[2])
video_chunk_ms = round(float(sys.argv[3]) * 1000)
probe_video_durations = sys.argv[4] == "1"
lookback_seconds = float(sys.argv[5])
work_dir = Path(sys.argv[6])
plan_path = Path(sys.argv[7])

VIDEO_PATTERN = re.compile(r"^camera-(\d+)\.mjpg$")
AUDIO_PATTERN = re.compile(r"^audio-(\d+)\.wav$")
TIMESTAMP_MS_THRESHOLD = 1_000_000_000_000

now_ms = int(time.time() * 1000)
window_start_ms = max(0, now_ms - round(lookback_seconds * 1000)) if lookback_seconds > 0 else None
window_end_ms = now_ms if lookback_seconds > 0 else None


def normalize_timestamp_ms(value: int) -> int:
    return value if value >= TIMESTAMP_MS_THRESHOLD else value * 1000


def timestamp_ms(path: Path, pattern: re.Pattern[str]) -> int | None:
    match = pattern.match(path.name)
    return normalize_timestamp_ms(int(match.group(1))) if match else None


def run_ffprobe(args: list[str]) -> str:
    return subprocess.check_output(
        ["ffprobe", "-v", "error", *args],
        text=True,
        stderr=subprocess.DEVNULL,
    ).strip()


def audio_duration_ms(path: Path) -> int:
    output = run_ffprobe([
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ])
    return max(0, round(float(output) * 1000))


def video_duration_ms(path: Path) -> int:
    if not probe_video_durations:
        return video_chunk_ms

    output = run_ffprobe([
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ])
    return max(0, round(float(output) * 1000))


def in_window(start_ms: int, end_ms: int) -> bool:
    if window_start_ms is not None and end_ms <= window_start_ms:
        return False

    if window_end_ms is not None and start_ms >= window_end_ms:
        return False

    return True


def video_start_time(path: Path) -> int | None:
    return timestamp_ms(path, VIDEO_PATTERN)


def collect_audio_chunks(directory: Path):
    chunks: list[tuple[int, int, Path]] = []

    if not directory.exists():
        return chunks

    for path in sorted(directory.iterdir()):
        start_ms = timestamp_ms(path, AUDIO_PATTERN)
        if start_ms is None:
            continue

        try:
            duration_ms = audio_duration_ms(path)
        except Exception as exc:
            print(f"skipping unreadable chunk: {path} ({exc})", file=sys.stderr)
            continue

        if duration_ms <= 0:
            continue

        end_ms = start_ms + duration_ms
        if in_window(start_ms, end_ms):
            chunks.append((start_ms, end_ms, path))

    return chunks


def collect_video_chunks(directory: Path):
    chunks: list[tuple[int, int, Path]] = []

    if not directory.exists():
        return chunks

    for path in sorted(directory.iterdir()):
        start_ms = video_start_time(path)
        if start_ms is None:
            continue

        try:
            duration_ms = video_duration_ms(path)
        except Exception as exc:
            print(f"skipping unreadable chunk: {path} ({exc})", file=sys.stderr)
            continue

        if duration_ms <= 0:
            continue

        end_ms = start_ms + duration_ms
        if in_window(start_ms, end_ms):
            chunks.append((start_ms, end_ms, path))

    return chunks


videos = collect_video_chunks(video_dir)
audios = collect_audio_chunks(audio_dir)

segments: list[tuple[int, Path, Path, float, float, float, Path]] = []
video_index = 0
audio_index = 0

while video_index < len(videos) and audio_index < len(audios):
    video_start, video_end, video_path = videos[video_index]
    audio_start, audio_end, audio_path = audios[audio_index]

    overlap_start = max(
        video_start,
        audio_start,
        window_start_ms if window_start_ms is not None else 0,
    )
    overlap_end = min(
        video_end,
        audio_end,
        window_end_ms if window_end_ms is not None else max(video_end, audio_end),
    )

    if overlap_end > overlap_start:
        segment_index = len(segments)
        segment_path = work_dir / f"segment-{segment_index:05d}.mp4"
        segments.append((
            segment_index,
            video_path,
            audio_path,
            (overlap_start - video_start) / 1000,
            (overlap_start - audio_start) / 1000,
            (overlap_end - overlap_start) / 1000,
            segment_path,
        ))

    if video_end <= audio_end:
        video_index += 1
    else:
        audio_index += 1

with plan_path.open("w", encoding="utf-8") as handle:
    for segment in segments:
        handle.write("\t".join(str(value) for value in segment))
        handle.write("\n")

print(f"video chunks: {len(videos)}")
print(f"audio chunks: {len(audios)}")
print(f"overlap segments: {len(segments)}")
if window_start_ms is not None and window_end_ms is not None:
    print(f"window: previous {lookback_seconds:g}s ({window_start_ms}..{window_end_ms})")
PY

if [[ ! -s "$PLAN_PATH" ]]; then
  echo "no overlapping audio/video ranges found" >&2
  exit 1
fi

while IFS=$'\t' read -r index video_path audio_path video_offset audio_offset duration segment_path; do
  echo "building segment $index: ${duration}s"

  ffmpeg \
    -hide_banner \
    -loglevel error \
    -y \
    -i "$video_path" \
    -i "$audio_path" \
    -filter_complex "[0:v]setpts=PTS-STARTPTS,trim=start=${video_offset}:duration=${duration},setpts=PTS-STARTPTS[v];[1:a]asetpts=PTS-STARTPTS,atrim=start=${audio_offset}:duration=${duration},asetpts=PTS-STARTPTS[a]" \
    -map "[v]" \
    -map "[a]" \
    -c:v "$VIDEO_ENCODER" \
    -preset "$VIDEO_PRESET" \
    -crf "$VIDEO_CRF" \
    -pix_fmt yuv420p \
    -c:a "$AUDIO_ENCODER" \
    -b:a "$AUDIO_BITRATE" \
    -movflags +faststart \
    "$segment_path"

  printf "file '%s'\n" "$(escape_concat_path "$segment_path")" >>"$CONCAT_PATH"
done <"$PLAN_PATH"

ffmpeg \
  -hide_banner \
  -loglevel error \
  -y \
  -f concat \
  -safe 0 \
  -i "$CONCAT_PATH" \
  -c copy \
  "$OUTPUT_PATH"

echo "wrote $OUTPUT_PATH"
