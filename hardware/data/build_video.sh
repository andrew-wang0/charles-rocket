#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEO_DIR="${VIDEO_DIR:-"$SCRIPT_DIR/video"}"
AUDIO_DIR="${AUDIO_DIR:-"$SCRIPT_DIR/audio"}"
VIDEO_FPS="${VIDEO_FPS:-30}"
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

python3 - "$VIDEO_DIR" "$AUDIO_DIR" "$VIDEO_FPS" "$WORK_DIR" "$PLAN_PATH" <<'PY'
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

video_dir = Path(sys.argv[1])
audio_dir = Path(sys.argv[2])
video_fps = float(sys.argv[3])
work_dir = Path(sys.argv[4])
plan_path = Path(sys.argv[5])

VIDEO_PATTERN = re.compile(r"^camera-(\d+)\.mjpg$")
AUDIO_PATTERN = re.compile(r"^audio-(\d+)\.wav$")


def timestamp_ms(path: Path, pattern: re.Pattern[str]) -> int | None:
    match = pattern.match(path.name)
    return int(match.group(1)) if match else None


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
    output = run_ffprobe([
        "-f",
        "mjpeg",
        "-framerate",
        str(video_fps),
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=nb_read_frames",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ])
    frames = int(output.splitlines()[-1])
    return max(0, round((frames / video_fps) * 1000))


def collect_chunks(directory: Path, pattern: re.Pattern[str], duration_fn):
    chunks: list[tuple[int, int, Path]] = []

    if not directory.exists():
        return chunks

    for path in sorted(directory.iterdir()):
        start_ms = timestamp_ms(path, pattern)
        if start_ms is None:
            continue

        try:
            duration_ms = duration_fn(path)
        except Exception as exc:
            print(f"skipping unreadable chunk: {path} ({exc})", file=sys.stderr)
            continue

        if duration_ms <= 0:
            continue

        chunks.append((start_ms, start_ms + duration_ms, path))

    return chunks


videos = collect_chunks(video_dir, VIDEO_PATTERN, video_duration_ms)
audios = collect_chunks(audio_dir, AUDIO_PATTERN, audio_duration_ms)

segments: list[tuple[int, Path, Path, float, float, float, Path]] = []
video_index = 0
audio_index = 0

while video_index < len(videos) and audio_index < len(audios):
    video_start, video_end, video_path = videos[video_index]
    audio_start, audio_end, audio_path = audios[audio_index]

    overlap_start = max(video_start, audio_start)
    overlap_end = min(video_end, audio_end)

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
    -framerate "$VIDEO_FPS" \
    -f mjpeg \
    -i "$video_path" \
    -i "$audio_path" \
    -filter_complex "[0:v]trim=start=${video_offset}:duration=${duration},setpts=PTS-STARTPTS[v];[1:a]atrim=start=${audio_offset}:duration=${duration},asetpts=PTS-STARTPTS[a]" \
    -map "[v]" \
    -map "[a]" \
    -c:v libx264 \
    -preset veryfast \
    -crf 20 \
    -pix_fmt yuv420p \
    -c:a aac \
    -b:a 128k \
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
