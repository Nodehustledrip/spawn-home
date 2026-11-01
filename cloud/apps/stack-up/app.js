(function () {
  "use strict";
  var cv = document.getElementById("c"), cx = cv.getContext("2d");
  var $ = function (s) { return document.querySelector(s); };
  var W, H, DPR, S; // S = pixels per world unit
  var C30 = Math.cos(Math.PI / 6), S30 = 0.5, BH = 0.22, PERFECT = 0.035;
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    cv.width = W * DPR; cv.height = H * DPR; cx.setTransform(DPR, 0, 0, DPR, 0, 0);
    S = Math.min(W * 0.34, H * 0.2, 170);
  }
  addEventListener("resize", resize); resize();

  /* ---------- state ---------- */
  var stack, cur, debris, parts, rings, score, combo, best, state = "menu", camY = 0, camT = 0, shake = 0, hue0, t0 = performance.now();
  try { best = +localStorage.getItem("stackup-best") || 0; } catch (e) { best = 0; }
  $("[data-best]").textContent = best;

  function reset() {
    hue0 = Math.random() * 360;
    stack = [{ x: 0, z: 0, w: 1, d: 1, y: 0, hue: hue0 }];
    // a few base layers so the tower has a foot
    for (var i = 1; i < 4; i++) stack.unshift({ x: 0, z: 0, w: 1, d: 1, y: -i * BH, hue: hue0 - i * 6 });
    debris = []; parts = []; rings = []; score = 0; combo = 0; camT = 0; camY = 0;
    setScore(0); spawn();
  }
  function top() { return stack[stack.length - 1]; }
  function spawn() {
    var p = top(), axis = score % 2 ? "z" : "x";
    cur = { x: p.x, z: p.z, w: p.w, d: p.d, y: p.y + BH, hue: hue0 + (score + 1) * 7, axis: axis, dir: 1, speed: Math.min(1.25 + score * 0.035, 2.8) };
    cur[axis] = p[axis] - 1.5; // enter from one side
  }

  /* ---------- sound (off by default) ---------- */
  var soundOn = false, ac = null;
  function tone(f, dur, type, vol, slide) {
    if (!soundOn) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      var o = ac.createOscillator(), g = ac.createGain(), n = ac.currentTime;
      o.type = type || "sine"; o.frequency.setValueAtTime(f, n); if (slide) o.frequency.exponentialRampToValueAtTime(slide, n + dur);
      g.gain.setValueAtTime(vol || 0.15, n); g.gain.exponentialRampToValueAtTime(0.0001, n + dur);
      o.connect(g); g.connect(ac.destination); o.start(n); o.stop(n + dur);
    } catch (e) {}
  }
  var sb = $("[data-sound]");
  sb.addEventListener("click", function (e) {
    e.stopPropagation(); soundOn = !soundOn;
    sb.setAttribute("aria-pressed", soundOn); sb.setAttribute("aria-label", soundOn ? "Sound on. Turn sound off" : "Sound off. Turn sound on");
    $("[data-snd-ic]").textContent = soundOn ? "🔊" : "🔇"; if (soundOn) tone(660, 0.12, "triangle", 0.12);
  });

  /* ---------- gameplay ---------- */
  function setScore(n) { var el = $("[data-score]"); el.textContent = n; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
  function flashCombo(txt) { var el = $("[data-combo]"); el.textContent = txt; el.classList.remove("show"); void el.offsetWidth; el.classList.add("show"); }

  function drop() {
    if (state !== "play") return;
    var p = top(), a = cur.axis, size = a === "x" ? "w" : "d", delta = cur[a] - p[a], over = p[size] - Math.abs(delta);
    if (over <= 0) { // missed entirely
      debris.push(mk(cur, 0)); return end();
    }
    if (Math.abs(delta) < PERFECT) {
      cur[a] = p[a]; combo++;
      if (combo >= 3) { var g = Math.min(cur[size] * 1.06, 1); var gx = (g - cur[size]) / 2; cur[size] = g; }
      rings.push({ b: clone(cur), t: 0 });
      burst(cur, 26, 1.2);
      tone(440 * Math.pow(2, Math.min(combo, 12) / 12), 0.22, "triangle", 0.16);
      flashCombo(combo > 1 ? "Perfect ×" + combo : "Perfect");
    } else {
      combo = 0;
      var cut = clone(cur); // the falling off-cut
      var keepC = p[a] + delta / 2, cutSize = Math.abs(delta), cutC = keepC + Math.sign(delta) * (over / 2 + cutSize / 2);
      cur[size] = over; cur[a] = keepC;
      cut[size] = cutSize; cut[a] = cutC;
      debris.push(mk(cut, Math.sign(delta)));
      burst(cur, 8, 0.6);
      tone(220 + score * 4, 0.1, "square", 0.06, 160);
      shake = reduce ? 0 : 4;
    }
    stack.push({ x: cur.x, z: cur.z, w: cur.w, d: cur.d, y: cur.y, hue: cur.hue });
    score++; setScore(score); camT = Math.max(0, score - 3) * BH;
    if (navigator.vibrate && soundOn) navigator.vibrate(combo ? 18 : 8);
    spawn();
  }
  function clone(b) { return { x: b.x, z: b.z, w: b.w, d: b.d, y: b.y, hue: b.hue }; }
  function mk(b, dir) { var o = clone(b); o.vy = 0; o.vx = dir * 0.4; o.axis = cur.axis; o.rot = 0; o.life = 1; return o; }
  function burst(b, n, power) {
    for (var i = 0; i < n; i++) {
      var ang = Math.random() * Math.PI * 2, sp = (0.4 + Math.random()) * power;
      parts.push({ x: b.x + (Math.random() - 0.5) * b.w, z: b.z + (Math.random() - 0.5) * b.d, y: b.y + BH, vx: Math.cos(ang) * sp * 0.6, vz: Math.sin(ang) * sp * 0.6, vy: 1 + Math.random() * 1.6 * power, life: 1, hue: b.hue + Math.random() * 40 - 20, r: 2 + Math.random() * 3 });
    }
  }
  function end() {
    state = "over"; shake = reduce ? 0 : 10;
    tone(300, 0.5, "sawtooth", 0.08, 70);
    var nb = score > best; if (nb) { best = score; try { localStorage.setItem("stackup-best", best); } catch (e) {} }
    $("[data-best]").textContent = best;
    setTimeout(function () {
      $("[data-final]").textContent = score;
      $("[data-final-sub]").textContent = nb && score > 0 ? "New best! 🎉" : "Best: " + best;
      $("[data-toast]").textContent = "";
      $("[data-over]").hidden = false; $("[data-again]").focus();
    }, 650);
  }
  function start() {
    $("[data-start]").hidden = true; $("[data-over]").hidden = true;
    reset(); state = "play"; tone(520, 0.12, "triangle", 0.1); cv.focus && cv.focus();
  }

  /* ---------- input ---------- */
  cv.addEventListener("pointerdown", function (e) { e.preventDefault(); drop(); });
  addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.code === "Enter" || e.code === "ArrowDown") {
      if (state === "play") { e.preventDefault(); drop(); }
      else if (e.code === "Space" && document.activeElement === document.body) { e.preventDefault(); start(); }
    }
  });
  $("[data-play]").addEventListener("click", start);
  $("[data-again]").addEventListener("click", start);
  $("[data-share]").addEventListener("click", function () {
    var text = "I stacked " + score + " block" + (score === 1 ? "" : "s") + " in Stack Up (best " + best + "). Can you beat it?", url = location.origin + location.pathname, toast = $("[data-toast]");
    if (navigator.share) navigator.share({ title: "Stack Up", text: text, url: url }).catch(function () {});
    else (navigator.clipboard ? navigator.clipboard.writeText(text + " " + url) : Promise.reject()).then(function () { toast.textContent = "Score copied — paste it anywhere."; }, function () { toast.textContent = text + " " + url; });
  });

  /* ---------- rendering ---------- */
  function P(x, y, z) { return [W / 2 + (x - z) * C30 * S, H * 0.66 + (x + z) * S30 * S - (y - camY) * S]; }
  function poly(pts, fill) { cx.beginPath(); cx.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) cx.lineTo(pts[i][0], pts[i][1]); cx.closePath(); cx.fillStyle = fill; cx.fill(); }
  function box(b, alpha) {
    var x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y0 = b.y, y1 = b.y + BH, h = b.hue;
    cx.globalAlpha = alpha == null ? 1 : alpha;
    poly([P(x0, y1, z1), P(x1, y1, z1), P(x1, y0, z1), P(x0, y0, z1)], "hsl(" + h + ",58%,50%)");
    poly([P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), P(x1, y0, z0)], "hsl(" + h + ",56%,40%)");
    poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], "hsl(" + h + ",70%,64%)");
    cx.globalAlpha = 1;
  }
  function bg(t) {
    var h = (hue0 == null ? 260 : hue0) + (stack ? stack.length * 4 : 0);
    var g = cx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "hsl(" + (h + 30) + ",45%,22%)"); g.addColorStop(1, "hsl(" + h + ",50%,10%)");
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    document.querySelector('meta[name="theme-color"]').content = "hsl(" + (h + 30) + ",45%,22%)";
    // drifting light motes
    cx.fillStyle = "rgba(255,255,255,.06)";
    for (var i = 0; i < 24; i++) { var x = (i * 97.3 + t * 0.006 * (1 + i % 3)) % (W + 40) - 20, y = (i * 61.7 + camY * S * (0.15 + (i % 4) * 0.05)) % H; cx.beginPath(); cx.arc(x, y, 1 + i % 3, 0, 7); cx.fill(); }
  }

  var last = performance.now();
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (!stack) { hue0 = 250; reset(); state = "menu"; }
    // move current block
    if (state === "play") {
      var p = top(), a = cur.axis; cur[a] += cur.dir * cur.speed * dt;
      if (cur[a] > p[a] + 1.5) { cur[a] = p[a] + 1.5; cur.dir = -1; }
      if (cur[a] < p[a] - 1.5) { cur[a] = p[a] - 1.5; cur.dir = 1; }
    } else if (state === "menu") { var q = top(); cur[cur.axis] = q[cur.axis] + Math.sin(now / 700) * 1.2; }
    camY += (camT - camY) * Math.min(1, dt * 5);
    debris.forEach(function (d) { d.vy -= 9 * dt; d.y += d.vy * dt; d[d.axis] += d.vx * dt; d.life -= dt * 0.6; });
    debris = debris.filter(function (d) { return d.life > 0; });
    parts.forEach(function (q) { q.vy -= 5 * dt; q.x += q.vx * dt; q.z += q.vz * dt; q.y += q.vy * dt; q.life -= dt * 1.4; });
    parts = parts.filter(function (q) { return q.life > 0; });
    rings.forEach(function (r) { r.t += dt * 1.8; }); rings = rings.filter(function (r) { return r.t < 1; });

    cx.save();
    if (shake > 0.1) { cx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.86; }
    bg(now);
    var vis = stack.filter(function (b) { return (b.y - camY) * S > -H * 0.6; });
    vis.forEach(function (b) { box(b); });
    debris.forEach(function (d) { box(d, Math.max(0, d.life)); });
    if (state !== "over") box(cur);
    rings.forEach(function (r) {
      var e = 1 - Math.pow(1 - r.t, 3), k = 1 + e * 0.5, b = r.b, y = b.y + BH;
      var x0 = b.x - b.w / 2 * k, x1 = b.x + b.w / 2 * k, z0 = b.z - b.d / 2 * k, z1 = b.z + b.d / 2 * k, pts = [P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)];
      cx.beginPath(); cx.moveTo(pts[0][0], pts[0][1]); pts.forEach(function (q) { cx.lineTo(q[0], q[1]); }); cx.closePath();
      cx.strokeStyle = "rgba(255,255,255," + (1 - r.t) + ")"; cx.lineWidth = 3; cx.stroke();
    });
    parts.forEach(function (q) { var s = P(q.x, q.y, q.z); cx.globalAlpha = Math.max(0, q.life); cx.fillStyle = "hsl(" + q.hue + ",85%,72%)"; cx.beginPath(); cx.arc(s[0], s[1], q.r, 0, 7); cx.fill(); });
    cx.globalAlpha = 1; cx.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__stackup = { drop: drop, start: start, state: function () { return { state: state, score: score, best: best }; } };
})();
