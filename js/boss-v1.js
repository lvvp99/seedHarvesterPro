const bossDefinitions = [
    { name: "Obsidian Colossus", color: "#ff536b", health: 800, speed: 138,
        attacks: ["shockwave", "volley", "meteors", "beam", "charge"],
        description: "Double shockwaves, aimed shard volleys, meteor barrages, a sweeping beam and a lightning-fast charge." },
    { name: "Cinder Behemoth", color: "#ff963e", health: 1800, speed: 146,
        attacks: ["flameSpiral", "cinderPools", "charge"],
        description: "Spins radial fireballs, leaves burning impact pools and charges through escape routes." },
    { name: "Tempest Sovereign", color: "#72dcff", health: 3400, speed: 162,
        attacks: ["stormCross", "thunderLines", "volley"],
        description: "Sweeps four lightning beams around its body, strikes vertical lightning lanes and fires aimed volleys." },
    { name: "Thorn Matriarch", color: "#a7ee66", health: 5800, speed: 174,
        attacks: ["thornMines", "thornRows", "seedStorm"],
        description: "Plants delayed thorn mines, seals horizontal rows around marked escape gaps and sprays dense seed rings." },
    { name: "Abyss Leviathan", color: "#a294ff", health: 9200, speed: 188,
        attacks: ["gravityWell", "collapsingRing", "abyssCharge"],
        description: "Pulls you into a gravity well, contracts a crushing ring and lunges across the arena." },
    { name: "Eclipse Tyrant", color: "#ff7de0", health: 14000, speed: 202,
        attacks: ["eclipseLattice", "eclipseOrbs", "solarStorm", "stormCross"],
        description: "Cuts a diagonal laser lattice, unleashes bouncing dark orbs and bombards the arena with solar impacts." }
];

function getBossDefinition(stage = 1) {
    return bossDefinitions[clamp(stage - 1, 0, bossDefinitions.length - 1)];
}

// Milestones are queued so one large XP reward cannot skip a campaign encounter.
const bossState = {
    queue: [],
    seenLevels: new Set(),
    active: null,
    bosses: [],
    encounterMaxHealth: 0,
    defeatedStages: new Set(),
    finalEncounterStarted: false,
    finalEncounterLevel: null,
    campaignComplete: false,
    nextEncounterAt: 0,
    introStartedAt: -Infinity,
    introDurationMs: 2600,
    defeatedUntil: 0,
    defeatedName: "BOSS",
    get attack() { return this.active?.attack || null; },
    set attack(value) { if (this.active) this.active.attack = value; },
    get attackIndex() { return this.active?.attackIndex || 0; },
    set attackIndex(value) { if (this.active) this.active.attackIndex = value; },
    get nextAttackAt() { return this.active?.nextAttackAt ?? Infinity; },
    set nextAttackAt(value) { if (this.active) this.active.nextAttackAt = value; }
};

function queueBossForLevel(level) {
    const campaignMilestone = level >= 5 && level <= 30 && level % 5 === 0;
    const finaleMilestone = bossState.finalEncounterLevel !== null && level === bossState.finalEncounterLevel;
    if (!Number.isSafeInteger(level) || (!campaignMilestone && !finaleMilestone)
        || bossState.campaignComplete || bossState.seenLevels.has(level)) return false;
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
    return bossState.bosses.some(monster => monster.health > 0);
}

function createCampaignBoss(stage, level, slot = 0, finale = false) {
    const definition = getBossDefinition(stage);
    const growth = stage - 1;
    const radius = getBossRadius(stage);
    const x = finale ? canvas.width * (slot % 2 ? 0.88 : 0.70) : canvas.width - radius - 6;
    const low = gameHudHeight + radius + 6;
    const high = canvas.height - radius - 6;
    const candidates = [low, high, (low + high) / 2];
    candidates.sort((a, b) => Math.hypot(x - player.x, b - player.y) - Math.hypot(x - player.x, a - player.y));
    const health = Math.ceil(definition.health * (finale ? 1.25 : 1));
    const monster = {
        id: monsterState.nextId++, type: "boss", edge: "right",
        x, y: finale ? low + (high - low) * (Math.floor(slot / 2) / 2) : candidates[0], radius, health, maxHealth: health,
        speed: definition.speed, damage: 28 + growth * 8,
        xpReward: 120 + stage * 40, hitUntil: 0,
        bossStage: stage, bossLevel: level, bossFinale: finale, name: definition.name, lootDropped: false,
        attack: null, attackIndex: 0,
        nextAttackAt: gameClock.elapsedMs + bossState.introDurationMs + 450 + slot * 400,
        moveAfter: gameClock.elapsedMs + bossState.introDurationMs
    };
    clampMonsterToMap(monster);
    return monster;
}

function updateBossEncounter() {
    if (bossState.finalEncounterLevel !== null && player.level >= bossState.finalEncounterLevel
        && !bossState.finalEncounterStarted && !bossState.campaignComplete) queueBossForLevel(bossState.finalEncounterLevel);
    if (!canControlPlayer() || isBossEncounterActive() || !bossState.queue.length
        || bossState.campaignComplete || gameClock.elapsedMs < bossState.nextEncounterAt
        || canvas.width < 60 || canvas.height - gameHudHeight < 60) return;
    const level = bossState.queue[0];
    const finale = level === bossState.finalEncounterLevel;
    if (finale && bossState.defeatedStages.size < bossDefinitions.length) return;
    bossState.queue.shift();
    const stages = finale ? [1, 2, 3, 4, 5, 6] : [level / 5];
    bossState.bosses = stages.map((stage, slot) => createCampaignBoss(stage, level, slot, finale));
    bossState.encounterMaxHealth = bossState.bosses.reduce((total, boss) => total + boss.maxHealth, 0);
    bossState.active = bossState.bosses[0];
    if (finale) bossState.finalEncounterStarted = true;

    // Clear the gates into an open arena; no huge boss can become wedged in a corridor.
    for (const wall of walls) {
        wallSparks.push({ x: wall.x + wall.width / 2, y: wall.y + wall.height / 2, createdAt: gameClock.elapsedMs });
    }
    walls.length = 0;
    worldState.nextWallX = canvas.width + Math.max(300, canvas.width * 0.4);
    worldState.zoneExposure = 0;
    worldState.zoneHitUntil = 0;
    bossState.introStartedAt = gameClock.elapsedMs;
    // Deliberately bypass the regular population cap: a milestone always earns its encounter.
    monsters.push(...bossState.bosses);
    monsterState.playerInvulnerableUntil = Math.max(monsterState.playerInvulnerableUntil, bossState.active.moveAfter);
    monsterState.nextSpawnAt = gameClock.elapsedMs + 3300;
    gameAudio.play("spawn");
    gameAudio.play("explosion");
}

function scheduleBossFinaleAfterRewards(monster) {
    // The sixth boss's XP belongs to the completed encounter. Count five new levels after that reward.
    if (monster.type === "boss" && !monster.bossFinale && bossState.defeatedStages.size === bossDefinitions.length
        && bossState.finalEncounterLevel === null) bossState.finalEncounterLevel = player.level + 5;
}

function bossDefeated(monster) {
    if (monster.type !== "boss" || !monster.bossStage || monster.lootDropped) return;
    monster.lootDropped = true;
    dropBossLoot(monster.bossStage, monster);
    monster.attack = null;
    monster.nextAttackAt = Infinity;
    bossState.bosses = bossState.bosses.filter(boss => boss.id !== monster.id && boss.health > 0);
    bossState.active = bossState.bosses[0] || null;
    if (!monster.bossFinale) bossState.defeatedStages.add(monster.bossStage);
    gameAudio.play("unlock");
    // A defeated member of the final six cannot release the arena or erase another boss's attack.
    if (isBossEncounterActive()) return;
    if (bossState.finalEncounterStarted) {
        bossState.campaignComplete = true;
        bossState.queue.length = 0;
    }
    bossState.defeatedName = bossState.campaignComplete ? "THE FINAL SIX" : (monster.name || getBossDefinition(monster.bossStage).name).toUpperCase();
    bossState.nextEncounterAt = gameClock.elapsedMs + 4500;
    bossState.defeatedUntil = gameClock.elapsedMs + 2400;
    monsterState.nextSpawnAt = Math.max(monsterState.nextSpawnAt, gameClock.elapsedMs + 1800);
    worldState.zoneExposure = 0;
    worldState.zoneHitUntil = 0;
}

const bossAttackTypes = ["shockwave", "volley", "meteors", "beam", "charge"];
const bossAttackLabels = {
    shockwave: "DOUBLE SHOCKWAVE · FIND THE GAP", volley: "TRIPLE VOLLEY · KEEP DODGING",
    meteors: "METEOR BARRAGE · WATCH THE NEXT WAVE", beam: "SWEEPING BEAM · CLEAR THE ARC",
    charge: "COLOSSUS CHARGE · CLEAR THE PATH",
    flameSpiral: "CINDER SPIRAL · WEAVE BETWEEN FLAMES", cinderPools: "BURNING POOLS · KEEP CLEAR",
    stormCross: "STORM CROSS · ROTATING LIGHTNING", thunderLines: "THUNDER LANES · FIND THE GAP",
    thornMines: "THORN MINES · LEAVE THE CIRCLES", thornRows: "THORN ROWS · FIND THE GAPS",
    seedStorm: "SEED STORM · THREAD THE RINGS", gravityWell: "GRAVITY WELL · RUN OUTWARD",
    collapsingRing: "ABYSS RING · FIND THE OPENING", abyssCharge: "LEVIATHAN LUNGE · CLEAR THE PATH",
    eclipseLattice: "ECLIPSE LATTICE · CROSS THE GAPS", eclipseOrbs: "DARK ORBS · WATCH THE REBOUND",
    solarStorm: "SOLAR BARRAGE · KEEP MOVING"
};

function bossAttackDamage(amount) {
    if (!canControlPlayer() || gameClock.elapsedMs < monsterState.playerInvulnerableUntil) return false;
    if (isEnergyShieldActive()) { gameAudio.play("block"); return false; }
    player.health = Math.max(0, player.health - amount);
    monsterState.playerInvulnerableUntil = gameClock.elapsedMs + monsterSettings.contactCooldownMs;
    updateHud();
    if (player.health === 0) endGame();
    else {
        gameAudio.play("hurt");
        if (player.health / player.maxHealth <= 0.25) gameAudio.play("lowHealth");
    }
    return true;
}

function bossAttackAngleDifference(a, b) {
    return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function bossCanPursueDuringAttack(boss = bossState.active) {
    const attack = boss?.attack;
    return !attack || ["meteors", "cinderPools", "solarStorm", "thornMines"].includes(attack.type)
        || (["volley", "flameSpiral", "seedStorm", "eclipseOrbs"].includes(attack.type) && attack.launched);
}

function addBossMeteorWave(attack, count, delay, spacing, boss = bossState.active) {
    const radius = Math.min(82, Math.max(22, Math.min(canvas.width, canvas.height - gameHudHeight) * 0.13));
    const top = Math.min(gameHudHeight + radius, canvas.height / 2 + gameHudHeight / 2);
    const angle = Math.atan2(player.y - boss.y, player.x - boss.x);
    for (let i = 0; i < count; i++) {
        const offset = i === 0 ? 0 : radius * 1.65;
        const a = angle + (i - 1) * Math.PI * 2 / Math.max(1, count - 1);
        attack.markers.push({
            x: clamp(player.x + Math.cos(a) * offset, radius, Math.max(radius, canvas.width - radius)),
            y: clamp(player.y + Math.sin(a) * offset, top, Math.max(top, canvas.height - radius)),
            radius, delay: delay + i * spacing, struck: false
        });
    }
}

function updateBossBeamEnd(attack, progress) {
    attack.currentAngle = attack.angle + attack.sweepAngle * clamp(progress, 0, 1);
    attack.endX = attack.x + Math.cos(attack.currentAngle) * attack.reach;
    attack.endY = attack.y + Math.sin(attack.currentAngle) * attack.reach;
}

function beginBossAttack(type, boss = bossState.active) {
    if (!boss || boss.health <= 0 || !isBossEncounterActive() || !canControlPlayer()) return null;
    const patterns = getBossDefinition(boss.bossStage).attacks;
    type ||= patterns[boss.attackIndex++ % patterns.length];
    const kind = ({ cinderPools: "meteors", solarStorm: "meteors", thornMines: "meteors",
        abyssCharge: "charge", collapsingRing: "shockwave", flameSpiral: "radial",
        seedStorm: "radial", eclipseOrbs: "radial", stormCross: "cross",
        thunderLines: "lanes", thornRows: "lanes", eclipseLattice: "lanes" })[type] || type;
    const angle = Math.atan2(player.y - boss.y, player.x - boss.x);
    const growth = Math.max(0, boss.bossStage - 1);
    const attack = {
        type, kind, x: boss.x, y: boss.y, angle, startedAt: gameClock.elapsedMs,
        windupMs: ({ shockwave: 750, volley: 650, meteors: 800, beam: 800, charge: 650,
            radial: 850, cross: 1050, lanes: 1050, gravityWell: 1000 }[kind] || 800)
            * Math.max(0.8, 1 - growth * 0.02),
        damageScale: 1 + growth * 0.12, launched: false, hit: false,
        projectiles: [], durationMs: 0
    };
    if (kind === "shockwave") {
        attack.startRadius = boss.radius + 12;
        attack.endRadius = Math.min(760, Math.max(190, Math.hypot(canvas.width, canvas.height - gameHudHeight) * 0.68));
        attack.endRadius = Math.max(attack.startRadius + 90, attack.endRadius);
        attack.radius = attack.startRadius;
        attack.gapAngle = angle + Math.PI / 3;
        attack.gapHalfAngle = Math.PI / 7;
        attack.waveDurationMs = (attack.endRadius - attack.startRadius) / (420 + Math.min(100, growth * 10)) * 1000;
        attack.rings = [0, 480].map(delay => ({ delay, radius: attack.startRadius, hit: false }));
        attack.durationMs = attack.waveDurationMs + 480;
        if (type === "collapsingRing") {
            [attack.startRadius, attack.endRadius] = [attack.endRadius, attack.startRadius];
            attack.rings = [0, 600].map(delay => ({ delay, radius: attack.startRadius, hit: false }));
            attack.durationMs = attack.waveDurationMs + 600;
            attack.gapHalfAngle = Math.PI / 6;
        }
    } else if (kind === "volley") {
        attack.count = Math.min(15, 9 + Math.floor(growth / 3) * 2);
        attack.speed = 340 + Math.min(120, growth * 12);
        attack.spread = 0.21;
        attack.burstCount = 3;
        attack.burstsFired = 0;
        attack.burstAngle = angle;
        attack.burstLocked = true;
        attack.burstReadyAt = attack.startedAt + attack.windupMs;
        attack.durationMs = 3100;
    } else if (kind === "meteors") {
        attack.markers = [];
        attack.followupCount = Math.min(5, 3 + Math.floor(growth / 3));
        attack.followupAdded = false;
        addBossMeteorWave(attack, Math.min(7, 5 + Math.floor(growth / 3)), 0, 140, boss);
        attack.durationMs = 2200;
        if (type === "cinderPools") { attack.poolMs = 1600; attack.durationMs = 3900; }
        if (type === "solarStorm") { attack.poolMs = 900; attack.followupCount = 7; attack.durationMs = 3200; }
        if (type === "thornMines") {
            attack.followupAdded = true;
            attack.poolMs = 1100;
            attack.durationMs = 2800;
            for (const marker of attack.markers) { marker.radius *= 0.65; marker.delay += 500; }
        }
    } else if (kind === "beam") {
        attack.reach = Math.hypot(canvas.width, canvas.height);
        attack.sweepAngle = 0.9;
        attack.angle = angle - attack.sweepAngle / 2;
        attack.currentAngle = attack.angle;
        updateBossBeamEnd(attack, 0);
        attack.width = 46 + Math.min(18, growth * 2);
        attack.durationMs = 1100;
    } else if (kind === "charge") {
        const reach = Math.min(type === "abyssCharge" ? 950 : 680, Math.hypot(canvas.width, canvas.height - gameHudHeight) * 0.8);
        // Clip along the ray rather than changing its angle at the map boundary.
        const dx = Math.cos(angle), dy = Math.sin(angle), margin = boss.radius + 2;
        const distances = [reach];
        if (dx > 0.0001) distances.push((canvas.width - margin - boss.x) / dx);
        if (dx < -0.0001) distances.push((margin - boss.x) / dx);
        if (dy > 0.0001) distances.push((canvas.height - margin - boss.y) / dy);
        if (dy < -0.0001) distances.push((gameHudHeight + margin - boss.y) / dy);
        const distance = Math.max(0, Math.min(...distances));
        attack.endX = boss.x + dx * distance;
        attack.endY = boss.y + dy * distance;
        attack.width = boss.radius * 2;
        attack.durationMs = Math.max(280, 360 - growth * 8);
    } else if (kind === "radial") {
        attack.count = type === "seedStorm" ? 18 : type === "eclipseOrbs" ? 10 : 12;
        attack.burstCount = type === "flameSpiral" ? 7 : type === "seedStorm" ? 4 : 3;
        attack.intervalMs = type === "flameSpiral" ? 260 : 550;
        attack.burstsFired = 0;
        attack.speed = type === "eclipseOrbs" ? 300 : 270 + growth * 15;
        attack.durationMs = attack.intervalMs * (attack.burstCount - 1) + 2400;
    } else if (kind === "cross") {
        attack.reach = Math.hypot(canvas.width, canvas.height);
        attack.width = 30;
        attack.currentAngle = angle - Math.PI / 4;
        attack.angle = attack.currentAngle;
        attack.sweepAngle = Math.PI / 2;
        attack.durationMs = 1900;
    } else if (kind === "lanes") {
        attack.lines = [];
        const horizontal = type === "thornRows";
        const extent = horizontal ? canvas.height - gameHudHeight : canvas.width;
        const lanes = 6;
        const size = extent / lanes;
        const safe = clamp(Math.floor((horizontal ? player.y - gameHudHeight : player.x) / size), 0, lanes - 1);
        attack.width = Math.min(65, size * 0.54);
        for (let i = 0; i < lanes; i++) {
            if (i === safe) continue;
            const position = (i + 0.5) * size;
            if (horizontal) attack.lines.push({ x: 0, y: gameHudHeight + position, endX: canvas.width, endY: gameHudHeight + position });
            else attack.lines.push({ x: position, y: gameHudHeight, endX: position, endY: canvas.height });
        }
        if (type === "eclipseLattice") {
            attack.width = 30;
            attack.lines = [];
            const length = Math.hypot(canvas.width, canvas.height);
            for (const direction of [-1, 1]) {
                for (const offset of [-240, 0, 240]) {
                    const x = player.x + offset, y = player.y;
                    attack.lines.push({ x: x - length, y: y - length * direction,
                        endX: x + length, endY: y + length * direction });
                }
            }
        }
        attack.durationMs = type === "thornRows" ? 1600 : 900;
    } else if (kind === "gravityWell") {
        attack.radius = Math.min(330, Math.min(canvas.width, canvas.height - gameHudHeight) * 0.45);
        attack.innerRadius = boss.radius + 35;
        attack.durationMs = 2500;
    }
    boss.attack = attack;
    gameAudio.play("spawn");
    return attack;
}

function updateBossAttacks(deltaMs) {
    if (!canControlPlayer() || !isBossEncounterActive()) return;
    for (const boss of [...bossState.bosses]) {
        if (!canControlPlayer()) break;
        updateSingleBossAttack(boss, deltaMs);
    }
}

function updateSingleBossAttack(boss, deltaMs) {
    const now = gameClock.elapsedMs;
    if (!boss.attack) {
        if (now >= boss.nextAttackAt) beginBossAttack(undefined, boss);
        return;
    }
    const attack = boss.attack, kind = attack.kind || attack.type;
    const age = now - attack.startedAt - attack.windupMs;
    if (age < 0) return;
    if (!attack.launched) {
        attack.launched = true;
        if (kind !== "volley") gameAudio.play("explosion");
    }
    const target = { x: player.x, y: player.y, radius: player.size / 2 };
    if (kind === "shockwave") {
        const distance = Math.hypot(player.x - attack.x, player.y - attack.y);
        const angle = Math.atan2(player.y - attack.y, player.x - attack.x);
        const outsideGap = bossAttackAngleDifference(angle, attack.gapAngle) > attack.gapHalfAngle;
        for (const ring of attack.rings) {
            if (age < ring.delay) continue;
            const previousRadius = ring.radius;
            ring.radius = attack.startRadius + (attack.endRadius - attack.startRadius)
                * Math.min(1, (age - ring.delay) / attack.waveDurationMs);
            if (!ring.hit && age - ring.delay <= attack.waveDurationMs + 50 && outsideGap
                && distance >= Math.min(previousRadius, ring.radius) - target.radius - 8
                && distance <= Math.max(previousRadius, ring.radius) + target.radius + 8) {
                ring.hit = true;
                bossAttackDamage(24 * attack.damageScale);
            }
        }
        attack.radius = attack.rings[0].radius;
    } else if (kind === "volley") {
        if (attack.burstsFired < attack.burstCount && age < attack.durationMs) {
            if (!attack.burstLocked && now >= attack.burstWarningAt) {
                attack.burstAngle = Math.atan2(player.y - boss.y, player.x - boss.x);
                attack.burstLocked = true;
                // Each re-aimed burst keeps a real warning window even after a delayed frame.
                attack.burstReadyAt = Math.max(attack.burstReadyAt, now + 500);
            }
            if (attack.burstLocked && now >= attack.burstReadyAt) {
                for (let i = 0; i < attack.count; i++) {
                    const angle = attack.burstAngle + (i - (attack.count - 1) / 2) * attack.spread;
                    attack.projectiles.push({
                        x: boss.x + Math.cos(angle) * (boss.radius + 9),
                        y: boss.y + Math.sin(angle) * (boss.radius + 9),
                        dx: Math.cos(angle) * attack.speed, dy: Math.sin(angle) * attack.speed, radius: 8
                    });
                }
                attack.burstsFired++;
                attack.burstLocked = false;
                attack.burstWarningAt = now + 200;
                attack.burstReadyAt = now + 700;
                gameAudio.play("shot");
            }
        }
        const seconds = Math.min(deltaMs, 50) / 1000;
        for (let i = attack.projectiles.length - 1; i >= 0; i--) {
            const p = attack.projectiles[i], x = p.x, y = p.y;
            p.x += p.dx * seconds; p.y += p.dy * seconds;
            if (bulletHitTime(x, y, p.x, p.y, target, p.radius) !== null) {
                bossAttackDamage(18 * attack.damageScale);
                attack.projectiles.splice(i, 1);
            } else if (p.x < -12 || p.x > canvas.width + 12 || p.y < gameHudHeight - 12 || p.y > canvas.height + 12) {
                attack.projectiles.splice(i, 1);
            }
        }
    } else if (kind === "meteors") {
        if (!attack.followupAdded && age >= 450 && age < attack.durationMs - 1000) {
            attack.followupAdded = true;
            addBossMeteorWave(attack, attack.followupCount, age + 700, 120, boss);
        }
        for (const marker of attack.markers) {
            if (age < marker.delay || (marker.struck && (!attack.poolMs || age > marker.delay + attack.poolMs))) continue;
            marker.struck = true;
            if (Math.hypot(player.x - marker.x, player.y - marker.y) <= marker.radius + target.radius) {
                bossAttackDamage(29 * attack.damageScale);
            }
        }
    } else if (kind === "beam") {
        const previousAngle = attack.currentAngle;
        updateBossBeamEnd(attack, age / attack.durationMs);
        const targetAngle = Math.atan2(player.y - attack.y, player.x - attack.x);
        const sweptAngle = attack.currentAngle - previousAngle;
        const between = bossAttackAngleDifference(targetAngle, previousAngle + sweptAngle / 2) <= sweptAngle / 2;
        if (age < attack.durationMs && (between || bulletHitTime(attack.x, attack.y, attack.endX, attack.endY, target, attack.width / 2) !== null)) {
            bossAttackDamage(26 * attack.damageScale);
        }
    } else if (kind === "charge") {
        const x = boss.x, y = boss.y, progress = Math.min(1, age / attack.durationMs);
        boss.x = attack.x + (attack.endX - attack.x) * progress;
        boss.y = attack.y + (attack.endY - attack.y) * progress;
        clampMonsterToMap(boss);
        if (!attack.hit && bulletHitTime(x, y, boss.x, boss.y, target, boss.radius) !== null) {
            attack.hit = true;
            bossAttackDamage(34 * attack.damageScale);
        }
    } else if (kind === "radial") {
        if (attack.burstsFired < attack.burstCount && age >= attack.burstsFired * attack.intervalMs) {
            const offset = attack.angle + attack.burstsFired * (attack.type === "flameSpiral" ? 0.22 : Math.PI / attack.count);
            for (let i = 0; i < attack.count; i++) {
                const a = offset + i * Math.PI * 2 / attack.count;
                attack.projectiles.push({ x: boss.x + Math.cos(a) * (boss.radius + 10),
                    y: boss.y + Math.sin(a) * (boss.radius + 10),
                    dx: Math.cos(a) * attack.speed, dy: Math.sin(a) * attack.speed,
                    radius: attack.type === "eclipseOrbs" ? 11 : 7, bounces: attack.type === "eclipseOrbs" ? 2 : 0 });
            }
            attack.burstsFired++;
            gameAudio.play("shot");
        }
        const seconds = Math.min(deltaMs, 50) / 1000;
        for (let i = attack.projectiles.length - 1; i >= 0; i--) {
            const p = attack.projectiles[i], x = p.x, y = p.y;
            p.x += p.dx * seconds; p.y += p.dy * seconds;
            if (bulletHitTime(x, y, p.x, p.y, target, p.radius) !== null) {
                bossAttackDamage(20 * attack.damageScale); attack.projectiles.splice(i, 1); continue;
            }
            const outX = p.x < p.radius || p.x > canvas.width - p.radius;
            const outY = p.y < gameHudHeight + p.radius || p.y > canvas.height - p.radius;
            if (outX || outY) {
                if (p.bounces > 0) {
                    if (outX) p.dx *= -1;
                    if (outY) p.dy *= -1;
                    p.x = clamp(p.x, p.radius, canvas.width - p.radius);
                    p.y = clamp(p.y, gameHudHeight + p.radius, canvas.height - p.radius);
                    p.bounces--;
                } else attack.projectiles.splice(i, 1);
            }
        }
    } else if (kind === "cross") {
        const previous = attack.currentAngle;
        attack.currentAngle = attack.angle + attack.sweepAngle * Math.min(1, age / attack.durationMs);
        const targetAngle = Math.atan2(player.y - attack.y, player.x - attack.x);
        for (let i = 0; i < 4; i++) {
            const a = attack.currentAngle + i * Math.PI / 2;
            const swept = attack.currentAngle - previous;
            const crossed = bossAttackAngleDifference(targetAngle, a - swept / 2) <= swept / 2;
            if (age < attack.durationMs && (crossed || bulletHitTime(attack.x, attack.y,
                attack.x + Math.cos(a) * attack.reach, attack.y + Math.sin(a) * attack.reach, target, attack.width / 2) !== null)) {
                bossAttackDamage(25 * attack.damageScale);
            }
        }
    } else if (kind === "lanes") {
        if (age < attack.durationMs && attack.lines.some(line => bulletHitTime(line.x, line.y,
            line.endX, line.endY, target, attack.width / 2) !== null)) bossAttackDamage(28 * attack.damageScale);
    } else if (kind === "gravityWell") {
        const dx = attack.x - player.x, dy = attack.y - player.y, distance = Math.hypot(dx, dy);
        if (age < attack.durationMs && distance < attack.radius && distance > 0) {
            if (!isEnergyShieldActive()) moveActor(player, dx / distance * 115 * Math.min(deltaMs, 50) / 1000,
                dy / distance * 115 * Math.min(deltaMs, 50) / 1000, player.size / 2, true, true);
            if (distance < attack.innerRadius + target.radius) bossAttackDamage(24 * attack.damageScale);
        }
    }
    if (age >= attack.durationMs) {
        boss.attack = null;
        boss.nextAttackAt = now + Math.max(450, 750 / (1 + (boss.bossStage - 1) * 0.055));
    }
}

function drawBossAttacks() {
    if (!isBossEncounterActive()) return;
    for (const boss of bossState.bosses) drawSingleBossAttack(boss);
}

function drawSingleBossAttack(boss) {
    const attack = boss.attack;
    if (!attack) return;
    const kind = attack.kind || attack.type;
    const age = gameClock.elapsedMs - attack.startedAt - attack.windupMs;
    const warning = age < 0;
    const pulse = 0.65 + Math.sin(gameClock.elapsedMs / 75) * 0.2;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, gameHudHeight, canvas.width, canvas.height - gameHudHeight); ctx.clip();
    ctx.lineCap = "round";
    ctx.strokeStyle = warning ? "#ffbe69" : "#ff4862";
    ctx.fillStyle = warning ? "rgba(255,160,70,.13)" : "rgba(255,50,80,.3)";
    ctx.lineWidth = warning ? 2 : 7;
    if (warning) { ctx.setLineDash([8, 6]); ctx.globalAlpha = pulse; }
    if (kind === "shockwave") {
        ctx.lineWidth = warning ? 2 : 16;
        for (const ring of attack.rings) {
            if (!warning && (age < ring.delay || age - ring.delay > attack.waveDurationMs)) continue;
            const radius = warning ? attack.startRadius : ring.radius;
            ctx.beginPath(); ctx.arc(attack.x, attack.y, radius, attack.gapAngle + attack.gapHalfAngle,
                attack.gapAngle + Math.PI * 2 - attack.gapHalfAngle); ctx.stroke();
            if (warning) break;
        }
        if (warning) {
            ctx.strokeStyle = "rgba(255,190,105,.35)";
            ctx.beginPath(); ctx.arc(attack.x, attack.y, attack.endRadius, attack.gapAngle + attack.gapHalfAngle,
                attack.gapAngle + Math.PI * 2 - attack.gapHalfAngle); ctx.stroke();
        }
    } else if (kind === "volley") {
        if (attack.burstLocked && attack.burstsFired < attack.burstCount) {
            ctx.save(); ctx.globalAlpha = pulse; ctx.lineWidth = 2;
            ctx.strokeStyle = "#ffbe69"; ctx.setLineDash([8, 6]);
            for (let i = 0; i < attack.count; i++) {
                const angle = attack.burstAngle + (i - (attack.count - 1) / 2) * attack.spread;
                const inner = boss.radius + 9;
                ctx.beginPath(); ctx.moveTo(boss.x + Math.cos(angle) * inner, boss.y + Math.sin(angle) * inner);
                ctx.lineTo(boss.x + Math.cos(angle) * 240, boss.y + Math.sin(angle) * 240); ctx.stroke();
            }
            ctx.restore();
        }
        if (attack.launched) {
            ctx.globalAlpha = 1; ctx.setLineDash([]);
            ctx.fillStyle = "#18111e"; ctx.strokeStyle = "#ff7893"; ctx.lineWidth = 2;
            for (const p of attack.projectiles) {
                ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.dy, p.dx));
                ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, -6); ctx.lineTo(-3, 0); ctx.lineTo(-7, 6);
                ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
            }
        }
    } else if (kind === "meteors") {
        for (const marker of attack.markers) {
            const visibleMs = attack.poolMs || 450;
            if (marker.struck && age - marker.delay > visibleMs) continue;
            ctx.globalAlpha = marker.struck ? Math.max(0, 1 - (age - marker.delay) / visibleMs) : pulse;
            ctx.setLineDash(marker.struck ? [] : [8, 6]);
            ctx.fillStyle = marker.struck ? "rgba(255,76,57,.4)" : "rgba(255,164,78,.15)";
            ctx.strokeStyle = marker.struck ? "#ff4862" : "#ffbe69";
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(marker.x, marker.y, marker.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(marker.x - 10, marker.y); ctx.lineTo(marker.x + 10, marker.y);
            ctx.moveTo(marker.x, marker.y - 10); ctx.lineTo(marker.x, marker.y + 10); ctx.stroke();
        }
    } else if (kind === "radial") {
        ctx.strokeStyle = getBossDefinition(boss.bossStage).color;
        if (warning) {
            for (let i = 0; i < attack.count; i++) {
                const a = attack.angle + i * Math.PI * 2 / attack.count;
                ctx.beginPath(); ctx.moveTo(boss.x + Math.cos(a) * boss.radius, boss.y + Math.sin(a) * boss.radius);
                ctx.lineTo(boss.x + Math.cos(a) * (boss.radius + 130), boss.y + Math.sin(a) * (boss.radius + 130)); ctx.stroke();
            }
        }
        ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineWidth = 2;
        ctx.fillStyle = getBossDefinition(boss.bossStage).color;
        ctx.strokeStyle = "#fff5e5";
        for (const p of attack.projectiles) {
            ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
    } else if (kind === "cross" || kind === "lanes") {
        const lines = kind === "lanes" ? attack.lines : Array.from({ length: 4 }, (_, i) => {
            const a = attack.currentAngle + i * Math.PI / 2;
            return { x: attack.x, y: attack.y, endX: attack.x + Math.cos(a) * attack.reach,
                endY: attack.y + Math.sin(a) * attack.reach };
        });
        for (const line of lines) {
            ctx.save(); ctx.globalAlpha = warning ? 0.22 : 0.75; ctx.setLineDash([]);
            ctx.strokeStyle = getBossDefinition(boss.bossStage).color; ctx.lineWidth = attack.width;
            ctx.beginPath(); ctx.moveTo(line.x, line.y); ctx.lineTo(line.endX, line.endY); ctx.stroke();
            ctx.globalAlpha = warning ? pulse : 1; ctx.lineWidth = warning ? 2 : 5;
            ctx.strokeStyle = warning ? "#ffe7a2" : "#fff";
            if (warning) ctx.setLineDash([8, 6]); ctx.stroke(); ctx.restore();
        }
        if (warning && kind === "cross") {
            ctx.setLineDash([]); ctx.strokeStyle = "#ffe7a2";
            for (let i = 0; i < 4; i++) {
                const a = attack.angle + i * Math.PI / 2;
                ctx.beginPath(); ctx.arc(attack.x, attack.y, boss.radius + 85, a, a + attack.sweepAngle); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(attack.x + Math.cos(a + attack.sweepAngle) * (boss.radius + 85),
                    attack.y + Math.sin(a + attack.sweepAngle) * (boss.radius + 85));
                ctx.lineTo(attack.x + Math.cos(a + attack.sweepAngle - 0.10) * (boss.radius + 72),
                    attack.y + Math.sin(a + attack.sweepAngle - 0.10) * (boss.radius + 72)); ctx.stroke();
            }
        }
    } else if (kind === "gravityWell") {
        ctx.strokeStyle = "#b7a3ff"; ctx.fillStyle = "rgba(112,65,219,.12)";
        ctx.beginPath(); ctx.arc(attack.x, attack.y, attack.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(126,56,228,.42)";
        ctx.beginPath(); ctx.arc(attack.x, attack.y, attack.innerRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4 + gameClock.elapsedMs / 1600;
            const radius = attack.innerRadius + (attack.radius - attack.innerRadius) * (1 - (gameClock.elapsedMs % 850) / 850);
            ctx.beginPath(); ctx.arc(attack.x + Math.cos(a) * radius, attack.y + Math.sin(a) * radius, 4, 0, Math.PI * 2); ctx.fill();
        }
    } else {
        if (warning && kind === "beam") {
            const end = attack.angle + attack.sweepAngle;
            ctx.fillStyle = "rgba(255,120,75,.08)";
            ctx.beginPath(); ctx.moveTo(attack.x, attack.y);
            ctx.arc(attack.x, attack.y, attack.reach, attack.angle, end); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(attack.x, attack.y);
            ctx.lineTo(attack.x + Math.cos(end) * attack.reach, attack.y + Math.sin(end) * attack.reach); ctx.stroke();
            ctx.beginPath(); ctx.arc(attack.x, attack.y, 200, attack.angle, end); ctx.stroke();
        }
        ctx.lineWidth = attack.width;
        ctx.strokeStyle = warning ? "rgba(255,160,75,.20)" : kind === "beam" ? "rgba(244,63,143,.75)" : "rgba(255,93,63,.2)";
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(attack.x, attack.y); ctx.lineTo(attack.endX, attack.endY); ctx.stroke();
        ctx.lineWidth = warning ? 2 : kind === "beam" ? 7 : 2;
        ctx.strokeStyle = warning ? "#ffc37b" : "#fff0e7";
        if (warning) ctx.setLineDash([8, 6]);
        ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    ctx.textAlign = "center"; ctx.font = `bold ${Math.min(14, Math.max(9, canvas.width / 72))}px Arial`;
    ctx.fillStyle = warning ? "#ffd998" : "#ffa8b8"; ctx.strokeStyle = "#090609"; ctx.lineWidth = 4;
    const multi = bossState.bosses.length > 1;
    const label = multi ? bossAttackLabels[attack.type].split(" · ")[0] : bossAttackLabels[attack.type];
    const labelX = multi ? clamp(boss.x, 95, Math.max(95, canvas.width - 95)) : canvas.width / 2;
    const labelY = multi ? Math.min(canvas.height - 10, boss.y + boss.radius + 25) : gameHudHeight + 111;
    if (multi) ctx.font = "bold 10px Arial";
    ctx.strokeText(label, labelX, labelY);
    ctx.fillText(label, labelX, labelY);
    ctx.restore();
}

function drawBossBody(ctx, monster, target, elapsedMs = 0) {
    const r = monster.radius;
    const stage = monster.bossStage || 1;
    const definition = getBossDefinition(stage);
    const angle = Math.atan2(target.y - monster.y, target.x - monster.x);
    const pulse = 0.5 + Math.sin(elapsedMs / 180) * 0.5;
    ctx.save();
    ctx.translate(monster.x, monster.y);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath(); ctx.ellipse(0, r * 0.77, r * 1.08, r * 0.37, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = definition.color + "80";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r + 6 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = monster.hitUntil > elapsedMs ? "#523237" : "#050507";
    ctx.strokeStyle = definition.color; ctx.lineWidth = Math.max(2, r * 0.04);
    ctx.beginPath();
    const sides = [16, 12, 8, 20, 10, 24][stage - 1] || 16;
    for (let i = 0; i < sides; i++) {
        const a = i * Math.PI * 2 / sides - Math.PI / 2;
        const length = r * (i % 2 === 0 ? 1.11 : stage === 4 ? 0.70 : 0.88);
        if (i === 0) ctx.moveTo(Math.cos(a) * length, Math.sin(a) * length);
        else ctx.lineTo(Math.cos(a) * length, Math.sin(a) * length);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (stage === 2) {
        ctx.strokeStyle = "#ffb45b"; ctx.lineWidth = r * 0.09;
        for (const side of [-1, 1]) {
            ctx.beginPath(); ctx.moveTo(side * r * 0.55, -r * 0.4); ctx.lineTo(side * r * 0.75, -r * 1.25);
            ctx.lineTo(side * r * 0.20, -r * 0.75); ctx.stroke();
        }
    } else if (stage === 3) {
        ctx.strokeStyle = "#a4edff"; ctx.lineWidth = 3;
        ctx.save(); ctx.rotate(elapsedMs / 1800);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.28, r * 0.47, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    } else if (stage === 4) {
        ctx.strokeStyle = "#90bc43"; ctx.lineWidth = 4;
        for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
            ctx.lineTo(Math.cos(a + 0.18) * r * 1.22, Math.sin(a + 0.18) * r * 1.22);
            ctx.lineTo(Math.cos(a + 0.4) * r * 1.05, Math.sin(a + 0.4) * r * 1.05); ctx.stroke();
        }
    } else if (stage === 5) {
        ctx.strokeStyle = "#a99aff"; ctx.lineWidth = 5;
        for (const side of [-1, 1]) {
            ctx.beginPath(); ctx.moveTo(side * r * 0.75, -r * 0.4);
            ctx.lineTo(side * r * 1.30, r * 0.55); ctx.lineTo(side * r * 0.65, r * 0.85); ctx.stroke();
        }
    } else if (stage === 6) {
        ctx.strokeStyle = "#ff9fe6"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0, 0, r * 1.20, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.6); ctx.lineTo(-r * 0.6, -r * 1.2);
        ctx.lineTo(0, -r * 0.90); ctx.lineTo(r * 0.6, -r * 1.2); ctx.lineTo(r * 0.6, -r * 0.6); ctx.stroke();
    }
    ctx.fillStyle = "#08080c"; ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#352932"; ctx.lineWidth = r * 0.08;
    ctx.beginPath(); ctx.moveTo(-r * 0.62, -r * 0.34); ctx.lineTo(-r * 0.23, -r * 0.67);
    ctx.lineTo(0, -r * 0.42); ctx.lineTo(r * 0.23, -r * 0.67); ctx.lineTo(r * 0.62, -r * 0.34); ctx.stroke();
    for (const side of [-1, 1]) {
        ctx.fillStyle = definition.color;
        ctx.beginPath(); ctx.ellipse(side * r * 0.32, -r * 0.08, r * 0.20, r * 0.115, side * -0.22, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffc9ad";
        ctx.beginPath(); ctx.arc(side * r * 0.32 + Math.cos(angle) * r * 0.05, -r * 0.08 + Math.sin(angle) * r * 0.04,
            r * 0.055, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = definition.color; ctx.lineWidth = 2;
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
            const message = bossState.defeatedName + (bossState.campaignComplete ? " DEFEATED · ENDLESS SURVIVAL" : " DEFEATED · LOOT DROPPED");
            ctx.strokeText(message, canvas.width / 2, gameHudHeight + 66);
            ctx.fillText(message, canvas.width / 2, gameHudHeight + 66);
            if (bossState.finalEncounterLevel !== null && !bossState.campaignComplete) {
                ctx.font = "bold 13px Arial";
                const next = `SURVIVE TO LEVEL ${bossState.finalEncounterLevel} · ALL SIX RETURN TOGETHER`;
                ctx.strokeText(next, canvas.width / 2, gameHudHeight + 88);
                ctx.fillText(next, canvas.width / 2, gameHudHeight + 88);
            }
            ctx.restore();
        }
        return;
    }

    const finale = bossState.finalEncounterStarted;
    const definition = getBossDefinition(monster.bossStage);
    const width = Math.min(finale ? 590 : 460, canvas.width * 0.65);
    const x = (canvas.width - width) / 2;
    const y = gameHudHeight + 30;
    ctx.save();
    ctx.fillStyle = "rgba(9,5,10,0.9)"; ctx.fillRect(x - 7, y - 24, width + 14, 52);
    ctx.strokeStyle = definition.color; ctx.lineWidth = 1; ctx.strokeRect(x - 7, y - 24, width + 14, 52);
    ctx.font = `bold ${Math.max(10, Math.min(14, width / 26))}px Arial`; ctx.textAlign = "center";
    ctx.fillStyle = "#ffd3d8";
    ctx.fillText(finale ? `THE FINAL SIX · ${bossState.bosses.length} REMAINING`
        : `${definition.name.toUpperCase()} · LEVEL ${monster.bossLevel}`, canvas.width / 2, y - 7);
    ctx.fillStyle = "#30121c"; ctx.fillRect(x, y, width, 8);
    const health = bossState.bosses.reduce((sum, boss) => sum + boss.health, 0);
    const maxHealth = finale ? bossState.encounterMaxHealth : monster.maxHealth;
    ctx.fillStyle = definition.color; ctx.fillRect(x, y, width * health / maxHealth, 8);
    ctx.font = "10px Arial"; ctx.fillStyle = "#e5c8cd";
    ctx.fillText(`${Math.ceil(health)} / ${maxHealth} HP · ${finale ? "Defeat every boss to advance" : "Arena locked"}`, canvas.width / 2, y + 21);
    if (finale) {
        ctx.font = "bold 10px Arial";
        bossState.bosses.forEach((boss, index) => {
            const columnWidth = width / 3;
            const left = x + (index % 3) * columnWidth;
            const top = y + 42 + Math.floor(index / 3) * 26;
            ctx.fillStyle = "rgba(9,5,10,.85)"; ctx.fillRect(left, top - 12, columnWidth - 4, 24);
            ctx.fillStyle = getBossDefinition(boss.bossStage).color;
            ctx.fillText(boss.name, left + (columnWidth - 4) / 2, top - 2, columnWidth - 8);
            ctx.fillRect(left + 4, top + 3, (columnWidth - 12) * boss.health / boss.maxHealth, 3);
        });
    }

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
        ctx.fillStyle = "#ffe5e5"; ctx.fillText(finale ? "THE FINAL SIX" : definition.name.toUpperCase(), canvas.width / 2, middle);
        ctx.font = `bold ${Math.min(16, Math.max(10, canvas.width / 38))}px Arial`;
        ctx.fillStyle = "#ff8b9d";
        ctx.fillText(finale ? "ALL SIX RETURN · THE LAST BOSS ENCOUNTER"
            : `LEVEL ${monster.bossLevel} BOSS · DEFEAT IT TO ADVANCE`, canvas.width / 2, middle + 28);
        ctx.strokeStyle = "rgba(255,68,96,0.75)"; ctx.lineWidth = 4;
        ctx.strokeRect(3, gameHudHeight + 3, canvas.width - 6, Math.max(1, canvas.height - gameHudHeight - 6));
    }
    ctx.restore();
}
