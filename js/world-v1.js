const walls = [];
const wallSparks = [];
const worldSettings = { baseSpeed: 55, maxSpeed: 95, zoneDamage: 8, zoneIntervalMs: 500 };
const worldState = {
    started: false, scroll: 0, nextWallX: Infinity,
    nextGateId: 1, lastGapRatio: 0.5, zoneExposure: 0, zoneHitUntil: 0, viewportWidth: 0,
    patternBag: [], lastPattern: null
};

function getScrollSpeed() {
    return Math.min(worldSettings.maxSpeed, worldSettings.baseSpeed + Math.floor(gameClock.elapsedMs / 30000) * 4);
}

function getDeathZoneWidth() {
    return Math.min(canvas.width * 0.24, Math.max(72, Math.min(140, canvas.width * 0.1)));
}

function wallRects(periodic = false) {
    if (!periodic) return walls;
    const height = Math.max(1, canvas.height - gameHudHeight);
    return walls.flatMap(wall => [wall, { ...wall, y: wall.y - height }, { ...wall, y: wall.y + height }]);
}

function bodyTouchesWall(x, y, radius, periodic = false) {
    return wallRects(periodic).some(wall => x + radius > wall.x + 0.001 && x - radius < wall.x + wall.width - 0.001
        && y + radius > wall.y + 0.001 && y - radius < wall.y + wall.height - 0.001);
}

function freeActorPoint(point, radius, playerBounds = true) {
    const top = gameHudHeight;
    const bottom = Math.max(top + 1, canvas.height);
    const left = playerBounds ? Math.min(radius, canvas.width / 2) : -radius * 3;
    const right = playerBounds ? Math.max(left, canvas.width - radius) : canvas.width + radius + 120;
    const result = { x: clamp(point.x, left, right), y: clamp(point.y, Math.min(top + radius, bottom), Math.max(top + radius, bottom - radius)) };
    // Used only after resizing or placing a teleport marker, never to bypass a wall while walking.
    for (let pass = 0; pass < 12; pass++) {
        const wall = walls.find(w => result.x + radius > w.x + 0.001 && result.x - radius < w.x + w.width - 0.001
            && result.y + radius > w.y + 0.001 && result.y - radius < w.y + w.height - 0.001);
        if (!wall) break;
        const candidates = [
            { x: wall.x - radius - 0.01, y: result.y }, { x: wall.x + wall.width + radius + 0.01, y: result.y },
            { x: result.x, y: wall.y - radius - 0.01 }, { x: result.x, y: wall.y + wall.height + radius + 0.01 }
        ].filter(p => p.x >= left && p.x <= right && p.y >= top + radius && p.y <= bottom - radius
            && !bodyTouchesWall(p.x, p.y, radius));
        candidates.sort((a, b) => Math.hypot(a.x - result.x, a.y - result.y) - Math.hypot(b.x - result.x, b.y - result.y));
        if (!candidates.length) break;
        Object.assign(result, candidates[0]);
    }
    return result;
}

const wallPatterns = ["gate", "needle", "shelves", "staggered", "elbow", "islands"];

function nextWallPattern() {
    if (!worldState.patternBag.length) {
        worldState.patternBag = [...wallPatterns];
        for (let i = worldState.patternBag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [worldState.patternBag[i], worldState.patternBag[j]] = [worldState.patternBag[j], worldState.patternBag[i]];
        }
        if (worldState.patternBag.at(-1) === worldState.lastPattern) worldState.patternBag.reverse();
    }
    worldState.lastPattern = worldState.patternBag.pop();
    return worldState.lastPattern;
}

function spawnWallGate(x, first = false, pattern = first ? "gate" : nextWallPattern()) {
    const height = canvas.height - gameHudHeight;
    if (height < 150 || canvas.width < 150) return;
    // Even the tightest route has clearance for the 40 px player and 48 px brute.
    const gap = pattern === "needle" ? 64 + Math.random() * 14
        : Math.min(height - 60, Math.max(150, height * (0.30 + Math.random() * 0.16)));
    const margin = gap / 2 + 28;
    const previous = gameHudHeight + height * worldState.lastGapRatio;
    const desired = first ? player.y : previous + (Math.random() - 0.5) * Math.min(320, height * 0.5);
    const center = clamp(desired, gameHudHeight + margin, canvas.height - margin);
    worldState.lastGapRatio = (center - gameHudHeight) / height;
    const width = clamp(canvas.width * 0.055, 44, 76);
    const gateId = worldState.nextGateId++;
    const span = clamp(canvas.width * 0.23, 170, 290);
    const thick = Math.min(38, height * 0.12);
    function add(offset, y, w, h) {
        if (h <= 0) return;
        walls.push({ x: x + offset, y, width: w, height: h, gateId, pattern,
            widthRatio: w / canvas.width, yRatio: (y - gameHudHeight) / height, heightRatio: h / height });
    }
    if (pattern === "gate" || pattern === "needle") {
        add(0, gameHudHeight, width, center - gap / 2 - gameHudHeight);
        add(0, center + gap / 2, width, canvas.height - center - gap / 2);
    } else if (pattern === "shelves") {
        // A narrow horizontal corridor, with open routes above and below it.
        const middle = gameHudHeight + height * (0.4 + Math.random() * 0.2);
        const opening = 68 + Math.random() * 32;
        add(0, middle - opening / 2 - thick, span, thick);
        add(0, middle + opening / 2, span, thick);
    } else if (pattern === "staggered") {
        add(0, gameHudHeight, width * 0.7, height * 0.52);
        add(span - width * 0.7, gameHudHeight + height * 0.48, width * 0.7, height * 0.52);
    } else if (pattern === "elbow") {
        const flipped = Math.random() < 0.5;
        const y = gameHudHeight + height * (flipped ? 0.3 : 0.7);
        add(0, flipped ? gameHudHeight : y, width * 0.65, height * 0.3);
        add(0, y, span, thick);
    } else {
        add(0, gameHudHeight + height * 0.18, span * 0.7, thick);
        add(span * 0.65, gameHudHeight + height * 0.46, width, height * 0.14);
        add(0, gameHudHeight + height * 0.78, span * 0.7, thick);
    }
}

function startScrollingWorld() {
    worldState.started = true;
    worldState.viewportWidth = canvas.width;
    const x = Math.max(player.x + 190, canvas.width * 0.82);
    spawnWallGate(x, true);
    worldState.nextWallX = x + Math.max(320, Math.min(500, canvas.width * 0.42));
}

function scrollWorld(deltaMs) {
    if (!canControlPlayer() || !worldState.started) return;
    const shift = getScrollSpeed() * Math.min(deltaMs, 50) / 1000;
    worldState.scroll += shift;
    worldState.nextWallX -= shift;
    const carried = [player, ...walls, ...hayStacks, ...harvestPickups, ...harvestBursts, ...dashTrail, ...monsters, ...bullets, ...collectionEffects, ...combatEffects, ...wallSparks];
    if (abilityState.lure.point) carried.push(abilityState.lure.point);
    if (movement.target && !movement.rightButtonDown) carried.push(movement.target);
    for (const item of carried) item.x -= shift;
    const radius = Math.min(player.size / 2, canvas.width / 2);
    player.x = clamp(player.x, radius, Math.max(radius, canvas.width - radius));
    // The advancing hazard consumes old gates before they could crush a player at the left boundary.
    for (let i = walls.length - 1; i >= 0; i--) {
        if (walls[i].x + walls[i].width < Math.max(getDeathZoneWidth() + player.size, walls[i].width + player.size + 1)) {
            walls.splice(i, 1);
        }
    }
    for (let i = hayStacks.length - 1; i >= 0; i--) if (hayStacks[i].x < -haySettings.size) hayStacks.splice(i, 1);
    for (let i = monsters.length - 1; i >= 0; i--) {
        if (monsters[i].x + monsters[i].radius < -16) monsters.splice(i, 1);
    }
    for (let i = harvestPickups.length - 1; i >= 0; i--) if (harvestPickups[i].x < -32) harvestPickups.splice(i, 1);
    if (movement.target) movement.target.x = clamp(movement.target.x, radius, Math.max(radius, canvas.width - radius));
    if (worldState.nextWallX <= canvas.width + 240 && walls.length <= 21) {
        spawnWallGate(worldState.nextWallX);
        worldState.nextWallX += Math.max(320, Math.min(500, canvas.width * 0.42)) * (0.9 + Math.random() * 0.25);
    }
    for (let i = wallSparks.length - 1; i >= 0; i--) {
        if (gameClock.elapsedMs - wallSparks[i].createdAt > 220) wallSparks.splice(i, 1);
    }
}

function resizeWorld() {
    const height = Math.max(1, canvas.height - gameHudHeight);
    const ratio = worldState.viewportWidth > 0 ? canvas.width / worldState.viewportWidth : 1;
    if (canvas.width < 150 || height < 150) walls.length = 0;
    for (const wall of walls) {
        wall.x *= ratio;
        wall.width = wall.widthRatio ? wall.widthRatio * canvas.width : wall.width * ratio;
        wall.y = gameHudHeight + wall.yRatio * height;
        wall.height = wall.heightRatio * height;
    }
    // Resizing a short window must not squeeze a designed passage below body width.
    const groups = new Map();
    for (const wall of walls) {
        if (!groups.has(wall.gateId)) groups.set(wall.gateId, []);
        groups.get(wall.gateId).push(wall);
    }
    for (const group of groups.values()) {
        if (group.length !== 2 || !["gate", "needle", "shelves"].includes(group[0].pattern)) continue;
        group.sort((a, b) => a.y - b.y);
        const [upper, lower] = group;
        if (lower.y - upper.y - upper.height >= 64) continue;
        const center = clamp((upper.y + upper.height + lower.y) / 2, gameHudHeight + 64, canvas.height - 64);
        if (upper.pattern === "shelves") {
            upper.y = center - 32 - upper.height;
            lower.y = center + 32;
        } else {
            upper.height = center - 32 - gameHudHeight;
            lower.y = center + 32;
            lower.height = canvas.height - lower.y;
        }
    }
    if (worldState.started) worldState.nextWallX *= ratio;
    worldState.viewportWidth = canvas.width;
    Object.assign(player, freeActorPoint(player, player.size / 2));
    for (const monster of monsters) Object.assign(monster, freeActorPoint(monster, monster.radius, false));
}

function moveActor(actor, dx, dy, radius, verticalWrap = false, playerBounds = false) {
    const top = Math.min(gameHudHeight, Math.max(0, canvas.height - 1));
    const bottom = Math.max(top + 1, canvas.height);
    const height = bottom - top;
    const left = Math.min(radius, canvas.width / 2);
    const right = Math.max(left, canvas.width - radius);
    if (playerBounds) actor.x = clamp(actor.x, left, right);
    const obstacles = wallRects(verticalWrap);
    const count = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
    const segments = [];
    let distance = 0, wrapped = false;
    for (let part = 0; part < count; part++) {
        const oldX = actor.x, oldY = actor.y;
        let nextX = actor.x + dx / count;
        if (playerBounds) nextX = clamp(nextX, left, right);
        for (const wall of obstacles) {
            if (actor.y + radius <= wall.y || actor.y - radius >= wall.y + wall.height) continue;
            if (nextX > actor.x && actor.x + radius <= wall.x + 0.001) nextX = Math.min(nextX, wall.x - radius);
            if (nextX < actor.x && actor.x - radius >= wall.x + wall.width - 0.001) nextX = Math.max(nextX, wall.x + wall.width + radius);
        }
        actor.x = nextX;
        if (oldX !== nextX) segments.push({ x1: oldX, y1: oldY, x2: nextX, y2: oldY });
        let nextY = actor.y + dy / count;
        for (const wall of obstacles) {
            if (actor.x + radius <= wall.x || actor.x - radius >= wall.x + wall.width) continue;
            if (nextY > actor.y && actor.y + radius <= wall.y + 0.001) nextY = Math.min(nextY, wall.y - radius);
            if (nextY < actor.y && actor.y - radius >= wall.y + wall.height - 0.001) nextY = Math.max(nextY, wall.y + wall.height + radius);
        }
        if (!verticalWrap) nextY = clamp(nextY, Math.min(top + radius, bottom), Math.max(top + radius, bottom - radius));
        distance += Math.hypot(nextX - oldX, nextY - oldY);
        let from = oldY;
        if (verticalWrap) {
            while (nextY < top || nextY > bottom) {
                const exit = nextY < top ? top : bottom;
                segments.push({ x1: nextX, y1: from, x2: nextX, y2: exit });
                from = nextY < top ? bottom : top;
                nextY += nextY < top ? height : -height;
                wrapped = true;
            }
        }
        segments.push({ x1: nextX, y1: from, x2: nextX, y2: nextY });
        actor.y = nextY;
    }
    return { distance, segments, wrapped };
}

function wallHitTime(startX, startY, endX, endY, radius = 0) {
    let first = null;
    for (const wall of walls) {
        let enter = 0, leave = 1;
        for (const [start, delta, low, high] of [
            [startX, endX - startX, wall.x - radius, wall.x + wall.width + radius],
            [startY, endY - startY, wall.y - radius, wall.y + wall.height + radius]
        ]) {
            if (delta === 0) { if (start < low || start > high) { enter = 2; break; } }
            else {
                const a = (low - start) / delta, b = (high - start) / delta;
                enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
            }
        }
        if (enter <= leave && enter <= 1 && (first === null || enter < first)) first = enter;
    }
    return first;
}

function monsterNavigationTarget(monster, target) {
    if (wallHitTime(monster.x, monster.y, target.x, target.y, monster.radius + 3) === null) return target;
    const direction = target.x < monster.x ? -1 : 1;
    const candidates = walls.filter(w => direction < 0 ? w.x < monster.x && w.x + w.width > target.x
        : w.x + w.width > monster.x && w.x < target.x);
    candidates.sort((a, b) => Math.abs(a.x + a.width / 2 - monster.x) - Math.abs(b.x + b.width / 2 - monster.x));
    const wall = candidates[0];
    if (!wall) return target;
    const pad = monster.radius + 6;
    let openings = [[gameHudHeight + pad, canvas.height - pad]];
    for (const blocker of walls.filter(w => w.x < wall.x + wall.width && w.x + w.width > wall.x)) {
        openings = openings.flatMap(([low, high]) => {
            const start = blocker.y - pad, end = blocker.y + blocker.height + pad;
            if (end <= low || start >= high) return [[low, high]];
            return [[low, Math.min(high, start)], [Math.max(low, end), high]].filter(([a, b]) => b > a);
        });
    }
    if (!openings.length) return target;
    const options = openings.map(([low, high]) => clamp(target.y, low, high));
    options.sort((a, b) => Math.abs(a - monster.y) - Math.abs(b - monster.y));
    return { x: direction < 0 ? wall.x - pad : wall.x + wall.width + pad, y: options[0] };
}

function updateDeathZone(deltaMs) {
    if (!canControlPlayer()) return;
    const exposed = player.x - player.size / 2 < getDeathZoneWidth();
    if (!exposed || isEnergyShieldActive()) {
        worldState.zoneExposure = 0;
        if (exposed) gameAudio.play("block");
        return;
    }
    worldState.zoneExposure += deltaMs;
    if (worldState.zoneExposure < worldSettings.zoneIntervalMs) return;
    worldState.zoneExposure %= worldSettings.zoneIntervalMs;
    player.health = Math.max(0, player.health - worldSettings.zoneDamage);
    worldState.zoneHitUntil = gameClock.elapsedMs + 220;
    gameAudio.play("hurt");
    if (player.health / player.maxHealth <= 0.25) gameAudio.play("lowHealth");
    updateHud();
    if (player.health === 0) endGame();
}

function drawScrollingWorld() {
    ctx.fillStyle = "#20261d";
    ctx.fillRect(0, gameHudHeight, canvas.width, canvas.height - gameHudHeight);
    ctx.save();
    ctx.strokeStyle = "rgba(159, 174, 108, 0.10)";
    ctx.lineWidth = 1;
    for (let x = -(worldState.scroll % 100); x < canvas.width; x += 100) {
        ctx.beginPath(); ctx.moveTo(x, gameHudHeight); ctx.lineTo(x - 55, canvas.height); ctx.stroke();
        for (let y = gameHudHeight + 55; y < canvas.height; y += 105) {
            ctx.strokeStyle = "rgba(159, 174, 108, 0.16)";
            ctx.beginPath(); ctx.moveTo(x + 30, y + 6); ctx.lineTo(x + 26, y - 3);
            ctx.moveTo(x + 30, y + 6); ctx.lineTo(x + 34, y - 5); ctx.stroke();
        }
    }
    ctx.restore();
}

function drawWalls() {
    ctx.save();
    for (const wall of walls) {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(wall.x - 5, wall.y + 5, wall.width + 10, wall.height);
        ctx.fillStyle = "#556052"; ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
        ctx.strokeStyle = "#29352c"; ctx.lineWidth = 2;
        for (let y = wall.y + 24, row = 0; y < wall.y + wall.height; y += 24, row++) {
            ctx.beginPath(); ctx.moveTo(wall.x, y); ctx.lineTo(wall.x + wall.width, y);
            const joint = wall.x + wall.width * (row % 2 ? 0.35 : 0.65);
            ctx.moveTo(joint, y - 24); ctx.lineTo(joint, y); ctx.stroke();
        }
        ctx.strokeStyle = "#929e79"; ctx.strokeRect(wall.x, wall.y, wall.width, wall.height);
        ctx.fillStyle = "#b9b28a"; ctx.fillRect(wall.x, wall.y, 4, wall.height);
    }
    for (const spark of wallSparks) {
        ctx.globalAlpha = Math.max(0, 1 - (gameClock.elapsedMs - spark.createdAt) / 220);
        ctx.fillStyle = "#ffd589";
        ctx.fillRect(spark.x - 3, spark.y - 3, 6, 6);
    }
    ctx.restore();
}

function drawDeathZone() {
    const width = getDeathZoneWidth();
    const height = canvas.height - gameHudHeight;
    const pulse = 0.18 + Math.sin(gameClock.elapsedMs / 250) * 0.035;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, gameHudHeight, width, height); ctx.clip();
    ctx.fillStyle = `rgba(196, 32, 44, ${pulse})`; ctx.fillRect(0, gameHudHeight, width, height);
    ctx.strokeStyle = "rgba(255, 95, 88, 0.22)"; ctx.lineWidth = 12;
    for (let y = gameHudHeight - width; y < canvas.height + width; y += 44) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y + width); ctx.stroke();
    }
    ctx.restore();
    ctx.save(); ctx.strokeStyle = "#ff6c63"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(width, gameHudHeight); ctx.lineTo(width, canvas.height); ctx.stroke();
    ctx.translate(width / 2, gameHudHeight + height * 0.65); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "#ffb4a7"; ctx.font = "bold 16px Arial"; ctx.textAlign = "center";
    ctx.fillText("DEATH ZONE · KEEP MOVING", 0, 0); ctx.restore();
    if (gameClock.elapsedMs < worldState.zoneHitUntil) {
        ctx.fillStyle = "rgba(230, 35, 45, 0.12)"; ctx.fillRect(0, gameHudHeight, canvas.width, height);
    }
}
