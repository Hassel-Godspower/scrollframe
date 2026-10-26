# Scrollframe

A tiny, dependency-free engine that turns a **video into a scroll-scrubbed, cinematic web experience**.
A sticky canvas stays pinned while a tall track scrolls; scroll progress picks the frame to paint.
No WebGL, no framework, no build step. Engine is ~3 KB gzipped.

The included homepage is a live demo: a camera flies through a glowing tunnel as you scroll,
with a HUD showing the current frame.

## Deploy to Vercel (2 minutes)

1. Create a new GitHub repo and push this folder (commands below).
2. Go to <https://vercel.com/new>, import the repo.
3. Leave **Framework Preset = Other**, no build command. `vercel.json` already sets the output directory to `public/`.
4. Click **Deploy**.

```bash
git init
git add .
git commit -m "Initial commit: Scrollframe"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Total repo size is about 6 MB (3 MB of frames + the 2.6 MB source clip), well within GitHub and Vercel limits.

## Run locally

```bash
python3 -m http.server 3000 --directory public
# open http://localhost:3000
```

(Any static server works. Opening `index.html` directly via `file://` won't work because the engine `fetch`es the manifest.)

## Use your own video

Requires Python 3 and [ffmpeg](https://ffmpeg.org/download.html) with WebP support.

```bash
python3 tools/build_frames.py path/to/your.mp4 --out public/frames
```

This writes `public/frames/d/` (desktop, 1280 px wide), `public/frames/m/` (mobile, 640 px) and `manifest.json`.
Useful flags:

| Flag | Default | Meaning |
|---|---|---|
| `--fps` | 24 | Frames per second to extract. 10–40. Fewer = lighter but choppier. |
| `--width` | 1280 | Desktop frame width |
| `--mobile-width` | 640 | Mobile frame width |
| `--quality` | 72 | WebP quality (1–100) |
| `--format` | webp | `webp` or `jpg` |
| `--no-mobile` | off | Skip the mobile set |

Then edit `public/index.html`: change the headlines, the overlay `from`/`to` ranges (0–1 scroll progress),
and `#track { height: 800vh }` (taller = slower film).

**Budget tip:** total weight ≈ frames × frame size. Keep desktop under ~15 MB and mobile under ~6 MB.
Lower `--fps` or `--quality` if you exceed that. Noisy footage (film grain, foliage) compresses poorly.

## Engine API

```html
<script src="scrollframe.js"></script>
<script>
  const sf = new Scrollframe({
    track: '#track',            // tall element that provides scroll length
    canvas: '#stage',           // <canvas> inside a position:sticky pin
    manifest: 'frames/manifest.json',
    smoothing: 0.14,            // 0 frozen … 1 instant
    fit: 'cover',               // or 'contain'
    maxDpr: 2,
    concurrency: 6,
    overlays: [{ el: '#title', from: 0.1, to: 0.4, fade: 0.04 }],
    onProgress: p => {},        // 0..1
    onLoad:     f => {},        // fraction of frames loaded
    onReady:    sf => {},       // enough frames loaded to start
    onError:    err => {}
  });

  sf.scrollToProgress(0.5);     // smooth-scroll to the middle
  sf.destroy();                 // remove listeners
</script>
```

Manifest format (`frames/manifest.json`):

```json
{ "version": 2, "count": 192, "fps": 24, "format": "webp", "pattern": "frame_%05d.webp",
  "mobileMaxWidth": 768,
  "sets": { "desktop": { "dir": "d", "width": 1280 }, "mobile": { "dir": "m", "width": 640 } } }
```

## How it works

- **Layout:** `#track` (e.g. `800vh`) contains a `position: sticky; height: 100svh` pin holding the canvas.
- **Mapping:** `progress = clamp(-track.top / (track.height − innerHeight), 0, 1)`; `frame = progress × (count − 1)`.
- **Smoothing:** the playhead eases toward the target each animation frame, hiding wheel stepping.
- **Loading:** first frame → every 16th → every 4th → the rest. The page starts after ~7% of frames; if you scroll to a frame that hasn't arrived, the nearest loaded one is shown.
- **Efficiency:** repaints only when the frame index changes; the loop sleeps when the track is off-screen; canvas DPR is capped at 2.
- **Accessibility:** text is real DOM; `prefers-reduced-motion` disables easing.

## Repo layout

```
public/            deployed site (Vercel output directory)
  index.html       homepage + demo
  scrollframe.js   the engine
  frames/          d/ (desktop), m/ (mobile), manifest.json
tools/
  render_demo.py   renders the demo footage (numpy + ffmpeg)
  build_frames.py  video → frame sets + manifest (ffmpeg)
  smoke_test.py    optional headless-browser test (Playwright)
assets/demo.mp4    source clip for the demo
vercel.json        output dir + cache headers
```

## Test

```bash
pip install playwright && playwright install chromium
python3 tools/smoke_test.py
```

Checks on desktop and mobile viewports: no JS errors, five scroll positions paint five different frames, and the right frame set is downloaded.

## Caching note

`vercel.json` caches frames for 1 day (with stale-while-revalidate); the manifest is always revalidated. If you swap in a new video, returning visitors may see old frames for up to a day. Lower `max-age` for `/frames/(.*)` in `vercel.json` while you are iterating.

## License

MIT. See `LICENSE`.
