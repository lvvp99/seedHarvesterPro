// --------------------
// ELEMENTS
// --------------------

const initialView = document.getElementById("initialView");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const fullscreenMessage = document.getElementById("fullscreenMessage");
let fullscreenPending = false;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const startGameBtn = document.getElementById("startGameBtn");
const bottomHud = document.getElementById("bottomHud");
const pauseBtn = document.getElementById("pauseBtn");
const autoTargetToggle = document.getElementById("autoTargetToggle");
let manuallyPaused = false;

const gameHud =
    document.getElementById("gameHud");

const healthBar =
    document.getElementById("healthBar");

const healthText =
    document.getElementById("healthText");

const seedHudCount =
    document.getElementById("seedHudCount");

const gameTime = document.getElementById("gameTime");
const gameOverDialog = document.getElementById("gameOverDialog");
const gameOverTime = document.getElementById("gameOverTime");
const gameOverKills = document.getElementById("gameOverKills");
const restartGameBtn = document.getElementById("restartGameBtn");

const statsPanel = document.getElementById("statsPanel");
const statsToggle = document.getElementById("statsToggle");
const statsContent = document.getElementById("statsContent");
const statsDragHandle = document.getElementById("statsDragHandle");
const statsPosition = { x: 10, y: null, drag: null };
const statFields = {
    health: document.getElementById("statHealth"),
    speed: document.getElementById("statSpeed"),
    damage: document.getElementById("statDamage"),
    bulletSpeed: document.getElementById("statBulletSpeed"),
    fireRate: document.getElementById("statFireRate"),
    criticalChance: document.getElementById("statCriticalChance"),
    weaponEffects: document.getElementById("statWeaponEffects"),
    rakeName: document.getElementById("statRakeName"),
    rakeDamage: document.getElementById("statRakeDamage")
};

const upgradeButtons = [...document.querySelectorAll(".statUpgradeButton")];
const statsUpgrades = Object.fromEntries(upgradeButtons.map(button => [button.dataset.upgrade, {
    button, cost: Number(button.dataset.cost), repeatable: button.dataset.repeatable === "true",
    label: ({maxHealth:"Maximum Health",damage:"Basic attack damage",bulletSpeed:"Basic attack speed",fireRate:"Basic attack fire rate",criticalChance:"Basic attack critical chance",piercingRound:"Piercing Round",knockback:"Knockback",explosiveKernel:"Explosive Kernel"})[button.dataset.upgrade]
}]));

const abilityHud = {
    teleport: {
        item: document.getElementById("abilityTeleport"),
        cooldownText: document.getElementById("teleportCooldownText")
    },

    energyShield: {
        item: document.getElementById("abilityEnergyShield"),
        cooldownText: document.getElementById("energyShieldCooldownText")
    },

    dash: {
        item: document.getElementById("abilityDash"),
        cooldownText: document.getElementById("dashCooldownText")
    },

    timeFreeze: {
        item: document.getElementById("abilityTimeFreeze"),
        cooldownText: document.getElementById("timeFreezeCooldownText")
    },

    lure: {
        item: document.getElementById("abilityLure"),
        cooldownText: document.getElementById("lureCooldownText")
    }
};


// --------------------
// CANVAS SIZE
// --------------------

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;


// --------------------
// GAME DATA
// --------------------

const player = {

    x: canvas.width / 2,
    y: canvas.height / 2,

    speed: 3,
    size: 40,

    image: null,

    health: 100,
    maxHealth: 100,

    seeds: 0,
    level: 1,
    xp: 0,
    totalXp: 0,

    damage: 10,
    bulletSpeed: 10,
    fireRate: 0.5,
    criticalChance: 0,


    unlocks: {

        piercingRound: false,
        knockback: false,
        explosiveKernel: false,

        teleport: true,
        energyShield: true,
        dash: true,
        timeFreeze: true,
        lure: true

    }

};


const upgradeLevels = {

    maxHealth: 0,
    damage: 0,
    bulletSpeed: 0,
    fireRate: 0,
    criticalChance: 0

};


const abilityState = {

    teleport: {
        cooldownMs: 5000,
        lastUsedAt: -Infinity
    },

    energyShield: {
        cooldownMs: 15000,
        lastUsedAt: -Infinity,
        durationMs: 2000,
        activeUntil: 0
    },

    dash: {
        cooldownMs: 2000,
        lastUsedAt: -Infinity,
        remainingMs: 0,
        directionX: 0,
        directionY: 0
    },

    timeFreeze: {
        cooldownMs: 60000,
        lastUsedAt: -Infinity,
        durationMs: 3000,
        activeUntil: 0
    },

    lure: {
        cooldownMs: 60000,
        lastUsedAt: -Infinity,
        durationMs: 10000,
        activeUntil: 0,
        point: null
    }

};

let armedAbility = null;
const abilityLabels = { teleport: "Teleport", energyShield: "Energy Shield", dash: "Dash", timeFreeze: "Time Freeze", lure: "Lure" };
const instantAbilities = new Set(["energyShield", "timeFreeze"]);
const abilityInstructions = {
    teleport: "Left-click to teleport to the marker.", energyShield: "Instantly shield yourself for 2 seconds.",
    dash: "Left-click to sprint towards the cursor.", timeFreeze: "Instantly freeze all enemies for 3 seconds.",
    lure: "Left-click on open ground to plant a lure at the cursor for 10 seconds."
};
const dashTrail = [];

const abilitySoundState = Object.fromEntries(Object.keys(abilityState)
    .map(name => [name, { active: false, coolingDown: false }]));

const movement = {
    target: null,
    rightButtonDown: false,
    keys: new Set()
};
const bullets = [];

const weaponState = {
    automaticTarget: true,
    nextShotAt: 0,
    aimX: 0,
    aimY: -1,
    target: null,
    nextTargetSearchAt: 0
};

const mouse = {
    x: canvas.width / 2,
    y: canvas.height / 2
};

let gameStarted = false;
let gameOver = false;

const gameClock = {
    elapsedMs: 0,
    lastUpdatedAt: null,
    paused: true
};

const haySettings = {
    size: 48,
    initialStacks: 5,
    maxStacks: 12,
    minSpawnDelayMs: 2000,
    maxSpawnDelayMs: 4000,
    minSeeds: 5,
    maxSeeds: 10,
    extraSeedsPerMinute: 2,
    collectionDurationMs: 1200
};

const hayImage = new Image();
hayImage.src = "imgs/random/hay.svg";

const hayStacks = [];
const collectionEffects = [];
const harvestPickups = [];
const harvestBursts = [];
let nextHarvestPickupAt = 18000;
let nextHaySpawnAt = 0;
let gameHudHeight = 0;


// --------------------
// HELPERS
// --------------------

function clamp(value, min, max) {

    return Math.max(
        min,
        Math.min(max, value)
    );

}


function clampPointToCanvas(x, y) {

    const bounds = getMapBounds(player.size / 2);

    return {
        x: clamp(
            x,
            Math.min(bounds.left, canvas.width / 2),
            Math.max(bounds.right, canvas.width / 2)
        ),

        y: clamp(
            y,
            Math.min(bounds.top, bounds.bottom),
            bounds.bottom
        )
    };

}

function getWrapBounds() {
    return {
        left: 0, right: Math.max(1, canvas.width),
        top: Math.min(gameHudHeight, Math.max(0, canvas.height - 1)),
        bottom: Math.max(1, canvas.height)
    };
}

function getMovementTarget(x, y) {
    const bounds = getWrapBounds();
    const edgeY = Math.min(12, (bounds.bottom - bounds.top) / 4);
    const radius = Math.min(player.size / 2, canvas.width / 2);
    // Only the top and bottom strips allow mouse-driven wrapping.
    return {
        x: clamp(x, radius, Math.max(radius, canvas.width - radius)),
        y: y <= bounds.top + edgeY ? bounds.top - 1
            : y >= bounds.bottom - edgeY ? bounds.bottom + 1 : y
    };
}


function getCooldownRemainingMs(abilityName) {

    const ability =
        abilityState[abilityName];

    const elapsed =
        gameClock.elapsedMs -
        ability.lastUsedAt;

    const remaining =
        ability.cooldownMs -
        elapsed;

    return Math.max(0, remaining);

}


function isAbilityOnCooldown(abilityName) {

    return getCooldownRemainingMs(
        abilityName
    ) > 0;

}


function isEnergyShieldActive() {

    return gameClock.elapsedMs <
        abilityState.energyShield.activeUntil;

}


function isTimeFreezeActive() {

    return gameClock.elapsedMs <
        abilityState.timeFreeze.activeUntil;

}


// --------------------
// PLAY TIME AND HAY
// --------------------

function updateGameClock(now = performance.now()) {
    if (gameClock.lastUpdatedAt !== null && !gameClock.paused) {
        gameClock.elapsedMs += Math.max(0, now - gameClock.lastUpdatedAt);
    }

    gameClock.lastUpdatedAt = now;

    const totalSeconds = Math.floor(gameClock.elapsedMs / 1000);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    const minutes = String(Math.floor(totalSeconds / 60) % 60).padStart(2, "0");
    const hours = Math.floor(totalSeconds / 3600);
    const formattedTime = hours > 0
        ? String(hours).padStart(2, "0") + ":" + minutes + ":" + seconds
        : minutes + ":" + seconds;

    if (gameTime.textContent !== formattedTime) {
        gameTime.textContent = formattedTime;
    }
}

function updateGamePauseState() {
    // Account for the last active interval before entering or leaving a pause.
    updateGameClock();
    gameClock.paused = !gameStarted || gameOver || manuallyPaused || document.hidden;
    gameAudio.setScene(gameOver ? "over" : !gameStarted ? "menu" : manuallyPaused ? "paused" : "play");

    if (gameClock.paused) {
        cancelMovement();
    }
}

function cancelMovement() {
    movement.target = null;
    movement.rightButtonDown = false;
    movement.keys.clear();
    clearArmedAbility();
    stopStatsDrag();
}

function endGame() {
    if (gameOver) return;
    updateGameClock();
    gameOver = true;
    gameClock.paused = true;
    survivalHistory.save(gameClock.elapsedMs, true);
    cancelMovement();
    updateHud();
    updateStatsPanel();
    gameOverTime.textContent = gameTime.textContent;
    gameOverKills.textContent = monsterState.defeated;
    document.getElementById("pauseOverlay").hidden = true;
    gameAudio.moveControls("gameOverSoundSlot");
    gameAudio.setScene("over");
    gameAudio.play("gameOver");
    gameOverDialog.showModal();
}

gameOverDialog.addEventListener("cancel", event => event.preventDefault());
restartGameBtn.addEventListener("click", () => {
    gameAudio.play("click");
    window.setTimeout(() => window.location.reload(), 140);
});

function getMapBounds(radius) {
    const margin = radius + 12;
    return {
        left: margin,
        right: canvas.width - margin,
        top: gameHudHeight + margin,
        bottom: canvas.height - margin
    };
}

function findHayPosition(ignoredStack = null, incoming = false) {
    const bounds = getMapBounds(haySettings.size / 2);
    if (worldState.started) bounds.left = Math.max(bounds.left, getDeathZoneWidth() + haySettings.size);
    if (bounds.right < bounds.left || bounds.bottom < bounds.top) {
        return null;
    }

    // Bound attempts so a small or crowded map never stalls the game loop.
    for (let attempt = 0; attempt < 80; attempt++) {
        const x = incoming ? canvas.width + haySettings.size / 2 + Math.random() * 90
            : bounds.left + Math.random() * (bounds.right - bounds.left);
        const y = bounds.top + Math.random() * (bounds.bottom - bounds.top);
        const nearPlayer = Math.hypot(x - player.x, y - player.y)
            < player.size / 2 + haySettings.size / 2 + 24;
        const nearHay = hayStacks.some(stack => stack !== ignoredStack
            && Math.hypot(x - stack.x, y - stack.y) < haySettings.size + 16);

        if (!nearPlayer && !nearHay && !bodyTouchesWall(x, y, haySettings.size / 2 + 6)) {
            return { x, y };
        }
    }

    return null;
}

function getHaySeedAmount(elapsedMs) {
    // 0:00 = 5–10, 1:00 = 7–12, 5:00 = 15–20, and so on.
    const timeBonus = Math.floor(elapsedMs / 60000) * haySettings.extraSeedsPerMinute;
    return haySettings.minSeeds + timeBonus
        + Math.floor(Math.random() * (haySettings.maxSeeds - haySettings.minSeeds + 1));
}

function spawnHayStack(incoming = worldState.started) {
    if (hayStacks.length >= haySettings.maxStacks) {
        return;
    }

    const position = findHayPosition(null, incoming);
    if (position) {
        hayStacks.push({
            ...position,
            seeds: getHaySeedAmount(gameClock.elapsedMs),
            spawnedAt: gameClock.elapsedMs
        });
        gameAudio.play("hay");
    }
}

function scheduleNextHayStack() {
    nextHaySpawnAt = gameClock.elapsedMs + haySettings.minSpawnDelayMs
        + Math.random() * (haySettings.maxSpawnDelayMs - haySettings.minSpawnDelayMs);
}

function updateHayStacks(previousX = player.x, previousY = player.y, segments = null) {
    if (gameClock.paused) {
        return;
    }

    if (gameClock.elapsedMs >= nextHaySpawnAt) {
        spawnHayStack();
        scheduleNextHayStack();
    }

    const path = segments || [{ x1: previousX, y1: previousY, x2: player.x, y2: player.y }];
    let collected = false;

    for (let i = hayStacks.length - 1; i >= 0; i--) {
        const stack = hayStacks[i];
        // Wrapping produces separate exit/entry segments, never a path across the map.
        const touched = path.some(segment => {
            const dx = segment.x2 - segment.x1;
            const dy = segment.y2 - segment.y1;
            const distanceSquared = dx * dx + dy * dy;
            const progress = distanceSquared === 0 ? 0 : clamp(
                ((stack.x - segment.x1) * dx + (stack.y - segment.y1) * dy) / distanceSquared, 0, 1
            );
            return Math.hypot(stack.x - (segment.x1 + dx * progress), stack.y - (segment.y1 + dy * progress))
                <= player.size / 2 + haySettings.size * 0.35;
        });

        if (touched) {
            const amount = Math.max(1, Math.round(stack.seeds));
            player.seeds += amount;
            collectionEffects.push({
                x: stack.x,
                y: stack.y,
                amount,
                collectedAt: gameClock.elapsedMs
            });
            hayStacks.splice(i, 1);
            collected = true;
        }
    }

    if (collected) {
        updateSeedCount();
        gameAudio.play("collect");
    }

    for (let i = collectionEffects.length - 1; i >= 0; i--) {
        if (gameClock.elapsedMs - collectionEffects[i].collectedAt >= haySettings.collectionDurationMs) {
            collectionEffects.splice(i, 1);
        }
    }
}

function pathTouchesPickup(pickup, segments, radius) {
    return segments.some(({ x1, y1, x2, y2 }) => {
        const dx = x2 - x1, dy = y2 - y1;
        const length = dx * dx + dy * dy;
        const t = length ? clamp(((pickup.x - x1) * dx + (pickup.y - y1) * dy) / length, 0, 1) : 0;
        return (pickup.x - x1 - dx * t) ** 2 + (pickup.y - y1 - dy * t) ** 2 <= radius * radius;
    });
}

function spawnHarvestPickup() {
    if (harvestPickups.length || canvas.width < 200 || canvas.height - gameHudHeight < 150) return false;
    for (let i = 0; i < 16; i++) {
        const point = findHayPosition();
        if (!point) return false;
        if (point.x < Math.max(canvas.width * 0.55, getDeathZoneWidth() + 55)) continue;
        harvestPickups.push({ ...point, spawnedAt: gameClock.elapsedMs });
        gameAudio.play("hay");
        return true;
    }
    return false;
}

function updateHarvestPickups(segments) {
    if (!canControlPlayer()) return;
    if (gameClock.elapsedMs >= nextHarvestPickupAt) {
        const spawned = spawnHarvestPickup();
        nextHarvestPickupAt = gameClock.elapsedMs + (spawned ? 35000 + Math.random() * 15000 : 3000);
    }
    for (let i = harvestPickups.length - 1; i >= 0; i--) {
        const pickup = harvestPickups[i];
        if (!pathTouchesPickup(pickup, segments, player.size / 2 + 23)) continue;
        harvestPickups.splice(i, 1);
        let total = 0;
        for (let j = hayStacks.length - 1; j >= 0; j--) {
            const stack = hayStacks[j];
            // Collect the hay on the map, leaving stacks that have not entered it yet.
            if (stack.x < 0 || stack.x > canvas.width || stack.y < gameHudHeight || stack.y > canvas.height) continue;
            total += Math.max(1, Math.round(stack.seeds));
            harvestBursts.push({ x: stack.x, y: stack.y, createdAt: gameClock.elapsedMs });
            hayStacks.splice(j, 1);
        }
        player.seeds += total;
        updateSeedCount();
        collectionEffects.push({ x: player.x, y: player.y - 35, amount: total,
            label: "Harvest! +" + total + " seeds", collectedAt: gameClock.elapsedMs });
        gameAudio.play("collect");
        gameAudio.play("ready");
    }
    for (let i = harvestBursts.length - 1; i >= 0; i--) {
        if (gameClock.elapsedMs - harvestBursts[i].createdAt > 650) harvestBursts.splice(i, 1);
    }
}

function drawHarvestPickups() {
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const pickup of harvestPickups) {
        const radius = 27 + Math.sin((gameClock.elapsedMs - pickup.spawnedAt) / 180) * 3;
        ctx.fillStyle = "rgba(255, 225, 104, 0.16)"; ctx.strokeStyle = "#ffe986"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pickup.x, pickup.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff1ac"; ctx.font = "28px Arial"; ctx.fillText("🌾", pickup.x, pickup.y - 1);
        ctx.font = "bold 11px Arial"; ctx.fillStyle = "#fff1ac"; ctx.strokeStyle = "#172519"; ctx.lineWidth = 4;
        ctx.strokeText("HARVEST ALL", pickup.x, pickup.y + 42); ctx.fillText("HARVEST ALL", pickup.x, pickup.y + 42);
    }
    for (const burst of harvestBursts) {
        const t = clamp((gameClock.elapsedMs - burst.createdAt) / 650, 0, 1);
        const x = burst.x + (player.x - burst.x) * t * t, y = burst.y + (player.y - burst.y) * t * t;
        ctx.globalAlpha = 1 - t; ctx.strokeStyle = "#ffe986"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(player.x, player.y); ctx.stroke();
        ctx.fillStyle = "#ffe986"; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
}

function drawHayStacks() {
    if (!hayImage.complete || hayImage.naturalWidth === 0) {
        return;
    }

    ctx.save();
    for (const stack of hayStacks) {
        const age = gameClock.elapsedMs - stack.spawnedAt;
        const size = haySettings.size * (0.65 + 0.35 * Math.min(1, age / 250));
        ctx.fillStyle = "rgba(255, 208, 102, 0.12)";
        ctx.beginPath();
        ctx.arc(stack.x, stack.y, haySettings.size / 2 + 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.drawImage(hayImage, stack.x - size / 2, stack.y - size / 2, size, size);
    }
    ctx.restore();
}

function drawCollectionEffects() {
    ctx.save();
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#172519";
    ctx.fillStyle = "#a7ff83";

    for (const effect of collectionEffects) {
        const progress = (gameClock.elapsedMs - effect.collectedAt) / haySettings.collectionDurationMs;
        const label = effect.label || "+" + effect.amount + " seeds";
        const halfWidth = ctx.measureText(label).width / 2 + 8;
        const x = clamp(effect.x, halfWidth, canvas.width - halfWidth);
        const y = Math.max(gameHudHeight + 18, effect.y - progress * 42);
        ctx.globalAlpha = 1 - progress;
        ctx.strokeText(label, x, y);
        ctx.fillText(label, x, y);
    }
    ctx.restore();
}

function resizeGameCanvas() {
    canvas.width = window.innerWidth;
    const bottomHeight = bottomHud.hidden ? 0 : bottomHud.getBoundingClientRect().height;
    canvas.height = Math.max(1, window.innerHeight - bottomHeight);
    canvas.style.height = canvas.height + "px";
    document.documentElement?.style.setProperty("--bottom-hud-height", bottomHeight + "px");
    gameHudHeight = gameHud.hidden ? 0 : gameHud.getBoundingClientRect().height;
    statsPanel.style.maxHeight = Math.max(0, canvas.height - gameHudHeight - 20) + "px";
    positionStatsPanel();
    Object.assign(player, clampPointToCanvas(player.x, player.y));
    resizeWorld();
    resizeMonsters();

    if (movement.target) {
        movement.target = getMovementTarget(movement.target.x, movement.target.y);
    }

    if (abilityState.lure.point) {
        const point = freeActorPoint(clampPointToCanvas(abilityState.lure.point.x, abilityState.lure.point.y), 14);
        abilityState.lure.point = isLurePlacementValid(point) ? point : null;
    }

    const bounds = getMapBounds(haySettings.size / 2);
    for (let i = hayStacks.length - 1; i >= 0; i--) {
        const stack = hayStacks[i];
        if (stack.x < bounds.left || stack.x > bounds.right
            || stack.y < bounds.top || stack.y > bounds.bottom || bodyTouchesWall(stack.x, stack.y, haySettings.size / 2)) {
            const position = findHayPosition(stack);
            if (position) {
                Object.assign(stack, position);
            } else {
                hayStacks.splice(i, 1);
            }
        }
    }

    for (const pickup of harvestPickups) {
        Object.assign(pickup, freeActorPoint(clampPointToCanvas(pickup.x, pickup.y), 24));
    }
}

// --------------------
// CHARACTER SELECTION
// --------------------

function startGame() {
    if (gameStarted || startGameBtn.disabled) return;
    startGameBtn.disabled = true;
    gameAudio.unlock();
    player.image = new Image();
    player.image.onerror = () => {
        startGameBtn.disabled = false;
        document.getElementById("startMessage").textContent = "The harvester image could not load. Please try again.";
    };
    player.image.onload = () => {
        if (gameStarted) return;
        initialView.hidden = true;
        canvas.hidden = false; gameHud.hidden = false; bottomHud.hidden = false; statsPanel.hidden = false;
        gameStarted = true;
        survivalHistory.begin();
        resizeGameCanvas(); startScrollingWorld(); updateGamePauseState();
        for (let i=0; i<haySettings.initialStacks; i++) spawnHayStack(false);
        scheduleNextHayStack(); updateHud(); updateProgressionHud();
        gameAudio.play("start"); gameLoop();
    };
    player.image.src = "imgs/seed-harvester.png";
}
startGameBtn.addEventListener("click", startGame);

// --------------------
// HUD
// --------------------

function updateHud() {

    const healthPercentage =
        player.health /
        player.maxHealth *
        100;

    healthBar.style.width =
        healthPercentage + "%";

    healthText.textContent =
        player.health +
        " / " +
        player.maxHealth;

    seedHudCount.textContent =
        Math.floor(player.seeds);

}


function updateAbilityHud() {
    for (const [name, hud] of Object.entries(abilityHud)) {
        const state = abilityState[name];
        const remaining = getCooldownRemainingMs(name);
        const active = name === "dash" ? state.remainingMs > 0 : state.activeUntil > gameClock.elapsedMs;
        const armed = armedAbility === name;
        const instant = instantAbilities.has(name);
        const unlocked = player.unlocks[name];
        const key = Object.keys(abilityHud).indexOf(name) + 1;
        const previous = abilitySoundState[name];
        if (canControlPlayer()) {
            if (previous.active && !active && state.durationMs) gameAudio.play("expire");
            if (previous.coolingDown && remaining === 0) gameAudio.play("ready");
        }
        previous.active = active;
        previous.coolingDown = remaining > 0;
        hud.item.classList.toggle("active", active);
        hud.item.classList.toggle("armed", armed);
        hud.item.classList.toggle("locked", !unlocked);
        hud.item.classList.toggle("ready", unlocked && !active && !armed && remaining === 0);
        hud.item.setAttribute("aria-pressed", String(instant ? active : armed));
        hud.item.setAttribute("aria-disabled", String(!unlocked || !canControlPlayer() || remaining > 0 || abilityState.dash.remainingMs > 0));
        hud.item.setAttribute("aria-label", key + ": " + abilityLabels[name]);
        hud.item.title = (instant ? "Click or press " : "Select or press ") + key + ". " + abilityInstructions[name]
            + " Cooldown: " + state.cooldownMs / 1000 + " seconds.";
        hud.item.classList.toggle("coolingDown", !active && remaining > 0);
        const statusLabel = !unlocked ? "🔒 Locked" : armed ? "➤ Armed · click map"
            : active ? "◆ Active" + (state.durationMs ? " · " + Math.ceil((state.activeUntil - gameClock.elapsedMs) / 1000) + "s" : "")
            : remaining > 0 ? "◷ Cooldown · " + (remaining / 1000).toFixed(1) + "s" : "✓ Ready";
        if (hud.cooldownText.textContent !== statusLabel) hud.cooldownText.textContent = statusLabel;
        document.getElementById(name + "Progress").style.width = (unlocked ? 100 * (1 - remaining / state.cooldownMs) : 0) + "%";
    }
}

function updateStatsPanel() {
    const effects = [
        player.unlocks.piercingRound && "Piercing",
        player.unlocks.knockback && "Knockback",
        player.unlocks.explosiveKernel && "Explosive"
    ].filter(Boolean);
    const values = {
        health: player.health + " / " + player.maxHealth,
        speed: Math.round(player.speed * 60) + " px/s",
        damage: Number(player.damage.toFixed(1)).toString(),
        bulletSpeed: Math.round(player.bulletSpeed * 60) + " px/s",
        fireRate: Number(player.fireRate.toFixed(2)) + " shots/s",
        criticalChance: Number((player.criticalChance * 100).toFixed(1)) + "%",
        weaponEffects: effects.join(" · ") || "None",
        rakeName: getRake().name,
        rakeDamage: getRake().damage.toString()
    };
    for (const [name, value] of Object.entries(values)) {
        if (statFields[name].textContent !== value) statFields[name].textContent = value;
    }
    for (const [name, upgrade] of Object.entries(statsUpgrades)) {
        const owned = !upgrade.repeatable && player.unlocks[name];
        const available = canPurchaseUpgrades() && !owned && player.seeds >= upgrade.cost;
        const price = owned ? "✓ Owned" : (upgrade.repeatable ? "+ " : "🔒 ") + upgrade.cost + " seeds";
        if (upgrade.button.textContent !== price) upgrade.button.textContent = price;
        upgrade.button.setAttribute("aria-disabled", String(!available));
        upgrade.button.classList.toggle("owned", Boolean(owned));
        upgrade.button.classList.toggle("affordable", available);
        upgrade.button.setAttribute("aria-label", owned ? upgrade.label + " purchased" : (upgrade.repeatable ? "Upgrade " : "Unlock ") + upgrade.label + " for " + upgrade.cost + " seeds");
        upgrade.button.title = owned ? "Applies only to your thrown rake." : upgrade.label + ": " + upgrade.cost + " seeds";
    }
}

statsToggle.addEventListener("click", function() {
    gameAudio.play("click");
    const collapsed = !statsContent.hidden;
    statsContent.hidden = collapsed;
    statsPanel.classList.toggle("collapsed", collapsed);
    statsToggle.textContent = collapsed ? "Stats +" : "Stats -";
    statsToggle.setAttribute("aria-expanded", String(!collapsed));
    positionStatsPanel();
});

function positionStatsPanel() {
    const rect = statsPanel.getBoundingClientRect();
    statsPosition.x = clamp(statsPosition.x, 0, Math.max(0, canvas.width - rect.width));
    statsPosition.y = clamp(statsPosition.y ?? gameHudHeight + 10, gameHudHeight + 10,
        Math.max(gameHudHeight + 10, canvas.height - rect.height - 10));
    statsPanel.style.left = statsPosition.x + "px";
    statsPanel.style.top = statsPosition.y + "px";
}

function stopStatsDrag() {
    statsPosition.drag = null;
    statsDragHandle.classList.remove("dragging");
}

statsDragHandle.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !canControlPlayer()) return;
    event.preventDefault();
    movement.target = null;
    movement.rightButtonDown = false;
    statsPosition.drag = { id: event.pointerId, x: event.clientX - statsPosition.x, y: event.clientY - statsPosition.y };
    statsDragHandle.setPointerCapture(event.pointerId);
    statsDragHandle.classList.add("dragging");
});
statsDragHandle.addEventListener("pointermove", event => {
    const drag = statsPosition.drag;
    if (!drag || drag.id !== event.pointerId) return;
    statsPosition.x = event.clientX - drag.x;
    statsPosition.y = event.clientY - drag.y;
    positionStatsPanel();
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) statsDragHandle.addEventListener(name, stopStatsDrag);
statsDragHandle.addEventListener("keydown", event => {
    const directions = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
    if (!directions[event.key]) return;
    event.preventDefault();
    event.stopPropagation();
    statsPosition.x += directions[event.key][0];
    statsPosition.y += directions[event.key][1];
    positionStatsPanel();
});


// --------------------
// SEED WALLET
// --------------------

updateAbilityHud();
renderEnemyGuide();
updateFullscreenButton();
updateProgressionHud();

// Fullscreen includes the entire page so the HUD and dialogs remain available.
function updateFullscreenButton() {
    const active = Boolean(document.fullscreenElement);
    const supported = typeof document.exitFullscreen === "function"
        && (active || (document.fullscreenEnabled !== false
            && typeof document.documentElement?.requestFullscreen === "function"));
    fullscreenBtn.disabled = fullscreenPending || !supported;
    fullscreenBtn.setAttribute("aria-pressed", String(active));
    fullscreenBtn.textContent = active ? "⛶ Exit fullscreen" : supported ? "⛶ Fullscreen" : "Fullscreen unavailable";
    fullscreenBtn.title = active ? "Exit fullscreen (Esc)" : supported ? "Enter fullscreen"
        : "Fullscreen is not available in this browser.";
}

async function toggleFullscreen() {
    if (fullscreenPending || fullscreenBtn.disabled) return;
    fullscreenPending = true;
    fullscreenMessage.hidden = true;
    updateFullscreenButton();
    gameAudio.play("click");
    try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
    } catch {
        fullscreenMessage.textContent = "Fullscreen could not be changed. Please try again or use your browser's fullscreen control.";
        fullscreenMessage.hidden = false;
    } finally {
        fullscreenPending = false;
        updateFullscreenButton();
    }
}

fullscreenBtn.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
    updateFullscreenButton();
    resizeGameCanvas();
});


// --------------------
// UPDATE SEED COUNTS
// --------------------

function updateSeedCount() { seedHudCount.textContent = Math.floor(player.seeds); }

function togglePause() {
    if (!gameStarted || gameOver) return;
    manuallyPaused = !manuallyPaused;
    document.getElementById("pauseOverlay").hidden = !manuallyPaused;
    pauseBtn.textContent = manuallyPaused ? "Resume (Space)" : "Pause (Space)";
    pauseBtn.setAttribute("aria-pressed", String(manuallyPaused));
    gameAudio.play(manuallyPaused ? "open" : "close");
    updateGamePauseState();
    updateStatsPanel();
}
pauseBtn.addEventListener("click", togglePause);
document.addEventListener("visibilitychange", updateGamePauseState);
document.addEventListener("visibilitychange", () => {
    if (document.hidden && gameStarted && !gameOver) survivalHistory.save(gameClock.elapsedMs);
});
window.addEventListener("pagehide", () => {
    if (!gameStarted || gameOver) return;
    updateGameClock();
    survivalHistory.save(gameClock.elapsedMs);
});
window.addEventListener("blur", cancelMovement);

function toggleAutomaticTarget() {
    if (!gameStarted || gameOver || document.hidden) return;
    weaponState.automaticTarget = !weaponState.automaticTarget;
    weaponState.target = null;
    weaponState.nextTargetSearchAt = 0;
    autoTargetToggle.setAttribute("aria-pressed", String(weaponState.automaticTarget));
    autoTargetToggle.textContent = "Aim: " + (weaponState.automaticTarget ? "Auto" : "Mouse") + " (C)";
    gameAudio.play("click");
}
autoTargetToggle.addEventListener("click", toggleAutomaticTarget);

function applyUpgrade(upgrade) {

    if (upgrade === "maxHealth") {

        player.maxHealth += 10;
        player.health += 10;

    }

    if (upgrade === "damage") {
        player.damage *= 1.10;
    }

    if (upgrade === "bulletSpeed") {
        player.bulletSpeed *= 1.08;
    }

    if (upgrade === "fireRate") {
        player.fireRate *= 1.10;
        // Preserve shot progress while applying the faster rate immediately.
        const remaining = Math.max(0, weaponState.nextShotAt - gameClock.elapsedMs);
        weaponState.nextShotAt = gameClock.elapsedMs + remaining / 1.10;
    }

    if (upgrade === "criticalChance") {
        player.criticalChance = Math.min(1, player.criticalChance + 0.02);
    }



}


// --------------------
// STATS PURCHASES
// --------------------

function canPurchaseUpgrades() {
    // Spending seeds is allowed during a manual pause without resuming combat.
    return gameStarted && !gameOver && !document.hidden;
}

function purchaseUpgrade(name) {
    const upgrade = statsUpgrades[name];
    if (!upgrade || !canPurchaseUpgrades() || (!upgrade.repeatable && player.unlocks[name])) return false;
    if (player.seeds < upgrade.cost) { gameAudio.play("denied"); return false; }
    player.seeds -= upgrade.cost;
    if (upgrade.repeatable) {
        upgradeLevels[name]++;
        applyUpgrade(name);
        upgrade.cost = Math.ceil(upgrade.cost * 1.1);
        upgrade.button.dataset.cost = upgrade.cost;
    } else player.unlocks[name] = true;
    gameAudio.play(upgrade.repeatable ? "purchase" : "unlock");
    updateSeedCount(); updateHud(); updateStatsPanel();
    return true;
}
for (const [name, upgrade] of Object.entries(statsUpgrades)) {
    upgrade.button.addEventListener("click", () => purchaseUpgrade(name));
}

// --------------------
// ABILITY USE
// --------------------

function canUseAbility(name) {
    if (!canControlPlayer()) return false;
    const ready = player.unlocks[name] && !isAbilityOnCooldown(name) && abilityState.dash.remainingMs === 0;
    if (!ready) gameAudio.play("denied");
    return ready;
}

function clearArmedAbility() {
    armedAbility = null;
    canvas.style.cursor = "crosshair";
    document.getElementById("abilityHint").hidden = true;
}

function selectAbility(name) {
    if (!instantAbilities.has(name)) {
        armAbility(name);
        return;
    }
    if (!canUseAbility(name)) return;
    clearArmedAbility();
    if (name === "energyShield") useEnergyShield();
    else useTimeFreeze();
}

function armAbility(name) {
    if (armedAbility === name) {
        clearArmedAbility();
    } else {
        if (!canUseAbility(name)) return;
        armedAbility = name;
        canvas.style.cursor = "none";
        const hint = document.getElementById("abilityHint");
        hint.textContent = abilityLabels[name] + " ready · " + (name === "dash" ? "Left-click to sprint" : "Left-click to use") + " · Esc to cancel";
        hint.hidden = false;
        gameAudio.play("marker");
    }
    updateAbilityHud();
}

for (const [name, hud] of Object.entries(abilityHud)) {
    hud.item.addEventListener("click", () => {
        if (!canControlPlayer()) return;
        selectAbility(name);
    });
}

function activateArmedAbility(button) {
    const name = armedAbility;
    if (!name || button !== 0) return false;
    if (name === "lure" && !isLurePlacementValid(mouse)) {
        gameAudio.play("denied");
        return true;
    }
    clearArmedAbility();
    if (name === "dash") {
        movement.rightButtonDown = false;
        movement.target = null;
    }
    const actions = { teleport: useTeleport, dash: () => useDash(mouse.x, mouse.y), lure: useLure };
    actions[name]();
    updateAbilityHud();
    return true;
}

function resetMovementAfterAbility() {
    // A completed click target must not pull the player back after a dash or teleport.
    movement.target = movement.rightButtonDown && movement.keys.size === 0
        ? getMovementTarget(mouse.x, mouse.y) : null;
}

function useTeleport() {
    if (!canUseAbility("teleport")) return;
    const point = freeActorPoint(clampPointToCanvas(mouse.x, mouse.y), player.size / 2);
    if (bodyTouchesWall(point.x, point.y, player.size / 2)) { gameAudio.play("denied"); return; }
    gameAudio.play("teleport");
    Object.assign(player, point);
    abilityState.teleport.lastUsedAt = gameClock.elapsedMs;
    resetMovementAfterAbility();
    updateAbilityHud();
}

function useEnergyShield() {
    if (!canUseAbility("energyShield")) return;
    gameAudio.play("shield");
    abilityState.energyShield.lastUsedAt = gameClock.elapsedMs;
    abilityState.energyShield.activeUntil = gameClock.elapsedMs + abilityState.energyShield.durationMs;
    updateAbilityHud();
}

function useDash(targetX, targetY) {
    if (!canUseAbility("dash")) return;
    const dx = targetX - player.x;
    const dy = targetY - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    gameAudio.play("dash");
    // 140 pixels over 0.2 seconds: fast movement through every collision and pickup step.
    abilityState.dash.remainingMs = 200;
    abilityState.dash.directionX = dx / distance;
    abilityState.dash.directionY = dy / distance;
    abilityState.dash.lastUsedAt = gameClock.elapsedMs;
    resetMovementAfterAbility();
    updateAbilityHud();
}

function useTimeFreeze() {
    if (!canUseAbility("timeFreeze")) return;
    gameAudio.play("freeze");
    abilityState.timeFreeze.lastUsedAt = gameClock.elapsedMs;
    abilityState.timeFreeze.activeUntil = gameClock.elapsedMs + abilityState.timeFreeze.durationMs;
    updateAbilityHud();
}

function isLureActive() {
    return abilityState.lure.point !== null && gameClock.elapsedMs < abilityState.lure.activeUntil;
}

function isLurePlacementValid(point) {
    return point.x >= 0 && point.x <= canvas.width && point.y >= gameHudHeight && point.y <= canvas.height
        && !bodyTouchesWall(point.x, point.y, 14);
}

function useLure() {
    if (!canUseAbility("lure")) return;
    if (!isLurePlacementValid(mouse)) { gameAudio.play("denied"); return; }
    gameAudio.play("lure");
    abilityState.lure.point = { x: mouse.x, y: mouse.y };
    abilityState.lure.lastUsedAt = gameClock.elapsedMs;
    abilityState.lure.activeUntil = gameClock.elapsedMs + abilityState.lure.durationMs;
    updateAbilityHud();
}

// All monsters follow the lure until it expires, then resume chasing the player.
function getMonsterTarget() {
    const target = isLureActive() ? abilityState.lure.point : player;
    return { x: target.x, y: target.y };
}

function updateLure() {
    if (!isLureActive()) abilityState.lure.point = null;
}

function drawLure() {
    if (!isLureActive()) return;
    drawLureMarker(abilityState.lure.point);
}

function drawLureMarker(point, preview = false) {
    const valid = !preview || isLurePlacementValid(point);
    const age = preview ? gameClock.elapsedMs : gameClock.elapsedMs - abilityState.lure.lastUsedAt;
    ctx.save();
    ctx.strokeStyle = valid ? "rgba(182, 124, 255, 0.75)" : "#ff848b";
    ctx.fillStyle = "rgba(159, 83, 245, 0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, preview ? 26 + Math.sin(age / 170) * 3 : 38 + (age % 1000) / 1000 * 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#c99aff";
    ctx.font = "bold 32px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✦", point.x, point.y);
    ctx.font = "bold 14px Arial";
    const label = preview ? (valid ? "Lure · left-click" : "Choose open ground")
        : "Lure · " + Math.ceil((abilityState.lure.activeUntil - gameClock.elapsedMs) / 1000) + "s";
    const halfWidth = ctx.measureText(label).width / 2 + 6;
    const x = clamp(point.x, halfWidth, canvas.width - halfWidth);
    const y = Math.min(canvas.height - 12, point.y + 36);
    ctx.strokeStyle = "#281a23";
    ctx.lineWidth = 3;
    ctx.strokeText(label, x, y);
    ctx.fillText(label, x, y);
    ctx.restore();
}

function drawDashPreview() {
    const angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
    ctx.save();
    ctx.strokeStyle = "#ffd36b";
    ctx.fillStyle = "#ffe5a3";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    // Show the sprint's direction and 140-pixel reach from the player.
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(player.size / 2 + 4, 0); ctx.lineTo(140, 0);
    ctx.moveTo(127, -8); ctx.lineTo(140, 0); ctx.lineTo(127, 8);
    ctx.stroke();
    ctx.restore();
    // Two forward chevrons make Dash distinct from Teleport's circular marker.
    ctx.save();
    ctx.translate(mouse.x, mouse.y);
    ctx.rotate(angle);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-18, -11); ctx.lineTo(-7, 0); ctx.lineTo(-18, 11);
    ctx.moveTo(-4, -11); ctx.lineTo(7, 0); ctx.lineTo(-4, 11);
    ctx.stroke();
    ctx.restore();
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Dash · left-click", clamp(mouse.x, 65, canvas.width - 65),
        Math.max(gameHudHeight + 18, mouse.y - 28));
    ctx.restore();
}

function drawAbilityPreview() {
    if (!armedAbility || !canControlPlayer() || mouse.y < gameHudHeight) return;
    if (armedAbility === "lure") {
        drawLureMarker(mouse, true);
        return;
    }
    if (armedAbility === "dash") {
        drawDashPreview();
        return;
    }
    const point = freeActorPoint(clampPointToCanvas(mouse.x, mouse.y), player.size / 2);
    ctx.save(); ctx.strokeStyle = "#72ffdc"; ctx.fillStyle = "#bcffe8"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(point.x, point.y, 17, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(point.x - 24, point.y); ctx.lineTo(point.x + 24, point.y);
    ctx.moveTo(point.x, point.y - 24); ctx.lineTo(point.x, point.y + 24); ctx.stroke();
    ctx.font = "bold 12px Arial"; ctx.textAlign = "center";
    ctx.fillText(abilityLabels[armedAbility], point.x, point.y - 30);
    ctx.restore();
}

function drawDashTrail() {
    ctx.save();
    for (let i = dashTrail.length - 1; i >= 0; i--) {
        const age = gameClock.elapsedMs - dashTrail[i].createdAt;
        if (age >= 180) { dashTrail.splice(i, 1); continue; }
        ctx.globalAlpha = (1 - age / 180) * 0.38;
        drawHarvester(dashTrail[i].x, dashTrail[i].y, false);
    }
    ctx.restore();
}


// --------------------
// CONTROLS
// --------------------

window.addEventListener("keydown", function(event) {
    if (!gameStarted || gameOver || event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const editing = event.target?.closest?.("input, textarea, select, [contenteditable], #soundControls");
    if (editing) return;

    // Space pauses even when a HUD button has focus, without clicking that button.
    if (event.code === "Space" || key === " ") {
        event.preventDefault();
        if (!event.repeat) togglePause();
        return;
    }
    if (key === "c") {
        event.preventDefault();
        if (!event.repeat) toggleAutomaticTarget();
        return;
    }
    if (gameClock.paused || manuallyPaused) return;

    // Enter still activates focused UI buttons.
    if (event.target?.closest?.("button") && key === "enter") return;

    if (["w", "a", "s", "d"].includes(key)) {
        event.preventDefault();
        movement.keys.add(key);
        // Keyboard steering replaces an old click destination.
        movement.target = null;
        return;
    }

    const abilityKeys = { "1": "teleport", "2": "energyShield", "3": "dash", "4": "timeFreeze", "5": "lure" };
    if (abilityKeys[key]) {
        event.preventDefault();
        if (!event.repeat) selectAbility(abilityKeys[key]);
    } else if (key === "escape") {
        clearArmedAbility();
        updateAbilityHud();
    } else if (key.startsWith("arrow")) {
        event.preventDefault();
    }
});

window.addEventListener("keyup", function(event) {
    const key = event.key.toLowerCase();
    if (!movement.keys.delete(key)) return;
    if (movement.keys.size === 0 && movement.rightButtonDown && canControlPlayer()) {
        movement.target = getMovementTarget(mouse.x, mouse.y);
    }
});

function getCanvasMousePoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * canvas.width / rect.width,
        y: (event.clientY - rect.top) * canvas.height / rect.height
    };
}

function canControlPlayer() {
    return gameStarted && !gameOver && !gameClock.paused && !manuallyPaused;
}

canvas.addEventListener("mousedown", function(event) {
    if (!canControlPlayer() || ![0, 2].includes(event.button)) return;
    event.preventDefault();
    Object.assign(mouse, getCanvasMousePoint(event));
    document.activeElement?.blur();
    if (activateArmedAbility(event.button)) return;
    if (event.button === 0) { throwRake(); return; }
    if (abilityState.dash.remainingMs > 0) return;
    movement.rightButtonDown = true;
    gameAudio.play("move");
    movement.target = movement.keys.size === 0 ? getMovementTarget(mouse.x, mouse.y) : null;
    // Return keyboard focus to the game after interacting with a HUD button.
    document.activeElement?.blur();
});

window.addEventListener("mousemove", function(event) {
    // Track aim in menus and while paused, without moving or firing.
    Object.assign(mouse, gameStarted ? getCanvasMousePoint(event)
        : { x: event.clientX, y: event.clientY });
    if (!canControlPlayer()) return;
    if (movement.rightButtonDown) {
        // Recover if a mouse release happened outside the browser window.
        if ((event.buttons & 2) === 0) {
            movement.rightButtonDown = false;
        } else if (movement.keys.size === 0) {
            movement.target = getMovementTarget(mouse.x, mouse.y);
        }
    }
});

window.addEventListener("mouseup", function(event) {
    if (event.button === 2) {
        if (movement.rightButtonDown && canControlPlayer() && movement.keys.size === 0) {
            Object.assign(mouse, getCanvasMousePoint(event));
            movement.target = getMovementTarget(mouse.x, mouse.y);
        }
        movement.rightButtonDown = false;
    }
});

// Keep right-click available to the game across the canvas, HUD, and menus.
document.addEventListener("contextmenu", event => event.preventDefault(), true);


// --------------------
// AUTOMATIC SHOOTING
// --------------------

function updateAutomaticShooting() {
    if (!canControlPlayer()) return;
    updateAutomaticTarget();
    if (gameClock.elapsedMs < weaponState.nextShotAt || (weaponState.automaticTarget && !weaponState.target)) return;

    const aim = weaponState.automaticTarget ? weaponState.target : mouse;
    const dx = aim.x - player.x;
    const dy = aim.y - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
        weaponState.aimX = dx / distance;
        weaponState.aimY = dy / distance;
    }
    // If the aim point overlaps the player, keep the last valid direction.
    const criticalHit = Math.random() < player.criticalChance;
    gameAudio.play(criticalHit ? "critical" : "shot");
    bullets.push({
        kind: "basic",
        x: player.x,
        y: player.y,
        dx: weaponState.aimX * player.bulletSpeed,
        dy: weaponState.aimY * player.bulletSpeed,
        size: 4,
        damage: criticalHit ? player.damage * 2 : player.damage,
        critical: criticalHit,
        piercing: false,
        knockback: false,
        explosive: false
    });

    const interval = 1000 / player.fireRate;
    // Keep a steady rate across frames without queuing a burst after a long stall.
    weaponState.nextShotAt = gameClock.elapsedMs - weaponState.nextShotAt >= interval
        ? gameClock.elapsedMs + interval
        : weaponState.nextShotAt + interval;
}

function updateAutomaticTarget() {
    if (!weaponState.automaticTarget) return;
    const visible = monster => monster.health > 0 && monster.x + monster.radius >= 0
        && monster.x - monster.radius <= canvas.width && monster.y + monster.radius >= gameHudHeight
        && monster.y - monster.radius <= canvas.height;
    if (weaponState.target && visible(weaponState.target) && monsters.includes(weaponState.target)) return;
    const lostTarget = weaponState.target !== null;
    weaponState.target = null;
    if (!lostTarget && gameClock.elapsedMs < weaponState.nextTargetSearchAt) return;
    weaponState.nextTargetSearchAt = gameClock.elapsedMs + 150;
    let closestDistance = Infinity;
    // One linear scan on acquisition; no sorting, square roots, or switching a live lock.
    for (const monster of monsters) {
        if (!visible(monster)) continue;
        const distance = (monster.x - player.x) ** 2 + (monster.y - player.y) ** 2;
        if (distance < closestDistance) { closestDistance = distance; weaponState.target = monster; }
    }
}

function drawAutomaticTarget() {
    if (!weaponState.automaticTarget || !weaponState.target || gameOver) return;
    const target = weaponState.target;
    ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255, 72, 83, 0.85)";
    ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(target.x, target.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(target.x, target.y, target.radius + 5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
}


// --------------------
// PLAYER MOVEMENT
// --------------------

function movePlayerBy(dx, dy) {
    const travel = moveActor(player, dx, dy, player.size / 2, true, true);
    if (travel.wrapped) gameAudio.play("wrap");
    return travel;
}

function movePlayer(deltaMs = 1000 / 60) {
    const stationary = { distance: 0, wrapped: false,
        segments: [{ x1: player.x, y1: player.y, x2: player.x, y2: player.y }] };
    if (!canControlPlayer()) return stationary;
    const dash = abilityState.dash;
    if (dash.remainingMs > 0) {
        const ms = Math.min(deltaMs, 50, dash.remainingMs);
        const travel = movePlayerBy(dash.directionX * ms * 0.7, dash.directionY * ms * 0.7);
        if (ms > 0) dashTrail.push({ x: player.x, y: player.y, createdAt: gameClock.elapsedMs });
        dash.remainingMs = Math.max(0, dash.remainingMs - ms);
        if (ms > 0 && travel.distance < 0.01) dash.remainingMs = 0;
        return travel;
    }
    const step = player.speed * Math.min(deltaMs, 50) / (1000 / 60);

    if (movement.keys.size > 0) {
        const dx = Number(movement.keys.has("d")) - Number(movement.keys.has("a"));
        const dy = Number(movement.keys.has("s")) - Number(movement.keys.has("w"));
        const distance = Math.hypot(dx, dy);
        if (distance > 0) {
            return movePlayerBy(dx / distance * step, dy / distance * step);
        }
        return stationary;
    }

    if (!movement.target) return stationary;
    const target = movement.target;
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance > 0 ? Math.min(1, step / distance) : 0;
    const travel = movePlayerBy(dx * scale, dy * scale);
    if (!movement.rightButtonDown && (distance <= step || travel.wrapped)) {
        movement.target = null;
        if (!travel.wrapped) gameAudio.play("arrive");
    }
    return travel;
}

function drawMovementTarget() {
    if (!movement.target) return;
    const bounds = getWrapBounds();
    const marker = { x: clamp(movement.target.x, bounds.left, bounds.right),
        y: clamp(movement.target.y, bounds.top, bounds.bottom) };
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(marker.x, marker.y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(200, 255, 205, 0.55)";
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}


// --------------------
// BULLETS
// --------------------

function updateBullets(deltaMs = 1000 / 60) {

    if (!canControlPlayer()) {
        return;
    }

    for (
        let i = bullets.length - 1;
        i >= 0;
        i--
    ) {

        const frameScale = Math.min(deltaMs, 50) / (1000 / 60);
        const startX = bullets[i].x;
        const startY = bullets[i].y;
        bullets[i].x += bullets[i].dx * frameScale;
        bullets[i].y += bullets[i].dy * frameScale;
        const wallTime = wallHitTime(startX, startY, bullets[i].x, bullets[i].y, bullets[i].size);
        if (wallTime !== null) {
            bullets[i].x = startX + (bullets[i].x - startX) * wallTime;
            bullets[i].y = startY + (bullets[i].y - startY) * wallTime;
        }

        // Sweep the whole path so fast upgraded bullets cannot skip enemies.
        if (resolveBulletHits(bullets[i], startX, startY)) {
            bullets.splice(i, 1);
            continue;
        }

        if (wallTime !== null) {
            wallSparks.push({ x: bullets[i].x, y: bullets[i].y, createdAt: gameClock.elapsedMs });
            gameAudio.play("hit");
            bullets.splice(i, 1);
            continue;
        }

        if (
            bullets[i].x < 0 ||
            bullets[i].x > canvas.width ||
            bullets[i].y < 0 ||
            bullets[i].y > canvas.height
        ) {

            bullets.splice(i, 1);

        }

    }

}


// --------------------
// DRAW
// --------------------

function draw() {

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    ctx.fillStyle = "#222";

    ctx.fillRect(
        0,
        0,
        canvas.width,
        canvas.height
    );


    drawScrollingWorld();
    drawHayStacks();
    drawHarvestPickups();
    drawWalls();
    drawMovementTarget();
    drawLure();
    drawMonsters();
    drawAutomaticTarget();

    drawAbilityPreview();
    drawDashTrail();


    drawHarvester();

    // ENERGY SHIELD VISUAL

    if (isEnergyShieldActive()) {

        ctx.strokeStyle = "#6fe8ff";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.arc(
            player.x,
            player.y,
            player.size / 2 + 8,
            0,
            Math.PI * 2
        );
        ctx.stroke();

    }


    // BULLETS

    for (const bullet of bullets) {
        if (bullet.kind === "rake") {
            drawRake(ctx, bullet.x, bullet.y, bullet.angle, bullet.level, 0.85);
            continue;
        }
        if (bullet.critical) {
            ctx.fillStyle = "orange";
        } else {
            ctx.fillStyle = "yellow";
        }

        ctx.beginPath();

        ctx.arc(
            bullet.x,
            bullet.y,
            bullet.size,
            0,
            Math.PI * 2
        );

        ctx.fill();

    }


    drawCombatEffects();
    drawCollectionEffects();
    drawDeathZone();

    // TIME FREEZE VISUAL

    if (isTimeFreezeActive()) {

        ctx.fillStyle =
            "rgba(120, 190, 255, 0.15)";

        ctx.fillRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        ctx.fillStyle = "#d6efff";
        ctx.font = "bold 28px Arial";
        ctx.textAlign = "center";

        ctx.fillText(
            "TIME FREEZE ACTIVE",
            canvas.width / 2,
            gameHudHeight + 32
        );

    }

}


// --------------------
// GAME LOOP
// --------------------

function gameLoop() {

    const previousTime = gameClock.elapsedMs;
    updateGameClock();
    const deltaMs = gameClock.elapsedMs - previousTime;
    if (!gameOver) survivalHistory.checkpoint(gameClock.elapsedMs);

    if (!gameClock.paused) {
        const frameMs = Math.min(deltaMs, 50);
        scrollWorld(frameMs);
        const travel = movePlayer(deltaMs);
        gameAudio.footsteps(travel.distance);
        updateMonsterSpawning();
        updateMonsters(deltaMs);
        updateBullets(deltaMs);
        updateAutomaticShooting();
        updateHayStacks(player.x, player.y, travel.segments);
        updateHarvestPickups(travel.segments);
        updateLure();
        updateCombatEffects();
        updateMonsterContact();
        updateDeathZone(frameMs);
    }

    draw();
    updateAbilityHud();
    updateStatsPanel();
    updateRakeStatus();

    requestAnimationFrame(
        gameLoop
    );

}


// --------------------
// WINDOW RESIZE
// --------------------

window.addEventListener("resize", resizeGameCanvas);

// Wrapping HUD rows also change the usable map area.
new ResizeObserver(resizeGameCanvas).observe(gameHud);

new ResizeObserver(resizeGameCanvas).observe(bottomHud);
