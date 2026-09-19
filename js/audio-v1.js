// Original procedural sounds and music: no downloads or third-party audio assets.
const gameAudio = (() => {
    const storageKey = "seedHarvester.audio.v1";
    const settings = { music: 0.35, effects: 0.65, muted: false };
    try {
        const saved = JSON.parse(window.localStorage?.getItem(storageKey) || "null");
        for (const name of ["music", "effects"]) {
            if (Number.isFinite(saved?.[name])) settings[name] = Math.max(0, Math.min(1, saved[name]));
        }
        if (typeof saved?.muted === "boolean") settings.muted = saved.muted;
    } catch { /* Storage can be unavailable in private browsing. */ }

    let context, master, musicBus, effectsBus, noiseBuffer;
    let scene = "menu", hidden = document.hidden, step = 0, nextNoteAt = 0;
    let walkingDistance = 0;
    const voices = new Set();
    const lastPlayed = new Map();
    const controls = document.getElementById("soundControls");
    const home = document.getElementById("soundHome");
    const muteButton = document.getElementById("muteAudioBtn");
    const status = document.getElementById("audioStatus");
    const sliders = {
        music: document.getElementById("musicVolume"),
        effects: document.getElementById("effectsVolume")
    };

    // Frequency, pitch glide, duration, amplitude, and optional start delay.
    const sounds = {
        hover: [{ f: 680, to: 760, d: 0.035, v: 0.018 }],
        click: [{ f: 520, to: 760, d: 0.07, v: 0.07 }],
        open: [{ f: 330, d: 0.1, v: 0.08 }, { f: 495, at: 0.07, d: 0.14, v: 0.06 }],
        close: [{ f: 495, to: 280, d: 0.12, v: 0.07 }],
        start: [0, 4, 7, 12].map((n, i) => ({ f: 261.63 * 2 ** (n / 12), at: i * 0.09, d: 0.23, v: 0.065 })),
        move: [{ f: 410, to: 540, d: 0.06, v: 0.035 }],
        arrive: [{ f: 610, to: 740, d: 0.05, v: 0.025 }],
        step: [{ noise: true, cutoff: 650, d: 0.055, v: 0.055 }],
        hay: [{ noise: true, cutoff: 1700, d: 0.16, v: 0.025 }],
        collect: [{ f: 660, d: 0.12, v: 0.09 }, { f: 990, at: 0.065, d: 0.2, v: 0.07 }],
        shot: [{ f: 600, to: 135, type: "triangle", d: 0.105, v: 0.095 }, { noise: true, cutoff: 2600, d: 0.035, v: 0.025 }],
        critical: [{ f: 1100, to: 210, d: 0.14, v: 0.1 }, { f: 1650, at: 0.03, d: 0.08, v: 0.035 }],
        hit: [{ f: 150, to: 65, type: "triangle", d: 0.08, v: 0.12 }],
        kill: [{ f: 300, to: 80, d: 0.16, v: 0.09 }, { f: 880, at: 0.08, d: 0.11, v: 0.045 }],
        spawn: [{ f: 95, to: 135, type: "triangle", d: 0.24, v: 0.04 }],
        explosion: [{ noise: true, cutoff: 1000, d: 0.38, v: 0.24 }, { f: 105, to: 28, d: 0.3, v: 0.17 }],
        hurt: [{ f: 185, to: 65, type: "sawtooth", d: 0.19, v: 0.07 }, { noise: true, cutoff: 800, d: 0.13, v: 0.09 }],
        lowHealth: [{ f: 185, d: 0.12, v: 0.07 }, { f: 185, at: 0.2, d: 0.12, v: 0.07 }],
        block: [{ f: 1300, to: 650, d: 0.18, v: 0.08 }],
        purchase: [{ f: 440, d: 0.12, v: 0.08 }, { f: 554, at: 0.08, d: 0.13, v: 0.07 }, { f: 660, at: 0.16, d: 0.24, v: 0.07 }],
        unlock: [0, 4, 7, 12, 16].map((n, i) => ({ f: 329.63 * 2 ** (n / 12), at: i * 0.085, d: 0.3, v: 0.07 })),
        denied: [{ f: 165, d: 0.08, v: 0.07 }, { f: 130, at: 0.09, d: 0.1, v: 0.07 }],
        marker: [{ f: 740, to: 1100, d: 0.2, v: 0.06 }],
        teleport: [{ f: 220, to: 1800, d: 0.24, v: 0.07 }, { f: 880, at: 0.2, d: 0.25, v: 0.04 }],
        wrap: [{ noise: true, cutoff: 1800, d: 0.12, v: 0.05 }, { f: 330, to: 660, d: 0.16, v: 0.035 }],
        shield: [{ f: 220, to: 440, d: 0.4, v: 0.075 }, { f: 660, at: 0.1, d: 0.45, v: 0.035 }],
        dash: [{ noise: true, cutoff: 3200, d: 0.19, v: 0.11 }, { f: 300, to: 900, d: 0.14, v: 0.035 }],
        freeze: [{ f: 1400, to: 350, d: 0.5, v: 0.055 }, { f: 2100, at: 0.09, d: 0.4, v: 0.035 }],
        lure: [0, 7, 12, 7].map((n, i) => ({ f: 523.25 * 2 ** (n / 12), at: i * 0.12, d: 0.2, v: 0.05 })),
        expire: [{ f: 620, to: 220, d: 0.2, v: 0.04 }],
        ready: [{ f: 880, d: 0.08, v: 0.035 }, { f: 1100, at: 0.07, d: 0.15, v: 0.03 }],
        gameOver: [64, 60, 57, 52, 45].map((n, i) => ({ f: 440 * 2 ** ((n - 69) / 12), at: i * 0.2, d: 0.55, v: 0.085 }))
    };
    const cooldowns = { hover: 0.09, step: 0.19, shot: 0.045, hit: 0.055, kill: 0.07,
        explosion: 0.1, collect: 0.06, spawn: 0.6, hay: 0.3, block: 0.3, lowHealth: 3, denied: 0.22, wrap: 0.3 };

    function save() {
        try { window.localStorage?.setItem(storageKey, JSON.stringify(settings)); } catch {}
    }

    function refreshControls() {
        muteButton.textContent = settings.muted ? "Unmute" : "Mute";
        muteButton.setAttribute("aria-pressed", String(settings.muted));
        status.textContent = settings.muted || (!settings.music && !settings.effects) ? "Muted" : "On";
        for (const [name, slider] of Object.entries(sliders)) {
            const percent = Math.round(settings[name] * 100);
            slider.value = percent;
            document.getElementById(name + "VolumeValue").textContent = percent + "%";
            slider.setAttribute("aria-valuetext", percent + " percent");
        }
    }

    function gains() {
        if (!context) return;
        master.gain.setTargetAtTime(hidden || settings.muted ? 0 : 0.75, context.currentTime, 0.02);
        musicBus.gain.setTargetAtTime(settings.music * (scene === "paused" ? 0.35 : 1), context.currentTime, 0.06);
        effectsBus.gain.setTargetAtTime(settings.effects, context.currentTime, 0.02);
    }

    function stopVoices(bus) {
        if (!context) return;
        for (const voice of voices) {
            if (bus && voice.bus !== bus) continue;
            voice.gain.gain.cancelScheduledValues(context.currentTime);
            voice.gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.008);
            voice.source.stop(context.currentTime + 0.04);
        }
    }

    function tone(options, bus, when = context.currentTime) {
        if (voices.size >= 64) return;
        const start = Math.max(context.currentTime, when + (options.at || 0));
        const duration = options.d || 0.1;
        const source = options.noise ? context.createBufferSource() : context.createOscillator();
        const gain = context.createGain();
        let filter;
        if (options.noise) {
            source.buffer = noiseBuffer;
        } else {
            source.type = options.type || "sine";
            source.frequency.setValueAtTime(options.f, start);
            if (options.to) source.frequency.exponentialRampToValueAtTime(options.to, start + duration);
        }
        if (options.noise || options.cutoff) {
            filter = context.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.value = options.cutoff || 1600;
            source.connect(filter);
            filter.connect(gain);
        } else {
            source.connect(gain);
        }
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(options.v || 0.06, start + Math.min(options.attack || 0.012, duration / 4));
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        gain.connect(bus);
        const voice = { source, gain, filter, bus };
        voices.add(voice);
        source.onended = () => {
            source.disconnect();
            filter?.disconnect();
            gain.disconnect();
            voices.delete(voice);
        };
        source.start(start);
        source.stop(start + duration + 0.025);
    }

    function play(name) {
        if (!context || context.state !== "running" || hidden || settings.muted || settings.effects === 0) return;
        const recipe = sounds[name];
        if (!recipe) return;
        const now = context.currentTime;
        if (now - (lastPlayed.get(name) ?? -Infinity) < (cooldowns[name] ?? 0.04)) return;
        lastPlayed.set(name, now);
        for (const note of recipe) tone(note, effectsBus, now);
    }

    // Original 16-bar battle theme at 132 BPM: war drums, marching snares,
    // low brass, and a restless D-minor ostinato. The second half adds urgency.
    const battleRoots = [38, 38, 34, 36, 38, 34, 39, 33];
    const ostinato = [0, 12, 7, 12, 0, 12, 10, 7];
    const battleCalls = [[0, 7, 10, 7], [12, 10, 7, 0], [0, 3, 7, 10], [7, 3, 1, 0]];
    const stepSeconds = 60 / 132 / 4;
    const hz = note => 440 * 2 ** ((note - 69) / 12);

    function scheduleMusic() {
        if (!context || context.state !== "running" || hidden || settings.muted || settings.music === 0 || scene === "over") {
            nextNoteAt = 0;
            return;
        }
        // Drop missed beats after a stall instead of playing a catch-up burst.
        if (nextNoteAt < context.currentTime) nextNoteAt = context.currentTime + 0.03;
        while (nextNoteAt < context.currentTime + 0.18) {
            const beat = step % 16;
            const bar = Math.floor(step / 16);
            const root = battleRoots[bar % 8];
            const intense = bar >= 8;
            if ([0, 6, 8, 11].includes(beat)) {
                tone({ f: 155, to: 40, d: 0.28, v: 0.19 }, musicBus, nextNoteAt);
                tone({ noise: true, cutoff: 750, d: 0.065, v: 0.05 }, musicBus, nextNoteAt);
            }
            if (beat % 2 === 0) {
                tone({ f: hz(root + 12 + ostinato[beat / 2]), type: "sawtooth", cutoff: 1100,
                    d: 0.115, v: intense ? 0.052 : 0.04 }, musicBus, nextNoteAt);
                tone({ f: hz(root), type: "triangle", d: 0.15, v: 0.095 }, musicBus, nextNoteAt);
            }
            if (beat === 4 || beat === 12) {
                tone({ noise: true, cutoff: 2400, d: 0.14, v: 0.12 }, musicBus, nextNoteAt);
                tone({ f: 180, to: 95, type: "triangle", d: 0.12, v: 0.075 }, musicBus, nextNoteAt);
            }
            if (beat === 2 || beat === 10 || (bar % 4 === 3 && beat >= 13)) {
                tone({ f: beat % 2 ? 240 : 190, to: 80, type: "triangle", d: 0.16, v: 0.09 }, musicBus, nextNoteAt);
            }
            if (beat % 2 === 1) tone({ noise: true, cutoff: 5500, d: 0.03, v: 0.018 }, musicBus, nextNoteAt);
            if (beat === 0 || (intense && beat === 8)) {
                tone({ f: hz(root + 12), type: "sawtooth", cutoff: 950, attack: 0.055, d: 0.7, v: 0.045 }, musicBus, nextNoteAt);
                tone({ f: hz(root + 19) * 1.003, type: "sawtooth", cutoff: 1250, attack: 0.06, d: 0.65, v: 0.026 }, musicBus, nextNoteAt);
            }
            if (intense && beat % 4 === 0) {
                tone({ f: hz(root + 24 + battleCalls[bar % 4][beat / 4]), type: "triangle",
                    d: 0.26, v: 0.055 }, musicBus, nextNoteAt);
            }
            if (bar % 4 === 0 && beat === 0) tone({ noise: true, cutoff: 6500, d: 0.65, v: 0.04 }, musicBus, nextNoteAt);
            nextNoteAt += stepSeconds;
            step = (step + 1) % 256;
        }
    }

    function unlock() {
        if (!context) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) { status.textContent = "Unavailable"; return; }
            try {
                context = new AudioContext();
                master = context.createGain();
                musicBus = context.createGain();
                effectsBus = context.createGain();
                const limiter = context.createDynamicsCompressor();
                limiter.threshold.value = -12;
                limiter.ratio.value = 6;
                musicBus.connect(limiter);
                effectsBus.connect(limiter);
                limiter.connect(master);
                master.connect(context.destination);
                // A separate deterministic noise generator leaves gameplay randomness alone.
                noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
                const samples = noiseBuffer.getChannelData(0);
                let seed = 71347;
                for (let i = 0; i < samples.length; i++) {
                    seed = (1664525 * seed + 1013904223) >>> 0;
                    samples[i] = seed / 2147483648 - 1;
                }
                gains();
                window.setInterval(scheduleMusic, 100);
            } catch {
                context?.close().catch(() => {});
                context = null;
                status.textContent = "Unavailable";
                return;
            }
        }
        if (context.state === "suspended") context.resume().then(scheduleMusic).catch(() => {});
        else scheduleMusic();
    }

    function setScene(value) {
        if (value === scene) return;
        scene = value;
        if (scene === "over") stopVoices(musicBus);
        gains();
        scheduleMusic();
    }

    function setHidden(value) {
        hidden = value;
        if (hidden) stopVoices();
        gains();
        scheduleMusic();
    }

    function setVolume(name, value) {
        if (!(name in sliders) || !Number.isFinite(value)) return;
        settings[name] = Math.max(0, Math.min(1, value));
        if (settings[name] === 0) stopVoices(name === "music" ? musicBus : effectsBus);
        save(); refreshControls(); gains(); scheduleMusic();
    }

    function setMuted(value) {
        settings.muted = Boolean(value);
        if (settings.muted) stopVoices();
        save(); refreshControls(); gains(); scheduleMusic();
    }

    function footsteps(distance) {
        walkingDistance += distance;
        if (walkingDistance >= 34) {
            walkingDistance %= 34;
            play("step");
        }
    }

    function moveControls(slot) {
        const parent = slot ? document.getElementById(slot) : home;
        if (controls.parentElement !== parent) parent.appendChild(controls);
    }

    document.addEventListener("pointerdown", unlock, { capture: true });
    document.addEventListener("keydown", event => {
        if (!event.ctrlKey && !event.altKey && !event.metaKey) unlock();
    }, { capture: true });
    document.addEventListener("pointerover", event => {
        const target = event.target?.closest?.("button, summary");
        if (target && !target.disabled && !target.contains(event.relatedTarget)) play("hover");
    });
    document.addEventListener("visibilitychange", () => setHidden(document.hidden));
    controls.addEventListener("toggle", () => play("click"));
    muteButton.addEventListener("click", () => {
        unlock(); setMuted(!settings.muted);
        if (!settings.muted) play("click");
    });
    for (const [name, slider] of Object.entries(sliders)) {
        slider.addEventListener("input", () => { unlock(); setVolume(name, Number(slider.value) / 100); });
        slider.addEventListener("change", () => play("click"));
    }
    refreshControls();
    return { unlock, play, setScene, setHidden, setVolume, setMuted, footsteps, moveControls };
})();
