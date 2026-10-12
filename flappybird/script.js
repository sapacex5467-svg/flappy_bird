(function () {
    "use strict";

    // ================= CONFIG =================
    var W = 360, H = 640;
    var GROUND_Y = 578;            // top of the ground strip in the background image
    var BIRD_W = 34, BIRD_H = 24;
    var BIRD_X = W / 8;
    var PIPE_W = 64, PIPE_H = 512;
    var GAP = H / 4;
    var PIPE_SPEED = -2;           // px per step
    var GRAVITY = 0.4;
    var JUMP = -6;
    var SPAWN_EVERY = 90;          // steps (1.5 s at 60 steps/sec)
    var STEP = 1000 / 60;          // fixed timestep => same speed on 60/90/120 Hz phones

    // ================= ASSETS =================
    var IMAGES = {
        bird:   "images/flappybird.png",
        bg:     "images/flappybirdbg.png",
        top:    "images/toppipe.png",
        bottom: "images/bottompipe.png"
    };
    var SFX_FILES = {
        wing:   "audio/sfx_wing.wav",
        point:  "audio/sfx_point.wav",
        hit:    "audio/sfx_hit.wav",
        die:    "audio/sfx_die.wav",
        swoosh: "audio/sfx_swooshing.wav"
    };
    var BGM_FILE = "audio/bgm_mario.mp3";

    var IMG = {};
    function imgOk(img) { return img && img.complete && img.naturalWidth > 0; }

    // ================= AUDIO =================
    var muted = false;
    try { muted = localStorage.getItem("flappy_muted") === "1"; } catch (e) {}

    var SFX = {};          // name -> { pool: [Audio, Audio], i: 0 }
    var bgm = null;
    var audioUnlocked = false;
    var bgmWanted = false;

    function initAudio() {
        Object.keys(SFX_FILES).forEach(function (name) {
            var pool = [];
            for (var i = 0; i < 2; i++) {
                var a = new Audio(SFX_FILES[name]);
                a.preload = "auto";
                pool.push(a);
            }
            SFX[name] = { pool: pool, i: 0 };
        });
        bgm = new Audio(BGM_FILE);
        bgm.loop = true;
        bgm.preload = "auto";
        bgm.volume = 0.35;    // (iOS ignores volume and always plays at full level)
    }

    function safePlay(a) {
        try {
            var p = a.play();
            if (p && p.catch) p.catch(function () {});
        } catch (e) {}
    }

    function playSfx(name) {
        if (muted || !SFX[name]) return;
        var s = SFX[name];
        var a = s.pool[s.i];
        s.i = (s.i + 1) % s.pool.length;
        try { a.currentTime = 0; } catch (e) {}
        safePlay(a);
    }

    // Browsers only allow sound after the first tap. Do this once, on the first tap.
    function unlockAudio() {
        if (audioUnlocked) return;
        audioUnlocked = true;
        Object.keys(SFX).forEach(function (name) {
            SFX[name].pool.forEach(function (a) {
                a.muted = true;
                var p;
                try { p = a.play(); } catch (e) {}
                if (p && p.then) {
                    p.then(function () { a.pause(); a.currentTime = 0; a.muted = false; })
                     .catch(function () { a.muted = false; });
                } else { a.muted = false; }
            });
        });
        bgmWanted = true;
        if (!muted) safePlay(bgm);
    }

    function setMuted(m) {
        muted = m;
        try { localStorage.setItem("flappy_muted", m ? "1" : "0"); } catch (e) {}
        if (!bgm) return;
        if (muted) bgm.pause();
        else if (bgmWanted) safePlay(bgm);
    }

    // pause the music when the tab / browser goes to the background
    document.addEventListener("visibilitychange", function () {
        if (!bgm) return;
        if (document.hidden) bgm.pause();
        else if (bgmWanted && !muted) safePlay(bgm);
    });

    // ================= CANVAS =================
    var canvas = document.getElementById("board");
    var ctx = canvas.getContext("2d");

    function resize() {
        var fit = Math.min(window.innerWidth / W, window.innerHeight / H);
        canvas.style.width = Math.floor(W * fit) + "px";
        canvas.style.height = Math.floor(H * fit) + "px";
        var dpr = Math.min(window.devicePixelRatio || 1, 3);
        var scale = Math.max(1, Math.round(fit * dpr));
        canvas.width = W * scale;
        canvas.height = H * scale;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.imageSmoothingEnabled = false;
    }
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", function () { setTimeout(resize, 150); });

    // ================= STATE =================
    var state = "ready";           // ready | playing | over
    var bird, pipes, score, stepCount;
    var best = 0, overAt = 0, bobT = 0;

    try { best = parseInt(localStorage.getItem("flappy_best") || "0", 10) || 0; } catch (e) {}

    function reset() {
        bird = { x: BIRD_X, y: H / 2, w: BIRD_W, h: BIRD_H, vy: 0 };
        pipes = [];
        score = 0;
        stepCount = 0;
    }
    reset();

    // ================= INPUT =================
    // Sound on/off button (top-right corner)
    var MUTE_BTN = { x: W - 50, y: 10, w: 40, h: 40 };

    function toCanvasXY(e) {
        var r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
    }

    function flap() {
        if (state === "ready") {
            state = "playing";
            bird.vy = JUMP;
            playSfx("swoosh");
            playSfx("wing");
        } else if (state === "playing") {
            bird.vy = JUMP;
            playSfx("wing");
        } else if (state === "over") {
            if (performance.now() - overAt > 600) {   // avoid accidental instant restart
                reset();
                state = "ready";
                playSfx("swoosh");
            }
        }
    }

    canvas.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        unlockAudio();
        var p = toCanvasXY(e);
        if (p.x >= MUTE_BTN.x && p.x <= MUTE_BTN.x + MUTE_BTN.w &&
            p.y >= MUTE_BTN.y && p.y <= MUTE_BTN.y + MUTE_BTN.h) {
            setMuted(!muted);
            return;
        }
        flap();
    });

    document.addEventListener("keydown", function (e) {
        if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyX") {
            e.preventDefault();
            if (e.repeat) return;
            unlockAudio();
            flap();
        } else if (e.code === "KeyM") {
            setMuted(!muted);
        }
    });

    // stop page scrolling / pinch zoom on phones
    document.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener("gesturestart", function (e) { e.preventDefault(); });

    // ================= GAME LOGIC =================
    function spawnPipes() {
        var topY = -PIPE_H / 4 - Math.random() * (PIPE_H / 2);
        pipes.push({ img: "top",    x: W, y: topY,                passed: false });
        pipes.push({ img: "bottom", x: W, y: topY + PIPE_H + GAP, passed: false });
    }

    function hit(a, b) {
        var m = 3; // small forgiveness on the bird's hitbox
        return a.x + m < b.x + PIPE_W && a.x + a.w - m > b.x &&
               a.y + m < b.y + PIPE_H && a.y + a.h - m > b.y;
    }

    function die() {
        if (state === "over") return;
        state = "over";
        overAt = performance.now();
        playSfx("hit");
        setTimeout(function () { if (state === "over") playSfx("die"); }, 300);
        if (score > best) {
            best = score;
            try { localStorage.setItem("flappy_best", String(best)); } catch (e) {}
        }
    }

    function step() {
        if (state === "ready") { bobT += 0.08; return; }
        if (state !== "playing") return;

        stepCount++;
        bird.vy += GRAVITY;
        bird.y += bird.vy;
        if (bird.y < 0) { bird.y = 0; if (bird.vy < 0) bird.vy = 0; }
        if (bird.y + bird.h >= GROUND_Y) { bird.y = GROUND_Y - bird.h; die(); return; }

        if (stepCount % SPAWN_EVERY === 1) spawnPipes();

        for (var i = 0; i < pipes.length; i++) {
            var p = pipes[i];
            p.x += PIPE_SPEED;
            if (!p.passed && bird.x > p.x + PIPE_W) {
                p.passed = true;
                if (p.img === "top") { score++; playSfx("point"); }   // count once per pair
            }
            if (hit(bird, p)) { die(); return; }
        }
        while (pipes.length && pipes[0].x < -PIPE_W) pipes.shift();
    }

    // ================= DRAWING =================
    function drawImg(name, x, y, w, h, fallback) {
        var img = IMG[name];
        if (imgOk(img)) {
            try { ctx.drawImage(img, x, y, w, h); return; } catch (e) {}
        }
        ctx.fillStyle = fallback;
        ctx.fillRect(x, y, w, h);
    }

    function text(str, x, y, size, align) {
        ctx.font = "bold " + size + "px 'Courier New', monospace";
        ctx.textAlign = align || "center";
        ctx.lineWidth = Math.max(3, size / 8);
        ctx.strokeStyle = "#1b1b1b";
        ctx.lineJoin = "round";
        ctx.strokeText(str, x, y);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(str, x, y);
    }

    function drawMuteButton() {
        var b = MUTE_BTN;
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        var cx = b.x + b.w / 2 - 4, cy = b.y + b.h / 2;
        // speaker body
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy - 4);
        ctx.lineTo(cx - 3, cy - 4);
        ctx.lineTo(cx + 3, cy - 10);
        ctx.lineTo(cx + 3, cy + 10);
        ctx.lineTo(cx - 3, cy + 4);
        ctx.lineTo(cx - 8, cy + 4);
        ctx.closePath();
        ctx.fill();
        if (muted) {
            ctx.beginPath();
            ctx.moveTo(cx + 8, cy - 5); ctx.lineTo(cx + 18, cy + 5);
            ctx.moveTo(cx + 18, cy - 5); ctx.lineTo(cx + 8, cy + 5);
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(cx + 5, cy, 6, -0.9, 0.9);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx + 5, cy, 12, -0.9, 0.9);
            ctx.stroke();
        }
        ctx.restore();
    }

    function draw() {
        // background
        ctx.fillStyle = "#70c5ce";
        ctx.fillRect(0, 0, W, H);
        if (imgOk(IMG.bg)) ctx.drawImage(IMG.bg, 0, 0, W, H);

        // pipes
        for (var i = 0; i < pipes.length; i++) {
            var p = pipes[i];
            drawImg(p.img, p.x, p.y, PIPE_W, PIPE_H, "#2ea000");
        }

        // ground strip drawn over the pipes so the pipes sit "behind" the ground
        if (imgOk(IMG.bg)) {
            ctx.drawImage(IMG.bg, 0, GROUND_Y, W, H - GROUND_Y, 0, GROUND_Y, W, H - GROUND_Y);
        }

        // bird (tilts with speed)
        var by = bird.y + (state === "ready" ? Math.sin(bobT) * 6 : 0);
        var angle = state === "ready" ? 0 : Math.max(-0.45, Math.min(1.1, bird.vy * 0.08));
        ctx.save();
        ctx.translate(bird.x + bird.w / 2, by + bird.h / 2);
        ctx.rotate(angle);
        drawImg("bird", -bird.w / 2, -bird.h / 2, bird.w, bird.h, "#ffd800");
        ctx.restore();

        // score
        if (state === "playing") text(String(score), W / 2, 80, 56);

        if (state === "ready") {
            text("FLAPPY BIRD", W / 2, 190, 36);
            text("TAP UNTUK MULAI", W / 2, 420, 22);
            if (best > 0) text("Terbaik: " + best, W / 2, 460, 18);
        }

        if (state === "over") {
            ctx.fillStyle = "rgba(0,0,0,0.45)";
            ctx.fillRect(40, 190, W - 80, 220);
            text("GAME OVER", W / 2, 245, 34);
            text("Skor: " + score, W / 2, 300, 26);
            text("Terbaik: " + best, W / 2, 338, 22);
            if (performance.now() - overAt > 600) text("TAP UNTUK ULANG", W / 2, 388, 18);
        }

        drawMuteButton();
    }

    // ================= MAIN LOOP (fixed timestep) =================
    var last = 0, acc = 0;
    function frame(t) {
        requestAnimationFrame(frame);
        if (!last) last = t;
        var dt = Math.min(t - last, 100);   // clamp after tab switches
        last = t;
        acc += dt;
        while (acc >= STEP) { step(); acc -= STEP; }
        draw();
    }

    // ================= BOOT =================
    resize();
    Object.keys(IMAGES).forEach(function (n) {
        var im = new Image();
        im.src = IMAGES[n];
        IMG[n] = im;
    });
    initAudio();
    requestAnimationFrame(frame);   // start right away; draw() has safe fallbacks
})();
