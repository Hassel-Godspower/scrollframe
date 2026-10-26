#!/usr/bin/env python3
"""
build_frames.py — turn any video into a Scrollframe frame sequence.

  python3 tools/build_frames.py assets/demo.mp4 --out public/frames

Writes:
  <out>/d/frame_00001.webp ...   desktop set
  <out>/m/frame_00001.webp ...   mobile set (smaller)
  <out>/manifest.json

Requires ffmpeg (with libwebp) on PATH. Standard library only.
"""
import argparse, json, shutil, subprocess, sys
from pathlib import Path


def extract(video, dest, fps, width, quality, ext):
    dest.mkdir(parents=True, exist_ok=True)
    vf = f"fps={fps},scale={width}:-2:flags=lanczos"
    if ext == "webp":
        codec = ["-c:v", "libwebp", "-quality", str(quality), "-compression_level", "6"]
    else:
        codec = ["-q:v", str(max(2, round((100 - quality) / 5)))]
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(video), "-vf", vf, *codec,
         str(dest / f"frame_%05d.{ext}")],
        check=True)
    return sorted(dest.glob(f"frame_*.{ext}"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--out", default="public/frames")
    ap.add_argument("--fps", type=int, default=24, help="frames/sec to extract (10-40; 24 is a good default)")
    ap.add_argument("--width", type=int, default=1280, help="desktop frame width")
    ap.add_argument("--mobile-width", type=int, default=640, help="mobile frame width")
    ap.add_argument("--quality", type=int, default=72, help="1-100 (webp quality / jpg equivalent)")
    ap.add_argument("--format", choices=["webp", "jpg"], default="webp")
    ap.add_argument("--no-mobile", action="store_true")
    a = ap.parse_args()

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH (install: https://ffmpeg.org/download.html)")
    if not Path(a.video).exists():
        sys.exit(f"video not found: {a.video}")

    out = Path(a.out)
    if out.exists():
        shutil.rmtree(out)

    d = extract(a.video, out / "d", a.fps, a.width, a.quality, a.format)
    sets = {"desktop": {"dir": "d", "width": a.width}}
    msg = [f"desktop: {len(d)} frames, {sum(f.stat().st_size for f in d)/1e6:.1f} MB"]

    if not a.no_mobile:
        m = extract(a.video, out / "m", a.fps, a.mobile_width, a.quality, a.format)
        if len(m) != len(d):
            sys.exit("frame count mismatch between sets")
        sets["mobile"] = {"dir": "m", "width": a.mobile_width}
        msg.append(f"mobile:  {len(m)} frames, {sum(f.stat().st_size for f in m)/1e6:.1f} MB")

    (out / "manifest.json").write_text(json.dumps({
        "version": 2,
        "count": len(d),
        "fps": a.fps,
        "format": a.format,
        "pattern": f"frame_%05d.{a.format}",
        "mobileMaxWidth": 768,
        "sets": sets,
    }, indent=2) + "\n")

    print("\n".join(msg))
    print(f"manifest -> {out/'manifest.json'}")


if __name__ == "__main__":
    main()
