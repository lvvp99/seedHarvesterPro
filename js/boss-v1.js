// Milestones are queued so one large XP reward cannot skip a boss encounter.
const bossState = {
    queue: [],
    seenLevels: new Set(),
    active: null,
    nextEncounterAt: 0,
    introStartedAt: -Infinity,
    introDurationMs: 2600,
    defeatedUntil: 0
};

function queueBossForLevel(level) {
    if (!Number.isSafeInteger(level) || level < 5 || level % 5 !== 0 || bossState.seenLevels.has(level)) return false;
    bossState.seenLevels.add(level);
    bossState.queue.push(level);
    bossState.queue.sort((a, b) => a - b);
    return true;
}

function getBossRadius(stage) {
    // Grow at every milestone, with enough room left to dodge on small screens.
    const top = Math.min(gameHudHeight, Math.max(0, canvas.height - 1));
    const space = Math.min(Math.max(1, canvas.width), Math.max(1, canvas.height - top));
    const limit = Math.max(0.1, space * 0.19);
    const base = Math.min(50, limit * 0.6);
    const room = limit - base;
    return base + room * (1 - Math.exp(-Math.max(0, stage - 1) * 7 / room));
}

function isBossEncounterActive() {
    return !!bossState.active && bossState.active.health > 0;
}

function updateBossEncounter() {
    if (!canControlPlayer() || isBossEncounterActive() || !bossState.queue.length
        || gameClock.elapsedMs < bossState.nextEncounterAt
        || canvas.width < 60 || canvas.height - gameHudHeight < 60) return;

    const level = bossState.queue.shift();
    const stage = level / 5;
    const growth = stage - 1;
    const radius = getBossRadius(stage);
    const x = canvas.width - radius - 6;
    const low = gameHudHeight + radius + 6;
    const high = canvas.height - radius - 6;
    const candidates = [low, high, (low + high) / 2];
    candidates.sort((a, b) => Math.hypot(x - player.x, b - player.y) - Math.hypot(x - player.x, a - player.y));
    const health = Math.ceil(800 * (1 + growth * 0.65 + growth * growth * 0.12));
    const monster = {
        id: monsterState.nextId++, type: "boss", edge: "right",
        x, y: candidates[0], radius, health, maxHealth: health,
        speed: 48 + growth * 4, damage: 28 + growth * 8,
        xpReward: 120 + stage * 40, hitUntil: 0,
        bossStage: stage, bossLevel: level, lootDropped: false,
        moveAfter: gameClock.elapsedMs + 1100
    };

    // Clear the gates into an open arena; no huge boss can become wedged in a corridor.
    for (const wall of walls) {
        wallSparks.push({ x: wall.x + wall.width / 2, y: wall.y + wall.height / 2, createdAt: gameClock.elapsedMs });
    }
    walls.length = 0;
    worldState.nextWallX = canvas.width + Math.max(300, canvas.width * 0.4);
    worldState.zoneExposure = 0;
    worldState.zoneHitUntil = 0;
    bossState.active = monster;
    bossState.introStartedAt = gameClock.elapsedMs;
    // Deliberately bypass the regular population cap: a milestone always earns its encounter.
    monsters.push(monster);
    monsterState.playerInvulnerableUntil = Math.max(monsterState.playerInvulnerableUntil, monster.moveAfter);
    monsterState.nextSpawnAt = gameClock.elapsedMs + 3300;
    gameAudio.play("spawn");
    gameAudio.play("explosion");
}

function bossDefeated(monster) {
    if (monster.type !== "boss" || !monster.bossStage || monster.lootDropped) return;
    monster.lootDropped = true;
    dropBossLoot(monster.bossStage, monster);
    if (bossState.active?.id === monster.id) bossState.active = null;
    bossState.nextEncounterAt = gameClock.elapsedMs + 4500;
    bossState.defeatedUntil = gameClock.elapsedMs + 2400;
    monsterState.nextSpawnAt = Math.max(monsterState.nextSpawnAt, gameClock.elapsedMs + 1800);
    worldState.zoneExposure = 0;
    worldState.zoneHitUntil = 0;
    gameAudio.play("unlock");
}

function drawBossBody(ctx, monster, target, elapsedMs = 0) {
    const r = monster.radius;
    const angle = Math.atan2(target.y - monster.y, target.x - monster.x);
    const pulse = 0.5 + Math.sin(elapsedMs / 180) * 0.5;
    ctx.save();
    ctx.translate(monster.x, monster.y);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath(); ctx.ellipse(0, r * 0.77, r * 1.08, r * 0.37, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,68,67,${0.32 + pulse * 0.2})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r + 6 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = monster.hitUntil > elapsedMs ? "#523237" : "#050507";
    ctx.strokeStyle = "#8b4e5a"; ctx.lineWidth = Math.max(2, r * 0.04);
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8 - Math.PI / 2;
        const length = r * (i % 2 === 0 ? 1.11 : 0.88);
        if (i === 0) ctx.moveTo(Math.cos(a) * length, Math.sin(a) * length);
        else ctx.lineTo(Math.cos(a) * length, Math.sin(a) * length);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#08080c"; ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#352932"; ctx.lineWidth = r * 0.08;
    ctx.beginPath(); ctx.moveTo(-r * 0.62, -r * 0.34); ctx.lineTo(-r * 0.23, -r * 0.67);
    ctx.lineTo(0, -r * 0.42); ctx.lineTo(r * 0.23, -r * 0.67); ctx.lineTo(r * 0.62, -r * 0.34); ctx.stroke();
    for (const side of [-1, 1]) {
        ctx.fillStyle = "#fa3f4d";
        ctx.beginPath(); ctx.ellipse(side * r * 0.32, -r * 0.08, r * 0.20, r * 0.115, side * -0.22, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffc9ad";
        ctx.beginPath(); ctx.arc(side * r * 0.32 + Math.cos(angle) * r * 0.05, -r * 0.08 + Math.sin(angle) * r * 0.04,
            r * 0.055, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = "#b1646b"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-r * 0.36, r * 0.30); ctx.lineTo(-r * 0.18, r * 0.38);
    ctx.lineTo(0, r * 0.30); ctx.lineTo(r * 0.18, r * 0.38); ctx.lineTo(r * 0.36, r * 0.30); ctx.stroke();
    ctx.restore();
}

function drawBossEncounter() {
    if (!gameStarted) return;
    const monster = bossState.active;
    if (!isBossEncounterActive()) {
        if (gameClock.elapsedMs < bossState.defeatedUntil) {
            ctx.save(); ctx.globalAlpha = Math.min(1, (bossState.defeatedUntil - gameClock.elapsedMs) / 500);
            ctx.textAlign = "center"; ctx.font = "bold 18px Arial";
            ctx.fillStyle = "#fff0ad"; ctx.strokeStyle = "#111"; ctx.lineWidth = 4;
            ctx.strokeText("COLOSSUS DEFEATED · LOOT DROPPED", canvas.width / 2, gameHudHeight + 66);
            ctx.fillText("COLOSSUS DEFEATED · LOOT DROPPED", canvas.width / 2, gameHudHeight + 66);
            ctx.restore();
        }
        return;
    }

    const width = Math.min(460, canvas.width * 0.65);
    const x = (canvas.width - width) / 2;
    const y = gameHudHeight + 30;
    ctx.save();
    ctx.fillStyle = "rgba(9,5,10,0.9)"; ctx.fillRect(x - 7, y - 24, width + 14, 52);
    ctx.strokeStyle = "#a55060"; ctx.lineWidth = 1; ctx.strokeRect(x - 7, y - 24, width + 14, 52);
    ctx.font = `bold ${Math.max(10, Math.min(14, width / 26))}px Arial`; ctx.textAlign = "center";
    ctx.fillStyle = "#ffd3d8";
    ctx.fillText(`OBSIDIAN COLOSSUS ${monster.bossStage} · LEVEL ${monster.bossLevel}`, canvas.width / 2, y - 7);
    ctx.fillStyle = "#30121c"; ctx.fillRect(x, y, width, 8);
    ctx.fillStyle = "#e9465d"; ctx.fillRect(x, y, width * monster.health / monster.maxHealth, 8);
    ctx.font = "10px Arial"; ctx.fillStyle = "#e5c8cd";
    ctx.fillText(`${Math.ceil(monster.health)} / ${monster.maxHealth} HP · Arena locked`, canvas.width / 2, y + 21);

    const age = gameClock.elapsedMs - bossState.introStartedAt;
    if (age < bossState.introDurationMs) {
        const fade = Math.min(1, age / 160, (bossState.introDurationMs - age) / 600);
        const middle = gameHudHeight + (canvas.height - gameHudHeight) * 0.39;
        ctx.globalAlpha = Math.max(0, fade);
        ctx.fillStyle = "rgba(51,3,14,0.16)"; ctx.fillRect(0, gameHudHeight, canvas.width, canvas.height - gameHudHeight);
        ctx.fillStyle = "rgba(3,1,6,0.80)"; ctx.fillRect(0, middle - 55, canvas.width, 118);
        ctx.strokeStyle = "#da4059"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, middle - 55); ctx.lineTo(canvas.width, middle - 55);
        ctx.moveTo(0, middle + 63); ctx.lineTo(canvas.width, middle + 63); ctx.stroke();
        ctx.font = `900 ${Math.min(44, Math.max(16, canvas.width / 24))}px Arial`;
        ctx.fillStyle = "#ffe5e5"; ctx.fillText("OBSIDIAN COLOSSUS", canvas.width / 2, middle);
        ctx.font = `bold ${Math.min(16, Math.max(10, canvas.width / 38))}px Arial`;
        ctx.fillStyle = "#ff8b9d";
        ctx.fillText(`LEVEL ${monster.bossLevel} BOSS · DEFEAT IT TO ADVANCE`, canvas.width / 2, middle + 28);
        ctx.strokeStyle = "rgba(255,68,96,0.75)"; ctx.lineWidth = 4;
        ctx.strokeRect(3, gameHudHeight + 3, canvas.width - 6, Math.max(1, canvas.height - gameHudHeight - 6));
    }
    ctx.restore();
}
