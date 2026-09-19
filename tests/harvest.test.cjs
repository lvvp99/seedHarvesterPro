const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = ["js/audio-v1.js", "js/world-v1.js", "js/monsters-v1.js", "js/boss-v1.js", "js/progression-v1.js", "js/history-v1.js", "js/controls-v1.js", "js/pickups-v1.js", "js/rewards-v1.js", "js/loot-v1.js", "js/ability-progress-v1.js", "js/ability-effects-v1.js", "js/game-v1.js"]
    .map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function createCombatGame(options = {}) {
    const game = createGame(options);
    game.start();
    game.run(`
        monsters.length = 0;
        bullets.length = 0;
        hayStacks.length = 0;
        monsterState.nextSpawnAt = Infinity;
        nextHaySpawnAt = Infinity;
        lootState.nextMysteryAt = Infinity;
        lootState.nextPotionAt = Infinity;
        weaponState.nextShotAt = Infinity;
        weaponState.nextTargetSearchAt = 0;
        function placeMonster(type, x, y) {
            return Object.assign(spawnMonster(type, "left"), { x, y });
        }
        function testBullet(x, y, dx, options = {}) {
            const bullet = { kind: "rake", x, y, dx, dy: 0, size: 4, damage: 10, ...options };
            bullets.push(bullet);
            return bullet;
        }
    `);
    return game;
}

function abilitySave(coins = 0, levels = {}) {
    return new Map([["seedHarvester.abilityProgress.v1", JSON.stringify({ coins, levels })]]);
}

function createGame({ scrolling = false, storage = new Map(), storageBlocked = false } = {}) {
    let now = 5000;
    let randomState = 12345;
    let nextFrame;
    const elements = new Map();
    const drawing = [];
    const ctx = new Proxy({}, {
        get: (_, name) => name === "measureText"
            ? text => ({ width: text.length * 10 })
            : (...args) => drawing.push({ name, args })
    });

    function element(id = "") {
        const listeners = new Map();
        const classes = new Set();
        const attributes = new Map();
        return {
            id, hidden: false, open: false, disabled: false, textContent: "", style: {setProperty(name,value){this[name]=value;}},
            children: [], dataset: {}, parts: {}, innerHTML: "",
            classList: {
                toggle(name, value) { if (value) classes.add(name); else classes.delete(name); },
                add(name) { classes.add(name); },
                remove(name) { classes.delete(name); },
                contains(name) { return classes.has(name); }
            },
            setAttribute(name, value) { attributes.set(name, value); },
            setPointerCapture(id) { this.capturedPointer = id; },
            getAttribute(name) { return attributes.get(name); },
            appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); },
            addEventListener(type, handler) {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(handler);
            },
            removeEventListener(type, handler) {
                listeners.set(type, (listeners.get(type) || []).filter(fn => fn !== handler));
            },
            emit(type, event = {}) {
                for (const handler of listeners.get(type) || []) handler(event);
            },
            showModal() { this.open = true; },
            close() { this.open = false; this.emit("close"); },
            getBoundingClientRect: () => id === "game"
                ? { left: 0, top: 0, width: window.innerWidth, height: elements.get("game").height || window.innerHeight }
                : { left: 0, top: 0, width: 250, height: id === "bottomHud" ? 0 : 92 },
            getContext: () => ctx,
            querySelector(selector) {
                return id.startsWith("charBtn") && selector === "img"
                    ? { src: "imgs/seed-harvester.png" } : this.parts[selector] || null;
            },
            closest(selector) { return selector === ".shopItem" ? this : null; }
        };
    }

    for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
        elements.set(match[1], element(match[1]));
    }
    const upgradeButtons = [];
    const levelFields = new Map();
    for (const match of html.matchAll(/<button\b([^>]*data-upgrade="([^"]+)"[^>]*)>([\s\S]*?)<\/button>/g)) {
        const id = match[1].match(/id="([^"]+)"/)[1];
        const button = elements.get(id);
        button.innerHTML = match[3];
        for (const attr of match[1].matchAll(/data-(\w+)="([^"]+)"/g)) {
            button.dataset[attr[1]] = attr[2];
        }
        for (const part of [".shopItemInfo", ".shopItemIcon", ".upgradeLevel", ".shopPrice", ".shopPurchaseAction"]) {
            button.parts[part] = element();
        }
        levelFields.set(match[2], button.parts[".upgradeLevel"]);
        upgradeButtons.push(button);
    }
    const document = Object.assign(element(), {
        getElementById: id => elements.get(id) || null,
        createElement: () => element(),
        querySelector: selector => levelFields.get(selector.match(/data-level-for="([^"]+)"/)?.[1]) || null,
        querySelectorAll: selector => selector === ".statUpgradeButton" ? upgradeButtons : []
    });
    const window = Object.assign(element(), {
        innerWidth: 1280, innerHeight: 720,
        localStorage: {
            getItem(key) { if (storageBlocked) throw new Error("Storage blocked"); return storage.get(key) ?? null; },
            setItem(key, value) { if (storageBlocked) throw new Error("Storage blocked"); storage.set(key, value); }
        },
        setTimeout(callback) { callback(); },
        location: { reload() { window.reloaded = true; } }
    });
    const math = Object.create(Math);
    math.random = () => {
        randomState = (1664525 * randomState + 1013904223) >>> 0;
        return randomState / 4294967296;
    };
    const context = vm.createContext({
        document, window, Math: math, console,
        performance: { now: () => now },
        requestAnimationFrame: callback => { nextFrame = callback; },
        Image: class {
            complete = true;
            naturalWidth = 512;
            set src(value) { this.url = value; this.onload?.(); }
            get src() { return this.url; }
        },
        ResizeObserver: class { observe() {} }
    });
    vm.runInContext(source, context);
    const run = code => vm.runInContext(code, context);
    // Isolate existing mechanics in an empty, still arena. Scrolling integration tests opt in below.
    if (!scrolling) run("startScrollingWorld = () => {}; worldSettings.zoneDamage = 0;");
    return {
        run, elements, document, window, drawing, upgradeButtons,
        start() { elements.get("startGameBtn").emit("click"); },
        advance(ms) { now += ms; nextFrame?.(); },
        key(key, extra = {}) {
            window.emit("keydown", { key, code: key === " " ? "Space" : "", preventDefault() {}, ...extra });
        },
        releaseKey(key) { window.emit("keyup", { key }); },
        rightClick(x, y) {
            const event = { button: 2, buttons: 2, clientX: x, clientY: y, preventDefault() {} };
            elements.get("game").emit("mousedown", event);
            window.emit("mouseup", { ...event, buttons: 0 });
        },
        leftClick(x = 800, y = 400) {
            elements.get("game").emit("mousedown", { button: 0, buttons: 1, clientX: x, clientY: y, preventDefault() {} });
        },
        read(code) { return JSON.parse(JSON.stringify(run(code))); }
    };
}

test("Start game loads the single harvester, starts the timer and five visible hay stacks", () => {
    const game = createGame();
    game.advance(120000);
    assert.equal(game.run("gameClock.elapsedMs"), 0);
    game.start();
    assert.equal(game.run("player.image.src"), "imgs/seed-harvester.png");
    assert.equal(game.run("player.level"), 1);
    game.start();
    assert.equal(game.run("hayStacks.length"), 5);
    assert.equal(game.elements.get("gameTime").textContent, "00:00");
    assert.equal(game.elements.get("initialView").hidden, true);
    assert.equal(game.elements.get("game").hidden, false);
    assert.ok(game.drawing.some(call => call.name === "drawImage"
        && call.args[0].src === "imgs/random/hay.svg"));
    game.advance(1000);
    assert.equal(game.elements.get("gameTime").textContent, "00:01");
});

test("completed survival times persist across reloads, exclude pause, and save only once", () => {
    const storage = new Map();
    const game = createGame({ storage });
    game.start(); game.advance(1234); game.key(" "); game.advance(90000);
    game.run("endGame(); endGame();");
    const record = JSON.parse(storage.get("seedHarvester.survivalHistory.v1"));
    assert.equal(record.recent.length, 1);
    assert.equal(record.recent[0].elapsedMs, 1234);
    assert.equal(record.recent[0].completed, true);
    assert.equal(record.bestMs, 1234);
    const reloaded = createGame({ storage });
    assert.equal(reloaded.elements.get("bestSurvivalTime").textContent, "00:01");
    assert.equal(reloaded.elements.get("historyEmpty").hidden, true);
    assert.equal(reloaded.elements.get("survivalHistoryList").children.length, 1);
    assert.equal(reloaded.elements.get("survivalHistoryList").children[0].children[1].textContent, "00:01");
});

test("history keeps ten recent runs and retains the best after that run leaves the list", () => {
    const storage = new Map();
    const game = createGame({ storage });
    game.run("survivalHistory.begin(); survivalHistory.save(3723000, true)");
    for (let i = 1; i <= 12; i++) game.run(`survivalHistory.begin(); survivalHistory.save(${i * 1000}, true)`);
    const record = JSON.parse(storage.get("seedHarvester.survivalHistory.v1"));
    assert.equal(record.recent.length, 10);
    assert.equal(record.recent[0].elapsedMs, 12000);
    assert.equal(record.recent.at(-1).elapsedMs, 3000);
    assert.equal(record.bestMs, 3723000);
    const reloaded = createGame({ storage });
    assert.equal(reloaded.elements.get("bestSurvivalTime").textContent, "01:02:03");
});

test("checkpoints and leaving the page update one run without including hidden time", () => {
    const storage = new Map();
    const game = createGame({ storage });
    game.start(); game.advance(5000);
    assert.equal(JSON.parse(storage.get("seedHarvester.survivalHistory.v1")).recent[0].elapsedMs, 5000);
    game.advance(1234); game.document.hidden = true; game.document.emit("visibilitychange");
    game.advance(60000); game.window.emit("pagehide");
    const record = JSON.parse(storage.get("seedHarvester.survivalHistory.v1"));
    assert.equal(record.recent.length, 1);
    assert.equal(record.recent[0].elapsedMs, 6234);
    assert.equal(record.recent[0].completed, false);
    const reloaded = createGame({ storage });
    assert.match(reloaded.elements.get("survivalHistoryList").children[0].children[0].textContent, /Left game/);
});

test("invalid or blocked history storage cannot stop play or erase in-memory best records", () => {
    for (const options of [{ storage: new Map([["seedHarvester.survivalHistory.v1", "broken JSON"]]) }, { storageBlocked: true }]) {
        const game = createGame(options);
        game.start(); game.advance(2100); game.run("endGame()");
        assert.equal(game.elements.get("bestSurvivalTime").textContent, "00:02");
        game.run("survivalHistory.begin(); survivalHistory.save(1000, true)");
        assert.equal(game.elements.get("bestSurvivalTime").textContent, "00:02");
    }
    const game = createGame({ storage: new Map([["seedHarvester.survivalHistory.v1", JSON.stringify({ bestMs: -1, recent: [null, {id:"bad",elapsedMs:123,startedAt:"invalid"}] })]]) });
    assert.equal(game.elements.get("bestSurvivalTime").textContent, "—");
});

test("XP carries past level 20 without changing weapons and queues every fifth level", () => {
    const game=createCombatGame();game.run("awardXp(39)");
    assert.equal(game.run("player.level"),1);assert.equal(game.elements.get("xpText").textContent,"39 / 40 XP");
    game.run("awardXp(1)");assert.equal(game.run("player.level"),2);assert.equal(game.run("player.xp"),0);
    assert.equal(game.elements.get("playerLevel").textContent,"Lv 2");assert.equal(game.elements.get("statRakeDamage").textContent,"12");
    game.run("awardXp(getXpRequired(2)+getXpRequired(3)+7)");assert.equal(game.run("player.level"),4);assert.equal(game.run("player.xp"),7);
    game.run("awardXp(Array.from({length:21},(_,i)=>getXpRequired(i+4)).reduce((a,b)=>a+b,0)-player.xp+11)");
    assert.equal(game.run("player.level"),25);assert.equal(game.run("player.xp"),11);
    assert.ok(game.run("getXpRequired()>0"));assert.equal(game.elements.get("rakeName").textContent,"Field Rake");
    assert.equal(game.run("player.rakeTier"),1);assert.deepEqual(game.read("bossState.queue"),[5,10,15,20,25]);
    game.run("awardXp(getXpRequired())");assert.equal(game.run("player.level"),26);assert.equal(game.run("player.xp"),11);
    assert.equal(game.run("player.seeds"),0);
});

test("all 20 rake levels have distinct drawings and increasing damage", () => {
    const game = createCombatGame(), drawings = new Set();
    let damage = 0;
    for (let level = 1; level <= 20; level++) {
        game.drawing.length = 0;
        game.run(`drawRake(ctx, 0, 0, 0, ${level})`);
        drawings.add(JSON.stringify(game.drawing));
        assert.ok(game.run(`getRake(${level}).damage`) > damage);
        damage = game.run(`getRake(${level}).damage`);
    }
    assert.equal(drawings.size, 20);
    assert.equal(new Set(game.read("rakeLevels.map(r => r.name)")).size, 20);
});

test("left-click throws one rake toward the mouse and obeys recovery, pause and input priority", () => {
    const game = createCombatGame();
    game.rightClick(1000, 360);
    assert.equal(game.run("bullets.length"), 0);
    game.leftClick(1000, 360);
    assert.equal(game.run("bullets.length"), 1);
    assert.equal(game.run("bullets[0].kind"), "rake");
    assert.equal(game.run("bullets[0].dy"), 0);
    game.leftClick(1000, 360);
    assert.equal(game.run("bullets.length"), 1);
    game.key(" "); game.advance(5000); game.leftClick();
    assert.equal(game.run("rakeState.nextThrowAt"), 450);
    assert.equal(game.run("bullets.length"), 1);
    game.key(" "); game.advance(450); game.run("bullets.length = 0");
    game.key("1"); game.leftClick(800, 400);
    assert.equal(game.run("bullets.length"), 0, "a targeted ability consumes its left-click");
    game.key("5"); game.leftClick(900, 500);
    assert.equal(game.run("bullets.length"), 0);
    game.leftClick(1100, 500);
    assert.equal(game.run("bullets.length"), 1);
    game.advance(500);
    assert.equal(game.run("bullets.length"), 1, "holding or waiting never auto-throws rakes");
});

test("rakes use mouse aim even with automatic targeting and basic upgrades cannot alter them", () => {
    const game = createCombatGame();
    game.run(`player.level = 6; player.damage = 300; player.criticalChance = 1;
        player.unlocks.piercingRound = true; player.unlocks.knockback = true; player.unlocks.explosiveKernel = true;
        const aimEnemy = placeMonster('brute', 400, 360); weaponState.nextShotAt = 0;`);
    game.leftClick(1000, 360);
    game.run("updateAutomaticShooting()");
    assert.ok(game.run("bullets[0].dx > 0 && bullets[1].dx < 0"));
    assert.equal(game.run("bullets[0].damage"), 12);
    assert.equal(game.run("bullets[1].damage"), 600);
    assert.ok(game.run("bullets[0].piercing && bullets[0].knockback && bullets[0].explosive"));
    assert.ok(game.run("!bullets[1].piercing && !bullets[1].knockback && !bullets[1].explosive"));
    game.run("awardXp(1000)");
    assert.equal(game.run("bullets[0].level"), 1, "in-flight rakes keep their original weapon tier and damage");
});

test("a thrown rake damages crossed enemies and walls stop it before a protected enemy", () => {
    for (const wall of [false, true]) {
        const game = createCombatGame();
        game.run("const victim = placeMonster('crawler',740,360)");
        if (wall) game.run("walls.push({x:700,y:250,width:20,height:200})");
        game.leftClick(1000, 360);
        for (let i=0;i<4;i++) game.run("updateBullets(50)");
        assert.equal(game.run("victim.health"), wall ? 28 : 16);
        assert.equal(game.run("bullets.length"), 0);
    }
});

test("mystery-only Ricochet leaves existing throws unchanged and updates the loadout", () => {
 const game=createCombatGame();game.leftClick(1000,360);
 assert.equal(game.run("bullets[0].bouncesRemaining"),0);
 assert.equal(game.run("purchaseUpgrade('ricochet')"),false);
 game.run("getMysteryBonuses().find(b=>b.id==='ricochet').apply();updateStatsPanel()");
 assert.equal(game.elements.get("effectState-ricochet").textContent,"Unlocked");
 assert.equal(game.elements.get("rakeEffectsCount").textContent,"1/4");
 assert.equal(game.run("bullets[0].bouncesRemaining"),0);
 game.run("rakeState.nextThrowAt=0");game.leftClick(1000,360);
 assert.equal(game.run("bullets[1].bouncesRemaining"),2);
});

test("Ricochet reflects on all wall faces and exact corners, including remaining frame movement and rotation", () => {
    for (const [x,y,dx,dy,endX,endY,outDx,outDy] of [
        [250,350,100,20,242,370,-100,20], [390,350,-100,20,398,370,100,20],
        [320,200,10,100,330,192,10,-100], [320,500,10,-100,330,508,10,100],
        [250,200,100,100,242,192,-100,-100]
    ]) {
        const game = createCombatGame();
        game.run(`walls.push({x:300,y:250,width:40,height:200});
            const shot = testBullet(${x},${y},${dx},{dy:${dy},bouncesRemaining:2}); updateBullets();`);
        assert.equal(game.run("bullets.length"), 1);
        assert.equal(game.run("shot.bouncesRemaining"), 1);
        assert.equal(game.run("shot.dx"), outDx); assert.equal(game.run("shot.dy"), outDy);
        assert.ok(Math.abs(game.run("shot.x")-endX)<0.01);
        assert.ok(Math.abs(game.run("shot.y")-endY)<0.01);
        assert.equal(game.run("shot.angle"), Math.atan2(outDy,outDx));
        assert.equal(game.run("bodyTouchesWall(shot.x,shot.y,shot.size)"), false);
    }
});

test("two bounces are shared across frames and a third wall hit consumes the rake even at high speed", () => {
    for (const speed of [300,1000]) {
        const game = createCombatGame();
        game.run(`walls.push({x:200,y:200,width:20,height:300},{x:400,y:200,width:20,height:300});
            const shot=testBullet(300,350,${speed},{bouncesRemaining:2}); updateBullets();`);
        assert.equal(game.run("shot.bouncesRemaining"), 0);
        if (speed === 300) {
            assert.equal(game.run("bullets.length"), 1);
            assert.equal(game.run("wallSparks.length"), 2);
            assert.ok(Math.abs(game.run("shot.x")-256)<0.01);
            game.run("updateBullets()");
        }
        assert.equal(game.run("bullets.length"), 0);
        assert.equal(game.run("wallSparks.length"), 3);
    }
});

test("wall bounces damage enemies on reflected paths and piercing does not hit the same enemy twice", () => {
    for (const piercing of [false,true]) {
        const game = createCombatGame();
        game.run(`walls.push({x:400,y:200,width:20,height:300});
            const reflected=placeMonster('brute',200,350);
            const protectedEnemy=placeMonster('brute',480,350);
            ${piercing ? "const front=placeMonster('brute',350,350);" : ""}
            const shot=testBullet(300,350,500,{bouncesRemaining:2,piercing:${piercing}}); updateBullets();`);
        assert.equal(game.run("reflected.health"), 58);
        assert.equal(game.run("protectedEnemy.health"), 68);
        if (piercing) assert.equal(game.run("front.health"), 58);
        assert.equal(game.run("shot.hitMonsterIds.size"), piercing ? 2 : 1);
        assert.equal(game.run("wallSparks.length"), 1);
        assert.equal(game.run("bullets.length"), 0);
    }
    const game = createCombatGame();
    game.run(`walls.push({x:400,y:200,width:20,height:300}); const front=placeMonster('brute',350,350);
        testBullet(300,350,500,{bouncesRemaining:2}); updateBullets();`);
    assert.equal(game.run("front.health"), 58);
    assert.equal(game.run("wallSparks.length"), 0, "a non-piercing enemy hit consumes the rake before the wall");
});

test("basic shots, locked rakes, and embedded projectiles stop safely at walls", () => {
    for (const options of ["{kind:'basic',bouncesRemaining:2}","{kind:'rake',bouncesRemaining:0}","{kind:'rake'}"]) {
        const game = createCombatGame();
        game.run(`walls.push({x:400,y:200,width:20,height:300}); testBullet(300,350,500,${options}); updateBullets();`);
        assert.equal(game.run("bullets.length"),0);
        assert.equal(game.run("wallSparks.length"),1);
    }
    const game = createCombatGame();
    game.run(`walls.push({x:400,y:200,width:20,height:300});
        testBullet(410,350,100,{bouncesRemaining:2}); updateBullets();`);
    assert.equal(game.run("bullets.length"),0);
});

test("bounces do not stick at frame boundaries or when gliding along wall faces", () => {
    const game = createCombatGame();
    game.run(`walls.push({x:400,y:200,width:20,height:300});
        const shot=testBullet(300,350,96,{bouncesRemaining:2}); updateBullets(); updateBullets();`);
    assert.equal(game.run("shot.bouncesRemaining"),1);
    assert.equal(game.run("wallSparks.length"),1);
    assert.ok(Math.abs(game.run("shot.x")-300)<0.01);
    assert.equal(game.run("wallHitTime(396,350,350,350,4)"),null);
    assert.equal(game.run("wallHitTime(396,350,396,400,4)"),null);
});

test("basic projectiles cannot apply rake-only effects even if stale flags are present", () => {
    const game = createCombatGame();
    game.run(`const first=placeMonster('brute',740,360); const nearby=placeMonster('brute',770,360);
        testBullet(640,360,150,{kind:'basic',piercing:true,knockback:true,explosive:true}); updateBullets();`);
    assert.equal(game.run("first.health"), 58);
    assert.equal(game.run("first.x"), 740);
    assert.equal(game.run("nearby.health"), 68);
    assert.equal(game.run("bullets.length"), 0);
    assert.equal(game.run("combatEffects.length"), 0);
});

test("sprite and held rake rotate with mouse aim independently of the automatic attack", () => {
    const game = createCombatGame();
    game.window.emit("mousemove", {clientX:640,clientY:600,buttons:0});
    game.drawing.length=0; game.run("drawHarvester()");
    assert.ok(game.drawing.some(c=>c.name==="rotate" && Math.abs(c.args[0]-Math.PI)<1e-8));
    assert.ok(game.drawing.some(c=>c.name==="rotate" && Math.abs(c.args[0]-Math.PI/2)<1e-8));
    game.leftClick(640,600);
    game.drawing.length=0; game.run("drawHarvester()");
    assert.equal(game.drawing.filter(c=>c.name==="rotate").length,1,"held rake disappears during throw recovery");
});

test("bottom HUD reserves map space and vertical wrapping stays above the abilities", () => {
    const game=createCombatGame();
    game.elements.get("bottomHud").getBoundingClientRect=()=>({height:84,width:1280,left:0,top:636});
    game.elements.get("gameHud").getBoundingClientRect=()=>({height:44,width:1280,left:0,top:0});
    game.run("resizeGameCanvas(); player.x=600; player.y=634;");
    assert.equal(game.run("canvas.height"),636);
    assert.equal(game.run("gameHudHeight"),44);
    game.key("s"); game.advance(50);
    assert.ok(game.run("player.y >=44 && player.y < 60"));
});

test("ability buttons distinguish ready, armed, active, cooldown and locked states with progress", () => {
    const game=createCombatGame(), hud=game.elements.get("abilityTeleport");
    assert.equal(hud.classList.contains("ready"),true);
    game.key("1");
    assert.match(game.elements.get("teleportCooldownText").textContent,/Armed/);
    game.leftClick(800,400);
    assert.match(game.elements.get("teleportCooldownText").textContent,/Cooldown/);
    assert.equal(game.elements.get("teleportProgress").style.width,"0%");
    game.advance(2500);
    assert.equal(game.elements.get("teleportProgress").style.width,"50%");
    game.key("2");
    assert.match(game.elements.get("energyShieldCooldownText").textContent,/Active/);
    game.run("player.unlocks.lure=false; updateAbilityHud()");
    assert.match(game.elements.get("lureCooldownText").textContent,/Locked/);
    game.advance(2500);
    assert.equal(hud.classList.contains("ready"),true);
});

test("the start-screen guide describes every named enemy and its arrival time before play", () => {
    const game = createGame();
    const cards = game.elements.get("enemyList").children;
    const types = game.read("monsterTypes");
    assert.equal(cards.length, Object.keys(types).length);
    const content = node => [node.textContent, ...node.children.map(content)].join(" ");
    for (const card of cards) {
        const type = types[card.dataset.enemy];
        assert.ok(type.name && type.description);
        assert.ok(content(card).includes(type.name));
        assert.ok(content(card).includes(type.description));
        const arrival = type.availability || ["From the start", "From 00:30", "From 01:00", "From 01:30"][type.minTier];
        assert.ok(content(card).includes(arrival));
        assert.equal(card.children[0].children[0].getAttribute("aria-hidden"), "true");
    }
    assert.equal(game.run("gameStarted"), false);
    assert.equal(game.run("gameClock.elapsedMs"), 0);
    assert.equal(game.run("monsters.length"), 0, "guide illustrations must not spawn live enemies");
});

test("every enemy displays its name above its HP bar, including near map edges", () => {
    const game = createCombatGame();
    game.run("Object.keys(monsterTypes).forEach((type, index) => placeMonster(type, 20 + index * 206, gameHudHeight + 22));");
    game.drawing.length = 0;
    game.run("drawMonsters()");
    for (const name of game.read("Object.values(monsterTypes).map(type => type.name)")) {
        const label = game.drawing.find(call => call.name === "fillText" && call.args[0] === name);
        assert.ok(label, "missing name: " + name);
        assert.ok(label.args[1] >= name.length * 5 && label.args[1] <= 1280 - name.length * 5);
        assert.ok(label.args[2] > game.run("gameHudHeight"));
    }
});

test("Space toggles pause once per press, P does nothing, and shortcut guards stay intact", () => {
    const game = createGame();
    game.key(" ");
    assert.equal(game.run("manuallyPaused"), false);
    game.start();
    game.key("p");
    assert.equal(game.run("manuallyPaused"), false);
    game.key(" ", { repeat: true });
    game.key(" ", { ctrlKey: true });
    game.key(" ", { target: { closest: () => ({}) } });
    assert.equal(game.run("manuallyPaused"), false);
    game.key("d"); game.key("5");
    game.key(" ");
    assert.equal(game.run("manuallyPaused"), true);
    assert.equal(game.run("gameClock.paused"), true);
    assert.equal(game.run("movement.keys.size"), 0);
    assert.equal(game.run("armedAbility"), null);
    game.key(" ", { repeat: true }); game.key("p");
    assert.equal(game.run("manuallyPaused"), true);
    game.key(" ");
    assert.equal(game.run("manuallyPaused"), false);
    assert.equal(game.run("gameClock.paused"), false);
});

test("fullscreen toggles the whole page from menu or gameplay, resizes the map, and tracks Escape", async () => {
    const game = createGame();
    const button = game.elements.get("fullscreenBtn");
    let enterRequests = 0;
    game.document.documentElement = { style: {setProperty(){}}, requestFullscreen: async () => {
        enterRequests++;
        game.document.fullscreenElement = game.document.documentElement;
        game.window.innerWidth = 1920; game.window.innerHeight = 1080;
        game.document.emit("fullscreenchange");
    } };
    game.document.exitFullscreen = async () => {
        game.document.fullscreenElement = null;
        game.window.innerWidth = 1280; game.window.innerHeight = 720;
        game.document.emit("fullscreenchange");
    };
    game.run("updateFullscreenButton()");
    button.emit("click"); button.emit("click");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(enterRequests, 1, "rapid clicks cannot queue competing fullscreen requests");
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.equal(button.textContent, "⛶ Exit fullscreen");
    assert.equal(button.disabled, false);
    assert.equal(game.run("canvas.width"), 1920);
    assert.equal(game.run("gameStarted"), false);
    game.start();
    await game.run("toggleFullscreen()");
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(game.run("canvas.width"), 1280);
    assert.equal(game.run("gameStarted && !gameOver"), true);
    await game.run("toggleFullscreen()");
    // The browser also exits directly through Escape or its own fullscreen control.
    game.document.fullscreenElement = null;
    game.window.innerWidth = 1280; game.window.innerHeight = 720;
    game.document.emit("fullscreenchange");
    assert.equal(button.textContent, "⛶ Fullscreen");
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(game.run("canvas.height"), 720);
    assert.equal(game.run("gameClock.elapsedMs"), 0);
});

test("unsupported or rejected fullscreen requests leave the game usable and allow retries", async () => {
    const game = createGame();
    const button = game.elements.get("fullscreenBtn");
    assert.equal(button.disabled, true);
    await game.run("toggleFullscreen()");
    assert.equal(game.run("fullscreenPending"), false);
    game.document.documentElement = { style: {setProperty(){}}, requestFullscreen: () => Promise.reject(new Error("Denied")) };
    game.document.exitFullscreen = async () => {};
    game.run("updateFullscreenButton()");
    await game.run("toggleFullscreen()");
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(game.elements.get("fullscreenMessage").hidden, false);
    assert.equal(game.run("fullscreenPending"), false);
    game.start();
    game.key("2");
    assert.equal(game.run("isEnergyShieldActive()"), true);
    game.key(" ");
    assert.equal(game.run("manuallyPaused"), true);
});

test("hay rewards increase at each completed minute, including long sessions", () => {
    const game = createGame();
    for (const [elapsed, minimum, maximum] of [[0, 5, 10], [59999, 5, 10], [60000, 7, 12], [300000, 15, 20], [3600000, 125, 130]]) {
        game.run("Math.random = () => 0");
        assert.equal(game.run("getHaySeedAmount(" + elapsed + ")"), minimum);
        game.run("Math.random = () => 0.999999");
        assert.equal(game.run("getHaySeedAmount(" + elapsed + ")"), maximum);
    }
});

test("walking over hay awards seeds once, updates the seed counter, and draws then removes + feedback", () => {
    const game = createGame();
    game.start();
    game.run("hayStacks.length = 0; nextHaySpawnAt = Infinity; hayStacks.push({ x: player.x + 39, y: player.y, seeds: 10, spawnedAt: 0 });");
    game.rightClick(800, 360);
    game.advance(16);
    assert.equal(game.run("player.seeds"), 10);
    assert.equal(game.run("hayStacks.length"), 0);
    assert.equal(Number(game.elements.get("seedHudCount").textContent), 10);
    assert.equal(Number(game.elements.get("seedHudCount").textContent), 10);
    assert.ok(game.drawing.some(call => call.name === "fillText" && call.args[0] === "+10 seeds"));
    game.advance(16);
    assert.equal(game.run("player.seeds"), 10);
    game.advance(1200);
    assert.equal(game.run("collectionEffects.length"), 0);
});

test("fast movement collects crossed hay stacks at their face value", () => {
    const game = createGame();
    game.start();
    game.run("hayStacks.length = 0; nextHaySpawnAt = Infinity; player.speed = 150; hayStacks.push({ x: player.x + 75, y: player.y, seeds: 10, spawnedAt: 0 });");
    game.rightClick(900, 360);
    game.advance(16);
    assert.equal(game.run("player.seeds"), 10);
    assert.equal(game.run("hayStacks.length"), 0);
});

test("pause and hidden-tab pauses stop time and spawning, then resume without a time jump", () => {
    const game = createGame();
    game.start();
    game.advance(1000);
    const count = game.run("hayStacks.length");
    game.elements.get("pauseBtn").emit("click");
    game.advance(60000);
    assert.equal(game.run("gameClock.elapsedMs"), 1000);
    assert.equal(game.run("hayStacks.length"), count);
    game.elements.get("pauseBtn").emit("click");
    game.advance(1000);
    assert.equal(game.run("gameClock.elapsedMs"), 2000);
    game.document.hidden = true;
    game.document.emit("visibilitychange");
    game.advance(120000);
    assert.equal(game.run("gameClock.elapsedMs"), 2000);
    game.document.hidden = false;
    game.document.emit("visibilitychange");
    game.advance(1000);
    assert.equal(game.run("gameClock.elapsedMs"), 3000);
    // Native dialog close (including Escape) also resumes the clock.
    game.elements.get("pauseBtn").emit("click");
    game.run("togglePause()");
    assert.equal(game.run("gameClock.paused"), false);
});

test("spawning is spaced, bounded, capped at twelve, and replenishes collected hay", () => {
    const game = createGame();
    game.start();
    for (let i = 0; i < 30; i++) game.advance(4000);
    const stacks = game.read("hayStacks");
    assert.equal(stacks.length, 12);
    for (const [i, stack] of stacks.entries()) {
        assert.ok(stack.x >= 36 && stack.x <= 1244 && stack.y >= 128 && stack.y <= 684);
        for (const other of stacks.slice(i + 1)) {
            assert.ok(Math.hypot(stack.x - other.x, stack.y - other.y) >= 64);
        }
    }
    game.run("Object.assign(player, { x: hayStacks[0].x, y: hayStacks[0].y });");
    game.advance(16);
    assert.equal(game.run("hayStacks.length"), 11);
    game.advance(4000);
    assert.equal(game.run("hayStacks.length"), 12);
});

test("resizing keeps hay and the player on the usable map and handles maps too small for hay", () => {
    const game = createGame();
    game.start();
    game.window.innerWidth = 375;
    game.window.innerHeight = 667;
    game.window.emit("resize");
    for (const stack of game.read("hayStacks")) {
        assert.ok(stack.x >= 36 && stack.x <= 339 && stack.y >= 128 && stack.y <= 631);
    }
    assert.ok(game.run("player.x <= 343 && player.y >= 124 && player.y <= 635"));
    game.window.innerHeight = 140;
    game.window.emit("resize");
    assert.equal(game.run("hayStacks.length"), 0);
    game.advance(4000);
    assert.equal(game.run("hayStacks.length"), 0);
});

test("timer displays minutes and hours correctly", () => {
    const game = createGame();
    game.start();
    game.advance(59999);
    assert.equal(game.elements.get("gameTime").textContent, "00:59");
    game.advance(1);
    assert.equal(game.elements.get("gameTime").textContent, "01:00");
    game.advance(3600000);
    assert.equal(game.elements.get("gameTime").textContent, "01:01:00");
});

test("right-click walks to its destination while a left-click rake throw adds no movement", () => {
    const game = createGame();
    game.start();
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
        game.key(key);
        game.advance(16);
    }
    assert.equal(game.run("player.x"), 640);
    assert.equal(game.run("player.y"), 360);
    game.leftClick(800, 360);
    game.advance(16);
    assert.equal(game.run("player.x"), 640);
    assert.equal(game.run("bullets.length"), 1);
    game.rightClick(649, 360);
    game.advance(50);
    assert.equal(game.run("player.x"), 649);
    assert.equal(game.run("movement.target"), null);
    game.window.emit("mousemove", { buttons: 0, clientX: 850, clientY: 400 });
    game.advance(50);
    assert.equal(game.run("player.x"), 649);
});

test("holding the right button follows the mouse and release preserves only the final destination", () => {
    const game = createGame();
    game.start();
    game.elements.get("game").emit("mousedown", {
        button: 2, buttons: 2, clientX: 700, clientY: 360, preventDefault() {}
    });
    game.advance(50);
    assert.equal(game.run("player.x"), 649);
    game.window.emit("mousemove", { buttons: 2, clientX: 649, clientY: 420 });
    game.advance(50);
    assert.equal(game.run("player.x"), 649);
    assert.equal(game.run("player.y"), 369);
    game.window.emit("mouseup", { button: 2, buttons: 0, clientX: 649, clientY: 390 });
    game.window.emit("mousemove", { buttons: 0, clientX: 1000, clientY: 600 });
    for (let i = 0; i < 3; i++) game.advance(50);
    assert.equal(game.run("player.y"), 390);
    assert.equal(game.run("movement.target"), null);
    assert.equal(game.run("movement.rightButtonDown"), false);
});

test("movement speed is stable across frame rates and outside clicks target the nearest exit", () => {
    for (const frameMs of [1000 / 60, 1000 / 120, 50]) {
        const game = createGame();
        game.start();
        game.rightClick(1000, 360);
        for (let i = 0; i < Math.round(1000 / frameMs); i++) game.advance(frameMs);
        assert.ok(Math.abs(game.run("player.x") - 820) < 0.001);
    }
    const game = createGame();
    game.start();
    game.rightClick(-100, -100);
    assert.deepEqual(game.read("movement.target"), { x: 20, y: 91 });
});

test("pause, hidden tabs, and focus loss cancel movement without restarting it on return", () => {
    const game = createGame();
    game.start();
    for (const interrupt of [
        () => { game.key(" "); game.advance(500); game.key(" "); },
        () => { game.document.hidden = true; game.document.emit("visibilitychange");
            game.advance(500); game.document.hidden = false; game.document.emit("visibilitychange"); },
        () => game.window.emit("blur")
    ]) {
        game.rightClick(1000, 360);
        interrupt();
        game.advance(50);
        assert.equal(game.run("player.x"), 640);
        assert.equal(game.run("movement.target"), null);
        assert.equal(game.run("movement.rightButtonDown"), false);
    }
});

test("Dash arms with 3 and uses left-click while right-click keeps steering; Lure uses 5 and left-click", () => {
    const game = createGame();
    game.start();
    game.run("player.unlocks.dash = true; player.unlocks.lure = true;");
    game.rightClick(1000, 360);
    game.elements.get("game").emit("contextmenu", { preventDefault() {} });
    assert.equal(game.run("player.x"), 640);
    assert.equal(game.run("getCooldownRemainingMs('dash')"), 0);
    assert.equal(game.run("bullets.length"), 0);
    assert.equal(game.run("isLureActive()"), false);
    game.key("3");
    assert.equal(game.run("player.x"), 640);
    assert.equal(game.run("armedAbility"), "dash");
    game.rightClick(1000, 360);
    assert.equal(game.run("abilityState.dash.remainingMs"), 0);
    assert.equal(game.run("armedAbility"), "dash");
    assert.deepEqual(game.read("movement.target"), { x: 1000, y: 360 });
    game.leftClick(1000, 360);
    assert.equal(game.run("getCooldownRemainingMs('dash')"), 2000);
    for (let i = 0; i < 4; i++) game.advance(50);
    assert.ok(Math.abs(game.run("player.x") - 780) < 0.00001);
    assert.equal(game.run("movement.target"), null);
    assert.equal(game.run("getCooldownRemainingMs('dash')"), 1800);
    game.key("3");
    assert.ok(Math.abs(game.run("player.x") - 780) < 0.00001);
    game.key("5");
    game.leftClick();
    assert.deepEqual(game.read("getMonsterTarget()"), { x: 800, y: 400 });
});

test("Lure is free from the start, plants at the cursor, lasts ten seconds, and recharges in sixty", () => {
    const game = createGame();
    game.start();
    game.key("5");
    assert.equal(game.run("isLureActive()"), false);
    assert.equal(game.run("player.seeds"), 0);
    assert.equal(game.run("armedAbility"), "lure");
    game.leftClick();
    assert.deepEqual(game.read("getMonsterTarget()"), { x: 800, y: 400 });
    game.rightClick(1000, 360);
    game.advance(50);
    assert.equal(game.run("player.x"), 649);
    assert.equal(game.run("getMonsterTarget().x"), 800);
    game.advance(9949);
    assert.equal(game.run("isLureActive()"), true);
    assert.equal(game.elements.get("lureCooldownText").textContent, "◆ Active · 1s");
    game.advance(1);
    assert.equal(game.run("abilityState.lure.point"), null);
    assert.equal(game.run("getMonsterTarget().x"), game.run("player.x"));
    assert.equal(game.run("getCooldownRemainingMs('lure')"), 50000);
    game.key("5");
    assert.equal(game.run("isLureActive()"), false);
    game.advance(50000);
    game.key("5");
    game.leftClick();
    assert.equal(game.run("isLureActive()"), true);
    assert.equal(game.run("getMonsterTarget().x"), 800);
});

test("specialty timers pause while paused and inputs do not conflict with UI or browser shortcuts", () => {
    const game = createGame();
    game.start();
    game.run("player.unlocks.lure = true; player.unlocks.energyShield = true; player.unlocks.timeFreeze = true;");
    game.key("5", { ctrlKey: true });
    game.key("5", { repeat: true });
    assert.equal(game.run("isLureActive()"), false);
    game.key(" ", { target: { closest: selector => selector === "button" ? {} : null } });
    assert.equal(game.run("isEnergyShieldActive()"), false);
    game.key(" ");
    game.key("5"); game.leftClick();
    game.key("2");
    game.key("4");
    game.key(" ");
    game.advance(120000);
    assert.equal(game.run("getCooldownRemainingMs('lure')"), 60000);
    assert.equal(game.run("isLureActive() && isEnergyShieldActive() && isTimeFreezeActive()"), true);
    game.key("3");
    assert.equal(game.run("player.x"), 640);
    game.key(" ");
    game.advance(2000);
    assert.equal(game.run("isEnergyShieldActive()"), false);
    assert.equal(game.run("isLureActive()"), true);
});

test("rake effects have no stats purchase buttons and unlock only through mystery rewards",()=>{
 const game=createCombatGame();game.run("player.seeds=100000");
 assert.equal(game.upgradeButtons.some(b=>b.dataset.repeatable==="false"),false);
 for(const name of ["piercingRound","knockback","explosiveKernel","ricochet"]){
  assert.equal(game.run(`purchaseUpgrade('${name}')`),false);
  assert.equal(game.elements.get("effectState-"+name).textContent,"Locked");
  game.run(`getMysteryBonuses().find(b=>b.id==='${name}').apply();updateStatsPanel()`);
  assert.equal(game.elements.get("effectState-"+name).textContent,"Unlocked");
 }
 assert.equal(game.run("player.seeds"),100000);
 assert.equal(game.elements.get("rakeEffectsCount").textContent,"4/4");
});

test("stats update after purchases and collapse/expand without changing the game", () => {
    const game = createGame();
    game.start();
    assert.equal(game.elements.get("statsPanel").hidden, false);
    assert.equal(game.elements.get("statsPanel").style.top, "102px");
    assert.equal(game.elements.get("statSpeed").textContent, "180/s");
    game.run("player.seeds = 1000;");
    assert.equal(game.upgradeButtons.find(button => button.dataset.upgrade === "speed"), undefined);
    assert.equal(game.run("upgradeLevels.speed"), undefined);
    for (const upgrade of ["maxHealth", "damage", "bulletSpeed", "criticalChance"]) {
        game.upgradeButtons.find(button => button.dataset.upgrade === upgrade).emit("click");
    }
    assert.equal(game.elements.get("statSpeed").textContent, "180/s");
    assert.equal(game.elements.get("statHealth").textContent, "102 / 102");
    assert.equal(game.elements.get("statDamage").textContent, "8.3");
    assert.equal(game.elements.get("statBulletSpeed").textContent, "612/s");
    assert.equal(game.elements.get("statCriticalChance").textContent, "0.45%");
    assert.equal(game.elements.get("statWeaponEffects").textContent, "None");
    const button = game.elements.get("statsToggle");
    button.emit("click");
    assert.equal(button.textContent, "Stats +");
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(game.elements.get("statsContent").hidden, true);
    button.emit("click");
    assert.equal(button.textContent, "Stats -");
    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.equal(game.run("gameClock.paused"), false);
});

test("all repeatable stats upgrades increase values and prices without casting an armed ability", () => {
 const game=createCombatGame(); game.run("player.seeds=5000"); game.key("1");
 assert.deepEqual(game.upgradeButtons.filter(b=>b.dataset.repeatable==="true").map(b=>b.dataset.upgrade),["maxHealth","moveSpeed","damage","bulletSpeed","fireRate","criticalChance","seedValue","cooldown-teleport","cooldown-energyShield","cooldown-dash","cooldown-timeFreeze","cooldown-lure","cooldown-rakeFrenzy"]);
 for(const b of game.upgradeButtons.filter(b=>b.dataset.repeatable==="true")){
   const cost=Number(b.dataset.cost),before=game.run("player.seeds"); b.emit("click");
   assert.equal(game.run("player.seeds"),before-cost); assert.equal(Number(b.dataset.cost),Math.ceil(cost*1.1));
   assert.equal(game.run("armedAbility"),"teleport");
 }
 assert.equal(game.run("player.maxHealth"),102); assert.equal(game.run("player.damage"),8.3);
 assert.equal(game.run("getRake().damage"),12,"basic upgrades do not change rake damage");
});

test("stats purchases work while paused but cannot overspend or run in a hidden or ended game", () => {
    const game = createCombatGame();
    const button = game.elements.get("upgradeDamage");
    game.run("player.seeds = 1; updateStatsPanel();");
    assert.equal(button.getAttribute("aria-disabled"), "true");
    button.emit("click");
    assert.equal(game.run("player.seeds"), 1);
    assert.equal(game.run("upgradeLevels.damage"), 0);
    game.run("player.seeds = 2; updateStatsPanel();");
    assert.equal(button.getAttribute("aria-disabled"), "false");
    button.emit("click"); button.emit("click");
    assert.equal(game.run("player.seeds"), 0);
    assert.equal(game.run("upgradeLevels.damage"), 1);
    game.run("player.seeds = 1000;");
    game.key(" ");
    assert.equal(button.getAttribute("aria-disabled"), "false");
    button.emit("click");
    assert.equal(game.run("player.seeds"), 997);
    assert.equal(game.run("upgradeLevels.damage"), 2);
    game.key(" "); game.document.hidden = true; game.document.emit("visibilitychange"); button.emit("click");
    assert.equal(game.run("player.seeds"), 997);
    game.document.hidden = false; game.document.emit("visibilitychange");
    game.run("player.health = 0; endGame();"); button.emit("click");
    assert.equal(game.run("player.seeds"), 997);
});

test("all stats purchases apply during pause while time, actors and cooldowns remain frozen", () => {
    const game = createCombatGame();
    game.run("player.seeds = 2000; weaponState.nextShotAt = gameClock.elapsedMs + 2000; placeMonster('crawler', 1000, 300);");
    game.key("2");
    game.elements.get("pauseBtn").emit("click");
    const snapshot = "({ time: gameClock.elapsedMs, x: player.x, y: player.y, monsters, bullets })";
    const paused = game.read(snapshot);
    let spent = 0;
    for (const button of game.upgradeButtons) {
        const cost = Number(button.dataset.cost);
        assert.equal(button.getAttribute("aria-disabled"), "false");
        button.emit("click");
        spent += cost;
        assert.equal(game.run("player.seeds"), 2000 - spent);
        game.advance(2000);
        assert.deepEqual(game.read(snapshot), paused);
    }
    assert.equal(game.run("player.maxHealth"), 102);
    assert.equal(game.run("player.damage"), 8.3);
    assert.equal(game.run("player.bulletSpeed"), 10.2);
    assert.ok(Math.abs(game.run("player.fireRate") - 0.77) < 1e-9);
    assert.equal(game.run("player.criticalChance"), 0.0045);
    assert.equal(game.run("player.seedMultiplier"),1.015);
    assert.equal(game.run("weaponState.nextShotAt - gameClock.elapsedMs"), 2000 / (game.run("player.fireRate") / 0.75));
    game.elements.get("pauseBtn").emit("click");
    game.advance(1940);
    assert.equal(game.run("bullets.length"), 0);
    game.advance(20);
    assert.equal(game.run("bullets.length"), 1, "resuming uses the upgraded fire rate");
    assert.equal(game.run("bullets[0].damage"), 8.3);
});

test("all five abilities are free and ready on the first HUD click or number-key press", () => {
    for (const [name, id, title, key] of [
        ["teleport", "abilityTeleport", "Teleport", "1"], ["energyShield", "abilityEnergyShield", "Energy Shield", "2"],
        ["dash", "abilityDash", "Dash", "3"], ["timeFreeze", "abilityTimeFreeze", "Time Freeze", "4"], ["lure", "abilityLure", "Lure", "5"]
    ]) for (const input of ["hud", "keyboard"]) {
        const game = createCombatGame();
        const hud = game.elements.get(id), shop = game.upgradeButtons.find(b => b.dataset.upgrade === name);
        const instant = ["energyShield", "timeFreeze"].includes(name);
        assert.equal(shop, undefined, "free abilities must not be purchasable");
        assert.equal(hud.getAttribute("aria-label"), key + ": " + title);
        assert.ok(html.includes(' ' + title + '</span>'));
        assert.equal(game.run(`abilityHud.${name}.cooldownText.textContent`), instant ? "✓ Ready" : "✓ Ready");
        assert.equal(hud.getAttribute("aria-disabled"), "false");
        assert.equal(game.run(`player.unlocks.${name}`), true);
        assert.equal(game.run("player.seeds"), 0);
        assert.equal(game.run(`getCooldownRemainingMs('${name}')`), 0);
        if (input === "hud") hud.emit("click");
        else game.key(key);
        assert.equal(game.run("armedAbility"), instant ? null : name);
        if (instant) assert.ok(game.run(`abilityState.${name}.activeUntil > gameClock.elapsedMs`));
        else game.leftClick(900, 500);
        assert.ok(game.run(`getCooldownRemainingMs('${name}')`) > 0);
        assert.equal(game.run(`purchaseUpgrade('${name}')`), false);
        assert.equal(game.run("player.seeds"), 0);
    }
});

test("stats purchases and free abilities coexist with steering",()=>{
 const game=createCombatGame();game.run("player.seeds=1000");game.rightClick(1000,400);
 const movement=game.read("movement.target");game.elements.get("upgradeMaxHealth").emit("click");
 assert.deepEqual(game.read("movement.target"),movement);
 game.elements.get("abilityTeleport").emit("click");
 assert.equal(game.run("armedAbility"),"teleport");assert.equal(game.run("player.seeds"),994);
});

test("WASD moves in all directions, normalizes diagonals, and stops on key release", () => {
    const game = createGame();
    game.start();
    for (const [key, dx, dy] of [["w", 0, -9], ["a", -9, 0], ["s", 0, 9], ["d", 9, 0]]) {
        const before = game.read("({ x: player.x, y: player.y })");
        game.key(key);
        game.advance(50);
        assert.equal(game.run("player.x"), before.x + dx);
        assert.equal(game.run("player.y"), before.y + dy);
        game.releaseKey(key);
        game.advance(50);
        assert.equal(game.run("player.x"), before.x + dx);
        assert.equal(game.run("player.y"), before.y + dy);
    }
    game.key("w");
    game.key("d");
    game.advance(50);
    assert.ok(Math.abs(game.run("Math.hypot(player.x - 640, player.y - 360)") - 9) < 0.001);
    game.key("a");
    game.key("s");
    const position = game.read("({ x: player.x, y: player.y })");
    game.advance(50);
    assert.deepEqual(game.read("({ x: player.x, y: player.y })"), position);
    game.window.emit("blur");
    assert.equal(game.run("movement.keys.size"), 0);
});

test("WASD cancels a click target, and held-right-button steering resumes after WASD", () => {
    const game = createGame();
    game.start();
    game.rightClick(1000, 360);
    game.key("w");
    game.advance(50);
    assert.equal(game.run("movement.target"), null);
    assert.equal(game.run("player.x"), 640);
    assert.equal(game.run("player.y"), 351);
    game.releaseKey("w");
    game.advance(50);
    assert.equal(game.run("player.y"), 351);

    game.elements.get("game").emit("mousedown", {
        button: 2, buttons: 2, clientX: 1000, clientY: 360, preventDefault() {}
    });
    game.key("a");
    game.window.emit("mousemove", { buttons: 2, clientX: 1000, clientY: 500 });
    game.advance(50);
    assert.equal(game.run("player.x"), 631);
    assert.equal(game.run("movement.target"), null);
    game.releaseKey("a");
    assert.deepEqual(game.read("movement.target"), { x: 1000, y: 500 });
    game.advance(50);
    assert.ok(game.run("player.x > 631 && player.y > 351"));
});

test("WASD can enter the edge strip and does not remain held after manual or visibility pauses", () => {
    const game = createGame();
    game.start();
    game.run("player.x = 33; player.y = 125;");
    game.key("w");
    game.key("a");
    game.advance(50);
    const position = game.read("({ x: player.x, y: player.y })");
    assert.ok(Math.abs(position.x - (33 - 9 / Math.SQRT2)) < 0.00001);
    assert.ok(Math.abs(position.y - (125 - 9 / Math.SQRT2)) < 0.00001);
    game.key(" ");
    assert.equal(game.run("movement.keys.size"), 0);
    game.key("d");
    game.key(" ");
    game.advance(50);
    assert.equal(game.run("player.x"), position.x);
    game.key("d");
    game.document.hidden = true;
    game.document.emit("visibilitychange");
    game.document.hidden = false;
    game.document.emit("visibilitychange");
    game.advance(50);
    assert.equal(game.run("player.x"), position.x);
});

test("basic attack waits for enemies, aims automatically, and keeps rake-only effects separate", () => {
    const game = createCombatGame();
    game.run("weaponState.nextShotAt = 0; updateAutomaticShooting()");
    assert.equal(game.run("bullets.length"), 0);
    assert.equal(game.elements.get("statFireRate").textContent, "0.75/s");
    game.run("const target = placeMonster('brute', 1000, 360); target.speed = 0; target.health = 10000;");
    game.window.emit("mousemove", { buttons: 0, clientX: 10, clientY: 360 });
    game.advance(150);
    assert.equal(game.run("bullets.length"), 1);
    assert.equal(game.run("bullets[0].dx"), 10);
    assert.equal(game.run("bullets[0].dy"), 0);
    game.advance(1183);
    assert.equal(game.run("bullets.length"), 1);
    game.advance(1);
    assert.equal(game.run("bullets.length"), 2);
    game.run("player.criticalChance = 1; player.damage = 25; player.bulletSpeed = 12; player.unlocks.piercingRound = true; player.unlocks.knockback = true; player.unlocks.explosiveKernel = true; target.x = 640; target.y = 600;");
    game.advance(2000);
    assert.equal(game.run("bullets.at(-1).dy"), 12);
    assert.equal(game.run("bullets.at(-1).damage"), 50);
    assert.equal(game.run("bullets.at(-1).critical && !bullets.at(-1).piercing && !bullets.at(-1).knockback && !bullets.at(-1).explosive"), true);
    game.run("target.x = player.x; target.y = player.y; weaponState.nextShotAt = 0; updateAutomaticShooting()");
    assert.ok(game.run("bullets.every(b => Number.isFinite(b.dx) && Number.isFinite(b.dy))"));
});

test("automatic fire pauses with the game and never queues a burst after a stall", () => {
    const game = createCombatGame();
    game.run("const target = placeMonster('brute', 100, 360); target.speed = 0; target.health = 10000; weaponState.nextShotAt = 0; updateAutomaticShooting();");
    game.key(" ");
    game.window.emit("mousemove", { buttons: 0, clientX: 100, clientY: 360 });
    game.advance(60000);
    assert.equal(game.run("bullets.length"), 1);
    game.key(" ");
    game.document.hidden = true;
    game.document.emit("visibilitychange");
    game.advance(60000);
    assert.equal(game.run("bullets.length"), 1);
    game.document.hidden = false;
    game.document.emit("visibilitychange");
    game.advance(1333);
    assert.equal(game.run("bullets.length"), 1);
    game.advance(1);
    assert.equal(game.run("bullets.length"), 2);
    assert.equal(game.run("bullets.at(-1).dx"), -10);
    assert.equal(game.run("bullets.at(-1).dy"), 0);
    game.advance(60000);
    assert.equal(game.run("bullets.length"), 3);
    game.advance(1);
    assert.equal(game.run("bullets.length"), 3);
});

test("automatic fire continues during movement and old bullets leave the map", () => {
    const game = createCombatGame();
    game.run("const target = placeMonster('brute', 640, 100); target.speed = 0; target.health = 10000; weaponState.nextShotAt = 0;");
    game.key("d");
    game.window.emit("mousemove", { buttons: 0, clientX: 640, clientY: 0 });
    for (let i = 0; i < 120; i++) game.advance(50);
    assert.ok(Math.abs(game.run("player.x") - 1260) < 0.001);
    assert.ok(game.run("bullets.length > 0 && bullets.length < 15"));
    assert.ok(game.run("bullets.at(-1).dx < 0 && bullets.at(-1).dy < 0"));
});

test("number keys 1–5 select or activate specialties and the former hotkeys do not", () => {
    const game = createGame();
    game.start();
    game.run("for (const name of Object.keys(abilityState)) player.unlocks[name] = true;");
    game.window.emit("mousemove", { buttons: 0, clientX: 800, clientY: 400 });
    for (const key of ["Shift", "p", "r", "e", "f", "l"]) game.key(key);
    assert.equal(game.run("armedAbility"), null);
    assert.equal(game.run("isEnergyShieldActive() || isTimeFreezeActive() || isLureActive()"), false);
    assert.equal(game.run("player.x"), 640);
    game.key("1");
    assert.equal(game.run("armedAbility"), "teleport");
    game.key("1", { repeat: true });
    assert.equal(game.run("player.x"), 640);
    game.leftClick(800, 400);
    assert.equal(game.run("player.x"), 800);
    game.key("2");
    assert.equal(game.run("isEnergyShieldActive()"), true);
    game.window.emit("mousemove", { buttons: 0, clientX: 1000, clientY: 400 });
    game.key("3");
    game.leftClick(1000, 400);
    for (let i = 0; i < 4; i++) game.advance(50);
    assert.ok(Math.abs(game.run("player.x") - 940) < 0.00001);
    game.key("4");
    assert.equal(game.run("isTimeFreezeActive()"), true);
    game.key("5"); game.leftClick();
    assert.deepEqual(game.read("getMonsterTarget()"), { x: 800, y: 400 });
});

test("the movement path starts at the current player position and disappears when steering changes", () => {
    const game = createGame();
    game.start();
    game.rightClick(1000, 500);
    game.advance(50);
    const position = game.read("({ x: player.x, y: player.y })");
    game.drawing.length = 0;
    game.run("drawMovementTarget()");
    assert.ok(game.drawing.some(call => call.name === "moveTo" && call.args[0] === position.x && call.args[1] === position.y));
    assert.ok(game.drawing.some(call => call.name === "lineTo" && call.args[0] === 1000 && call.args[1] === 500));
    game.key("w");
    game.drawing.length = 0;
    game.run("drawMovementTarget()");
    assert.equal(game.drawing.length, 0);
});

test("Fire Rate is repeatable, costs seeds, updates stats, and speeds up the pending shot", () => {
    const game = createCombatGame();
    game.run("const target = placeMonster('brute', 1000, 360); target.speed = 0; target.health = 10000; weaponState.nextShotAt = 0; updateAutomaticShooting();");
    const button = game.upgradeButtons.find(item => item.dataset.upgrade === "fireRate");
    assert.ok(button);
    assert.equal(button.dataset.repeatable, "true");
    assert.equal(game.run("player.fireRate"), 0.75);
    button.emit("click");
    assert.equal(game.run("upgradeLevels.fireRate"), 0);
    assert.equal(game.run("player.fireRate"), 0.75);

    game.advance(300);
    game.run("player.seeds = 8;");
    button.emit("click");
    assert.equal(game.run("player.seeds"), 6);
    assert.equal(game.run("upgradeLevels.fireRate"), 1);
    assert.equal(game.elements.get("statFireRate").textContent, "0.77/s");
    assert.equal(Number(button.dataset.cost), 3);
    game.advance(1006);
    assert.equal(game.run("bullets.length"), 1);
    game.advance(1);
    assert.equal(game.run("bullets.length"), 2);

    button.emit("click");
    assert.equal(game.run("player.seeds"), 3);
    assert.equal(game.run("upgradeLevels.fireRate"), 2);
    assert.ok(Math.abs(game.run("player.fireRate") - 0.79) < 0.000001);
    assert.equal(game.elements.get("statFireRate").textContent, "0.79/s");
    assert.equal(Number(button.dataset.cost), 4);
    assert.equal(button.disabled, false);
    button.emit("click");
    assert.equal(game.run("player.seeds"), 3);
    assert.equal(game.run("upgradeLevels.fireRate"), 2);
});

test("monsters spawn only at the right edge, safely away from the player, with a population cap", () => {
    const game = createGame();
    assert.equal(game.run("monsters.length"), 0);
    game.start();
    assert.equal(game.run("monsters.length"), 1);
    game.run("monsters.length = 0; for (let i = 0; i < 8; i++) spawnMonster();");
    const spawned = game.read("monsters");
    for (const monster of spawned) {
        assert.ok(Math.hypot(monster.x - 640, monster.y - 360) >= 120);
        assert.equal(monster.edge, "right");
        assert.equal(monster.x, 1280 + monster.radius + 4);
    }
    game.run("for (let i = 0; i < 100; i++) spawnMonster();");
    assert.equal(game.run("monsters.length"), 60);
});

test("fast skitters and slow brutes have different HP and later spawns become tougher and more frequent", () => {
    const game = createCombatGame();
    game.run(`
        const crawler = placeMonster("crawler", 100, 350);
        const skitter = placeMonster("skitter", 300, 350);
        const brute = placeMonster("brute", 500, 350);
        player.x = 900; player.y = 350;
        updateMonsters(50);
    `);
    assert.ok(game.run("skitter.x - 300 > crawler.x - 100 && crawler.x - 100 > brute.x - 500"));
    assert.ok(game.run("brute.health > crawler.health && crawler.health > skitter.health"));
    const early = game.read("getMonsterDifficulty(0)");
    assert.deepEqual(game.read("getMonsterDifficulty(29999)"), early);
    const later = game.read("getMonsterDifficulty(120000)");
    assert.ok(later.healthScale > early.healthScale && later.damageScale > early.damageScale);
    assert.ok(later.speedScale > early.speedScale && later.spawnIntervalMs < early.spawnIntervalMs);
    game.run("gameClock.elapsedMs = 120000; const lateCrawler = spawnMonster('crawler', 'right');");
    assert.equal(game.run("lateCrawler.health"), 84);
    assert.equal(game.run("crawler.health"), 28, "existing HP should not jump at a difficulty boundary");
    assert.ok(game.run("lateCrawler.speed > crawler.speed && lateCrawler.damage > crawler.damage"));
    assert.equal(game.run("getMonsterDifficulty(3600000).spawnIntervalMs"), 450);
    assert.ok(game.run("getMonsterDifficulty(3600000).speedScale * monsterTypes.skitter.speed < player.speed * 60"));
});

test("monster spawning and pursuit pause while paused and hidden tabs without overdue spawn bursts", () => {
    const game = createGame();
    game.start();
    const before = game.read("monsters");
    game.advance(1000);
    assert.equal(game.run("monsters.length"), 1);
    assert.notDeepEqual(game.read("monsters"), before);
    game.key(" ");
    const paused = game.read("({ monsters, next: monsterState.nextSpawnAt, time: gameClock.elapsedMs })");
    game.advance(300000);
    assert.deepEqual(game.read("({ monsters, next: monsterState.nextSpawnAt, time: gameClock.elapsedMs })"), paused);
    game.key(" ");
    game.document.hidden = true;
    game.document.emit("visibilitychange");
    game.advance(300000);
    assert.deepEqual(game.read("({ monsters, next: monsterState.nextSpawnAt, time: gameClock.elapsedMs })"), paused);
    game.document.hidden = false;
    game.document.emit("visibilitychange");
    game.advance(0);
    assert.equal(game.run("monsters.length"), 1);
    game.advance(60000);
    assert.equal(game.run("monsters.length"), 2, "a stalled frame should add only one spawn");
});

test("every monster follows Lure for ten seconds, then returns to chasing the player", () => {
    const game = createCombatGame();
    game.run(`
        player.x = 250; player.y = 350;
        player.unlocks.lure = true;
        mouse.x = 250; mouse.y = 350;
        useLure();
        player.x = 900;
        placeMonster("crawler", 600, 200);
        placeMonster("skitter", 600, 350);
        placeMonster("brute", 600, 500);
        updateMonsters(50);
    `);
    assert.ok(game.run("monsters.every(m => m.x < 600)"));
    game.run("gameClock.elapsedMs = 10000; const beforeExpiry = monsters.map(m => m.x); updateMonsters(50);");
    assert.ok(game.run("monsters.every((m, i) => m.x > beforeExpiry[i])"));
});

test("Lure's violet marker follows the cursor when readied by HUD or key, then plants at the map click", () => {
    for (const input of ["button", "key"]) {
        const game = createCombatGame();
        game.run("player.unlocks.lure = true;");
        if (input === "button") game.elements.get("abilityLure").emit("click"); else game.key("5");
        game.window.emit("mousemove", { clientX: 930, clientY: 480, buttons: 0 });
        game.drawing.length = 0; game.run("drawAbilityPreview()");
        assert.ok(game.drawing.some(c => c.name === "fillText" && c.args[0] === "✦" && c.args[1] === 930 && c.args[2] === 480));
        assert.equal(game.run("abilityState.lure.point"), null);
        assert.equal(game.run("getCooldownRemainingMs('lure')"), 0);
        game.leftClick(880, 520);
        assert.deepEqual(game.read("abilityState.lure.point"), { x: 880, y: 520 });
        assert.deepEqual(game.read("({ x: player.x, y: player.y })"), { x: 640, y: 360 });
        assert.equal(game.run("armedAbility"), null);
        assert.equal(game.run("getCooldownRemainingMs('lure')"), 60000);
        game.window.emit("mousemove", { clientX: 300, clientY: 250, buttons: 0 });
        assert.deepEqual(game.read("getMonsterTarget()"), { x: 880, y: 520 });
    }
});

test("Lure rejects walls without consuming its cooldown or ready state, then accepts open ground", () => {
    const game = createCombatGame();
    game.run("player.unlocks.lure = true; walls.push({ x: 800, y: 400, width: 90, height: 90 });");
    game.key("5"); game.leftClick(850, 450);
    assert.equal(game.run("armedAbility"), "lure");
    assert.equal(game.run("abilityState.lure.point"), null);
    assert.equal(game.run("getCooldownRemainingMs('lure')"), 0);
    game.drawing.length = 0; game.run("drawAbilityPreview()");
    assert.ok(game.drawing.some(c => c.name === "fillText" && c.args[0] === "Choose open ground"));
    game.leftClick(900, 550);
    assert.deepEqual(game.read("abilityState.lure.point"), { x: 900, y: 550 });
});

test("all six enemy types, including a rushing Charger, chase a cursor-placed Lure and retarget on expiry", () => {
    const game = createCombatGame();
    game.run(`
        player.x = 900; player.y = 350; player.unlocks.lure = true;
        mouse.x = 250; mouse.y = 350; useLure();
        Object.keys(monsterTypes).filter(type => type !== 'boss').forEach((type, i) => placeMonster(type, 600, 150 + i * 85));
        monsters.find(m => m.type === 'charger').chargePhase = 'rush';
        updateMonsters(50);
    `);
    assert.ok(game.run("monsters.every(m => m.x < 600)"));
    game.run("gameClock.elapsedMs = 10000; const before = monsters.map(m => m.x); updateMonsters(50);");
    assert.ok(game.run("monsters.every((m, i) => m.x > before[i])"));
});

test("stronger monster types enter progressively and become more common later", () => {
    const game = createCombatGame();
    const expected = [
        [0, ["crawler", "skitter", "brute"]],
        [30000, ["crawler", "skitter", "brute", "stalker"]],
        [60000, ["crawler", "skitter", "brute", "stalker", "shellback"]],
        [90000, ["crawler", "skitter", "brute", "stalker", "shellback", "charger"]]
    ];
    for (const [time, types] of expected) {
        game.run(`gameClock.elapsedMs = ${time};`);
        assert.deepEqual(game.read("getMonsterSpawnPool().map(t => t.name)"), types);
        const sampled = new Set(game.read("Array.from({length: 1000}, () => randomMonsterType())"));
        assert.deepEqual([...sampled].sort(), [...types].sort());
    }
    assert.ok(game.run("getMonsterSpawnPool(20).filter(t => monsterTypes[t.name].minTier > 0).reduce((n,t) => n + t.weight, 0) > getMonsterSpawnPool(3).filter(t => monsterTypes[t.name].minTier > 0).reduce((n,t) => n + t.weight, 0)"));
    game.run("gameClock.elapsedMs = 0; const shell = placeMonster('shellback', 800, 400); const hunter = placeMonster('stalker', 950, 400); drawMonsters();");
    assert.equal(game.run("shell.health"), 120);
    assert.ok(game.run("hunter.speed > monsterTypes.skitter.speed"));
    assert.ok(game.drawing.some(c => c.name === "fillText" && c.args[0] === "Shellback"));
    assert.ok(game.drawing.some(c => c.name === "fillText" && c.args[0] === "120/120"));
});

test("later waves grow in health, damage and frequency, with bounded packs and no overdue spawn flood", () => {
    const game = createCombatGame();
    let previous;
    for (const ms of [0, 30000, 120000, 240000, 600000, 3600000]) {
        const tier = game.read(`getMonsterDifficulty(${ms})`);
        if (previous) {
            assert.ok(tier.healthScale > previous.healthScale && tier.damageScale > previous.damageScale);
            assert.ok(tier.spawnIntervalMs <= previous.spawnIntervalMs);
        }
        assert.ok(tier.packSize >= 1 && tier.packSize <= 3);
        assert.ok(Number.isFinite(tier.healthScale) && tier.spawnIntervalMs >= 450);
        previous = tier;
    }
    for (const [time, count] of [[0, 1], [120000, 2], [240000, 3]]) {
        game.run(`gameClock.elapsedMs = ${time}; monsters.length = 0; monsterState.nextSpawnAt = 0; updateMonsterSpawning();`);
        assert.equal(game.run("monsters.length"), count);
        game.run("updateMonsterSpawning()");
        assert.equal(game.run("monsters.length"), count);
    }
    game.run("monsters.length = 0; for (let i=0; i<59; i++) spawnMonster('crawler'); monsterState.nextSpawnAt = 0; updateMonsterSpawning();");
    assert.equal(game.run("monsters.length"), 60);
});

test("Chargers warn before rushing, pause their attack during Freeze, and cannot rush through walls", () => {
    const game = createCombatGame();
    game.run("const charger = placeMonster('charger', 850, 350); charger.chargeElapsedMs = 1750; updateMonsters(50);");
    assert.equal(game.run("charger.chargePhase"), "windup");
    assert.equal(game.run("charger.x"), 850);
    for (let i = 0; i < 8; i++) game.run("updateMonsters(50)");
    assert.equal(game.run("charger.x"), 850);
    game.run("updateMonsters(50)");
    assert.equal(game.run("charger.chargePhase"), "rush");
    assert.ok(game.run("850 - charger.x > charger.speed * 0.05"));
    const frozen = game.read("charger");
    game.run("abilityState.timeFreeze.activeUntil = Infinity; updateMonsters(50)");
    assert.deepEqual(game.read("charger"), frozen);
    game.run("abilityState.timeFreeze.activeUntil = 0; walls.push({x: 750, y: 200, width: 30, height: 300}); charger.x = 800; charger.y = 350;");
    for (let i = 0; i < 5; i++) {
        game.run("updateMonsters(50)");
        assert.equal(game.run("bodyTouchesWall(charger.x, charger.y, charger.radius)"), false);
        assert.ok(game.run("charger.x >= 800 - 0.001"));
    }
    for (let i = 0; i < 5; i++) game.run("updateMonsters(50)");
    assert.equal(game.run("charger.chargePhase"), "pursuit");
});

test("Time Freeze stops pursuit and contact damage while Shield prevents damage until it expires", () => {
    const game = createCombatGame();
    game.run(`
        const enemy = placeMonster("crawler", player.x - 30, player.y);
        player.unlocks.timeFreeze = true;
        useTimeFreeze();
    `);
    const frozen = game.read("enemy");
    game.advance(1000);
    assert.deepEqual(game.read("enemy"), frozen);
    assert.equal(game.run("player.health"), 100);
    game.advance(2000);
    assert.equal(game.run("player.health"), 92);
    game.run("player.unlocks.energyShield = true; useEnergyShield();");
    game.advance(1500);
    assert.equal(game.run("player.health"), 92);
    game.advance(500);
    assert.equal(game.run("player.health"), 84);
});

test("bullet hits reduce each HP bar, and kills award XP exactly once without seeds", () => {
    const game = createCombatGame();
    game.run("const enemy = placeMonster('crawler', 200, 400); testBullet(100, 400, 100); updateBullets(); drawMonsters();");
    assert.equal(game.run("enemy.health"), 18);
    assert.equal(game.run("bullets.length"), 0);
    assert.ok(game.drawing.some(call => call.name === "fillText" && call.args[0] === "18/28"));
    assert.ok(game.drawing.some(call => call.name === "fillRect" && call.args[3] === 5
        && Math.abs(call.args[2] - 44 * 18 / 28) < 0.00001));
    game.run("testBullet(100, 400, 100); updateBullets(); damageMonster(enemy, 50);");
    assert.equal(game.run("monsters.length"), 0);
    assert.equal(game.run("monsterState.defeated"), 1);
    assert.equal(game.run("player.seeds"), 0);
    assert.equal(Number(game.elements.get("seedHudCount").textContent), 0);
    assert.equal(game.run("player.xp"), 12);
    assert.equal(game.run("collectionEffects.length"), 1);
});

test("fast bullets hit the nearest crossed enemy even if the bullet exits the canvas in that frame", () => {
    const game = createCombatGame();
    game.run(`
        const far = placeMonster("brute", 900, 400);
        const near = placeMonster("crawler", 300, 400);
        testBullet(100, 400, 2000);
        updateBullets();
    `);
    assert.equal(game.run("near.health"), 18);
    assert.equal(game.run("far.health"), 68);
    assert.equal(game.run("bullets.length"), 0);
});

test("piercing rounds hit at most two unique enemies and cannot damage the same enemy twice", () => {
    const game = createCombatGame();
    game.run(`
        const first = placeMonster("brute", 200, 400);
        const second = placeMonster("brute", 300, 400);
        const third = placeMonster("brute", 400, 400);
        const shot = testBullet(175, 400, 10, { piercing: true });
        updateBullets(); updateBullets();
    `);
    assert.equal(game.run("first.health"), 58);
    assert.equal(game.run("bullets.length"), 1);
    game.run("shot.dx = 500; updateBullets();");
    assert.equal(game.run("first.health"), 58);
    assert.equal(game.run("second.health"), 58);
    assert.equal(game.run("third.health"), 68);
    assert.equal(game.run("bullets.length"), 0);
});

test("knockback pushes monsters away and explosive rounds damage nearby enemies with a fading effect", () => {
    const game = createCombatGame();
    game.run(`
        const direct = placeMonster("brute", 300, 400);
        const nearby = placeMonster("crawler", 320, 450);
        const distant = placeMonster("crawler", 600, 450);
        testBullet(200, 400, 200, { knockback: true, explosive: true, damage: 20 });
        updateBullets();
    `);
    assert.equal(game.run("direct.health"), 48);
    assert.equal(game.run("direct.x"), 324);
    assert.equal(game.run("nearby.health"), 18);
    assert.equal(game.run("distant.health"), 28);
    assert.equal(game.run("combatEffects.length"), 1);
    game.advance(300);
    assert.equal(game.run("combatEffects.length"), 0);
});

test("contact damage has an 800ms grace period and crowds do not damage once per monster per frame", () => {
    const game = createCombatGame();
    game.run(`
        placeMonster("crawler", player.x, player.y);
        placeMonster("brute", player.x, player.y);
        updateMonsterContact(); updateMonsterContact();
    `);
    assert.equal(game.run("player.health"), 85);
    game.advance(799);
    assert.equal(game.run("player.health"), 85);
    game.advance(1);
    assert.equal(game.run("player.health"), 70);
    assert.equal(game.elements.get("healthText").textContent, "70 / 100");
    assert.equal(game.elements.get("statHealth").textContent, "70 / 100");
});

test("zero HP ends the run, stops clock and inputs, and offers a fresh start screen", () => {
    const game = createCombatGame();
    game.run("player.health = 8; placeMonster('crawler', player.x, player.y); monsterState.defeated = 4;");
    game.key("d");
    game.advance(1000);
    assert.equal(game.run("player.health"), 0);
    assert.equal(game.run("gameOver"), true);
    assert.equal(game.elements.get("gameOverDialog").open, true);
    assert.equal(game.elements.get("gameOverTime").textContent, "00:01");
    assert.equal(Number(game.elements.get("gameOverKills").textContent), 4);
    const ended = game.read("({ x: player.x, y: player.y, time: gameClock.elapsedMs, count: monsters.length })");
    game.key(" ");
    game.key("w");
    game.rightClick(900, 500);
    game.run("player.unlocks.lure = true; useLure();");
    game.document.emit("visibilitychange");
    game.advance(100000);
    assert.deepEqual(game.read("({ x: player.x, y: player.y, time: gameClock.elapsedMs, count: monsters.length })"), ended);
    assert.equal(game.run("manuallyPaused"), false);
    assert.equal(game.run("movement.keys.size"), 0);
    assert.equal(game.run("movement.target"), null);
    assert.equal(game.run("abilityState.lure.point"), null);
    let canceled = false;
    game.elements.get("gameOverDialog").emit("cancel", { preventDefault() { canceled = true; } });
    assert.equal(canceled, true);
    game.elements.get("restartGameBtn").emit("click");
    assert.equal(game.window.reloaded, true);
});

test("resizing keeps monsters near the playable bounds and tiny maps do not spawn new enemies", () => {
    const game = createCombatGame();
    game.run("placeMonster('crawler', 1200, 650); placeMonster('brute', -500, -500);");
    game.window.innerWidth = 400;
    game.window.innerHeight = 600;
    game.window.emit("resize");
    assert.ok(game.run("monsters.every(m => m.x >= -m.radius * 4 && m.x <= 400 + m.radius + 120 && m.y >= gameHudHeight - m.radius && m.y <= 600 + m.radius)"));
    game.window.innerWidth = 90;
    game.window.innerHeight = 100;
    game.window.emit("resize");
    assert.equal(game.run("spawnMonster()"), null);
});

test("gameplay routes pickup, combat, purchase, and specialty transitions to their sound cues", () => {
    const game = createGame();
    game.run("const soundEvents = []; gameAudio.play = name => soundEvents.push(name);");
    game.start();
    game.run("monsters.length = 0; hayStacks.length = 0; monsterState.nextSpawnAt = Infinity; nextHaySpawnAt = Infinity;");
    game.rightClick(900, 360);
    for (let i = 0; i < 5; i++) game.advance(50);
    game.run("hayStacks.push({ x: player.x, y: player.y, seeds: 10, spawnedAt: 0 });");
    game.advance(0);
    game.run("const soundEnemy = spawnMonster('crawler', 'left'); soundEnemy.x = 1000; soundEnemy.y = 360; weaponState.nextTargetSearchAt = 0; updateAutomaticShooting(); damageMonster(soundEnemy, 5); damageMonster(soundEnemy, 50); player.seeds = 10000;");
    game.upgradeButtons.find(button => button.dataset.upgrade === "damage").emit("click");
    game.run("openMysteryChoice();lootState.choices[0]=getMysteryBonuses().find(b=>b.id==='piercingRound');chooseMysteryBonus(0)");
    game.run("for (const name of Object.keys(abilityState)) player.unlocks[name] = true;");
    game.key("1"); game.leftClick(800, 400);
    game.window.emit("mousemove", { buttons: 0, clientX: 1000, clientY: 500 });
    game.key("2"); game.key("4"); game.key("5"); game.leftClick();
    game.key("3"); game.leftClick(1000, 500);
    for (let i = 0; i < 4; i++) game.advance(50);
    game.advance(10000);
    game.advance(60000);
    game.run("player.health = 0; endGame();");
    const events = game.read("soundEvents");
    for (const cue of ["start", "hay", "spawn", "shot", "move", "collect", "hit", "kill", "purchase", "unlock",
        "marker", "teleport", "shield", "dash", "freeze", "lure", "expire", "ready", "gameOver"]) {
        assert.ok(events.includes(cue), "missing cue: " + cue);
    }
    game.run("soundEvents.length = 0;");
    game.advance(60000);
    assert.deepEqual(game.read("soundEvents"), [], "ended runs should not keep producing gameplay sounds");
});

test("WASD stops at left and right boundaries but wraps vertically with direction intact", () => {
    for (const [key, x, y, expectedX, expectedY] of [
        ["a", 22, 350, 20, 350], ["d", 1258, 350, 1260, 350],
        ["w", 600, 94, 600, 713], ["s", 600, 718, 600, 99]
    ]) {
        const game = createCombatGame();
        game.run(`player.x = ${x}; player.y = ${y};`);
        game.key(key); game.advance(50);
        assert.deepEqual(game.read("({ x: player.x, y: player.y })"), { x: expectedX, y: expectedY });
        assert.equal(game.run("movement.keys.size"), 1);
        assert.equal(game.run("movement.target"), null);
        game.releaseKey(key);
        game.advance(50);
        assert.deepEqual(game.read("({ x: player.x, y: player.y })"), { x: expectedX, y: expectedY });
    }
});

test("corner movement clamps horizontally while vertical wrap preserves speed across frame rates", () => {
    const game = createCombatGame();
    game.run("player.x = 22; player.y = 94;");
    game.key("a"); game.key("w"); game.advance(50);
    assert.equal(game.run("player.x"), 20);
    assert.ok(Math.abs(game.run("player.y") - (722 - 9 / Math.SQRT2)) < 0.00001);
    for (const frameMs of [1000 / 60, 1000 / 120, 50]) {
        const run = createCombatGame();
        run.run("player.x = 600; player.y = 710;");
        run.key("s");
        for (let i = 0; i < Math.round(1000 / frameMs); i++) run.advance(frameMs);
        assert.ok(Math.abs(run.run("player.y") - 262) < 0.00001);
    }
});

test("right-click side destinations stop while vertical destinations wrap once or continue when held", () => {
    for (const [x, y, clickX, clickY, expectedX, expectedY] of [
        [22, 350, 1, 350, 20, 350], [1258, 350, 1279, 350, 1260, 350],
        [600, 94, 600, 93, 600, 719], [600, 718, 600, 719, 600, 93]
    ]) {
        const game = createCombatGame();
        game.run(`player.x = ${x}; player.y = ${y};`);
        game.rightClick(clickX, clickY); game.advance(50);
        assert.deepEqual(game.read("({ x: player.x, y: player.y })"), { x: expectedX, y: expectedY });
        assert.equal(game.run("movement.target"), null);
        game.advance(50);
        assert.deepEqual(game.read("({ x: player.x, y: player.y })"), { x: expectedX, y: expectedY });
    }
    const game = createCombatGame();
    game.run("player.x = 600; player.y = 718;");
    game.elements.get("game").emit("mousedown", { button: 2, buttons: 2, clientX: 600, clientY: 719, preventDefault() {} });
    game.advance(50);
    assert.equal(game.run("player.y"), 93);
    game.advance(50);
    assert.equal(game.run("player.y"), 102);
    assert.equal(game.run("movement.rightButtonDown"), true);
    game.key("w"); game.advance(50);
    assert.equal(game.run("player.y"), 93);
    assert.equal(game.run("movement.target"), null);
});

test("wrap pickups use exit and entry segments without collecting the middle or adding false footsteps", () => {
    const game = createCombatGame();
    game.run(`
        player.x = 600; player.y = 94;
        const footstepDistances = [];
        gameAudio.footsteps = distance => footstepDistances.push(distance);
        hayStacks.push({ x: 600, y: 126, seeds: 5 }, { x: 600, y: 686, seeds: 6 }, { x: 600, y: 350, seeds: 100 });
    `);
    game.key("w"); game.advance(50);
    assert.equal(game.run("player.seeds"), 11);
    assert.equal(game.run("hayStacks.length"), 1);
    assert.equal(game.run("hayStacks[0].y"), 350);
    assert.deepEqual(game.read("footstepDistances"), [9]);
});

test("Dash wraps and only collects its real travel path; held mouse targets and cooldowns stay valid", () => {
    const game = createCombatGame();
    game.run(`
        player.x = 600; player.y = 690; player.unlocks.dash = true;
        hayStacks.push({ x: 600, y: 152, seeds: 5 }, { x: 600, y: 450, seeds: 100 });
    `);
    game.window.emit("mousemove", { buttons: 0, clientX: 600, clientY: 719 });
    game.key("3");
    game.leftClick(600, 719);
    for (let i = 0; i < 4; i++) game.advance(50);
    assert.ok(Math.abs(game.run("player.y") - 202) < 0.00001);
    assert.equal(game.run("player.seeds"), 5);
    assert.equal(game.run("hayStacks[0].y"), 450);
    assert.equal(game.run("getCooldownRemainingMs('dash')"), 1800);
    assert.equal(game.run("movement.target"), null);
});

test("wrap coordinates remain finite after resize and very small map dimensions", () => {
    const game = createCombatGame();
    game.window.innerWidth = 400; game.window.innerHeight = 600;
    game.window.emit("resize");
    game.run("player.x = 398; player.y = 350;");
    game.key("d"); game.advance(50);
    assert.equal(game.run("player.x"), 380);
    game.window.innerWidth = 1; game.window.innerHeight = 1;
    game.window.emit("resize");
    game.key("w"); game.advance(50);
    assert.ok(game.run("Number.isFinite(player.x) && Number.isFinite(player.y) && player.x >= 0 && player.x <= 1 && player.y >= 0 && player.y <= 1"));
});

test("scrolling carries an idle player, terrain, pickups, projectiles, and planted abilities together", () => {
    const game = createGame({ scrolling: true });
    game.start();
    game.run(`
        monsterState.nextSpawnAt = Infinity; nextHaySpawnAt = Infinity; weaponState.nextShotAt = Infinity;
        for (const monster of monsters) monster.speed = 0;
        abilityState.lure.point = { x: 300, y: 400 }; abilityState.lure.activeUntil = Infinity;
        harvestPickups.push({ x: 800, y: 400, spawnedAt: 0 });
        bullets.length = 0; bullets.push({ x: 800, y: 350, dx: 0, dy: 0, size: 4, damage: 10 });
        const original = [player, walls[0], hayStacks[0], monsters[0], bullets[0], abilityState.lure.point, harvestPickups[0]];
        const originalX = original.map(item => item.x);
    `);
    for (let i = 0; i < 20; i++) game.advance(50);
    assert.ok(game.run("original.every((item, i) => Math.abs(item.x - (originalX[i] - 55)) < 0.0001)"));
    assert.equal(game.run("player.y"), 360);
    assert.equal(game.run("player.health"), 100);
});

test("forward steering beats the scroll at consistent speed and the right boundary never wraps", () => {
    for (const frameMs of [50, 1000 / 60, 1000 / 120]) {
        const game = createGame({ scrolling: true });
        game.start();
        game.run("walls.length = 0; worldState.nextWallX = Infinity; monsters.length = 0; monsterState.nextSpawnAt = Infinity;");
        game.key("d");
        for (let i = 0; i < Math.round(1000 / frameMs); i++) game.advance(frameMs);
        assert.ok(Math.abs(game.run("player.x") - 765) < 0.001);
        game.run("player.x = 1259;"); game.advance(50);
        assert.equal(game.run("player.x"), 1260);
    }
});

test("the pause and hidden tabs pause scrolling, damage, and all map objects without a catch-up jump", () => {
    const game = createGame({ scrolling: true });
    game.start(); game.advance(50); game.key(" ");
    const snapshot = "({ scroll: worldState.scroll, walls, x: player.x, health: player.health, hayStacks, monsters })";
    const paused = game.read(snapshot);
    game.advance(120000);
    assert.deepEqual(game.read(snapshot), paused);
    game.key(" ");
    game.document.hidden = true; game.document.emit("visibilitychange");
    game.advance(120000);
    assert.deepEqual(game.read(snapshot), paused);
    game.document.hidden = false; game.document.emit("visibilitychange");
    game.advance(0);
    assert.equal(game.run("worldState.scroll"), paused.scroll);
});

test("death zone drains health on exposure, respects Shield, and ends and freezes a dead run", () => {
    const game = createGame({ scrolling: true }); game.start();
    game.run(`
        walls.length = 0; worldState.nextWallX = Infinity; monsters.length = 0; monsterState.nextSpawnAt = Infinity;
        player.x = getDeathZoneWidth() + player.size / 2 - 1;
    `);
    for (let i = 0; i < 9; i++) game.advance(50);
    assert.equal(game.run("player.health"), 100);
    game.advance(50);
    assert.equal(game.run("player.health"), 92);
    game.run("player.x = 300;"); game.advance(50);
    assert.equal(game.run("worldState.zoneExposure"), 0);
    game.run("player.x = 80; player.unlocks.energyShield = true; useEnergyShield();");
    for (let i = 0; i < 20; i++) game.advance(50);
    assert.equal(game.run("player.health"), 92);
    game.run("abilityState.energyShield.activeUntil = 0; abilityState.timeFreeze.activeUntil = Infinity;");
    for (let i = 0; i < 10; i++) game.advance(50);
    assert.equal(game.run("player.health"), 84, "Time Freeze freezes enemies, not the scrolling hazard");
    game.run("player.health = 4;");
    for (let i = 0; i < 10; i++) game.advance(50);
    assert.equal(game.run("player.health"), 0);
    assert.equal(game.run("gameOver"), true);
    assert.equal(game.elements.get("gameOverDialog").open, true);
    const scroll = game.run("worldState.scroll"); game.advance(10000);
    assert.equal(game.run("worldState.scroll"), scroll);
});

test("walls stop player movement on every face, allow sliding, and prevent Dash tunneling", () => {
    const game = createCombatGame();
    game.run("walls.push({ x: 260, y: 200, width: 50, height: 300 });");
    for (const [x, y, dx, dy, expectedX, expectedY] of [
        [200, 350, 300, 0, 240, 350], [380, 350, -300, 0, 330, 350],
        [280, 150, 0, 300, 280, 180], [280, 600, 0, -300, 280, 520],
        [200, 250, 200, 200, 240, 450]
    ]) {
        game.run(`player.x = ${x}; player.y = ${y}; movePlayerBy(${dx}, ${dy});`);
        assert.ok(Math.abs(game.run("player.x") - expectedX) < 0.001);
        assert.ok(Math.abs(game.run("player.y") - expectedY) < 0.001);
        assert.equal(game.run("bodyTouchesWall(player.x, player.y, player.size / 2)"), false);
    }
    game.run("player.x = 200; player.y = 350; player.unlocks.dash = true; useDash(800, 350);");
    for (let i = 0; i < 4; i++) game.advance(50);
    assert.equal(game.run("player.x"), 240);
    assert.equal(game.run("getCooldownRemainingMs('dash')"), 1800);
});

test("monsters route through a gate opening and neither steering nor crowd separation crosses walls", () => {
    const game = createCombatGame();
    game.run(`
        player.x = 200; player.y = 300; spawnWallGate(500, true);
        const fast = placeMonster("skitter", 700, 570);
        const slow = placeMonster("crawler", 730, 570);
    `);
    for (let i = 0; i < 600; i++) {
        game.run("updateMonsters(50);");
        assert.equal(game.run("monsters.some(m => bodyTouchesWall(m.x, m.y, m.radius))"), false);
    }
    assert.ok(game.run("fast.x < 450 && slow.x < 450"));
});

test("walls stop piercing bullets before a protected enemy and also block knockback", () => {
    const game = createCombatGame();
    game.run(`
        walls.push({ x: 300, y: 200, width: 50, height: 300 });
        const front = placeMonster("brute", 260, 350);
        const protectedEnemy = placeMonster("brute", 400, 350);
        testBullet(100, 350, 600, { piercing: true, knockback: true }); updateBullets();
    `);
    assert.equal(game.run("front.health"), 58);
    assert.equal(game.run("front.x"), 276);
    assert.equal(game.run("protectedEnemy.health"), 68);
    assert.equal(game.run("bullets.length"), 0);
    assert.equal(game.run("wallSparks.length"), 1);
    assert.equal(game.run("bodyTouchesWall(front.x, front.y, front.radius)"), false);
});

test("vertical wrapping is blocked when its opposite entrance contains a wall", () => {
    const game = createCombatGame();
    game.run("walls.push({ x: 280, y: 600, width: 100, height: 120 }); player.x = 320; player.y = 130; movePlayerBy(0, -100);");
    assert.equal(game.run("player.y"), 112);
    game.run("player.x = 600; player.y = 94; movePlayerBy(0, -9);");
    assert.equal(game.run("player.y"), 713);
});

test("a readied teleport lands on free ground instead of embedding the player in a wall", () => {
    const game = createCombatGame();
    game.run("walls.push({ x: 400, y: 200, width: 80, height: 300 }); player.unlocks.teleport = true;");
    game.key("1"); game.leftClick(440, 350);
    assert.equal(game.run("bodyTouchesWall(player.x, player.y, player.size / 2)"), false);
    assert.equal(game.run("getCooldownRemainingMs('teleport')"), 5000);
});

test("enemies and incoming hay spawn on the right in clear ground and gate generation stays bounded", () => {
    const game = createGame({ scrolling: true }); game.start();
    game.run(`
        walls.length = 0; monsters.length = 0; hayStacks.length = 0;
        spawnWallGate(canvas.width - 10, true);
        for (let i = 0; i < 80; i++) spawnMonster();
        for (let i = 0; i < 12; i++) spawnHayStack();
    `);
    assert.equal(game.run("monsters.length"), 60);
    assert.ok(game.run("monsters.every(m => m.edge === 'right' && m.x > canvas.width && !bodyTouchesWall(m.x, m.y, m.radius))"));
    assert.ok(game.run("hayStacks.length > 0 && hayStacks.every(h => h.x > canvas.width && !bodyTouchesWall(h.x, h.y, 24))"));
    game.run("walls.length = 0; worldState.nextWallX = canvas.width + 240;");
    for (let i = 0; i < 1200; i++) game.run("gameClock.elapsedMs += 50; scrollWorld(50);");
    assert.ok(game.run("walls.length > 0 && walls.length <= 24 && monsters.length === 0"));
    assert.ok(game.run("walls.every(w => Number.isFinite(w.x) && w.height > 0)"));
    assert.ok(game.run("getScrollSpeed() > worldSettings.baseSpeed"));
});

test("resizing a scrolling map keeps walls and actors valid and makes tiny canvases safe", () => {
    const game = createGame({ scrolling: true }); game.start();
    game.window.innerWidth = 390; game.window.innerHeight = 844; game.window.emit("resize");
    assert.ok(game.run("walls.every(w => w.y >= gameHudHeight && w.y + w.height <= canvas.height + 0.001)"));
    assert.equal(game.run("bodyTouchesWall(player.x, player.y, player.size / 2)"), false);
    assert.ok(game.run("monsters.every(m => !bodyTouchesWall(m.x, m.y, m.radius))"));
    game.window.innerWidth = 90; game.window.innerHeight = 100; game.window.emit("resize");
    game.advance(50);
    assert.equal(game.run("walls.length"), 0);
    assert.ok(game.run("Number.isFinite(player.x) && Number.isFinite(player.y)"));
});

test("enemies carried beyond the left edge are removed without rewards or blocking future spawns", () => {
    const game = createGame({ scrolling: true }); game.start();
    game.run(`
        monsters.length = 0;
        const departed = spawnMonster("crawler"); departed.x = -40;
        scrollWorld(50); updateMonsters(50);
    `);
    assert.equal(game.run("monsters.includes(departed)"), false);
    assert.equal(game.run("monsterState.defeated"), 0);
    assert.equal(game.run("player.seeds"), 0);
    assert.ok(game.run("spawnMonster('crawler') !== null"));
});

test("wall layouts cycle through six distinct shapes with narrow and horizontal passages", () => {
    const game = createCombatGame();
    const patterns = game.read("Array.from({ length: 18 }, () => nextWallPattern())");
    for (let i = 0; i < patterns.length; i += 6) assert.equal(new Set(patterns.slice(i, i + 6)).size, 6);
    assert.ok(patterns.every((p, i) => i === 0 || p !== patterns[i - 1]));
    for (const pattern of game.read("wallPatterns")) {
        game.run(`walls.length = 0; spawnWallGate(500, false, ${JSON.stringify(pattern)});`);
        assert.ok(game.run("walls.length >= 2 && walls.every(w => w.width > 0 && w.height > 0 && w.y >= gameHudHeight && w.y + w.height <= canvas.height + 0.001)"));
        if (pattern === "needle") assert.ok(game.run("walls[1].y - walls[0].y - walls[0].height >= 64 && walls[1].y - walls[0].y - walls[0].height < 80"));
        if (["shelves", "elbow", "islands"].includes(pattern)) assert.ok(game.run("walls.some(w => w.width > w.height * 3)"));
    }
    assert.doesNotMatch(html, /gameDistance|gameOverDistance/);
    assert.doesNotMatch(source, /FORWARD →/);
});

test("monsters navigate all six layouts without walking through any wall", () => {
    for (const pattern of ["gate", "needle", "shelves", "staggered", "elbow", "islands"]) {
        const game = createCombatGame();
        game.run(`player.x = 280; player.y = 420; spawnWallGate(500, false, ${JSON.stringify(pattern)});
            const navigator = placeMonster('brute', 960, 220); navigator.speed = 180;`);
        for (let i = 0; i < 500; i++) {
            game.run("updateMonsters(50)");
            assert.equal(game.run("bodyTouchesWall(navigator.x, navigator.y, navigator.radius)"), false, pattern);
        }
        assert.ok(game.run("Math.hypot(navigator.x - player.x, navigator.y - player.y) < 55"), pattern + ": " + JSON.stringify(game.read("navigator")));
    }
});

test("short-window resizing preserves enough clearance through narrow wall passages", () => {
    for (const pattern of ["needle", "shelves"]) {
        const game = createCombatGame();
        game.run(`spawnWallGate(500, false, ${JSON.stringify(pattern)});`);
        game.window.innerHeight = 260; game.window.emit("resize");
        assert.ok(game.run("walls[1].y - walls[0].y - walls[0].height >= 64 - 0.001"), pattern + ": " + JSON.stringify(game.read("walls")));
        assert.ok(game.run("walls.every(w => w.y >= gameHudHeight && w.y + w.height <= canvas.height + 0.001)"));
    }
});

test("automatic target chooses the closest enemy, holds the lock, and reacquires after death or exit", () => {
    const game = createCombatGame();
    game.run(`const near = placeMonster('brute', 750, 360); const far = placeMonster('brute', 950, 360);
        mouse.x = 20; mouse.y = 360; weaponState.nextShotAt = 0;`);
    game.run("updateAutomaticShooting()");
    assert.equal(game.run("weaponState.target === near"), true);
    assert.ok(game.run("bullets.at(-1).dx > 0"));
    game.run("far.x = 660; updateAutomaticTarget()");
    assert.equal(game.run("weaponState.target === near"), true, "keep firing at the live lock even if another enemy becomes closer");
    game.run("damageMonster(near, 100); updateAutomaticTarget()");
    assert.equal(game.run("weaponState.target === far"), true);
    game.drawing.length = 0;
    game.run("drawAutomaticTarget()");
    assert.ok(game.drawing.some(c => c.name === "lineTo" && c.args[0] === 660 && c.args[1] === 360));
    game.run("far.x = -100; weaponState.nextShotAt = 0; bullets.length = 0; updateAutomaticShooting()");
    assert.equal(game.run("weaponState.target"), null);
    assert.equal(game.run("bullets.length"), 0);
    game.run("mouse.x = 20; updateAutomaticShooting()");
    assert.equal(game.run("bullets.length"), 0, "never fall back to mouse aim");
});

test("C switches continuous basic fire between auto and mouse aim without changing cadence or abilities", () => {
    const game = createCombatGame();
    const button = game.elements.get("autoTargetToggle");
    game.run("const target = placeMonster('brute', 400, 360); mouse.x = 1000; mouse.y = 360; weaponState.nextShotAt = 0; updateAutomaticShooting();");
    assert.ok(game.run("bullets.at(-1).dx < 0"), "auto aim fires at the enemy opposite the cursor");
    const nextShot = game.run("weaponState.nextShotAt");
    game.key("1"); game.key("c");
    assert.equal(game.run("weaponState.automaticTarget"), false);
    assert.equal(game.run("armedAbility"), "teleport");
    assert.equal(button.textContent, "Aim: Mouse (C)");
    assert.equal(game.run("weaponState.target"), null);
    game.run("updateAutomaticShooting()");
    assert.equal(game.run("bullets.length"), 1, "switching does not trigger an extra shot");
    assert.equal(game.run("weaponState.nextShotAt"), nextShot);
    game.run("gameClock.elapsedMs = weaponState.nextShotAt; updateAutomaticShooting()");
    assert.equal(game.run("bullets.length"), 2);
    assert.ok(game.run("bullets.at(-1).dx > 0"), "mouse aim continues firing without clicks");
    game.drawing.length = 0; game.run("drawAutomaticTarget()");
    assert.equal(game.drawing.length, 0, "mouse aim hides the target line");
    game.key("c", { repeat: true });
    for (const extra of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { target: { closest: () => ({}) } }]) game.key("c", extra);
    game.key("r"); game.key("p");
    assert.equal(game.run("weaponState.automaticTarget"), false);
    let prevented = false;
    game.key(" ", {target: {closest: s => s === "button" ? {} : null}, preventDefault(){prevented=true;}});
    assert.equal(prevented, true);
    assert.equal(game.run("manuallyPaused"), true);
    assert.equal(game.run("armedAbility"), null);
    game.key("C");
    assert.equal(game.run("weaponState.automaticTarget"), true);
    assert.equal(button.textContent, "Aim: Auto (C)");
    game.run("weaponState.nextShotAt = 0; updateAutomaticShooting()");
    assert.equal(game.run("bullets.length"), 2, "changing aim during pause never fires");
    game.key(" "); game.run("updateAutomaticShooting()");
    assert.ok(game.run("bullets.at(-1).dx < 0"));
    button.emit("click");
    assert.equal(game.run("weaponState.automaticTarget"), false);
    game.run("monsters.length = 0; gameClock.elapsedMs = weaponState.nextShotAt; updateAutomaticShooting()");
    assert.ok(game.run("bullets.at(-1).dx > 0"), "mouse aim fires even without enemies");
    game.run("mouse.x = player.x; mouse.y = player.y; gameClock.elapsedMs = weaponState.nextShotAt; updateAutomaticShooting()");
    assert.ok(game.run("bullets.every(b => Number.isFinite(b.dx) && Number.isFinite(b.dy))"));
    game.leftClick(1000, 360);
    assert.equal(game.run("bullets.at(-1).kind"), "rake");
    assert.ok(game.run("bullets.at(-1).dx > 0"));
});

test("targeted HUD abilities arm, show ready previews, cancel, and activate only from left-click", () => {
    const game = createCombatGame();
    const teleport = game.elements.get("abilityTeleport");
    teleport.emit("click");
    assert.equal(game.run("armedAbility"), "teleport");
    assert.equal(teleport.getAttribute("aria-pressed"), "true");
    assert.equal(game.elements.get("teleportCooldownText").textContent, "➤ Armed · click map");
    assert.equal(game.elements.get("game").style.cursor, "none");
    assert.equal(game.run("getCooldownRemainingMs('teleport')"), 0);
    game.run("drawAbilityPreview()");
    assert.ok(game.drawing.some(c => c.name === "fillText" && c.args[0] === "Teleport"));
    game.rightClick(800, 400);
    assert.equal(game.run("armedAbility"), "teleport");
    assert.equal(game.run("player.x"), 640);
    game.leftClick(800, 400);
    assert.equal(game.run("player.x"), 800);
    assert.equal(game.run("armedAbility"), null);
    teleport.emit("click");
    assert.equal(game.run("armedAbility"), null, "cooldown cannot arm");
    game.elements.get("abilityDash").emit("click");
    game.rightClick(1000, 400);
    assert.equal(game.run("abilityState.dash.remainingMs"), 0);
    game.key("Escape");
    assert.equal(game.run("armedAbility"), null);
    game.elements.get("abilityLure").emit("click");
    assert.equal(game.run("isLureActive()"), false);
    game.leftClick(400, 500);
    assert.equal(game.run("isLureActive()"), true);
    game.key("3"); game.key("3");
    assert.equal(game.run("armedAbility"), null, "selecting the same ability cancels");
    game.key("3"); game.key(" "); game.rightClick(1200, 400);
    assert.equal(game.run("armedAbility"), null);
    assert.equal(game.run("abilityState.dash.remainingMs"), 0);
});

test("Shield and Time Freeze activate immediately from HUD or number keys and preserve movement", () => {
    for (const [name, id, key, duration] of [
        ["energyShield", "abilityEnergyShield", "2", 2000], ["timeFreeze", "abilityTimeFreeze", "4", 3000]
    ]) for (const input of ["hud", "keyboard"]) {
        const game = createCombatGame();
        game.run(`player.unlocks.${name} = true; player.unlocks.lure = true; updateAbilityHud();`);
        const hud = game.elements.get(id);
        assert.equal(game.run(`abilityHud.${name}.cooldownText.textContent`), "✓ Ready");
        game.key("5");
        game.rightClick(1000, 360);
        const target = game.read("movement.target");
        if (input === "hud") hud.emit("click");
        else game.key(key);
        assert.equal(game.run(`abilityState.${name}.activeUntil`), duration);
        assert.equal(game.run("armedAbility"), null);
        assert.equal(game.elements.get("game").style.cursor, "crosshair");
        assert.equal(game.elements.get("abilityHint").hidden, true);
        assert.equal(hud.getAttribute("aria-pressed"), "true");
        assert.equal(hud.classList.contains("active"), true);
        assert.deepEqual(game.read("movement.target"), target);
        game.leftClick(900, 500);
        assert.equal(game.run("isLureActive()"), false, "instant activation clears the previous targeting mode");
        game.advance(50);
        assert.equal(game.run("player.x"), 649);
        game.drawing.length = 0;
        game.run("drawAbilityPreview()");
        assert.equal(game.drawing.length, 0, "instant abilities never show a placement cursor");
    }
});

test("instant ability inputs respect pause, editing, repeat and cooldown guards", () => {
    for (const [name, id, key, cooldown] of [
        ["energyShield", "abilityEnergyShield", "2", 15000], ["timeFreeze", "abilityTimeFreeze", "4", 60000]
    ]) {
        const game = createCombatGame();
        game.run(`player.unlocks.${name} = true; player.unlocks.dash = true;`);
        const hud = game.elements.get(id);
        game.key(key, { repeat: true });
        game.key(key, { ctrlKey: true });
        game.key(key, { target: { closest: () => ({}) } });
        game.key(" "); game.key(key); hud.emit("click"); game.key(" ");
        assert.equal(game.run(`abilityState.${name}.activeUntil`), 0);
        game.key("d"); game.key(key); game.advance(50);
        assert.equal(game.run("player.x"), 649, "instant keys preserve WASD steering");
        game.releaseKey("d");
        game.key("3");
        hud.emit("click"); game.key(key);
        assert.equal(game.run(`abilityState.${name}.lastUsedAt`), 0, "cooldown cannot restart an active ability");
        assert.equal(game.run("armedAbility"), "dash", "a denied cast leaves the targeting mode intact");
        game.advance(cooldown - 50);
        assert.equal(game.run(`abilityHud.${name}.cooldownText.textContent`), "✓ Ready");
        assert.equal(hud.getAttribute("aria-pressed"), "false");
        game.key(key, { repeat: true });
        assert.equal(game.run(`abilityState.${name}.lastUsedAt`), 0);
        game.key(key);
        assert.equal(game.run(`abilityState.${name}.lastUsedAt`), cooldown);
        assert.equal(game.run("armedAbility"), null);
    }
});

test("Dash previews directional chevrons and sprint reach while Teleport keeps its circular marker", () => {
    const game = createCombatGame();
    game.run("player.unlocks.dash = true; player.unlocks.teleport = true;");
    game.window.emit("mousemove", { buttons: 0, clientX: 900, clientY: 500 });
    game.key("3");
    game.drawing.length = 0;
    game.run("drawAbilityPreview()");
    assert.ok(game.drawing.some(c => c.name === "fillText" && c.args[0] === "Dash · left-click"));
    assert.ok(game.drawing.some(c => c.name === "translate" && c.args[0] === 900 && c.args[1] === 500));
    assert.ok(game.drawing.some(c => c.name === "lineTo" && c.args[0] === 140 && c.args[1] === 0));
    assert.equal(game.drawing.some(c => c.name === "arc"), false);
    assert.match(game.elements.get("abilityHint").textContent, /Left-click to sprint/);
    game.key("1");
    game.drawing.length = 0;
    game.run("drawAbilityPreview()");
    assert.ok(game.drawing.some(c => c.name === "arc" && c.args[2] === 17));
    assert.ok(game.drawing.some(c => c.name === "fillText" && c.args[0] === "Teleport"));
});

test("Dash advances over multiple frames, pauses while paused and resumes normal steering after the sprint", () => {
    for (const step of [50, 1000 / 60, 1000 / 120]) {
        const game = createCombatGame();
        game.run("player.unlocks.dash = true;");
        game.key("3"); game.leftClick(1100, 360);
        assert.equal(game.run("player.x"), 640);
        game.advance(step);
        assert.ok(game.run("player.x > 640 && player.x < 780 && dashTrail.length > 0"));
        game.key(" "); const x = game.run("player.x");
        game.advance(5000); assert.equal(game.run("player.x"), x);
        game.key(" ");
        for (let i = 1; i < Math.round(200 / step); i++) game.advance(step);
        assert.ok(Math.abs(game.run("player.x") - 780) < 0.001);
        game.advance(step);
        game.key("d"); game.advance(50);
        assert.ok(Math.abs(game.run("player.x") - 789) < 0.001);
    }
});

test("stats drag clamps to the viewport, survives collapsing and resizing, and does not cast an armed ability", () => {
    const game = createCombatGame();
    game.run("player.unlocks.teleport = true;"); game.key("1");
    const handle = game.elements.get("statsDragHandle");
    handle.emit("pointerdown", { button: 0, pointerId: 4, clientX: 30, clientY: 120, preventDefault() {} });
    handle.emit("pointermove", { pointerId: 4, clientX: 530, clientY: 420 });
    assert.deepEqual(game.read("({ x: statsPosition.x, y: statsPosition.y })"), { x: 504, y: 402 });
    handle.emit("pointerup");
    assert.equal(game.run("statsPosition.drag"), null);
    assert.equal(game.run("armedAbility"), "teleport");
    assert.equal(game.run("player.x"), 640);
    game.elements.get("statsToggle").emit("click");
    assert.equal(game.run("statsPosition.x"), 504);
    game.window.innerWidth = 390; game.window.innerHeight = 400; game.window.emit("resize");
    assert.equal(game.run("statsPosition.x"), 140);
    assert.equal(game.run("statsPosition.y"), 298);
    handle.emit("keydown", { key: "ArrowLeft", preventDefault() {}, stopPropagation() {} });
    assert.equal(game.run("statsPosition.x"), 124);
});

test("Harvest All collects every visible hay stack once across walls at face value", () => {
    const game = createCombatGame();
    game.run(`
        hayStacks.push({x: 300, y: 300, seeds: 5}, {x: 1000, y: 500, seeds: 10}, {x: 1340, y: 300, seeds: 100});
        walls.push({x: 800, y: 92, width: 50, height: 628});
        harvestPickups.push({x: player.x, y: player.y, spawnedAt: 0});`);
    game.advance(0);
    assert.equal(game.run("player.seeds"), 15);
    assert.equal(Number(game.elements.get("seedHudCount").textContent), 15);
    assert.equal(game.run("hayStacks.length"), 1);
    assert.equal(game.run("harvestPickups.length"), 0);
    assert.equal(game.run("harvestBursts.length"), 2);
    assert.ok(game.drawing.some(c => c.name === "fillText" && c.args[0] === "Harvest! +15 seeds"));
    game.advance(700);
    assert.equal(game.run("player.seeds"), 15);
    assert.equal(game.run("harvestBursts.length"), 0);
});

test("Harvest All appears occasionally on free ground, pauses, scrolls and expires offscreen", () => {
    const game = createGame({ scrolling: true }); game.start();
    game.run("monsters.length = 0; monsterState.nextSpawnAt = Infinity; walls.length = 0; worldState.nextWallX = Infinity; hayStacks.length = 0;");
    game.key(" "); game.advance(20000);
    assert.equal(game.run("harvestPickups.length"), 0);
    game.key(" "); game.advance(18000);
    assert.equal(game.run("harvestPickups.length"), 1);
    assert.ok(game.run("harvestPickups[0].x > canvas.width * 0.55 && !bodyTouchesWall(harvestPickups[0].x, harvestPickups[0].y, 24)"));
    const x = game.run("harvestPickups[0].x"); game.advance(50);
    assert.equal(game.run("harvestPickups[0].x"), x - 2.75);
    assert.equal(game.run("spawnHarvestPickup()"), false);
    game.run("harvestPickups[0].x = -40; scrollWorld(50)");
    assert.equal(game.run("harvestPickups.length"), 0);
});

test("key bindings reject collisions, persist, update HUD labels, and reset every action", () => {
    const storage = new Map();
    const game = createGame({ storage });
    game.elements.get("keybindingsBtn").emit("click");
    game.elements.get("bind-teleport").emit("click");
    game.key("w");
    assert.match(game.elements.get("bindingMessage").textContent, /already used/);
    assert.equal(game.run("keyBindings.label('teleport')"), "1");
    game.key("k");
    assert.equal(game.elements.get("teleportKey").textContent, "K");
    game.elements.get("bind-pause").emit("click"); game.key("p");
    game.elements.get("bind-autoAim").emit("click"); game.key("j");
    game.elements.get("bind-moveUp").emit("click"); game.key("ArrowUp");
    game.elements.get("closeKeybindingsBtn").emit("click");
    game.start(); game.key("w"); game.advance(50);
    assert.equal(game.run("player.y"), 360);
    game.key("ArrowUp"); game.advance(50); game.releaseKey("ArrowUp");
    assert.equal(game.run("player.y"), 351);
    game.key("1"); assert.equal(game.run("armedAbility"), null);
    game.key("k"); assert.equal(game.run("armedAbility"), "teleport");
    game.key("j"); assert.equal(game.run("weaponState.automaticTarget"), false);
    game.key(" "); assert.equal(game.run("manuallyPaused"), false);
    game.key("p"); assert.equal(game.run("manuallyPaused"), true);
    assert.equal(game.elements.get("pauseBtn").textContent, "Resume (P)");
    const reloaded = createGame({ storage });
    assert.equal(reloaded.run("keyBindings.label('teleport')"), "K");
    reloaded.elements.get("keybindingsBtn").emit("click");
    reloaded.elements.get("resetKeybindingsBtn").emit("click");
    assert.equal(reloaded.run("keyBindings.label('teleport')"), "1");
    assert.equal(reloaded.run("keyBindings.label('pause')"), "Space");
    assert.equal(reloaded.run("keyBindings.label('autoAim')"), "C");
    assert.equal(reloaded.run("keyBindings.label('moveUp')"), "W");
    assert.equal(reloaded.run("keyBindings.label('rakeFrenzy')"), "6");
    assert.equal(createGame({ storage }).run("keyBindings.label('teleport')"), "1");
});

test("the bindings menu pauses safely, captures keys without firing, and preserves manual pause", () => {
    const game = createCombatGame();
    game.key("d"); game.key("1");
    game.elements.get("keybindingsBtn").emit("click");
    assert.equal(game.run("movement.keys.size"), 0);
    assert.equal(game.run("armedAbility"), null);
    game.advance(50000); game.leftClick();
    assert.equal(game.run("gameClock.elapsedMs"), 0);
    assert.equal(game.run("bullets.length"), 0);
    game.elements.get("bind-rakeFrenzy").emit("click"); game.key("r");
    assert.equal(game.run("isRakeFrenzyActive()"), false);
    game.elements.get("closeKeybindingsBtn").emit("click");
    assert.equal(game.run("gameClock.paused"), false);
    game.key("r"); assert.equal(game.run("isRakeFrenzyActive()"), true);
    game.key(" "); game.elements.get("keybindingsBtn").emit("click");
    game.elements.get("closeKeybindingsBtn").emit("click");
    assert.equal(game.run("gameClock.paused"), true);
    assert.doesNotThrow(() => createGame({storageBlocked:true}));
    assert.equal(createGame({storage:new Map([["seedHarvester.keyBindings.v1", "bad"]])}).run("keyBindings.label('pause')"), "Space");
});

test("Rake Frenzy removes recovery for five active seconds, pauses, and respects its own cooldown", () => {
    for (const input of ["key", "hud"]) {
        const game = createCombatGame();
        game.leftClick(); game.leftClick();
        assert.equal(game.run("bullets.length"), 1);
        if (input === "key") game.key("6"); else game.elements.get("abilityRakeFrenzy").emit("click");
        for (let i=0;i<8;i++) game.leftClick();
        assert.equal(game.run("bullets.length"), 9);
        assert.equal(game.run("getCooldownRemainingMs('rakeFrenzy')"), 45000);
        game.key(" "); game.advance(10000); game.leftClick();
        assert.equal(game.run("bullets.length"), 9);
        assert.equal(game.run("isRakeFrenzyActive()"), true);
        game.key(" "); game.advance(4999); game.leftClick();
        const count = game.run("bullets.length");
        game.advance(1); game.leftClick();
        assert.equal(game.run("isRakeFrenzyActive()"), false);
        assert.equal(game.run("bullets.length"), count);
        game.key("6"); assert.equal(game.run("isRakeFrenzyActive()"), false);
        game.advance(449); game.leftClick();
        assert.equal(game.run("bullets.length"), count + 1);
    }
});

test("cooldown reset pickups clear all six cooldowns once and preserve active effect durations", () => {
    const game = createCombatGame();
    game.key("5"); game.leftClick(800,400); game.key("2"); game.key("6");
    game.run("for (const state of Object.values(abilityState)) state.lastUsedAt = gameClock.elapsedMs; cooldownPickups.push({x:700,y:360,spawnedAt:0});");
    const before = game.read("({ shield:abilityState.energyShield.activeUntil, lure:abilityState.lure.activeUntil, frenzy:abilityState.rakeFrenzy.activeUntil })");
    game.run("updateCooldownPickups([{x1:640,y1:360,x2:800,y2:360}])");
    assert.equal(game.run("cooldownPickups.length"), 0);
    assert.equal(game.run("Object.keys(abilityState).every(name => getCooldownRemainingMs(name) === 0)"), true);
    assert.deepEqual(game.read("({ shield:abilityState.energyShield.activeUntil, lure:abilityState.lure.activeUntil, frenzy:abilityState.rakeFrenzy.activeUntil })"), before);
    assert.equal(game.elements.get("cooldownResetNotice").hidden, false);
    game.run("abilityState.teleport.lastUsedAt = gameClock.elapsedMs; updateCooldownPickups([{x1:640,y1:360,x2:800,y2:360}]); drawLure()");
    assert.equal(game.run("getCooldownRemainingMs('teleport')"), 5000);
    assert.ok(game.drawing.filter(call=>call.name==="arc").every(call=>call.args.every(Number.isFinite)));
    game.advance(2401);
    assert.equal(game.elements.get("cooldownResetNotice").hidden, true);
});

test("cooldown pickups spawn on open ground, scroll, expire and do not advance while paused", () => {
    const game = createGame({scrolling:true}); game.start();
    game.run("monsters.length=0; monsterState.nextSpawnAt=Infinity; weaponState.nextShotAt=Infinity; nextHaySpawnAt=Infinity;");
    game.key(" "); game.advance(30000);
    assert.equal(game.run("cooldownPickups.length"), 0);
    game.key(" "); game.advance(25000);
    assert.equal(game.run("cooldownPickups.length"), 1);
    assert.ok(game.run("cooldownPickups[0].x >= canvas.width*0.55 && !bodyTouchesWall(cooldownPickups[0].x,cooldownPickups[0].y,24)"));
    assert.equal(game.run("spawnCooldownPickup()"), false);
    const x=game.run("cooldownPickups[0].x"); game.advance(50);
    assert.equal(game.run("cooldownPickups[0].x"), x-2.75);
    game.advance(18000);
    assert.equal(game.run("cooldownPickups.length"), 0);
});

test("Time Freeze stops scrolling walls and pickups while leaving player controls and timers active", () => {
    const game=createGame({scrolling:true}); game.start();
    game.run("monsters.length=0; monsterState.nextSpawnAt=Infinity; weaponState.nextShotAt=Infinity; nextHaySpawnAt=Infinity; cooldownPickups.push({x:900,y:400,spawnedAt:0});");
    game.key("4");
    const state=game.read("({scroll:worldState.scroll,wall:walls[0].x,pickup:cooldownPickups[0].x})");
    game.key("d"); game.advance(1000); game.releaseKey("d");
    assert.deepEqual(game.read("({scroll:worldState.scroll,wall:walls[0].x,pickup:cooldownPickups[0].x})"),state);
    assert.equal(game.run("player.x"),649);
    assert.equal(game.run("getCooldownRemainingMs('timeFreeze')"),59000);
    game.advance(1999);
    assert.equal(game.run("worldState.scroll"),state.scroll);
    game.advance(1);
    assert.ok(game.run("worldState.scroll")>state.scroll);
});

test("movement and uncapped cooldown upgrades apply immediately while preserving cooldown progress", () => {
    const game=createCombatGame(); game.run("player.seeds=1000000000");
    game.elements.get("upgradeMoveSpeed").emit("click");
    game.key("d"); game.advance(50); game.releaseKey("d");
    assert.ok(Math.abs(game.run("player.x")-649.09)<1e-8);
    game.key("2"); game.advance(5000); game.key(" ");
    const old=game.run("getCooldownRemainingMs('energyShield')");
    game.elements.get("upgradeCooldown-energyShield").emit("click");
    assert.ok(Math.abs(game.run("getCooldownRemainingMs('energyShield')")-old*0.995)<1e-8);
    assert.equal(game.run("abilityState.teleport.cooldownMs"),5000);
    for(const name of game.read("Object.keys(abilityState)")) {
        const button=game.elements.get("upgradeCooldown-"+name);
        for(let i=0;i<50;i++)button.emit("click");
        const duration=game.run(`abilityState.${name}.cooldownMs`);
        assert.ok(duration < game.run(`abilityState.${name}.baseCooldownMs`)*0.8);
        assert.equal(button.getAttribute("aria-disabled"),"false");
        assert.notEqual(button.textContent,"Max");
        const seeds=game.run("player.seeds"), cost=Number(button.dataset.cost);button.emit("click");
        assert.equal(game.run("player.seeds"),seeds-cost);
        assert.ok(Math.abs(game.run(`abilityState.${name}.cooldownMs`)-duration*0.995)<1e-8);
    }
    assert.equal(game.run("gameClock.paused"),true);
});

test("cooldown reductions stay fractional below one millisecond and never display a zero cooldown", () => {
    const game=createCombatGame();
    game.run("abilityState.dash.cooldownMs=0.75; player.seeds=100; purchaseUpgrade('cooldown-dash')");
    assert.equal(game.run("abilityState.dash.cooldownMs"),0.74625);
    assert.equal(game.elements.get("statCooldown-dash").textContent,"0.000746s");
    assert.equal(game.run("purchaseUpgrade('cooldown-dash')"),true);
});

test("basic attack balance favors rake damage while inexpensive upgrades still improve DPS", () => {
    const game=createCombatGame();
    const base=game.run("player.damage*player.fireRate");
    assert.equal(base,6);
    game.run("player.seeds=4");
    game.elements.get("upgradeDamage").emit("click"); game.elements.get("upgradeFireRate").emit("click");
    assert.ok(Math.abs(game.run("player.damage*player.fireRate")-6.391)<1e-8);
    assert.equal(game.run("player.seeds"),0);
    assert.equal(game.run("getRake().damage"),12);
});

test("mystery boxes count down five active seconds, pause their expiry, and cannot be collected after expiry", () => {
    const game=createCombatGame();
    game.run("mysteryBoxes.push({x:900,y:350,spawnedAt:gameClock.elapsedMs}); drawLootPickups()");
    assert.ok(game.drawing.some(call=>call.name==="fillText" && call.args[0]==="5s"));
    game.advance(1000); game.drawing.length=0; game.run("drawLootPickups()");
    assert.ok(game.drawing.some(call=>call.name==="fillText" && call.args[0]==="4s"));
    game.key(" "); game.advance(30000);
    assert.equal(game.run("mysteryBoxes.length"),1);
    assert.equal(game.run("gameClock.elapsedMs"),1000);
    game.key(" "); game.advance(3999);
    assert.equal(game.run("mysteryBoxes.length"),1);
    game.run("player.x=900;player.y=350"); game.advance(1);
    assert.equal(game.run("mysteryBoxes.length"),0);
    assert.equal(game.run("isMysteryChoiceOpen()"),false);
});

test("walking into a mystery box freezes all gameplay and choosing one card resumes without duplicate rewards", () => {
    const game=createCombatGame();
    game.run(`Math.random=()=>0; player.seeds=0;
        mysteryBoxes.push({x:player.x,y:player.y,spawnedAt:gameClock.elapsedMs});
        const enemy=placeMonster('brute',player.x,player.y); testBullet(300,400,10);`);
    game.key("2"); game.key("d"); game.advance(16);
    assert.equal(game.run("mysteryBoxes.length"),0);
    assert.equal(game.elements.get("mysteryDialog").open,true);
    assert.equal(game.run("gameClock.paused"),true);
    assert.equal(game.run("player.health"),100,"contact cannot damage the player after a box opens");
    assert.equal(game.run("movement.keys.size"),0);
    assert.deepEqual(game.read("lootState.choices.map(c=>c.id)"),["seeds","vitality","rakePower"]);
    const state="({time:gameClock.elapsedMs,scroll:worldState.scroll,x:player.x,y:player.y,health:player.health,bullets,monsters,abilities:abilityState})";
    const paused=game.read(state);
    game.key(" ");game.key("c");game.key("1");game.key("d");game.leftClick(1000,350);game.rightClick(1000,350);
    game.elements.get("keybindingsBtn").emit("click");
    assert.equal(game.elements.get("keybindingsDialog").open,false);
    game.advance(60000);
    assert.deepEqual(game.read(state),paused);
    assert.equal(game.run("armedAbility"),null);
    assert.equal(game.run("manuallyPaused"),false);
    assert.equal(game.run("purchaseUpgrade('damage')"),false);
    let cancelled=false;
    game.elements.get("mysteryDialog").emit("cancel",{preventDefault(){cancelled=true;}});
    assert.equal(cancelled,true);
    game.document.hidden=true;game.document.emit("visibilitychange");
    game.elements.get("mysteryCard0").emit("click");
    assert.equal(game.run("player.seeds"),0);
    game.document.hidden=false;game.document.emit("visibilitychange");
    game.elements.get("mysteryCard0").emit("click");game.elements.get("mysteryCard1").emit("click");
    assert.equal(game.run("player.seeds"),1000);
    assert.equal(game.run("player.maxHealth"),100);
    assert.equal(game.run("gameClock.paused"),false);
    assert.equal(game.elements.get("mysteryDialog").open,false);
    assert.equal(game.run("gameClock.elapsedMs"),16);
    game.advance(20);
    assert.equal(game.run("gameClock.elapsedMs"),36);
});

test("random cards are distinct, eligible, and still offer three useful bonuses at maximum progression", () => {
    const game=createCombatGame(), combinations=new Set();
    for(let i=0;i<25;i++) {
        game.run("openMysteryChoice()");
        const choices=game.read("lootState.choices.map(c=>c.id)");
        assert.equal(new Set(choices).size,3);
        assert.ok(!choices.includes("heal") && !choices.includes("cooldowns"));
        combinations.add(choices.join(","));
        game.run("dismissMysteryChoice();updateGamePauseState()");
    }
    assert.ok(combinations.size>5);
    game.run("player.level=20;for(const name of ['piercingRound','knockback','explosiveKernel','ricochet'])player.unlocks[name]=true;openMysteryChoice()");
    assert.equal(game.run("new Set(lootState.choices.map(c=>c.id)).size"),3);
    assert.ok(game.run("getMysteryBonuses().length>=25"));
    assert.ok(game.run("!lootState.choices.some(c=>['piercingRound','knockback','explosiveKernel','ricochet'].includes(c.id))"));
    assert.equal(game.run("openMysteryChoice()"),false,"a pending reward cannot be rerolled");
});

test("mystery bonuses grant health, levels, cooldowns, rake damage, and free weapon effects correctly", () => {
    for(const id of ["vitality","heal","level","cooldowns","rakePower","piercingRound","knockback","explosiveKernel","ricochet"]) {
        const game=createCombatGame();
        game.run(`player.health=30;player.seeds=17;player.xp=10;abilityState.teleport.lastUsedAt=gameClock.elapsedMs;
            const pool=getMysteryBonuses();const reward=pool.find(b=>b.id===${JSON.stringify(id)});
            openMysteryChoice();lootState.choices[0]=reward;chooseMysteryBonus(0);`);
        assert.equal(game.run("player.seeds"),17);
        if(id==="vitality") {assert.equal(game.run("player.maxHealth"),125);assert.equal(game.run("player.health"),55);}
        else if(id==="heal") assert.equal(game.run("player.health"),100);
        else if(id==="level") {assert.equal(game.run("player.level"),2);assert.equal(game.run("player.xp"),0);assert.equal(game.run("player.rakeTier"),1);}
        else if(id==="cooldowns") assert.equal(game.run("Object.keys(abilityState).every(n=>getCooldownRemainingMs(n)===0)"),true);
        else if(id==="rakePower") {
            assert.equal(game.run("getRakeDamage()"),14);
            assert.equal(game.elements.get("statRakeDamage").textContent,"14");
            game.leftClick(1000,350);
            assert.equal(game.run("bullets[0].damage"),14);
            game.run("awardXp(getXpRequired())");
            assert.equal(game.run("getRakeDamage()"),14);
            assert.equal(game.run("bullets[0].damage"),14);
            assert.equal(game.run("player.damage"),8);
        } else {
            assert.equal(game.run(`player.unlocks.${id}`),true);
            assert.equal(game.elements.get("effectState-"+id).textContent,"Unlocked");
            assert.equal(game.run(`purchaseUpgrade("${id}")`),false);
            assert.equal(game.run("player.seeds"),17);
        }
    }
});

test("health potions heal crossed paths once, cap at maximum HP, and are not wasted at full health", () => {
    const game=createCombatGame();
    game.run(`player.health=20;const path=[{x1:500,y1:350,x2:850,y2:350}];
        healthPotions.push({x:700,y:350,spawnedAt:gameClock.elapsedMs}); updateLootPickups(path);updateLootPickups(path);`);
    assert.equal(game.run("player.health"),55);
    assert.equal(game.run("healthPotions.length"),0);
    assert.equal(game.elements.get("healthText").textContent,"55 / 100");
    assert.ok(game.run("collectionEffects.some(e=>e.label==='+35 HP')"));
    game.run("player.health=100;healthPotions.push({x:700,y:350,spawnedAt:gameClock.elapsedMs});updateLootPickups(path)");
    assert.equal(game.run("healthPotions.length"),1);
    game.run("player.health=94;updateLootPickups(path)");
    assert.equal(game.run("player.health"),100);
    assert.equal(game.run("healthPotions.length"),0);
    assert.ok(game.run("collectionEffects.some(e=>e.label==='+6 HP')"));
});

test("loot spawns periodically on clear ground with population limits and bounded attempts", () => {
    const game=createCombatGame();
    game.run("lootState.nextPotionAt=12000;lootState.nextMysteryAt=20000");
    game.advance(11999);assert.equal(game.run("healthPotions.length"),0);
    game.advance(1);assert.equal(game.run("healthPotions.length"),1);
    game.advance(8000);assert.equal(game.run("mysteryBoxes.length"),1);
    assert.ok(game.run("[...healthPotions,...mysteryBoxes].every(p=>p.x>getDeathZoneWidth()+60 && !bodyTouchesWall(p.x,p.y,24))"));
    assert.equal(game.run("spawnMysteryBox()"),false);
    game.run("spawnHealthPotion();spawnHealthPotion()");assert.equal(game.run("healthPotions.length"),2);
    assert.ok(game.run("lootState.nextMysteryAt>=55000 && lootState.nextMysteryAt<=75000"));
    game.run("mysteryBoxes.length=0;healthPotions.length=0;walls.push({x:0,y:0,width:1280,height:720})");
    assert.equal(game.run("spawnMysteryBox()"),false);assert.equal(game.run("spawnHealthPotion()"),false);
});

test("new loot follows the scrolling map, stops with Time Freeze, and expires while the world is frozen", () => {
    const game=createGame({scrolling:true});game.start();
    game.run(`monsters.length=0;monsterState.nextSpawnAt=Infinity;lootState.nextMysteryAt=Infinity;lootState.nextPotionAt=Infinity;
        mysteryBoxes.push({x:900,y:350,spawnedAt:gameClock.elapsedMs});healthPotions.push({x:1000,y:500,spawnedAt:gameClock.elapsedMs});`);
    game.advance(50);
    assert.equal(game.run("mysteryBoxes[0].x"),897.25);assert.equal(game.run("healthPotions[0].x"),997.25);
    game.key("4");game.advance(50);
    assert.equal(game.run("mysteryBoxes[0].x"),897.25);
    game.run("abilityState.timeFreeze.activeUntil=30000");game.advance(6900);
    assert.equal(game.run("mysteryBoxes.length"),0);
    assert.equal(game.run("healthPotions.length"),1);
    game.advance(13000);assert.equal(game.run("healthPotions.length"),0);
});

test("resizing and ending a run safely clear blocked loot and pending rewards", () => {
    const game=createCombatGame();
    game.run("spawnMysteryBox();spawnHealthPotion();openMysteryChoice()");
    game.window.innerWidth=80;game.window.innerHeight=180;game.window.emit("resize");
    assert.equal(game.run("mysteryBoxes.length+healthPotions.length"),0);
    assert.equal(game.run("gameClock.paused"),true);
    game.run("endGame()");
    assert.equal(game.elements.get("mysteryDialog").open,false);
    assert.equal(game.elements.get("gameOverDialog").open,true);
    assert.equal(game.run("chooseMysteryBonus(0)"),false);
});

test("minute coins accumulate once, survive reload, and restart their minute schedule each run", () => {
    const storage = abilitySave(), game = createCombatGame({ storage });
    game.advance(59999); assert.equal(game.run("abilityProgress.coins"), 0);
    game.advance(1); assert.equal(game.run("abilityProgress.coins"), 1);
    game.advance(60000); assert.equal(game.run("abilityProgress.coins"), 3);
    game.advance(240000); assert.equal(game.run("abilityProgress.coins"), 21);
    game.advance(0); assert.equal(game.run("abilityProgress.coins"), 21);
    assert.equal(game.elements.get("hudCoins").textContent, "21");
    game.run("endGame()"); game.advance(60000);
    const next = createCombatGame({ storage });
    assert.equal(next.run("abilityProgress.coins"), 21);
    next.advance(60000); assert.equal(next.run("abilityProgress.coins"), 22);
});

test("coins exclude manual pause, hidden time, and ability guide time", () => {
    const game = createCombatGame(); game.advance(30000);
    game.key(" "); game.advance(120000); game.key(" ");
    game.document.hidden = true; game.document.emit("visibilitychange"); game.advance(120000);
    game.document.hidden = false; game.document.emit("visibilitychange");
    game.elements.get("abilityInfoBtn").emit("click"); game.advance(120000);
    assert.equal(game.run("abilityProgress.coins"), 0);
    game.elements.get("closeAbilityGuideBtn").emit("click"); game.advance(30000);
    assert.equal(game.run("abilityProgress.coins"), 1);
});

test("coins upgrade abilities from menu and paused guide and persist all six levels", () => {
    const storage = abilitySave(240), game = createGame({ storage });
    for (const name of game.read("Object.keys(abilityCatalog)")) game.elements.get("menuUpgrade-" + name).emit("click");
    assert.equal(game.run("abilityProgress.coins"), 180);
    game.start(); game.key(" "); game.elements.get("abilityInfoBtn").emit("click");
    for (const name of game.read("Object.keys(abilityCatalog)")) game.elements.get("guideUpgrade-" + name).emit("click");
    assert.equal(game.run("abilityProgress.coins"), 0);
    assert.equal(game.run("abilityProgress.purchase('teleport')"), false);
    game.elements.get("closeAbilityGuideBtn").emit("click");
    assert.equal(game.run("gameClock.paused"), true, "manual pause survives closing the guide");
    const next = createGame({ storage });
    for (const name of next.read("Object.keys(abilityCatalog)")) {
        assert.equal(next.run(`getAbilityLevel('${name}')`), 3);
        assert.equal(next.elements.get("menuUpgrade-" + name).disabled, true);
        assert.equal(next.elements.get(name + "Level").textContent, "Lv 3");
    }
});

test("unaffordable upgrades and modal input cannot spend coins or mutate play", () => {
    const game = createCombatGame({ storage: abilitySave(9) });
    assert.equal(game.run("abilityProgress.purchase('teleport')"), false);
    game.elements.get("abilityInfoBtn").emit("click");
    const before = game.read("({player,abilityState,time:gameClock.elapsedMs})");
    game.key("1"); game.key(" "); game.key("d"); game.leftClick(); game.rightClick(900,400); game.advance(1000);
    assert.deepEqual(game.read("({player,abilityState,time:gameClock.elapsedMs})"), before);
    assert.equal(game.run("abilityProgress.coins"), 9);
    game.elements.get("closeAbilityGuideBtn").emit("click");
    assert.equal(game.run("gameClock.paused"), false);
});

test("invalid or unavailable saved progression falls back safely and quota failures retain visit progress", () => {
    for (const stored of ["broken", JSON.stringify({ coins:-1, levels:{teleport:9,energyShield:"3"} })]) {
        const storage = new Map([["seedHarvester.abilityProgress.v1", stored]]), game = createCombatGame({storage});
        assert.equal(game.run("abilityProgress.coins"),0); assert.equal(game.run("getAbilityLevel('teleport')"),1);
        game.advance(60000); assert.equal(game.run("abilityProgress.coins"),1);
    }
    for (const blocked of [true, false]) {
        const game = createCombatGame({ storageBlocked: blocked });
        if (!blocked) game.window.localStorage.setItem = () => { throw Error("Quota exceeded"); };
        game.advance(300000); assert.equal(game.run("abilityProgress.coins"),15);
        assert.equal(game.run("abilityProgress.purchase('teleport')"),true);
        game.advance(60000); assert.equal(game.run("abilityProgress.coins"),11);
        assert.equal(game.run("getAbilityLevel('teleport')"),2);
        assert.match(game.elements.get("abilityStorageNote").textContent,/this visit only/);
    }
});

test("shield and freeze durations grow by level and upgrades affect the next cast", () => {
    for (let level = 1; level <= 3; level++) {
        const game=createCombatGame({storage:abilitySave(100,{energyShield:level,timeFreeze:level})});
        game.key("2"); game.key("4");
        assert.equal(game.run("abilityState.energyShield.activeUntil"),level*2000);
        assert.equal(game.run("abilityState.timeFreeze.activeUntil"),1000+level*2000);
        if(level<3) {
            game.run("abilityProgress.purchase('energyShield');abilityProgress.purchase('timeFreeze')");
            assert.equal(game.run("abilityState.energyShield.activeUntil"),level*2000);
            assert.equal(game.run("abilityState.timeFreeze.activeUntil"),1000+level*2000);
            game.run("resetAbilityCooldowns();useEnergyShield();useTimeFreeze()");
            assert.equal(game.run("abilityState.energyShield.activeUntil"),(level+1)*2000);
        }
    }
});

test("teleport explodes at departure from level two and its level three trail damages only nearby enemies", () => {
    for(let level=1;level<=3;level++) {
        const game=createCombatGame({storage:abilitySave(0,{teleport:level})});
        game.run(`player.x=300;player.y=350;const originEnemy=placeMonster('crawler',330,350);
            const trailEnemy=placeMonster('crawler',600,350);const safeEnemy=placeMonster('crawler',600,430);
            for(const m of monsters){m.health=1000;m.maxHealth=1000;}`);
        game.key("1");game.leftClick(900,350);
        assert.equal(game.run("player.x"),900);
        assert.equal(game.run("originEnemy.health"),level>=2?964:1000);
        assert.equal(game.run("teleportTrails.length"),level===3?1:0);
        game.run("updateAbilityEffects(50)");
        assert.equal(game.run("trailEnemy.health"),level===3?999.55:1000);
        assert.equal(game.run("safeEnemy.health"),1000);
        game.run("gameClock.elapsedMs=3000;updateAbilityEffects(50)");
        assert.equal(game.run("teleportTrails.length"),0);
    }
});

test("upgraded dash phases through thin walls, travels further at level three, and never lands inside a thick wall", () => {
    for(let level=1;level<=3;level++) {
        const game=createCombatGame({storage:abilitySave(0,{dash:level})});
        game.run("player.x=300;player.y=350;walls.push({x:345,y:200,width:25,height:300})");
        game.key("3");game.leftClick(1000,350);
        for(let i=0;i<8;i++)game.advance(50);
        const x=game.run("player.x");
        assert.ok(level===1?x<345:Math.abs(x-(level===2?440:540))<0.01,`level ${level} ends at ${x}`);
        assert.equal(game.run("bodyTouchesWall(player.x,player.y,player.size/2,true)"),false);
    }
    const game=createCombatGame({storage:abilitySave(0,{dash:3})});
    game.run("player.x=300;player.y=350;walls.push({x:345,y:200,width:600,height:300})");
    game.key("3");game.leftClick(1000,350); for(let i=0;i<8;i++)game.advance(50);
    assert.ok(game.run("player.x<345"));
    assert.equal(game.run("bodyTouchesWall(player.x,player.y,player.size/2,true)"),false);
});

test("level two lure pulls much faster and level three explodes once on expiry", () => {
    const traveled=[];
    for(let level=1;level<=3;level++) {
        const game=createCombatGame({storage:abilitySave(0,{lure:level})});
        game.run("player.x=300;player.y=350;const prey=placeMonster('crawler',650,350);prey.health=1000;prey.maxHealth=1000");
        game.key("5");game.leftClick(900,350);game.run("updateMonsters(50)");
        traveled.push(game.run("prey.x-650"));
        game.run("prey.x=900;gameClock.elapsedMs=10000;updateLure();updateLure()");
        assert.equal(game.run("prey.health"),level===3?952:1000);
        assert.equal(game.run("abilityBursts.length"),level===3?1:0);
        assert.equal(game.run("abilityState.lure.point"),null);
    }
    assert.ok(traveled[1]>=traveled[0]*3);
});

test("frenzy throws level-dependent spread volleys then returns to normal single throws", () => {
    for(let level=1;level<=3;level++) {
        const game=createCombatGame({storage:abilitySave(0,{rakeFrenzy:level})});
        game.run("player.x=300;player.y=350");game.key("6");game.leftClick(900,350);game.leftClick(900,350);
        assert.equal(game.run("bullets.length"),2*level);
        assert.equal(game.run(`new Set(bullets.slice(0,${level}).map(b=>b.angle)).size`),level);
        assert.ok(Math.abs(game.run(`bullets.slice(0,${level}).reduce((n,b)=>n+b.dy,0)`))<1e-8);
        game.run("gameClock.elapsedMs=5000;bullets.length=0");game.leftClick(900,350);game.leftClick(900,350);
        assert.equal(game.run("bullets.length"),1);
    }
});

test("cooldown attempts flash the remaining time near the cursor without casting", () => {
    const game=createCombatGame();game.run("mouse.x=550;mouse.y=350");game.key("2");game.releaseKey("2");game.key("2");
    const notice=game.elements.get("cooldownCursorNotice");
    assert.equal(notice.hidden,false);assert.equal(notice.textContent,"15.0s");
    assert.equal(notice.style.left,"562px");assert.equal(notice.style.top,"312px");
    game.advance(851);assert.equal(notice.hidden,true);
    game.elements.get("abilityEnergyShield").emit("click");assert.equal(notice.hidden,false);
    assert.equal(game.run("abilityState.energyShield.lastUsedAt"),0);
});

test("seed value purchases increase both already-spawned and future hay, including mass harvest", () => {
    const game=createCombatGame();game.run("player.seeds=100;hayStacks.push({x:player.x,y:player.y,seeds:10});purchaseUpgrade('seedValue');updateHayStacks()");
    assert.equal(game.run("player.seeds"),100);
    assert.ok(Math.abs(game.run("player.seedRemainder")-0.15)<1e-9);
    game.run("hayStacks.push({x:900,y:350,seeds:20},{x:1000,y:350,seeds:10});harvestPickups.push({x:player.x,y:player.y});updateHarvestPickups([{x1:player.x,y1:player.y,x2:player.x,y2:player.y}])");
    assert.equal(game.run("player.seeds"),130);
    game.run("hayStacks.push({x:player.x,y:player.y,seeds:60});updateHayStacks()");
    assert.equal(game.run("player.seeds"),191,"small fractions accumulate into one bonus seed after collecting 100 base seeds");
    assert.equal(game.run("hayStacks.length"),0);
    const next=createCombatGame();assert.equal(next.run("player.seedMultiplier"),1);
});

test("stats remain purchasable beyond the former speed, fire rate and critical limits", () => {
    const game=createCombatGame();
    game.run("player.speed=8;player.fireRate=15;player.criticalChance=1;player.seeds=1000;updateStatsPanel()");
    for(const name of ["moveSpeed","fireRate","criticalChance"]) {
        const button=game.upgradeButtons.find(b=>b.dataset.upgrade===name);
        assert.equal(button.getAttribute("aria-disabled"),"false");
        assert.ok(!button.textContent.includes("Max"));
        button.emit("click"); button.emit("click");
        assert.equal(game.run(`upgradeLevels.${name}`),2);
    }
    assert.ok(game.run("player.speed>8 && player.fireRate>15 && player.criticalChance>1"));
});

test("uncapped critical chance produces stronger shots beyond 100 percent", () => {
    const game=createCombatGame();
    game.run("weaponState.automaticTarget=false;mouse.x=1000;mouse.y=360;player.damage=10;player.criticalChance=1.5;Math.random=()=>0.49;weaponState.nextShotAt=0;updateAutomaticShooting()");
    assert.equal(game.run("bullets.at(-1).damage"),30);
    game.run("Math.random=()=>0.51;weaponState.nextShotAt=0;updateAutomaticShooting()");
    assert.equal(game.run("bullets.at(-1).damage"),20);
    game.run("player.criticalChance=2;weaponState.nextShotAt=0;updateAutomaticShooting()");
    assert.equal(game.run("bullets.at(-1).damage"),30);
});

test("repeated seed upgrades stay linear and fractional rewards are independent of collection method", () => {
    const game=createCombatGame();game.run("for(let i=0;i<100;i++)applyUpgrade('seedValue')");
    assert.ok(Math.abs(game.run("player.seedMultiplier")-2.5)<1e-9,"100 upgrades add 150% of base value rather than compounding");
    const individually=createCombatGame(), together=createCombatGame();
    for(const current of [individually,together]) current.run("applyUpgrade('seedValue');for(let i=0;i<10;i++)hayStacks.push({x:player.x,y:player.y,seeds:10})");
    individually.run("updateHayStacks()");
    together.run("harvestPickups.push({x:player.x,y:player.y});updateHarvestPickups([{x1:player.x,y1:player.y,x2:player.x,y2:player.y}])");
    assert.equal(individually.run("player.seeds"),101);
    assert.equal(together.run("player.seeds"),101);
});

test("mystery rerolls spend seeds, replace choices, grow cost, and keep the game paused", () => {
    const game=createCombatGame();game.run("player.seeds=200;openMysteryChoice()");
    const first=game.read("lootState.choices.map(c=>c.id)");
    game.elements.get("rerollMysteryBtn").emit("click");
    const second=game.read("lootState.choices.map(c=>c.id)");
    assert.equal(second.some(id=>first.includes(id)),false);
    assert.equal(game.run("player.seeds"),150);assert.equal(game.run("getMysteryRerollCost()"),100);
    game.elements.get("rerollMysteryBtn").emit("click");
    assert.equal(game.run("player.seeds"),50);assert.equal(game.run("getMysteryRerollCost()"),200);
    assert.equal(game.run("gameClock.paused"),true);
    assert.equal(game.run("rerollMysteryChoices()"),false);
    assert.equal(game.elements.get("rerollMysteryBtn").disabled,true);
    game.run("chooseMysteryBonus(0);openMysteryChoice()");assert.equal(game.run("getMysteryRerollCost()"),50);
});

test("rerolls refuse to charge when no different eligible rewards exist or the tab is hidden", () => {
    const game=createCombatGame();game.run("player.seeds=1000;const originalBonuses=getMysteryBonuses;getMysteryBonuses=()=>originalBonuses().slice(0,3);openMysteryChoice()");
    assert.equal(game.run("rerollMysteryChoices()"),false);assert.equal(game.run("player.seeds"),1000);
    assert.match(game.elements.get("rerollMessage").textContent,/already shown/);
    game.run("chooseMysteryBonus(0);getMysteryBonuses=originalBonuses;openMysteryChoice()");
    const before=game.run("player.seeds");game.document.hidden=true;
    assert.equal(game.run("rerollMysteryChoices()"),false);assert.equal(game.run("player.seeds"),before);
});

test("teleport trails follow scrolling terrain and stop with an upgraded time freeze", () => {
    const game=createCombatGame({scrolling:true,storage:abilitySave(0,{teleport:3,timeFreeze:3})});
    game.run("walls.length=0;worldState.nextWallX=Infinity;player.x=400;player.y=350");
    game.key("1");game.leftClick(800,350);game.advance(50);
    assert.equal(game.run("teleportTrails[0].x1"),397.25);
    assert.equal(game.run("teleportTrails[0].x2"),797.25);
    game.key("4");const before=game.run("worldState.scroll");game.advance(50);
    assert.equal(game.run("worldState.scroll"),before);
    assert.equal(game.run("teleportTrails[0].x1"),397.25);
    game.advance(3000);assert.equal(game.run("teleportTrails.length"),0);
    assert.equal(game.run("worldState.scroll"),before);
});

test("level three wall-phasing dash retains top/bottom wrapping and safe landing", () => {
    const game=createCombatGame({storage:abilitySave(0,{dash:3})});
    game.run("player.x=500;player.y=gameHudHeight+60;walls.push({x:450,y:gameHudHeight,width:100,height:20})");
    const expected=game.run("canvas.height-180");
    game.run("useDash(500,gameHudHeight-100)");for(let i=0;i<8;i++)game.advance(50);
    assert.ok(Math.abs(game.run("player.y")-expected)<0.01);
    assert.equal(game.run("bodyTouchesWall(player.x,player.y,player.size/2,true)"),false);
});

test("every fifth level queues a boss once and pauses defer its arrival", () => {
    const game=createCombatGame();
    game.run("player.level=4;player.xp=getXpRequired()-1;awardXp(1);queueBossForLevel(5)");
    assert.deepEqual(game.read("bossState.queue"),[5]);
    game.key(" ");game.advance(50);assert.equal(game.run("isBossEncounterActive()"),false);
    game.key(" ");game.elements.get("abilityInfoBtn").emit("click");game.advance(50);
    assert.equal(game.run("isBossEncounterActive()"),false);
    game.elements.get("closeAbilityGuideBtn").emit("click");game.advance(50);
    assert.equal(game.run("bossState.active.bossLevel"),5);
    assert.equal(game.run("bossState.active.maxHealth"),800);
    assert.ok(game.run("bossState.active.radius>monsterTypes.brute.radius"));
    game.run("queueBossForLevel(10);queueBossForLevel(15);queueBossForLevel(10);updateBossEncounter()");
    assert.deepEqual(game.read("bossState.queue"),[10,15]);
    assert.equal(game.run("monsters.filter(m=>m.type==='boss').length"),1);
});

test("a boss creates a clear stationary arena with no deathzone or regular spawns", () => {
    const game=createCombatGame({scrolling:true});
    game.run("walls.push({x:500,y:200,width:80,height:300});player.x=20;queueBossForLevel(5);updateBossEncounter()");
    const before=game.read("({scroll:worldState.scroll,health:player.health,count:monsters.length})");
    assert.equal(game.run("walls.length"),0);
    game.run("monsterState.nextSpawnAt=0;scrollWorld(50);updateDeathZone(1000);updateMonsterSpawning()");
    assert.deepEqual(game.read("({scroll:worldState.scroll,health:player.health,count:monsters.length})"),before);
    game.drawing.length=0;game.run("drawDeathZone()");assert.equal(game.drawing.length,0);
    game.run("gameClock.elapsedMs=300;drawBossEncounter()");
    assert.ok(game.drawing.some(call=>call.name==='fillText' && call.args[0]==='OBSIDIAN COLOSSUS'));
    game.key(" ");const boss=game.read("bossState.active");game.advance(20000);
    assert.deepEqual(game.read("bossState.active"),boss);
});

test("boss death restores the world and drops loot only once; later bosses are stronger and larger", () => {
    const game=createCombatGame({scrolling:true});
    game.run("queueBossForLevel(5);queueBossForLevel(10);updateBossEncounter();const firstBoss=bossState.active;damageMonster(firstBoss,100000);damageMonster(firstBoss,100000);bossDefeated(firstBoss)");
    assert.equal(game.run("isBossEncounterActive()"),false);
    assert.equal(game.run("monsterState.defeated"),1);
    assert.equal(game.run("mysteryBoxes.filter(b=>b.bossDrop).length"),3);
    assert.deepEqual(game.read("bossLootDrops.map(p=>p.kind).sort()"),["coins","seeds","weapon"]);
    assert.equal(game.run("player.rakeTier"),1,"weapon improves only when collected");
    game.run("const priorScroll=worldState.scroll;scrollWorld(50)");
    assert.ok(game.run("worldState.scroll>priorScroll"));
    game.run("player.x=20;worldState.zoneExposure=0;updateDeathZone(1000)");assert.ok(game.run("player.health<player.maxHealth"));
    game.run("gameClock.elapsedMs=bossState.nextEncounterAt-1;updateBossEncounter()");assert.equal(game.run("isBossEncounterActive()"),false);
    game.run("gameClock.elapsedMs++;updateBossEncounter()");
    assert.equal(game.run("bossState.active.bossLevel"),10);
    assert.ok(game.run("bossState.active.maxHealth>firstBoss.maxHealth && bossState.active.damage>firstBoss.damage && bossState.active.radius>firstBoss.radius"));
});

test("a ranged boss kill drops every reward around the boss instead of near the player", () => {
    const game = createCombatGame();
    game.run(`player.x=230;player.y=350;queueBossForLevel(5);updateBossEncounter();
        bossState.active.x=1000;bossState.active.y=350;
        damageMonster(bossState.active,100000);
        updateLootPickups([{x1:player.x,y1:player.y,x2:player.x,y2:player.y}]);`);
    const drops = game.read("[...mysteryBoxes,...bossLootDrops]");
    assert.equal(drops.length, 6);
    for (const drop of drops) {
        assert.ok(Math.hypot(drop.x-1000,drop.y-350)<160, "reward remains near the defeated boss");
        assert.ok(Math.hypot(drop.x-230,drop.y-350)>500, "reward does not move toward the player");
    }
    assert.equal(game.run("isMysteryChoiceOpen()"), false);
    assert.equal(game.run("player.rakeTier"), 1);
    assert.equal(game.run("abilityProgress.coins"), 0);
});

test("boss spawning bypasses the regular population cap, stays bounded after knockback and resize", () => {
    const game=createCombatGame();
    game.run("for(let i=0;i<60;i++)spawnMonster('crawler');queueBossForLevel(5);updateBossEncounter()");
    assert.equal(game.run("monsters.length"),61);assert.equal(game.run("bossState.active.type"),"boss");
    game.run("bossState.active.x=5000;bossState.active.y=-5000;clampMonsterToMap(bossState.active)");
    assert.ok(game.run("bossState.active.x<=canvas.width-bossState.active.radius && bossState.active.y>=gameHudHeight+bossState.active.radius"));
    game.window.innerWidth=200;game.window.innerHeight=240;game.window.emit("resize");
    assert.ok(game.run("Number.isFinite(bossState.active.x) && bossState.active.radius<50"));
    game.run("endGame();queueBossForLevel(10);bossState.active=null;updateBossEncounter()");assert.equal(game.run("bossState.active"),null);
});

test("weapon loot upgrades independently of XP and continues beyond the original twenty styles", () => {
    const game=createCombatGame();game.leftClick(1000,350);
    const first=game.read("bullets[0]");game.run("upgradeRakeWeapon()");
    assert.equal(game.run("player.level"),1);assert.equal(game.run("player.rakeTier"),2);
    assert.equal(game.run("getRakeDamage()"),14);assert.equal(game.run("getRake().name"),"Copper Tines");
    assert.equal(game.run("bullets[0].damage"),first.damage);assert.equal(game.run("bullets[0].level"),1);
    game.run("player.rakeTier=20;upgradeRakeWeapon()");
    assert.equal(game.run("player.rakeTier"),21);assert.equal(game.run("getRakeDamage()"),52);
    assert.match(game.run("getRake().name"),/Ascended/);
    game.run("drawRake(ctx,100,100,0,player.rakeTier);awardXp(100000)");
    assert.equal(game.run("getRakeDamage()"),52);
});

test("expanded mystery rewards provide over thirty unique cards that apply once without changing permanent progression", () => {
    const probe = createCombatGame();
    probe.run("player.health=40;abilityState.teleport.lastUsedAt=gameClock.elapsedMs;hayStacks.push({x:800,y:350,seeds:20});placeMonster('brute',900,350)");
    const ids = probe.read("getMysteryBonuses().map(card=>card.id)");
    assert.ok(ids.length >= 30);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) {
        const storage = abilitySave(123, { teleport: 2, rakeFrenzy: 3 });
        const saved = storage.get("seedHarvester.abilityProgress.v1");
        const game = createCombatGame({ storage });
        game.run("player.health=40;abilityState.teleport.lastUsedAt=gameClock.elapsedMs;hayStacks.push({x:800,y:350,seeds:20});placeMonster('brute',900,350)");
        assert.equal(game.run(`openMysteryChoice();lootState.choices[0]=getMysteryBonuses().find(card=>card.id===${JSON.stringify(id)});chooseMysteryBonus(0)`), true, id);
        assert.equal(game.run("chooseMysteryBonus(0)"), false, id + " cannot be claimed twice");
        assert.equal(game.run("gameClock.paused"), false, id);
        assert.equal(game.run("Number.isFinite(player.health)&&Number.isFinite(player.seeds)&&player.health>0"), true, id);
        assert.equal(storage.get("seedHarvester.abilityProgress.v1"), saved, id);
        assert.deepEqual(game.read("({coins:abilityProgress.coins,teleport:getAbilityLevel('teleport'),frenzy:getAbilityLevel('rakeFrenzy')})"), { coins: 123, teleport: 2, frenzy: 3 }, id);
    }
});

test("regeneration rewards heal during active simulation and stop while paused or selecting cards", () => {
    const game = createCombatGame();
    game.run("player.health=50;getMysteryBonuses().find(card=>card.id==='regeneration').apply()");
    for (let i = 0; i < 20; i++) game.advance(50);
    assert.ok(Math.abs(game.run("player.health") - 50.3) < 1e-9);
    game.key(" ");
    for (let i = 0; i < 20; i++) game.advance(50);
    game.run("updateMysteryBonuses(1000)");
    assert.ok(Math.abs(game.run("player.health") - 50.3) < 1e-9);
    game.key(" "); game.run("openMysteryChoice()"); game.advance(30000);
    assert.ok(Math.abs(game.run("player.health") - 50.3) < 1e-9);
    game.run("lootState.choices[0]=getMysteryBonuses().find(card=>card.id==='seeds');chooseMysteryBonus(0)");
    for (let i = 0; i < 20; i++) game.advance(50);
    assert.ok(Math.abs(game.run("player.health") - 50.6) < 1e-9);
});

test("armor, kill healing and extra XP rewards affect contact and defeated enemies", () => {
    const game = createCombatGame();
    game.run(`for(const id of ['armor','killHealing','xpBonus'])getMysteryBonuses().find(card=>card.id===id).apply();
        const enemy=placeMonster('brute',player.x,player.y);enemy.damage=11;enemy.xpReward=20;
        updateMonsterContact();`);
    assert.equal(game.run("player.health"), 90);
    game.key(" "); game.run("monsterState.playerInvulnerableUntil=0;updateMonsterContact()");
    assert.equal(game.run("player.health"), 90);
    game.key(" "); game.run("damageMonster(enemy,enemy.health)");
    assert.ok(Math.abs(game.run("player.health") - 90.4) < 1e-9);
    assert.equal(game.run("player.xp"), 22);
    assert.equal(game.run("player.level"), 1);
    game.run("damageMonster(enemy,1000)");
    assert.equal(game.run("player.xp"), 22, "an already defeated enemy grants no second reward");
});

test("pickup magnet reaches hay and potions beyond normal collection range without collecting while paused", () => {
    const game = createCombatGame();
    game.run(`player.x=500;player.y=350;player.health=50;player.seeds=0;
        hayStacks.push({x:player.x+player.size/2+haySettings.size*.35+20,y:player.y,seeds:20,spawnedAt:gameClock.elapsedMs});
        healthPotions.push({x:player.x+player.size/2+19+20,y:player.y,spawnedAt:gameClock.elapsedMs});
        const pickupPath=[{x1:player.x,y1:player.y,x2:player.x,y2:player.y}];
        updateHayStacks();updateLootPickups(pickupPath);`);
    assert.equal(game.run("hayStacks.length+healthPotions.length"), 2);
    game.run("getMysteryBonuses().find(card=>card.id==='magnet').apply()");
    game.key(" "); game.run("updateHayStacks();updateLootPickups(pickupPath)");
    assert.equal(game.run("hayStacks.length+healthPotions.length"), 2);
    game.key(" "); game.run("updateHayStacks();updateLootPickups(pickupPath)");
    assert.equal(game.run("hayStacks.length+healthPotions.length"), 0);
    assert.equal(game.run("player.seeds"), 20);
    assert.equal(game.run("player.health"), 85);
});

test("level cards grant exactly one unlimited character level while weapon cards advance only the rake", () => {
    const game = createCombatGame();
    game.run("player.level=24;player.xp=50;player.rakeTier=3;mysteryBonuses.xpBonus=1;openMysteryChoice();lootState.choices[0]=getMysteryBonuses().find(card=>card.id==='level');chooseMysteryBonus(0)");
    assert.deepEqual(game.read("({level:player.level,xp:player.xp,tier:player.rakeTier,queue:bossState.queue})"), { level: 25, xp: 0, tier: 3, queue: [25] });
    const damage = game.run("getRakeDamage()");
    game.run("openMysteryChoice();lootState.choices[0]=getMysteryBonuses().find(card=>card.id==='weaponUpgrade');chooseMysteryBonus(0)");
    assert.deepEqual(game.read("({level:player.level,xp:player.xp,tier:player.rakeTier})"), { level: 25, xp: 0, tier: 4 });
    assert.ok(game.run("getRakeDamage()") > damage);
});

test("three boss mystery boxes each survive reward selection and expire after five active seconds", () => {
    const game = createCombatGame();
    game.run(`dropBossLoot(1,player);for(const box of mysteryBoxes)Object.assign(box,{x:player.x,y:player.y});
        const lootPath=[{x1:player.x,y1:player.y,x2:player.x,y2:player.y}];`);
    assert.equal(game.run("mysteryBoxes.length"), 3);
    for (let remaining = 2; remaining >= 0; remaining--) {
        game.run("updateLootPickups(lootPath)");
        assert.equal(game.run("mysteryBoxes.length"), remaining);
        assert.equal(game.run("isMysteryChoiceOpen()"), true);
        game.advance(30000);
        assert.equal(game.run("mysteryBoxes.length"), remaining);
        assert.equal(game.run("gameClock.elapsedMs"), 0);
        game.run("lootState.choices[0]=getMysteryBonuses().find(card=>card.id==='seeds');chooseMysteryBonus(0)");
    }
    const expiry = createCombatGame();
    expiry.run("dropBossLoot(1,player);for(const box of mysteryBoxes)Object.assign(box,{x:1000,y:350})");
    expiry.advance(4999); assert.equal(expiry.run("mysteryBoxes.length"), 3);
    expiry.advance(1); assert.equal(expiry.run("mysteryBoxes.length"), 0);
});

test("boss jackpot and weapon drops wait for pickup and can each be claimed only once", () => {
    const game = createCombatGame();
    game.run("player.seeds=0;player.xp=17;dropBossLoot(2,player);mysteryBoxes.length=0");
    assert.equal(game.run("bossLootDrops.length"), 3);
    assert.deepEqual(game.read("({level:player.level,xp:player.xp,tier:player.rakeTier,seeds:player.seeds})"), { level: 1, xp: 17, tier: 1, seeds: 0 });
    game.run(`for(const drop of bossLootDrops)Object.assign(drop,{x:player.x,y:player.y});
        const dropPath=[{x1:player.x,y1:player.y,x2:player.x,y2:player.y}];
        updateLootPickups(dropPath);updateLootPickups(dropPath);`);
    assert.equal(game.run("bossLootDrops.length"), 0);
    assert.deepEqual(game.read("({level:player.level,xp:player.xp,tier:player.rakeTier,seeds:player.seeds})"), { level: 1, xp: 17, tier: 2, seeds: 1000 });
});

test("expanded mystery rerolls exclude owned rake effects and do not repeat the current three cards", () => {
    const game = createCombatGame();
    game.run("for(const name of ['piercingRound','knockback','explosiveKernel','ricochet'])player.unlocks[name]=true;player.seeds=10000;openMysteryChoice()");
    let previous = game.read("lootState.choices.map(card=>card.id)");
    for (let i = 0; i < 5; i++) {
        const seeds = game.run("player.seeds"), cost = game.run("getMysteryRerollCost()");
        assert.equal(game.run("rerollMysteryChoices()"), true);
        const current = game.read("lootState.choices.map(card=>card.id)");
        assert.equal(new Set(current).size, 3);
        assert.ok(current.every(id => !previous.includes(id) && !['piercingRound','knockback','explosiveKernel','ricochet'].includes(id)));
        assert.equal(game.run("player.seeds"), seeds - cost);
        previous = current;
    }
});


test("every repeatable stat has a Max control matching sequential rounded-price purchases", () => {
    const reference = createCombatGame();
    const upgrades = reference.read("Object.entries(statsUpgrades).filter(([,value])=>value.repeatable).map(([name,value])=>({name,id:value.button.id}))");
    assert.equal(upgrades.length, 13);
    for (const { name, id } of upgrades) {
        const bulk = createCombatGame(), single = createCombatGame();
        for (const game of [bulk, single]) game.run(`
            player.seeds=4321; player.health=37; gameClock.elapsedMs=1000;
            weaponState.nextShotAt=2400;
            for(const state of Object.values(abilityState)) state.lastUsedAt=0;
            updateStatsPanel();
        `);
        const maximum = bulk.elements.get(id + "Max");
        assert.ok(maximum, name);
        assert.equal(maximum.getAttribute("aria-disabled"), "false");
        assert.match(maximum.getAttribute("aria-label"), /Buy maximum .* upgrades: \d+ for \d+ seeds/);
        maximum.emit("click");
        single.run(`while(player.seeds >= statsUpgrades[${JSON.stringify(name)}].cost) purchaseUpgrade(${JSON.stringify(name)})`);
        for (const expression of [`player.seeds`, `upgradeLevels[${JSON.stringify(name)}]`, `statsUpgrades[${JSON.stringify(name)}].cost`]) {
            assert.equal(bulk.run(expression), single.run(expression), name + ": " + expression);
        }
        assert.ok(bulk.run(`player.seeds < statsUpgrades[${JSON.stringify(name)}].cost`));
        assert.equal(maximum.getAttribute("aria-disabled"), "true");
        for (const expression of ["player.health", "player.maxHealth", "player.speed", "player.damage", "player.bulletSpeed", "player.fireRate", "player.criticalChance", "player.seedMultiplier", "weaponState.nextShotAt", ...bulk.read("Object.keys(abilityState)").map(ability => `abilityState.${ability}.cooldownMs`), ...bulk.read("Object.keys(abilityState)").map(ability => `getCooldownRemainingMs('${ability}')`)]) {
            assert.ok(Math.abs(bulk.run(expression) - single.run(expression)) < 1e-8, name + ": " + expression);
        }
    }
});

test("Max quotes exact budgets and one bulk purchase produces one sound and one stats refresh", () => {
    const game = createCombatGame();
    for (const budget of [0, 1, 2, 4, 5, 8, 9, 13, 14, 20, 100, 10000]) {
        let remaining = budget, cost = 2, count = 0;
        while (remaining >= cost) { remaining -= cost; count++; cost = Math.ceil(cost * 1.1); }
        const quote = game.read(`player.seeds=${budget}; getUpgradePurchase(statsUpgrades.damage,true)`);
        assert.deepEqual(quote, { count, remainingSeeds: remaining, nextCost: cost, spent: budget - remaining });
    }
    game.run(`
        player.seeds=20;
        const maxSounds=[]; gameAudio.play=name=>maxSounds.push(name);
        let maxRefreshes=0; const originalMaxRefresh=updateStatsPanel;
        updateStatsPanel=()=>{maxRefreshes++; originalMaxRefresh();};
    `);
    game.elements.get("upgradeDamageMax").emit("click");
    assert.deepEqual(game.read("maxSounds"), ["purchase"]);
    assert.equal(game.run("maxRefreshes"), 1);
    assert.equal(game.run("upgradeLevels.damage"), 5);
    assert.equal(game.run("player.seeds"), 0);
    assert.equal(game.run("statsUpgrades.damage.cost"), 7);
    assert.equal(game.elements.get("upgradeDamage").textContent, "7");
    assert.equal(game.elements.get("upgradeDamage").getAttribute("aria-disabled"), "true");
});

test("Max remains available during manual pause and preserves pending shots and cooldown progress", () => {
    const game = createCombatGame();
    game.run("player.seeds=1000; weaponState.nextShotAt=2000; abilityState.teleport.lastUsedAt=0;");
    game.advance(1000); game.key(" ");
    const before = game.read("({time:gameClock.elapsedMs,x:player.x,y:player.y,rate:player.fireRate,remaining:weaponState.nextShotAt-gameClock.elapsedMs,fraction:getCooldownRemainingMs('teleport')/abilityState.teleport.cooldownMs})");
    game.elements.get("upgradeFireRateMax").emit("click");
    const newRate = game.run("player.fireRate");
    assert.ok(newRate > before.rate);
    assert.ok(Math.abs(game.run("weaponState.nextShotAt-gameClock.elapsedMs") - before.remaining * before.rate / newRate) < 1e-8);
    game.run("player.seeds=1000;"); game.elements.get("upgradeCooldown-teleportMax").emit("click");
    assert.ok(Math.abs(game.run("getCooldownRemainingMs('teleport')/abilityState.teleport.cooldownMs") - before.fraction) < 1e-8);
    game.advance(60000);
    assert.equal(game.run("gameClock.paused"), true);
    assert.deepEqual(game.read("({time:gameClock.elapsedMs,x:player.x,y:player.y})"), {time:before.time,x:before.x,y:before.y});
});

test("Max cannot spend before play, without funds, inside choice or guide dialogs, while hidden, or after game over", () => {
    for (const state of ["before", "poor", "choice", "guide", "hidden", "over"]) {
        const game = state === "before" ? createGame() : createCombatGame();
        game.run("player.seeds=100;");
        if (state === "poor") game.run("player.seeds=1");
        if (state === "choice") game.run("openMysteryChoice()");
        if (state === "guide") game.run("openAbilityGuide()");
        if (state === "hidden") { game.document.hidden = true; game.document.emit("visibilitychange"); }
        if (state === "over") game.run("endGame()");
        game.run("updateStatsPanel()");
        const before = game.read("({seeds:player.seeds,damage:player.damage,level:upgradeLevels.damage,cost:statsUpgrades.damage.cost})");
        const button = game.elements.get("upgradeDamageMax");
        assert.equal(button.getAttribute("aria-disabled"), "true", state);
        button.emit("click");
        assert.deepEqual(game.read("({seeds:player.seeds,damage:player.damage,level:upgradeLevels.damage,cost:statsUpgrades.damage.cost})"), before, state);
    }
});

test("Max has no upgrade cap and later seed income enables further bulk upgrades", () => {
    const game = createCombatGame();
    game.run("player.seeds=1000000000; player.health=35; purchaseUpgrade('maxHealth',true)");
    const count = game.run("upgradeLevels.maxHealth");
    assert.ok(count > 100);
    assert.equal(game.run("player.maxHealth"), 100 + count * 2);
    assert.equal(game.run("player.health"), 35 + count * 2);
    game.run("player.seeds+=1000000000; updateStatsPanel()");
    assert.equal(game.elements.get("upgradeMaxHealthMax").getAttribute("aria-disabled"), "false");
    game.elements.get("upgradeMaxHealthMax").emit("click");
    assert.ok(game.run("upgradeLevels.maxHealth") > count);
    assert.ok(game.run("player.seeds < statsUpgrades.maxHealth.cost"));
});


test("boss coin drops roll inclusive 1–10 amounts and only enter the permanent wallet once collected", () => {
    for (const [random, amount] of [[0, 1], [0.999999, 10]]) {
        const storage = abilitySave(27, { teleport: 2 });
        const game = createCombatGame({ storage });
        game.run(`Math.random=()=>${random};dropBossLoot(1,player);mysteryBoxes.length=0;
            const coin=bossLootDrops.find(drop=>drop.kind==='coins');
            for(const drop of bossLootDrops)Object.assign(drop,{x:1000,y:500});
            coin.x=player.x;coin.y=player.y;
            const coinPath=[{x1:player.x,y1:player.y,x2:player.x,y2:player.y}];`);
        assert.equal(game.run("coin.coins"), amount);
        assert.equal(game.run("abilityProgress.coins"), 27);
        assert.equal(game.run("bossLootDrops.filter(drop=>drop.kind==='coins').length"), 1);
        game.key(" "); game.run("updateLootPickups(coinPath)");
        assert.equal(game.run("abilityProgress.coins"), 27, "pause cannot collect coins");
        game.key(" "); game.run("updateLootPickups(coinPath);updateLootPickups(coinPath)");
        assert.equal(game.run("abilityProgress.coins"), 27 + amount);
        assert.equal(game.run("bossLootDrops.filter(drop=>drop.kind==='coins').length"), 0);
        assert.equal(game.elements.get("hudCoins").textContent, String(27 + amount));
        const next = createCombatGame({ storage });
        assert.equal(next.run("abilityProgress.coins"), 27 + amount);
        assert.equal(next.run("getAbilityLevel('teleport')"), 2);
    }
});

test("boss coin drops survive pending placement and wait safely outside the death zone", () => {
    const game = createCombatGame();
    game.run("canvas.width=40;canvas.height=gameHudHeight+40;dropBossLoot(1,player)");
    assert.equal(game.run("mysteryBoxes.length+bossLootDrops.length"), 6);
    assert.equal(game.run("bossLootDrops.find(drop=>drop.kind==='coins').pending"), true);
    const amount = game.run("bossLootDrops.find(drop=>drop.kind==='coins').coins");
    game.run("canvas.width=1280;canvas.height=720;resizeLootPickups();updateLootPickups([])");
    assert.equal(game.run("bossLootDrops.find(drop=>drop.kind==='coins').pending"), false);
    game.run("const savedCoin=bossLootDrops.find(drop=>drop.kind==='coins');savedCoin.x=-200;gameClock.elapsedMs+=60000;updateLootPickups([])");
    assert.equal(game.run("savedCoin.coins"), amount);
    assert.ok(game.run("savedCoin.x>=getDeathZoneWidth()+35"));
    assert.equal(game.run("abilityProgress.coins"), 0);
    game.drawing.length = 0; game.run("drawLootPickups()");
    assert.ok(game.drawing.some(call => call.name === "fillText" && call.args[0] === "+" + amount + (amount === 1 ? " COIN" : " COINS")));
});

test("coin wallet additions coexist with minute rewards, retain saved levels, and handle unavailable storage", () => {
    const storage = abilitySave(10, { dash: 2 });
    const game = createCombatGame({ storage });
    assert.equal(game.run("abilityProgress.awardMinutes(60000)"), 1);
    assert.equal(game.run("abilityProgress.addCoins(7)"), 7);
    assert.equal(game.run("abilityProgress.awardMinutes(120000)"), 2);
    assert.equal(game.run("abilityProgress.awardMinutes(120000)"), 0);
    assert.equal(game.run("abilityProgress.coins"), 20);
    storage.set("seedHarvester.abilityProgress.v1", JSON.stringify({ coins: 22, levels: { dash: 3 } }));
    assert.equal(game.run("abilityProgress.addCoins(3)"), 3);
    assert.deepEqual(game.read("({coins:abilityProgress.coins,dash:getAbilityLevel('dash')})"), { coins: 25, dash: 3 });
    for (const amount of [0, -1, 1.5, Infinity, NaN]) {
        assert.equal(game.run(`abilityProgress.addCoins(${String(amount)})`), 0);
    }
    assert.equal(game.run("abilityProgress.coins"), 25);
    const blocked = createCombatGame({ storageBlocked: true });
    assert.equal(blocked.run("abilityProgress.addCoins(4);abilityProgress.awardMinutes(60000);abilityProgress.coins"), 5);
});

test("mystery rewards restart at defaults and omit redundant duration labels", () => {
    const storage = abilitySave(65, { lure: 3, dash: 2 });
    const game = createCombatGame({ storage });
    const snapshot = `({maxHealth:player.maxHealth,damage:player.damage,speed:player.speed,fireRate:player.fireRate,
        bulletSpeed:player.bulletSpeed,criticalChance:player.criticalChance,seedMultiplier:player.seedMultiplier,
        rakeTier:player.rakeTier,rakeDamageMultiplier:player.rakeDamageMultiplier,unlocks:player.unlocks,
        bonuses:mysteryBonuses,rakeCooldown:rakeState.cooldownMs,
        abilityCooldowns:Object.fromEntries(Object.entries(abilityState).map(([id,state])=>[id,state.cooldownMs]))})`;
    const defaults = game.read(snapshot);
    game.run("player.health=40;hayStacks.push({x:800,y:350,seeds:20});placeMonster('brute',900,350);abilityState.teleport.lastUsedAt=gameClock.elapsedMs");
    assert.equal(game.run("getMysteryBonuses().some(card=>/for this run/i.test(card.kind+' '+card.description))"), false);
    game.run("for(const card of getMysteryBonuses())card.apply()");
    assert.notDeepEqual(game.read(snapshot), defaults);
    const next = createCombatGame({ storage });
    assert.deepEqual(next.read(snapshot), defaults);
    assert.deepEqual(next.read("({coins:abilityProgress.coins,lure:getAbilityLevel('lure'),dash:getAbilityLevel('dash')})"), { coins: 65, lure: 3, dash: 2 });
});

test("boss fights stop survival time, difficulty, history and minute coins while combat clocks advance", () => {
    const storage = new Map(), game = createCombatGame({ storage });
    game.advance(59000);
    const difficulty = game.read("getMonsterDifficulty()");
    const scrollSpeed = game.run("getScrollSpeed()");
    game.run("queueBossForLevel(5);updateBossEncounter();bossState.nextAttackAt=Infinity;monsterState.playerInvulnerableUntil=Infinity;useEnergyShield()");
    const before = game.read("({x:bossState.active.x,y:bossState.active.y})");
    game.advance(60000);
    assert.equal(game.run("gameClock.elapsedMs"), 119000);
    assert.equal(game.run("getSurvivalTime()"), 59000);
    assert.equal(game.elements.get("gameTime").textContent, "00:59");
    assert.equal(game.elements.get("timeLabel").textContent, "Time · Held");
    assert.equal(game.run("isEnergyShieldActive()"), false);
    assert.equal(game.run("getCooldownRemainingMs('energyShield')"), 0);
    assert.equal(game.run("abilityProgress.coins"), 0);
    assert.notDeepEqual(game.read("({x:bossState.active.x,y:bossState.active.y})"), before);
    assert.deepEqual(game.read("getMonsterDifficulty()"), difficulty);
    assert.equal(game.run("getScrollSpeed()"), scrollSpeed);
    assert.equal(JSON.parse(storage.get("seedHarvester.survivalHistory.v1")).bestMs, 59000);
    game.key(" "); game.advance(15000);
    assert.equal(game.run("gameClock.elapsedMs"), 119000);
    game.key(" ");
    game.run("damageMonster(bossState.active,100000);mysteryBoxes.length=0;bossLootDrops.length=0;monsterState.nextSpawnAt=Infinity");
    game.advance(1000);
    assert.equal(game.run("getSurvivalTime()"), 60000);
    assert.equal(game.elements.get("gameTime").textContent, "01:00");
    assert.equal(game.run("abilityProgress.coins"), 1);
    assert.equal(game.elements.get("timeLabel").textContent, "Time");
    game.run("endGame()");
    assert.equal(JSON.parse(storage.get("seedHarvester.survivalHistory.v1")).bestMs, 60000);
});

test("dying or leaving during a boss records only survival time outside the encounter", () => {
    const storage = new Map(), game = createCombatGame({ storage });
    game.advance(2500);
    game.run("queueBossForLevel(5);updateBossEncounter();bossState.nextAttackAt=Infinity;monsterState.playerInvulnerableUntil=Infinity");
    game.advance(20000);
    game.document.hidden = true; game.document.emit("visibilitychange");
    game.advance(90000); game.window.emit("pagehide");
    assert.equal(JSON.parse(storage.get("seedHarvester.survivalHistory.v1")).recent[0].elapsedMs, 2500);
    game.document.hidden = false; game.document.emit("visibilitychange");
    game.advance(3000); game.run("endGame()");
    const record = JSON.parse(storage.get("seedHarvester.survivalHistory.v1")).recent[0];
    assert.equal(record.elapsedMs, 2500); assert.equal(record.completed, true);
    assert.equal(game.elements.get("gameOverTime").textContent, "00:02");
});

test("boss immunity includes level-three lure explosions but leaves teleport damage effective", () => {
    const game = createCombatGame({ storage: abilitySave(0, { lure: 3, teleport: 2 }) });
    game.run(`queueBossForLevel(5);updateBossEncounter();
        bossState.active.x=700;bossState.active.y=350;
        mouse.x=700;mouse.y=350;useLure();
        const prey=placeMonster('crawler',700,350);
        gameClock.elapsedMs=abilityState.lure.activeUntil;updateLure();`);
    assert.equal(game.run("bossState.active.health"), 800);
    assert.equal(game.run("monsters.includes(prey)"), false);
    game.run(`abilityState.lure.lastUsedAt=-Infinity;useLure();
        abilityState.lure.lastUsedAt=-Infinity;useLure();`);
    assert.equal(game.run("bossState.active.health"), 800, "replacing a level-three lure cannot damage the boss");
    game.run("leaveTeleportEffects({x:700,y:350},{x:900,y:350})");
    assert.equal(game.run("bossState.active.health"), 764);
});

function createBossAttackGame() {
    const game = createCombatGame();
    game.run(`
        queueBossForLevel(5); updateBossEncounter();
        const attackBoss = bossState.active;
        gameClock.elapsedMs = 10000;
        attackBoss.x = 300; attackBoss.y = 350; attackBoss.moveAfter = 0;
        bossState.nextAttackAt = Infinity;
        player.x = 600; player.y = 350;
        monsterState.playerInvulnerableUntil = 0;
        function advanceBossAttack(age, delta = 50) {
            gameClock.elapsedMs = bossState.attack.startedAt + bossState.attack.windupMs + age;
            updateBossAttacks(delta);
        }
    `);
    return game;
}

test("boss ignores Lure and Time Freeze while ordinary monsters still obey both", () => {
    const game = createBossAttackGame();
    game.run(`
        attackBoss.x = 800; player.x = 200;
        const lureVictim = placeMonster('crawler', 600, 500);
        abilityState.lure.point = {x:1100,y:350};
        abilityState.lure.castLevel = 3; abilityState.lure.activeUntil = 30000;
        updateMonsters(50);
    `);
    assert.ok(game.run("attackBoss.x < 800"));
    assert.ok(game.run("lureVictim.x > 600"));
    const before = game.read("({boss:attackBoss.x,normal:lureVictim.x,y:lureVictim.y})");
    game.run("abilityState.timeFreeze.activeUntil = 30000; updateMonsters(50);");
    assert.ok(game.run("attackBoss.x") < before.boss);
    assert.equal(game.run("lureVictim.x"), before.normal);
    assert.equal(game.run("lureVictim.y"), before.y);
    game.run("attackBoss.x=player.x; attackBoss.y=player.y; updateMonsterContact();");
    assert.equal(game.run("player.health"), 72);
    game.run(`
        attackBoss.x = 1000; lureVictim.x = player.x; lureVictim.y = player.y;
        monsterState.playerInvulnerableUntil = 0; updateMonsterContact();
    `);
    assert.equal(game.run("player.health"), 72);
});

for (const [type, amount, position] of [
    ["shockwave", 24, "player.x=430; advanceBossAttack(500);"],
    ["volley", 18, "player.x=369; advanceBossAttack(1);"],
    ["meteors", 29, "advanceBossAttack(1);"],
    ["beam", 26, "advanceBossAttack(550);"],
    ["charge", 34, "player.x=550; advanceBossAttack(300);"]
]) {
    test(`boss ${type} visibly warns before its distinct attack and can damage the player`, () => {
        const game = createBossAttackGame();
        game.run(`beginBossAttack('${type}'); drawBossAttacks(); advanceBossAttack(-1);`);
        assert.equal(game.run("player.health"), 100);
        assert.equal(game.run("bossState.attack.launched"), false);
        assert.ok(game.drawing.some(call => call.name === "fillText" && call.args[0] === game.run(`bossAttackLabels['${type}']`)));
        game.run(position);
        assert.equal(game.run("player.health"), 100 - amount);
        assert.equal(game.run("bossState.attack.launched"), true);
        if (type === "charge") {
            assert.ok(game.run("attackBoss.x > bossState.attack.x && attackBoss.x < bossState.attack.endX"));
            assert.equal(game.run("attackBoss.y"), 350);
        }
        game.run("advanceBossAttack(bossState.attack.durationMs + 1);");
        assert.equal(game.run("bossState.attack"), null);
    });
}

test("boss attacks retain safe exits around the double ring gap, marked circles, beam sweep, volley and charge", () => {
    for (const type of ["shockwave", "volley", "meteors", "beam", "charge"]) {
        const game = createBossAttackGame();
        game.run(`beginBossAttack('${type}'); player.x=300;player.y=560;`);
        if (type === "shockwave") game.run("player.x=300+Math.cos(bossState.attack.gapAngle)*210;player.y=350+Math.sin(bossState.attack.gapAngle)*210");
        if (type === "meteors") game.run("player.x=100;player.y=600");
        // Use real short updates so secondary bursts and meteor warnings are exercised too.
        game.run(`const dodgeStart=bossState.attack.startedAt+bossState.attack.windupMs;
            for(let age=0;bossState.attack && age<4000;age+=25){
                gameClock.elapsedMs=dodgeStart+age;updateBossAttacks(25);
                if('${type}'==='meteors' && age===475){player.x=300;player.y=100;}
                if('${type}'==='volley' && age===250){player.x=100;player.y=350;}
                if('${type}'==='volley' && age===950){player.x=300;player.y=100;}
            }`);
        assert.equal(game.run("player.health"), 100, type);
    }
});

test("boss attack defenses respect armor, shield, invulnerability, pause and time-freeze immunity", () => {
    const game = createBossAttackGame();
    game.run(`
        beginBossAttack('beam');
        abilityState.timeFreeze.activeUntil=30000;
        manuallyPaused=true; updateGamePauseState();
        advanceBossAttack(1);
    `);
    assert.equal(game.run("bossState.attack.launched"), false);
    assert.equal(game.run("player.health"), 100);
    game.run(`
        manuallyPaused=false; updateGamePauseState();
        abilityState.energyShield.activeUntil=30000; advanceBossAttack(520);
    `);
    assert.equal(game.run("bossState.attack.launched"), true);
    assert.equal(game.run("player.health"), 100);
    game.run("abilityState.energyShield.activeUntil=0; monsterState.playerInvulnerableUntil=30000; advanceBossAttack(530);");
    assert.equal(game.run("player.health"), 100);
    game.run("monsterState.playerInvulnerableUntil=0; mysteryBonuses.armor=1; advanceBossAttack(540);");
    assert.equal(game.run("player.health"), 87);
    game.run("advanceBossAttack(550);");
    assert.equal(game.run("player.health"), 87);
});

test("boss cycles all five attacks, scales their pressure, and removes hazards at death", () => {
    const game = createBossAttackGame();
    game.run("abilityState.energyShield.activeUntil=Infinity;");
    const types = [];
    for (let i = 0; i < 5; i++) {
        game.run("beginBossAttack();");
        types.push(game.run("bossState.attack.type"));
        game.run("advanceBossAttack(bossState.attack.durationMs+1);");
    }
    assert.deepEqual(types, ["shockwave", "volley", "meteors", "beam", "charge"]);
    game.run("attackBoss.bossStage=2; beginBossAttack('volley'); advanceBossAttack(1);");
    assert.equal(game.run("bossState.attack.damageScale"), 1.12);
    assert.ok(game.run("bossState.attack.projectiles.length") > 0);
    game.run("damageMonster(attackBoss, attackBoss.health);");
    assert.equal(game.run("bossState.attack"), null);
    assert.equal(game.run("bossState.nextAttackAt"), Infinity);
    const health = game.run("player.health");
    game.run("abilityState.energyShield.activeUntil=0; updateBossAttacks(50); drawBossAttacks();");
    assert.equal(game.run("player.health"), health);
});

test("boss pursuit is much faster, continues through ranged barrages, and leaves only short recovery windows", () => {
    const game = createBossAttackGame();
    assert.equal(game.run("attackBoss.speed"), 138);
    game.run("updateMonsters(50)");
    assert.ok(Math.abs(game.run("attackBoss.x") - 306.9) < 1e-8);
    for (const type of ["meteors", "volley"]) {
        game.run(`attackBoss.x=300;attackBoss.y=350;player.x=800;player.y=350;
            beginBossAttack('${type}');`);
        if (type === "volley") game.run("advanceBossAttack(0)");
        game.run("updateMonsters(50)");
        assert.ok(game.run("attackBoss.x > 300"), type);
    }
    for (const type of ["shockwave", "beam", "charge"]) {
        game.run(`attackBoss.x=300;beginBossAttack('${type}');updateMonsters(50)`);
        assert.equal(game.run("attackBoss.x"), 300, "stationary telegraph: " + type);
    }
    game.run("abilityState.energyShield.activeUntil=Infinity;advanceBossAttack(bossState.attack.durationMs+1)");
    assert.equal(game.run("bossState.nextAttackAt-gameClock.elapsedMs"), 750);
    game.run("attackBoss.bossStage=10;beginBossAttack('charge');");
    assert.equal(game.run("bossState.attack.durationMs"), 288);
    assert.ok(game.run("bossState.attack.windupMs < 650 && bossState.attack.windupMs >= 520"));
    game.run("advanceBossAttack(bossState.attack.durationMs+1)");
    assert.ok(game.run("bossState.nextAttackAt-gameClock.elapsedMs < 510"));
    game.run("damageMonster(attackBoss,attackBoss.health);gameClock.elapsedMs+=4500;queueBossForLevel(10);updateBossEncounter()");
    assert.equal(game.run("bossState.active.speed"), 146);
    assert.ok(game.run("bossState.active.moveAfter >= bossState.introStartedAt + bossState.introDurationMs"), "arrival banner never conceals a moving boss");
});

test("volley fires three faster, separately aimed bursts and preserves each fresh aim warning", () => {
    const game = createBossAttackGame();
    game.run("abilityState.energyShield.activeUntil=Infinity;beginBossAttack('volley');advanceBossAttack(0)");
    assert.equal(game.run("bossState.attack.count"), 9);
    assert.equal(game.run("bossState.attack.projectiles.length"), 9);
    assert.equal(game.run("bossState.attack.burstsFired"), 1);
    assert.equal(game.run("bossState.attack.speed"), 340);
    game.run("player.x=300;player.y=600;advanceBossAttack(200)");
    assert.equal(game.run("bossState.attack.burstAngle"), Math.PI / 2);
    game.run("player.x=600;player.y=350;advanceBossAttack(699)");
    assert.equal(game.run("bossState.attack.burstsFired"), 1);
    game.run("advanceBossAttack(700)");
    assert.equal(game.run("bossState.attack.burstsFired"), 2);
    assert.equal(game.run("bossState.attack.burstAngle"), Math.PI / 2, "locked warning direction matches the shot");
    game.run("player.x=100;advanceBossAttack(900);advanceBossAttack(1400)");
    assert.equal(game.run("bossState.attack.burstsFired"), 3);
    assert.equal(game.run("bossState.attack.burstAngle"), Math.PI);

    const delayed = createBossAttackGame();
    delayed.run("beginBossAttack('volley');advanceBossAttack(0);advanceBossAttack(600);advanceBossAttack(700)");
    assert.equal(delayed.run("bossState.attack.burstsFired"), 1, "a delayed frame cannot remove a new warning");
    delayed.run("advanceBossAttack(1100)");
    assert.equal(delayed.run("bossState.attack.burstsFired"), 2);
});

test("meteor follow-up warns at the player's new location before striking and pauses with the game", () => {
    const game = createBossAttackGame();
    game.run("beginBossAttack('meteors');player.x=200;player.y=600;advanceBossAttack(450)");
    assert.equal(game.run("bossState.attack.markers.length"), 8);
    assert.deepEqual(game.read("({x:bossState.attack.markers[5].x,y:bossState.attack.markers[5].y,delay:bossState.attack.markers[5].delay})"), { x: 200, y: 600, delay: 1150 });
    assert.equal(game.run("player.health"), 100);
    game.run("advanceBossAttack(1149)");
    assert.equal(game.run("player.health"), 100);
    game.run("manuallyPaused=true;updateGamePauseState();advanceBossAttack(1150)");
    assert.equal(game.run("bossState.attack.markers[5].struck"), false);
    game.run("manuallyPaused=false;updateGamePauseState();advanceBossAttack(1150)");
    assert.equal(game.run("player.health"), 71);
});

test("beam sweeps the previewed arc while fast charge preserves continuous collision and map bounds", () => {
    const game = createBossAttackGame();
    game.run("beginBossAttack('beam');advanceBossAttack(0)");
    assert.equal(game.run("player.health"), 100);
    assert.ok(game.run("bossState.attack.endY < 350"));
    game.run("advanceBossAttack(550);drawBossAttacks()");
    assert.equal(game.run("player.health"), 74);
    assert.ok(Math.abs(game.run("bossState.attack.endY") - 350) < 1e-8);
    game.run("advanceBossAttack(1000)");
    assert.ok(game.run("bossState.attack.endY > 350"));

    const charge = createBossAttackGame();
    charge.run("player.x=600;beginBossAttack('charge')");
    assert.equal(charge.run("bossState.attack.endX-bossState.attack.x"), 680);
    assert.equal(charge.run("bossState.attack.durationMs"), 360);
    charge.run("advanceBossAttack(350)");
    assert.equal(charge.run("player.health"), 66, "fast motion cannot skip a player between its endpoints");
    assert.ok(charge.run("attackBoss.x > player.x && attackBoss.x+attackBoss.radius <= canvas.width"));
});

test("double shockwave draws and collides with both advancing rings without stacking damage in invulnerability", () => {
    const game = createBossAttackGame();
    game.run("beginBossAttack('shockwave');advanceBossAttack(500)");
    assert.equal(game.run("bossState.attack.rings.length"), 2);
    assert.equal(game.run("bossState.attack.endRadius"), 760);
    assert.ok(game.run("bossState.attack.rings[0].radius > bossState.attack.rings[1].radius"));
    assert.equal(game.run("player.health"), 76);
    game.run("advanceBossAttack(1000);drawBossAttacks()");
    assert.equal(game.run("player.health"), 76);
    assert.equal(game.run("bossState.attack.rings.every(ring=>ring.hit)"), true);
    const activeRings = game.drawing.filter(call => call.name === "arc" && call.args[0] === 300 && call.args[1] === 350);
    assert.equal(activeRings.length, 2);
});
