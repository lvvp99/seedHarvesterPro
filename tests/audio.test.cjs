const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/audio-v1.js"), "utf8");

function audioHarness({ saved, unsupported = false, storageBlocked = false } = {}) {
    const elements = new Map();
    const contexts = [];
    const timers = [];
    const storage = new Map(saved ? [["seedHarvester.audio.v1", saved]] : []);
    function element() {
        const handlers = new Map();
        return {
            value: "", textContent: "", attributes: {}, children: [], parentElement: null,
            addEventListener(name, fn) { (handlers.get(name) || handlers.set(name, []).get(name)).push(fn); },
            emit(name, event = {}) { for (const fn of handlers.get(name) || []) fn(event); },
            setAttribute(name, value) { this.attributes[name] = value; },
            appendChild(child) {
                if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
                this.children.push(child); child.parentElement = this;
            }
        };
    }
    const document = Object.assign(element(), {
        hidden: false,
        getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }
    });
    function parameter() {
        return {
            value: 0, events: [],
            setValueAtTime(value, time) { this.value = value; this.events.push({ value, time }); },
            linearRampToValueAtTime(value, time) { this.value = value; this.events.push({ value, time }); },
            exponentialRampToValueAtTime(value, time) { assert.ok(value > 0); this.value = value; this.events.push({ value, time }); },
            setTargetAtTime(value, time) { this.value = value; this.events.push({ value, time }); },
            cancelScheduledValues() {}
        };
    }
    function node() {
        return { connections: [], connect(other) { this.connections.push(other); }, disconnect() { this.disconnected = true; } };
    }
    class AudioContext {
        constructor() {
            this.currentTime = 0; this.state = "running"; this.sampleRate = 48000;
            this.destination = node(); this.sources = []; this.gains = [];
            contexts.push(this);
        }
        createGain() { const gain = Object.assign(node(), { gain: parameter() }); this.gains.push(gain); return gain; }
        createDynamicsCompressor() { return Object.assign(node(), { threshold: parameter(), ratio: parameter() }); }
        createBiquadFilter() { return Object.assign(node(), { frequency: parameter() }); }
        createBuffer(channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
        createOscillator() {
            const source = Object.assign(node(), {
                frequency: parameter(), type: "sine", ended: false,
                start(time) { this.startAt = time; }, stop(time) { this.stopAt = time; }
            });
            this.sources.push(source);
            return source;
        }
        createBufferSource() { return this.createOscillator(); }
        resume() { this.state = "running"; return Promise.resolve(); }
        close() { this.state = "closed"; return Promise.resolve(); }
    }
    const window = {
        AudioContext: unsupported ? undefined : AudioContext,
        setInterval(callback) { timers.push(callback); return timers.length; },
        localStorage: {
            getItem(key) { if (storageBlocked) throw Error("Storage blocked"); return storage.get(key); },
            setItem(key, value) { if (storageBlocked) throw Error("Storage blocked"); storage.set(key, value); }
        }
    };
    const context = vm.createContext({ window, document, console });
    vm.runInContext(source, context);
    const audio = vm.runInContext("gameAudio", context);
    return {
        audio, elements, document, contexts, timers, storage,
        advance(seconds) {
            for (const ctx of contexts) {
                ctx.currentTime += seconds;
                for (const source of ctx.sources) {
                    if (!source.ended && source.stopAt <= ctx.currentTime) {
                        source.ended = true; source.onended?.();
                    }
                }
            }
            for (const timer of timers) timer();
        }
    };
}

test("audio waits for a gesture, creates one context, and schedules a bounded, continuous music loop", () => {
    const h = audioHarness();
    assert.equal(h.contexts.length, 0);
    h.audio.play("shot");
    assert.equal(h.contexts.length, 0);
    h.document.emit("pointerdown");
    h.document.emit("keydown", { key: "w" });
    assert.equal(h.contexts.length, 1);
    assert.equal(h.timers.length, 1);
    const ctx = h.contexts[0];
    assert.ok(ctx.sources.length > 0);
    for (let i = 0; i < 500; i++) {
        h.advance(0.1);
        assert.ok(ctx.sources.filter(source => !source.ended).length <= 64);
    }
    assert.ok(ctx.sources.length > 500, "music should continue across multiple complete loops");
    assert.ok(ctx.sources.filter(source => source.ended).every(source => source.disconnected));
    const count = ctx.sources.length;
    h.advance(10000);
    assert.ok(ctx.sources.length - count < 15, "a stall must not cause a burst of missed music");
});

test("every sound cue produces finite enveloped audio, with limits on repeated loud events", () => {
    const h = audioHarness();
    h.audio.unlock();
    h.audio.setVolume("music", 0);
    h.advance(1);
    const ctx = h.contexts[0];
    for (const cue of ["hover", "click", "open", "close", "start", "move", "arrive", "step", "hay", "collect", "shot",
        "critical", "hit", "kill", "spawn", "explosion", "hurt", "lowHealth", "block", "purchase", "unlock", "denied",
        "marker", "teleport", "wrap", "shield", "dash", "freeze", "lure", "expire", "ready", "gameOver"]) {
        const before = ctx.sources.length;
        h.audio.play(cue);
        assert.ok(ctx.sources.length > before, cue);
        for (const source of ctx.sources.slice(before)) {
            assert.ok(Number.isFinite(source.startAt) && source.stopAt > source.startAt, cue);
        }
        h.advance(2);
    }
    const before = ctx.sources.length;
    for (let i = 0; i < 500; i++) h.audio.play("explosion");
    assert.equal(ctx.sources.length - before, 2);
    h.advance(1);
    const walkingCount = ctx.sources.length;
    h.audio.footsteps(0); h.audio.footsteps(20);
    assert.equal(ctx.sources.length, walkingCount);
    h.audio.footsteps(14);
    assert.equal(ctx.sources.length, walkingCount + 1);
    h.advance(10);
    assert.equal(ctx.sources.length, walkingCount + 1, "standing still should not make footsteps");
});

test("music and effects volumes are independent, mute silences both, and preferences survive reload", () => {
    const h = audioHarness();
    h.audio.unlock();
    const ctx = h.contexts[0];
    h.audio.setVolume("music", 0);
    assert.equal(ctx.gains[1].gain.value, 0);
    const count = ctx.sources.length;
    h.audio.play("collect");
    assert.ok(ctx.sources.length > count, "effects should work with music off");
    h.audio.setVolume("effects", 0);
    const silentCount = ctx.sources.length;
    h.audio.play("shot");
    assert.equal(ctx.sources.length, silentCount);
    h.audio.setVolume("music", 0.25);
    h.audio.setVolume("effects", 0.4);
    h.audio.setMuted(true);
    assert.equal(ctx.gains[0].gain.value, 0);
    const mutedCount = ctx.sources.length;
    h.audio.play("explosion"); h.advance(100);
    assert.equal(ctx.sources.length, mutedCount);
    const reloaded = audioHarness({ saved: h.storage.get("seedHarvester.audio.v1") });
    assert.equal(reloaded.elements.get("musicVolume").value, 25);
    assert.equal(reloaded.elements.get("effectsVolume").value, 40);
    assert.equal(reloaded.elements.get("muteAudioBtn").textContent, "Unmute");
    reloaded.audio.unlock();
    assert.equal(reloaded.contexts[0].sources.length, 0);
    reloaded.audio.setMuted(false);
    assert.ok(reloaded.contexts[0].sources.length > 0);
});

test("hidden tabs are silent, paused music is quieter, and game over stops music but plays its cue", () => {
    const h = audioHarness();
    h.audio.unlock();
    const ctx = h.contexts[0];
    const fullVolume = ctx.gains[1].gain.value;
    h.audio.setScene("paused");
    assert.ok(ctx.gains[1].gain.value < fullVolume);
    h.audio.setScene("play");
    assert.equal(ctx.gains[1].gain.value, fullVolume);
    h.document.hidden = true; h.document.emit("visibilitychange");
    assert.equal(ctx.gains[0].gain.value, 0);
    const hiddenCount = ctx.sources.length;
    h.audio.play("hurt"); h.advance(100);
    assert.equal(ctx.sources.length, hiddenCount);
    h.document.hidden = false; h.document.emit("visibilitychange");
    assert.ok(ctx.sources.length > hiddenCount);
    assert.ok(ctx.sources.length - hiddenCount < 15);
    h.audio.setScene("over");
    const endCount = ctx.sources.length;
    h.audio.play("gameOver");
    assert.equal(ctx.sources.length - endCount, 5);
    h.advance(100);
    assert.equal(ctx.sources.length - endCount, 5);
});

test("controls move into modal dialogs without duplication and update stored volumes from UI events", () => {
    const h = audioHarness();
    const controls = h.elements.get("soundControls");
    h.audio.moveControls("gameOverSoundSlot");
    h.audio.moveControls("gameOverSoundSlot");
    assert.equal(h.elements.get("gameOverSoundSlot").children.length, 1);
    h.audio.moveControls(null);
    assert.equal(h.elements.get("gameOverSoundSlot").children.length, 0);
    assert.equal(controls.parentElement, h.elements.get("soundHome"));
    const slider = h.elements.get("effectsVolume");
    slider.value = "20"; slider.emit("input");
    assert.equal(h.elements.get("effectsVolumeValue").textContent, "20%");
    assert.equal(slider.attributes["aria-valuetext"], "20 percent");
    h.elements.get("muteAudioBtn").emit("click");
    assert.equal(h.elements.get("muteAudioBtn").attributes["aria-pressed"], "true");
});

test("unavailable audio and blocked or corrupt preference storage never stop the game", () => {
    for (const options of [{ unsupported: true }, { storageBlocked: true }, { saved: "invalid json" },
        { saved: '{"music":-20,"effects":99,"muted":"false"}' }]) {
        const h = audioHarness(options);
        assert.doesNotThrow(() => {
            h.audio.unlock(); h.audio.play("start"); h.audio.setScene("play");
            h.audio.setVolume("music", 0.3); h.audio.setMuted(true); h.audio.setHidden(true);
        });
    }
});

