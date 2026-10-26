#!/usr/bin/env python3
"""
smoke_test.py — optional end-to-end check in a real headless browser.

  pip install playwright && playwright install chromium
  python3 tools/smoke_test.py            # serves ./public and tests it

Verifies, on desktop and mobile viewports:
  * the page loads with no JS errors
  * scrolling to 5 positions paints 5 different frames
  * the mobile viewport downloads the mobile frame set (m/), desktop gets d/
"""
import functools, hashlib, http.server, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "public"
PORT = 8765


def serve():
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    h = functools.partial(Q, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def run(browser, name, vw, vh, expect_dir):
    page = browser.new_page(viewport={"width": vw, "height": vh}, device_scale_factor=1)
    errors, urls = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: urls.append(r.url))
    page.goto(f"http://127.0.0.1:{PORT}/")
    page.wait_for_function("document.getElementById('loader').classList.contains('done')", timeout=60000)
    total = page.evaluate("document.getElementById('track').offsetHeight - innerHeight")
    hashes = []
    for pct in (0, .25, .5, .75, 1):
        page.evaluate(f"window.scrollTo(0,{int(total*pct)})")
        page.wait_for_timeout(1000)
        hashes.append(hashlib.md5(page.locator('#stage').screenshot()).hexdigest())
    page.wait_for_timeout(1500)
    frame_urls = [u for u in urls if "/frames/" in u and u.endswith(".webp")]
    right = [u for u in frame_urls if f"/frames/{expect_dir}/" in u]
    ok = len(set(hashes)) == 5 and not errors and len(right) == len(frame_urls) and frame_urls
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: distinct frames={len(set(hashes))}/5, "
          f"errors={errors or 'none'}, frame requests={len(frame_urls)} (all /{expect_dir}/: {len(right)==len(frame_urls)})")
    page.close()
    return bool(ok)


def main():
    srv = serve()
    with sync_playwright() as p:
        b = p.chromium.launch()
        ok = run(b, "desktop 1280x720", 1280, 720, "d") & run(b, "mobile 390x800", 390, 800, "m")
        b.close()
    srv.shutdown()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
