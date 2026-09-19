// Monster stats are fixed at spawn and scale with active play time.
const monsterTypes = {
    crawler: { name: "Crawler", description: "Steady pursuer. Easy alone; dangerous in a crowd.", radius: 17, health: 28, speed: 43.7, damage: 8, xp: 3, color: "#8bc461", minTier: 0, weight: 50 },
    skitter: { name: "Skitter", description: "Fast and fragile. Stop it before it closes in.", radius: 12, health: 16, speed: 94.3, damage: 6, xp: 2, color: "#f49a69", minTier: 0, weight: 30 },
    brute: { name: "Brute", description: "Slow, tough and hard-hitting. Keep your distance.", radius: 24, health: 68, speed: 28.75, damage: 15, xp: 6, color: "#b593e0", minTier: 0, weight: 20 },
    stalker: { name: "Stalker", description: "The fastest hunter. Use an ability to escape.", radius: 14, health: 36, speed: 110, damage: 10, xp: 5, color: "#5bd6cd", minTier: 1, weight: 14 },
    shellback: { name: "Shellback", description: "Heavily armored. Avoid getting cornered.", radius: 23, health: 120, speed: 34, damage: 20, xp: 10, color: "#729acb", minTier: 2, weight: 10 },
    charger: { name: "Charger", description: "Glows, then rushes. Dodge or get behind a wall.", radius: 20, health: 76, speed: 70, damage: 22, xp: 8, color: "#e56a78", minTier: 3, weight: 12 }
};

const monsterSettings = {
    maxAlive: 60,
    difficultyStepMs: 30000,
    contactCooldownMs: 800,
    explosionRadius: 70
};

const monsters = [];
const combatEffects = [];
const monsterState = {
    nextId: 1,
    nextSpawnAt: 0,
    defeated: 0,
    playerInvulnerableUntil: 0
};

function getMonsterDifficulty(elapsedMs = gameClock.elapsedMs) {
    const tier = Math.floor(elapsedMs / monsterSettings.difficultyStepMs);
    return {
        tier,
        healthScale: 1 + tier * 0.4 + tier * tier * 0.025,
        speedScale: 1 + Math.min(0.8, tier * 0.045),
        damageScale: 1 + tier * 0.12,
        spawnIntervalMs: Math.max(450, 3300 * Math.pow(0.88, tier)),
        packSize: Math.min(3, 1 + Math.floor(tier / 4))
    };
}

function getMonsterSpawnPool(tier = getMonsterDifficulty().tier) {
    return Object.entries(monsterTypes).filter(([, type]) => type.minTier <= tier).map(([name, type]) => ({
        name, weight: type.minTier === 0 ? type.weight : Math.min(40, type.weight + (tier - type.minTier) * 3)
    }));
}

function randomMonsterType() {
    const pool = getMonsterSpawnPool();
    let roll = Math.random() * pool.reduce((total, type) => total + type.weight, 0);
    for (const type of pool) {
        roll -= type.weight;
        if (roll < 0) return type.name;
    }
    return pool[pool.length - 1].name;
}

function spawnMonster(type = randomMonsterType()) {
    if (monsters.length >= monsterSettings.maxAlive
        || canvas.width < 120 || canvas.height - gameHudHeight < 100) return null;

    const variant = monsterTypes[type];
    const radius = variant.radius;
    let position = null;
    for (let attempt = 0; attempt < 16; attempt++) {
        const y = gameHudHeight + radius + Math.random() * (canvas.height - gameHudHeight - radius * 2);
        const candidate = { x: canvas.width + radius + 4, y };
        // Avoid surprise contact when the player is walking beside a spawn edge.
        if (Math.hypot(candidate.x - player.x, candidate.y - player.y) >= 120
            && !bodyTouchesWall(candidate.x, candidate.y, radius + 3)) {
            position = candidate;
            break;
        }
    }
    if (!position) return null;

    const difficulty = getMonsterDifficulty();
    const health = Math.ceil(variant.health * difficulty.healthScale);
    const monster = {
        ...position,
        id: monsterState.nextId++,
        type,
        edge: "right",
        radius,
        health,
        maxHealth: health,
        speed: variant.speed * difficulty.speedScale,
        damage: Math.ceil(variant.damage * difficulty.damageScale),
        xpReward: variant.xp * 4 + difficulty.tier * 2,
        hitUntil: 0,
        chargePhase: "pursuit",
        chargeElapsedMs: 0
    };
    monsters.push(monster);
    gameAudio.play("spawn");
    return monster;
}

function updateMonsterSpawning() {
    if (!canControlPlayer() || gameClock.elapsedMs < monsterState.nextSpawnAt) return;
    const difficulty = getMonsterDifficulty();
    for (let i = 0; i < difficulty.packSize && monsters.length < monsterSettings.maxAlive; i++) spawnMonster();
    const delay = difficulty.spawnIntervalMs * (0.85 + Math.random() * 0.3);
    // Never accumulate overdue spawns while paused or while the map is full.
    monsterState.nextSpawnAt = gameClock.elapsedMs + delay;
}

function clampMonsterToMap(monster) {
    monster.x = clamp(monster.x, -monster.radius * 4, canvas.width + monster.radius + 120);
    monster.y = clamp(monster.y, gameHudHeight - monster.radius, canvas.height + monster.radius);
}

function resizeMonsters() {
    for (const monster of monsters) clampMonsterToMap(monster);
}

function chargerSpeedMultiplier(monster, deltaMs, destination) {
    if (monster.type !== "charger") return 1;
    monster.chargeElapsedMs += deltaMs;
    if (monster.chargePhase === "pursuit") {
        if (monster.chargeElapsedMs >= 1800 && Math.hypot(destination.x - monster.x, destination.y - monster.y) < 450
            && wallHitTime(monster.x, monster.y, destination.x, destination.y, monster.radius) === null) {
            monster.chargePhase = "windup";
            monster.chargeElapsedMs = 0;
        }
    } else if (monster.chargePhase === "windup" && monster.chargeElapsedMs >= 450) {
        monster.chargePhase = "rush";
        monster.chargeElapsedMs = 0;
    } else if (monster.chargePhase === "rush" && monster.chargeElapsedMs >= 500) {
        monster.chargePhase = "pursuit";
        monster.chargeElapsedMs = 0;
    }
    return monster.chargePhase === "windup" ? 0 : monster.chargePhase === "rush" ? 2.3 : 1;
}

function updateMonsters(deltaMs) {
    if (!canControlPlayer() || isTimeFreezeActive()) return;
    const seconds = Math.min(deltaMs, 50) / 1000;
    const destination = getMonsterTarget();
    const targetRadius = isLureActive() ? 7 : player.size * 0.35;
    for (const monster of monsters) {
        const pulled = isLureActive() && abilityState.lure.castLevel >= 2;
        const speedMultiplier = pulled ? 1 : chargerSpeedMultiplier(monster, seconds * 1000, destination);
        const target = monsterNavigationTarget(monster, destination);
        const dx = target.x - monster.x;
        const dy = target.y - monster.y;
        const distance = Math.hypot(dx, dy);
        const stopRadius = target === destination ? monster.radius + targetRadius : 0;
        const speed = pulled ? Math.max(420, monster.speed * 4) : monster.speed * speedMultiplier;
        const step = Math.min(speed * seconds, Math.max(0, distance - stopRadius));
        if (distance > 0) {
            moveActor(monster, dx / distance * step, dy / distance * step, monster.radius);
        }
    }

    // Separate bodies gently so a crowd does not collapse into one invisible stack.
    for (let i = 0; i < monsters.length; i++) {
        for (let j = 0; j < i; j++) {
            const a = monsters[i];
            const b = monsters[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const distance = Math.hypot(dx, dy);
            const minimum = (a.radius + b.radius) * 0.9;
            if (distance >= minimum) continue;
            const nx = distance > 0 ? dx / distance : Math.cos(a.id);
            const ny = distance > 0 ? dy / distance : Math.sin(a.id);
            const push = Math.min((minimum - distance) / 2, 30 * seconds);
            moveActor(a, nx * push, ny * push, a.radius);
            moveActor(b, -nx * push, -ny * push, b.radius);
        }
    }
    for (const monster of monsters) clampMonsterToMap(monster);
}

function damageMonster(monster, amount) {
    if (monster.health <= 0) return;
    monster.health = Math.max(0, monster.health - amount);
    monster.hitUntil = gameClock.elapsedMs + 120;
    gameAudio.play(monster.health > 0 ? "hit" : "kill");
    if (monster.health > 0) return;

    const index = monsters.indexOf(monster);
    if (index !== -1) monsters.splice(index, 1);
    monsterState.defeated++;
    awardXp(monster.xpReward, monster);
}

function bulletHitTime(startX, startY, endX, endY, monster, bulletRadius) {
    const dx = endX - startX;
    const dy = endY - startY;
    const ox = startX - monster.x;
    const oy = startY - monster.y;
    const radius = monster.radius + bulletRadius;
    const c = ox * ox + oy * oy - radius * radius;
    if (c <= 0) return 0;
    const a = dx * dx + dy * dy;
    if (a === 0) return null;
    const b = 2 * (ox * dx + oy * dy);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const time = (-b - Math.sqrt(discriminant)) / (2 * a);
    return time >= 0 && time <= 1 ? time : null;
}

function resolveBulletHits(bullet, startX, startY) {
    bullet.hitMonsterIds ??= new Set();
    const hits = [];
    for (const monster of monsters) {
        if (bullet.hitMonsterIds.has(monster.id)) continue;
        const time = bulletHitTime(startX, startY, bullet.x, bullet.y, monster, bullet.size);
        if (time !== null) hits.push({ monster, time });
    }
    hits.sort((a, b) => a.time - b.time);

    for (const { monster, time } of hits) {
        if (monster.health <= 0) continue;
        bullet.hitMonsterIds.add(monster.id);
        const hitX = startX + (bullet.x - startX) * time;
        const hitY = startY + (bullet.y - startY) * time;
        damageMonster(monster, bullet.damage);

        if (bullet.kind === "rake" && bullet.knockback && monster.health > 0) {
            const speed = Math.hypot(bullet.dx, bullet.dy);
            if (speed > 0) {
                moveActor(monster, bullet.dx / speed * 24, bullet.dy / speed * 24, monster.radius);
                clampMonsterToMap(monster);
            }
        }

        if (bullet.kind === "rake" && bullet.explosive) {
            gameAudio.play("explosion");
            combatEffects.push({ x: hitX, y: hitY, createdAt: gameClock.elapsedMs });
            for (const other of [...monsters]) {
                if (other.id !== monster.id
                    && Math.hypot(other.x - hitX, other.y - hitY) <= monsterSettings.explosionRadius + other.radius) {
                    damageMonster(other, bullet.damage * 0.5);
                }
            }
        }

        // Piercing rounds pass through the first enemy and stop at the second.
        if (bullet.hitMonsterIds.size >= (bullet.kind === "rake" && bullet.piercing ? 2 : 1)) return true;
    }
    return false;
}

function updateMonsterContact() {
    if (!canControlPlayer() || isTimeFreezeActive()
        || gameClock.elapsedMs < monsterState.playerInvulnerableUntil) return;
    let damage = 0;
    for (const monster of monsters) {
        if (Math.hypot(monster.x - player.x, monster.y - player.y) <= monster.radius + player.size / 2) {
            damage = Math.max(damage, monster.damage);
        }
    }
    if (damage === 0) return;
    if (isEnergyShieldActive()) {
        gameAudio.play("block");
        return;
    }
    player.health = Math.max(0, player.health - damage);
    if (player.health > 0) {
        gameAudio.play("hurt");
        if (player.health / player.maxHealth <= 0.25) gameAudio.play("lowHealth");
    }
    monsterState.playerInvulnerableUntil = gameClock.elapsedMs + monsterSettings.contactCooldownMs;
    updateHud();
    if (player.health === 0) endGame();
}

function updateCombatEffects() {
    for (let i = combatEffects.length - 1; i >= 0; i--) {
        if (gameClock.elapsedMs - combatEffects[i].createdAt >= 300) combatEffects.splice(i, 1);
    }
}

// Shared by the live map and the enemy guide so their illustrations always match.
function drawMonsterBody(ctx, monster, target, elapsedMs = 0) {
    const radius = monster.radius;
    const variant = monsterTypes[monster.type];
    const angle = Math.atan2(target.y - monster.y, target.x - monster.x);
    ctx.save();
    ctx.translate(monster.x, monster.y);
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.beginPath();
    ctx.ellipse(0, radius * 0.75, radius, radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    if (monster.type === "charger" && monster.chargePhase !== "pursuit") {
        ctx.strokeStyle = monster.chargePhase === "windup" ? "#ffc977" : "#ff5c6e";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, radius + 6 + Math.sin(monster.chargeElapsedMs / 55) * 2, 0, Math.PI * 2); ctx.stroke();
        if (monster.chargePhase === "windup") {
            ctx.beginPath(); ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
            ctx.lineTo(Math.cos(angle) * 80, Math.sin(angle) * 80); ctx.stroke();
        }
    }
    ctx.fillStyle = monster.hitUntil > elapsedMs ? "#fff" : variant.color;
    ctx.strokeStyle = "#19241c";
    ctx.lineWidth = 2;

    if (!["shellback", "stalker"].includes(monster.type)) {
        ctx.beginPath();
        ctx.moveTo(-radius * 0.9, -radius * 0.2);
        ctx.lineTo(-radius * 0.85, -radius * (monster.type === "charger" ? 1.45 : 1.2));
        ctx.lineTo(-radius * 0.25, -radius * 0.7);
        ctx.lineTo(radius * 0.25, -radius * 0.7);
        ctx.lineTo(radius * 0.85, -radius * (monster.type === "charger" ? 1.45 : 1.2));
        ctx.lineTo(radius * 0.9, -radius * 0.2);
        ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.beginPath();
    if (monster.type === "skitter") {
        ctx.moveTo(0, -radius);
        ctx.lineTo(radius, radius * 0.65);
        ctx.lineTo(0, radius);
        ctx.lineTo(-radius, radius * 0.65);
        ctx.closePath();
    } else if (monster.type === "shellback") {
        for (let side = 0; side < 6; side++) {
            const a = side * Math.PI / 3;
            if (side === 0) ctx.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
            else ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
        }
        ctx.closePath();
    } else if (monster.type === "stalker") {
        ctx.moveTo(0, -radius);
        ctx.lineTo(radius, -radius * 0.35); ctx.lineTo(radius * 0.65, radius * 0.3);
        ctx.lineTo(0, radius); ctx.lineTo(-radius * 0.65, radius * 0.3);
        ctx.lineTo(-radius, -radius * 0.35); ctx.closePath();
    } else {
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    if (monster.type === "shellback") {
        ctx.strokeStyle = "#c7dbf4";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-radius * 0.6, radius * 0.4); ctx.lineTo(-radius * 0.6, -radius * 0.45);
        ctx.lineTo(0, -radius * 0.7); ctx.lineTo(radius * 0.6, -radius * 0.45);
        ctx.lineTo(radius * 0.6, radius * 0.4); ctx.stroke();
        ctx.strokeStyle = "#19241c";
    }
    for (const side of [-1, 1]) {
        ctx.fillStyle = "#fffde8";
        ctx.beginPath();
        ctx.arc(side * radius * 0.38, -radius * 0.16, radius * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#19241c";
        ctx.beginPath();
        ctx.arc(side * radius * 0.38 + Math.cos(angle) * 2, -radius * 0.16 + Math.sin(angle) * 2,
            radius * 0.12, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(-radius * 0.35, radius * 0.4);
    ctx.lineTo(radius * 0.35, radius * 0.4);
    ctx.stroke();
    ctx.restore();
}

function renderEnemyGuide() {
    const list = document.getElementById("enemyList");
    for (const [type, variant] of Object.entries(monsterTypes)) {
        const card = document.createElement("li");
        card.className = "enemyCard";
        card.dataset.enemy = type;
        card.style.borderTopColor = variant.color;
        const heading = document.createElement("div");
        heading.className = "enemyCardHeading";
        const portrait = document.createElement("canvas");
        portrait.width = 80;
        portrait.height = 80;
        portrait.setAttribute("aria-hidden", "true");
        drawMonsterBody(portrait.getContext("2d"), {
            type, radius: variant.radius, x: 40, y: 44, hitUntil: 0, chargePhase: "pursuit"
        }, { x: 40, y: 80 });
        const summary = document.createElement("div");
        const name = document.createElement("h3");
        name.textContent = variant.name;
        const arrival = document.createElement("span");
        arrival.className = "enemyArrival";
        const seconds = variant.minTier * monsterSettings.difficultyStepMs / 1000;
        arrival.textContent = seconds === 0 ? "From the start" : "From "
            + String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
        const description = document.createElement("p");
        description.textContent = variant.description;
        summary.appendChild(name);
        summary.appendChild(arrival);
        heading.appendChild(portrait);
        heading.appendChild(summary);
        card.appendChild(heading);
        card.appendChild(description);
        list.appendChild(card);
    }
}

function drawMonsters() {
    const target = getMonsterTarget();
    for (const monster of monsters) {
        const radius = monster.radius;
        if (monster.x + radius < 0 || monster.x - radius > canvas.width
            || monster.y + radius < gameHudHeight || monster.y - radius > canvas.height) continue;
        const variant = monsterTypes[monster.type];
        drawMonsterBody(ctx, monster, target, gameClock.elapsedMs);

        const width = Math.max(42, radius * 2 + 10);
        const x = clamp(monster.x - width / 2, 2, canvas.width - width - 2);
        const y = Math.max(gameHudHeight + 30, monster.y - radius - 14);
        ctx.save();
        ctx.fillStyle = "#141414";
        ctx.fillRect(x - 1, y - 1, width + 2, 7);
        ctx.fillStyle = monster.health / monster.maxHealth > 0.35 ? "#a8e775" : "#ff7b6d";
        ctx.fillRect(x, y, width * monster.health / monster.maxHealth, 5);
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#141414";
        ctx.lineWidth = 3;
        const label = Math.ceil(monster.health) + "/" + monster.maxHealth;
        ctx.strokeText(label, x + width / 2, y - 4);
        ctx.fillText(label, x + width / 2, y - 4);
        ctx.font = "bold 10px Arial";
        ctx.fillStyle = variant.color;
        const nameX = clamp(monster.x, ctx.measureText(variant.name).width / 2 + 3,
            canvas.width - ctx.measureText(variant.name).width / 2 - 3);
        ctx.strokeText(variant.name, nameX, y - 16);
        ctx.fillText(variant.name, nameX, y - 16);
        ctx.restore();
    }
}

function drawCombatEffects() {
    ctx.save();
    for (const effect of combatEffects) {
        const progress = (gameClock.elapsedMs - effect.createdAt) / 300;
        ctx.globalAlpha = Math.max(0, 1 - progress);
        ctx.fillStyle = "rgba(255, 174, 70, 0.2)";
        ctx.strokeStyle = "#ffcf70";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, monsterSettings.explosionRadius * (0.3 + progress * 0.7), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
    ctx.restore();
    if (gameClock.elapsedMs < monsterState.playerInvulnerableUntil) {
        ctx.save();
        ctx.strokeStyle = "rgba(255, 110, 100, 0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.size / 2 + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}
