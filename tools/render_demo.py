#!/usr/bin/env python3
"""
render_demo.py — procedurally renders the demo footage (a camera flying through
a glowing tunnel) with numpy and pipes it to ffmpeg. No assets, no network.

This stands in for the AI-generated video in the full pipeline: any .mp4 you
make elsewhere goes through tools/build.py exactly the same way.

  python3 tools/render_demo.py assets/demo.mp4 --seconds 8 --fps 24
"""
import argparse, subprocess, sys
import numpy as np


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def palette(t, phase):
    # cosine palette (Inigo Quilez style), phase shifts hue over the journey
    a = np.array([0.50, 0.50, 0.50])
    b = np.array([0.50, 0.50, 0.50])
    c = np.array([1.00, 1.00, 1.00])
    d = np.array([0.00, 0.33, 0.67]) + phase
    return a + b * np.cos(2 * np.pi * (c * t[..., None] + d))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--w", type=int, default=1280)
    ap.add_argument("--h", type=int, default=720)
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--seconds", type=float, default=8)
    a = ap.parse_args()

    W, H, N = a.w, a.h, int(a.fps * a.seconds)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    aspect = W / H
    X = (xs / W * 2 - 1) * aspect
    Y = (ys / H * 2 - 1)

    ff = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(a.fps), "-i", "-",
         "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", a.out],
        stdin=subprocess.PIPE)

    for i in range(N):
        p = i / (N - 1)                       # journey progress 0..1
        t = p * 9.0                           # travel distance
        # camera drifts on a gentle curve so the tunnel bends
        cx = 0.35 * np.sin(p * 2 * np.pi * 1.0)
        cy = 0.18 * np.sin(p * 2 * np.pi * 1.7 + 1.0)
        u, v = X - cx * (1 - 0.0), Y - cy
        r = np.sqrt(u * u + v * v) + 1e-4
        ang = np.arctan2(v, u) + p * 2.2      # slow roll

        depth = 0.55 / r + t                  # perspective: far = small r
        rings = 0.5 + 0.5 * np.cos(depth * 2 * np.pi * 0.9)
        spokes = 0.5 + 0.5 * np.cos(ang * 7 + depth * 0.9)
        edge = rings ** 10                    # thin bright ring edges
        panel = (rings * 0.35 + spokes * 0.25)

        # cos/sin of the angle (not the raw angle) keeps the colour continuous
        # across the atan2 branch cut at ±pi — no seam.
        col = palette(depth * 0.06 + 0.12 * np.cos(ang) + 0.08 * np.sin(ang * 2), phase=p * 0.9)
        light = edge * 1.5 + panel * 0.55
        fog = smoothstep(0.02, 0.55, r) * (1 - 0.55 * smoothstep(0.9, 2.2, r))
        glow = np.exp(-r * 3.2) * (0.55 + 0.45 * np.sin(p * 6))   # light at tunnel end
        img = col * light[..., None] * fog[..., None] + glow[..., None] * palette(
            np.full_like(r, 0.15 + p * 0.6), phase=p * 0.9 + 0.2)

        img = 1 - np.exp(-img * 1.6)          # filmic tone map
        img = img ** (1 / 1.15)
        ff.stdin.write((np.clip(img, 0, 1) * 255).astype(np.uint8).tobytes())
        if i % 24 == 0:
            print(f"  frame {i}/{N}", file=sys.stderr)

    ff.stdin.close()
    ff.wait()
    print("wrote", a.out)


if __name__ == "__main__":
    main()
