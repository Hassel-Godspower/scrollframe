/*!
 * Scrollframe v1.1.0 — scroll-scrubbed frame-sequence engine
 * MIT License. Zero dependencies. ~3 KB gzipped.
 *
 * A tall "track" element scrolls past while a sticky <canvas> stays pinned.
 * Scroll progress (0..1) over the track maps to a frame index; that frame is
 * painted to the canvas. A lerp-smoothed playhead removes scroll-wheel jitter.
 *
 *   const sf = new Scrollframe({
 *     track:    '#track',                 // tall scroll container
 *     canvas:   '#stage',                 // canvas inside a sticky pin
 *     manifest: 'frames/manifest.json',
 *     overlays: [{ el: '#s1', from: 0, to: 0.2 }],
 *     onProgress: (p) => {},
 *     onLoad:     (fraction) => {},       // 0..1 of frames loaded
 *     onReady:    (sf) => {},             // first usable paint is possible
 *     onError:    (err) => {}
 *   });
 *
 * Methods: sf.destroy(), sf.scrollToProgress(p, smooth=true)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Scrollframe = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var $ = function (x) { return typeof x === 'string' ? document.querySelector(x) : x; };
  var noop = function () {};

  function Scrollframe(opts) {
    if (!(this instanceof Scrollframe)) return new Scrollframe(opts);

    this.track = $(opts.track);
    this.canvas = $(opts.canvas);
    if (!this.track || !this.canvas) throw new Error('Scrollframe: track/canvas not found');
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    this.manifestUrl = opts.manifest;
    this.smoothing = opts.smoothing == null ? 0.14 : opts.smoothing; // 0 frozen … 1 instant
    this.fit = opts.fit || 'cover';                                  // 'cover' | 'contain'
    this.maxDpr = opts.maxDpr || 2;
    this.concurrency = opts.concurrency || 6;
    this.overlays = (opts.overlays || []).map(function (o) {
      return { el: $(o.el), from: o.from, to: o.to, fade: o.fade == null ? 0.04 : o.fade };
    }).filter(function (o) { return o.el; });

    this.onProgress = opts.onProgress || noop;
    this.onLoad = opts.onLoad || noop;
    this.onReady = opts.onReady || noop;
    this.onError = opts.onError || noop;

    this.reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    this.frames = [];
    this.count = 0;
    this.progress = 0;
    this.target = 0;
    this.head = 0;
    this.lastDrawn = -1;
    this.visible = true;
    this.running = false;
    this.destroyed = false;
    this._raf = 0;
    this._resizeT = 0;

    this._onScroll = this._measure.bind(this);
    this._onResize = this._debouncedResize.bind(this);
    this._tick = this._loop.bind(this);

    this._boot();
  }

  /* ---------- boot & loading ---------- */

  Scrollframe.prototype._boot = function () {
    var self = this;
    fetch(this.manifestUrl)
      .then(function (r) {
        if (!r.ok) throw new Error('manifest HTTP ' + r.status);
        return r.json();
      })
      .then(function (m) {
        if (self.destroyed) return;
        self.manifest = m;
        self.count = m.count;
        self.base = self.manifestUrl.replace(/[^/]*$/, '') + self._pickSet(m);
        self.frames = new Array(m.count);
        for (var i = 0; i < m.count; i++) self.frames[i] = null;

        self._resize();
        window.addEventListener('scroll', self._onScroll, { passive: true });
        window.addEventListener('resize', self._onResize);
        if ('IntersectionObserver' in window) {
          self._io = new IntersectionObserver(function (e) {
            self.visible = e[0].isIntersecting;
            if (self.visible && self.running && !self._raf) self._raf = requestAnimationFrame(self._tick);
          });
          self._io.observe(self.track);
        }
        self._load();
      })
      .catch(function (err) { self.onError(err); });
  };

  // Mobile devices get the smaller frame set when the manifest provides one.
  Scrollframe.prototype._pickSet = function (m) {
    if (!m.sets) return '';
    var small = window.innerWidth <= (m.mobileMaxWidth || 768);
    var s = small && m.sets.mobile ? m.sets.mobile : (m.sets.desktop || m.sets.mobile);
    return s.dir ? s.dir.replace(/\/?$/, '/') : '';
  };

  // Load order: first -> every 16th -> every 4th -> all -> last.
  // The page goes live after the coarse pass; the rest streams in behind it.
  Scrollframe.prototype._order = function () {
    var n = this.count, seen = {}, out = [];
    function push(i) { if (i >= 0 && i < n && !seen[i]) { seen[i] = 1; out.push(i); } }
    push(0);
    [16, 4, 1].forEach(function (step) { for (var i = 0; i < n; i += step) push(i); });
    push(n - 1);
    return out;
  };

  Scrollframe.prototype._url = function (idx) {
    return this.base + this.manifest.pattern.replace('%05d', String(idx + 1).padStart(5, '0'));
  };

  Scrollframe.prototype._load = function () {
    var self = this, order = this._order(), cursor = 0, inflight = 0, done = 0, failed = 0;
    var readyAt = Math.min(this.count, Math.ceil(this.count / 16) + 1), signalled = false;

    function pump() {
      if (self.destroyed) return;
      while (inflight < self.concurrency && cursor < order.length) {
        (function (idx) {
          inflight++;
          var img = new Image();
          img.decoding = 'async';
          img.onload = function () {
            self.frames[idx] = img;
            finish();
          };
          img.onerror = function () { failed++; finish(); };
          img.src = self._url(idx);
        })(order[cursor++]);
      }
    }
    function finish() {
      inflight--; done++;
      self.onLoad(done / order.length);
      if (!signalled && done >= readyAt) {
        signalled = true;
        if (done === failed) { self.onError(new Error('no frames could be loaded')); return; }
        self._start();
      }
      pump();
    }
    pump();
  };

  Scrollframe.prototype._start = function () {
    this._measure();
    this.head = this.target;
    this.running = true;
    this.onReady(this);
    this._raf = requestAnimationFrame(this._tick);
  };

  /* ---------- geometry ---------- */

  Scrollframe.prototype._debouncedResize = function () {
    var self = this;
    clearTimeout(this._resizeT);
    this._resizeT = setTimeout(function () { self._resize(); }, 120);
  };

  Scrollframe.prototype._resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.lastDrawn = -1; // force repaint after the canvas is cleared
    this._measure();
  };

  Scrollframe.prototype._measure = function () {
    var r = this.track.getBoundingClientRect();
    var scrollable = r.height - window.innerHeight;
    var p = scrollable > 0 ? clamp(-r.top / scrollable, 0, 1) : 0;
    this.progress = p;
    this.target = p * Math.max(0, this.count - 1);
    this.onProgress(p);
    this._overlays(p);
  };

  Scrollframe.prototype._overlays = function (p) {
    for (var i = 0; i < this.overlays.length; i++) {
      var o = this.overlays[i], f = o.fade, a;
      if (p < o.from - f || p > o.to + f) a = 0;
      else if (p < o.from) a = (p - (o.from - f)) / f;
      else if (p > o.to) a = 1 - (p - o.to) / f;
      else a = 1;
      o.el.style.opacity = a.toFixed(3);
      o.el.style.transform = 'translate3d(0,' + ((1 - a) * 24).toFixed(1) + 'px,0)';
      o.el.style.pointerEvents = a > 0.5 ? 'auto' : 'none';
      o.el.setAttribute('aria-hidden', a > 0.5 ? 'false' : 'true');
    }
  };

  /* ---------- painting ---------- */

  Scrollframe.prototype._nearest = function (idx) {
    var f = this.frames;
    if (f[idx]) return idx;
    for (var d = 1; d < this.count; d++) {
      if (idx - d >= 0 && f[idx - d]) return idx - d;
      if (idx + d < this.count && f[idx + d]) return idx + d;
    }
    return -1;
  };

  Scrollframe.prototype._draw = function (idx) {
    var img = this.frames[idx];
    if (!img) return;
    var cw = this.canvas.width, ch = this.canvas.height;
    var iw = img.naturalWidth, ih = img.naturalHeight;
    var s = this.fit === 'contain' ? Math.min(cw / iw, ch / ih) : Math.max(cw / iw, ch / ih);
    var dw = iw * s, dh = ih * s;
    this.ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    this.lastDrawn = idx;
  };

  Scrollframe.prototype._loop = function () {
    this._raf = 0;
    if (!this.running || this.destroyed) return;
    var k = this.reduced ? 1 : this.smoothing;
    this.head += (this.target - this.head) * k;
    if (Math.abs(this.target - this.head) < 0.01) this.head = this.target;
    var want = this._nearest(Math.round(this.head));
    if (want !== -1 && want !== this.lastDrawn) this._draw(want);
    if (this.visible) this._raf = requestAnimationFrame(this._tick); // sleeps when off-screen
  };

  /* ---------- public ---------- */

  Scrollframe.prototype.scrollToProgress = function (p, smooth) {
    var top = this.track.getBoundingClientRect().top + window.pageYOffset;
    var scrollable = this.track.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + clamp(p, 0, 1) * scrollable, behavior: smooth === false ? 'auto' : 'smooth' });
  };

  Scrollframe.prototype.destroy = function () {
    this.destroyed = true;
    this.running = false;
    cancelAnimationFrame(this._raf);
    clearTimeout(this._resizeT);
    if (this._io) this._io.disconnect();
    window.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('resize', this._onResize);
  };

  Scrollframe.version = '1.1.0';
  return Scrollframe;
});
