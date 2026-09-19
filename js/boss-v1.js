// Milestones are queued so one large XP reward cannot skip a boss encounter.
const bossState = {
    queue: [],
    seenLevels: new Set(),
    active: null,
    nextEncounterAt: 0,
    introStartedAt: -Infinity,
    introDurationMs: 2600,
    defeatedUntil: 0,
    attack: null,
    attackIndex: 0,
    nextAttackAt: Infinity
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
        speed: 138 + growth * 8, damage: 28 + growth * 8,
        xpReward: 120 + stage * 40, hitUntil: 0,
        bossStage: stage, bossLevel: level, lootDropped: false,
        moveAfter: gameClock.elapsedMs + bossState.introDurationMs
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
    bossState.attack = null;
    bossState.attackIndex = 0;
    bossState.nextAttackAt = gameClock.elapsedMs + bossState.introDurationMs + 450;
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
    bossState.attack = null;
    bossState.nextAttackAt = Infinity;
    bossState.nextEncounterAt = gameClock.elapsedMs + 4500;
    bossState.defeatedUntil = gameClock.elapsedMs + 2400;
    monsterState.nextSpawnAt = Math.max(monsterState.nextSpawnAt, gameClock.elapsedMs + 1800);
    worldState.zoneExposure = 0;
    worldState.zoneHitUntil = 0;
    gameAudio.play("unlock");
}

const bossAttackTypes = ["shockwave", "volley", "meteors", "beam", "charge"];
const bossAttackLabels = {
    shockwave: "DOUBLE SHOCKWAVE · FIND THE GAP", volley: "TRIPLE VOLLEY · KEEP DODGING",
    meteors: "METEOR BARRAGE · WATCH THE NEXT WAVE", beam: "SWEEPING BEAM · CLEAR THE ARC",
    charge: "COLOSSUS CHARGE · CLEAR THE PATH"
};

function bossAttackDamage(amount) {
    if (!canControlPlayer() || gameClock.elapsedMs < monsterState.playerInvulnerableUntil) return false;
    if (isEnergyShieldActive()) { gameAudio.play("block"); return false; }
    player.health = Math.max(0, player.health - getMysteryDamageTaken(amount));
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

function bossCanPursueDuringAttack() {
    const attack = bossState.attack;
    return !attack || attack.type === "meteors" || (attack.type === "volley" && attack.launched);
}

function addBossMeteorWave(attack, count, delay, spacing) {
    const radius = Math.min(82, Math.max(22, Math.min(canvas.width, canvas.height - gameHudHeight) * 0.13));
    const top = Math.min(gameHudHeight + radius, canvas.height / 2 + gameHudHeight / 2);
    const angle = Math.atan2(player.y - bossState.active.y, player.x - bossState.active.x);
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

function beginBossAttack(type = bossAttackTypes[bossState.attackIndex++ % bossAttackTypes.length]) {
    const boss = bossState.active;
    if (!isBossEncounterActive() || !canControlPlayer()) return null;
    const angle = Math.atan2(player.y - boss.y, player.x - boss.x);
    const growth = Math.max(0, boss.bossStage - 1);
    const attack = {
        type, x: boss.x, y: boss.y, angle, startedAt: gameClock.elapsedMs,
        windupMs: ({ shockwave: 750, volley: 650, meteors: 800, beam: 800, charge: 650 }[type] || 800)
            * Math.max(0.8, 1 - growth * 0.02),
        damageScale: 1 + growth * 0.12, launched: false, hit: false,
        projectiles: [], durationMs: 0
    };
    if (type === "shockwave") {
        attack.startRadius = boss.radius + 12;
        attack.endRadius = Math.min(760, Math.max(190, Math.hypot(canvas.width, canvas.height - gameHudHeight) * 0.68));
        attack.endRadius = Math.max(attack.startRadius + 90, attack.endRadius);
        attack.radius = attack.startRadius;
        attack.gapAngle = angle + Math.PI / 3;
        attack.gapHalfAngle = Math.PI / 7;
        attack.waveDurationMs = (attack.endRadius - attack.startRadius) / (420 + Math.min(100, growth * 10)) * 1000;
        attack.rings = [0, 480].map(delay => ({ delay, radius: attack.startRadius, hit: false }));
        attack.durationMs = attack.waveDurationMs + 480;
    } else if (type === "volley") {
        attack.count = Math.min(15, 9 + Math.floor(growth / 3) * 2);
        attack.speed = 340 + Math.min(120, growth * 12);
        attack.spread = 0.21;
        attack.burstCount = 3;
        attack.burstsFired = 0;
        attack.burstAngle = angle;
        attack.burstLocked = true;
        attack.burstReadyAt = attack.startedAt + attack.windupMs;
        attack.durationMs = 3100;
    } else if (type === "meteors") {
        attack.markers = [];
        attack.followupCount = Math.min(5, 3 + Math.floor(growth / 3));
        attack.followupAdded = false;
        addBossMeteorWave(attack, Math.min(7, 5 + Math.floor(growth / 3)), 0, 140);
        attack.durationMs = 2200;
    } else if (type === "beam") {
        attack.reach = Math.hypot(canvas.width, canvas.height);
        attack.sweepAngle = 0.9;
        attack.angle = angle - attack.sweepAngle / 2;
        attack.currentAngle = attack.angle;
        updateBossBeamEnd(attack, 0);
        attack.width = 46 + Math.min(18, growth * 2);
        attack.durationMs = 1100;
    } else if (type === "charge") {
        const reach = Math.min(680, Math.hypot(canvas.width, canvas.height - gameHudHeight) * 0.8);
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
    }
    bossState.attack = attack;
    gameAudio.play("spawn");
    return attack;
}

function updateBossAttacks(deltaMs) {
    if (!canControlPlayer() || !isBossEncounterActive()) return;
    const boss = bossState.active, now = gameClock.elapsedMs;
    if (!bossState.attack) {
        if (now >= bossState.nextAttackAt) beginBossAttack();
        return;
    }
    const attack = bossState.attack;
    const age = now - attack.startedAt - attack.windupMs;
    if (age < 0) return;
    if (!attack.launched) {
        attack.launched = true;
        if (attack.type !== "volley") gameAudio.play("explosion");
    }
    const target = { x: player.x, y: player.y, radius: player.size / 2 };
    if (attack.type === "shockwave") {
        const distance = Math.hypot(player.x - attack.x, player.y - attack.y);
        const angle = Math.atan2(player.y - attack.y, player.x - attack.x);
        const outsideGap = bossAttackAngleDifference(angle, attack.gapAngle) > attack.gapHalfAngle;
        for (const ring of attack.rings) {
            if (age < ring.delay) continue;
            const previousRadius = ring.radius;
            ring.radius = attack.startRadius + (attack.endRadius - attack.startRadius)
                * Math.min(1, (age - ring.delay) / attack.waveDurationMs);
            if (!ring.hit && age - ring.delay <= attack.waveDurationMs + 50 && outsideGap
                && distance >= previousRadius - target.radius - 8 && distance <= ring.radius + target.radius + 8) {
                ring.hit = true;
                bossAttackDamage(24 * attack.damageScale);
            }
        }
        attack.radius = attack.rings[0].radius;
    } else if (attack.type === "volley") {
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
    } else if (attack.type === "meteors") {
        if (!attack.followupAdded && age >= 450 && age < attack.durationMs - 1000) {
            attack.followupAdded = true;
            addBossMeteorWave(attack, attack.followupCount, age + 700, 120);
        }
        for (const marker of attack.markers) {
            if (marker.struck || age < marker.delay) continue;
            marker.struck = true;
            if (Math.hypot(player.x - marker.x, player.y - marker.y) <= marker.radius + target.radius) {
                bossAttackDamage(29 * attack.damageScale);
            }
        }
    } else if (attack.type === "beam") {
        const previousAngle = attack.currentAngle;
        updateBossBeamEnd(attack, age / attack.durationMs);
        const targetAngle = Math.atan2(player.y - attack.y, player.x - attack.x);
        const sweptAngle = attack.currentAngle - previousAngle;
        const between = bossAttackAngleDifference(targetAngle, previousAngle + sweptAngle / 2) <= sweptAngle / 2;
        if (age < attack.durationMs && (between || bulletHitTime(attack.x, attack.y, attack.endX, attack.endY, target, attack.width / 2) !== null)) {
            bossAttackDamage(26 * attack.damageScale);
        }
    } else if (attack.type === "charge") {
        const x = boss.x, y = boss.y, progress = Math.min(1, age / attack.durationMs);
        boss.x = attack.x + (attack.endX - attack.x) * progress;
        boss.y = attack.y + (attack.endY - attack.y) * progress;
        clampMonsterToMap(boss);
        if (!attack.hit && bulletHitTime(x, y, boss.x, boss.y, target, boss.radius) !== null) {
            attack.hit = true;
            bossAttackDamage(34 * attack.damageScale);
        }
    }
    if (age >= attack.durationMs) {
        bossState.attack = null;
        bossState.nextAttackAt = now + Math.max(450, 750 / (1 + (boss.bossStage - 1) * 0.055));
    }
}

function drawBossAttacks() {
    const attack = bossState.attack;
    if (!attack || !isBossEncounterActive()) return;
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
    if (attack.type === "shockwave") {
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
    } else if (attack.type === "volley") {
        if (attack.burstLocked && attack.burstsFired < attack.burstCount) {
            ctx.save(); ctx.globalAlpha = pulse; ctx.lineWidth = 2;
            ctx.strokeStyle = "#ffbe69"; ctx.setLineDash([8, 6]);
            for (let i = 0; i < attack.count; i++) {
                const angle = attack.burstAngle + (i - (attack.count - 1) / 2) * attack.spread;
                const boss = bossState.active, inner = boss.radius + 9;
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
    } else if (attack.type === "meteors") {
        for (const marker of attack.markers) {
            if (marker.struck && age - marker.delay > 450) continue;
            ctx.globalAlpha = marker.struck ? Math.max(0, 1 - (age - marker.delay) / 450) : pulse;
            ctx.setLineDash(marker.struck ? [] : [8, 6]);
            ctx.fillStyle = marker.struck ? "rgba(255,76,57,.4)" : "rgba(255,164,78,.15)";
            ctx.strokeStyle = marker.struck ? "#ff4862" : "#ffbe69";
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(marker.x, marker.y, marker.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(marker.x - 10, marker.y); ctx.lineTo(marker.x + 10, marker.y);
            ctx.moveTo(marker.x, marker.y - 10); ctx.lineTo(marker.x, marker.y + 10); ctx.stroke();
        }
    } else {
        if (warning && attack.type === "beam") {
            const end = attack.angle + attack.sweepAngle;
            ctx.fillStyle = "rgba(255,120,75,.08)";
            ctx.beginPath(); ctx.moveTo(attack.x, attack.y);
            ctx.arc(attack.x, attack.y, attack.reach, attack.angle, end); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(attack.x, attack.y);
            ctx.lineTo(attack.x + Math.cos(end) * attack.reach, attack.y + Math.sin(end) * attack.reach); ctx.stroke();
            ctx.beginPath(); ctx.arc(attack.x, attack.y, 200, attack.angle, end); ctx.stroke();
        }
        ctx.lineWidth = attack.width;
        ctx.strokeStyle = warning ? "rgba(255,160,75,.20)" : attack.type === "beam" ? "rgba(244,63,143,.75)" : "rgba(255,93,63,.2)";
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(attack.x, attack.y); ctx.lineTo(attack.endX, attack.endY); ctx.stroke();
        ctx.lineWidth = warning ? 2 : attack.type === "beam" ? 7 : 2;
        ctx.strokeStyle = warning ? "#ffc37b" : "#fff0e7";
        if (warning) ctx.setLineDash([8, 6]);
        ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    ctx.textAlign = "center"; ctx.font = `bold ${Math.min(14, Math.max(9, canvas.width / 72))}px Arial`;
    ctx.fillStyle = warning ? "#ffd998" : "#ffa8b8"; ctx.strokeStyle = "#090609"; ctx.lineWidth = 4;
    const label = bossAttackLabels[attack.type];
    ctx.strokeText(label, canvas.width / 2, gameHudHeight + 111);
    ctx.fillText(label, canvas.width / 2, gameHudHeight + 111);
    ctx.restore();
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
