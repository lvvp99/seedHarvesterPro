const abilityBursts = [];
const teleportTrails = [];
const cooldownFeedback = { until: 0 };

function abilityExplosion(point, radius, damage, color = "#d8a1ff") {
    abilityBursts.push({ x: point.x, y: point.y, radius, color, createdAt: gameClock.elapsedMs });
    for (const monster of [...monsters]) {
        if (Math.hypot(monster.x - point.x, monster.y - point.y) <= radius + monster.radius) damageMonster(monster, damage);
    }
    gameAudio.play("explosion");
}

function leaveTeleportEffects(origin, destination) {
    const level = getAbilityLevel("teleport");
    if (level >= 2) abilityExplosion(origin, 140, getRakeDamage() * 3, "#80ffe0");
    if (level >= 3) teleportTrails.push({ x1: origin.x, y1: origin.y, x2: destination.x, y2: destination.y,
        expiresAt: gameClock.elapsedMs + 3000, damagePerSecond: getRakeDamage() * 0.75 });
}

function updateAbilityEffects(deltaMs) {
    if (!canControlPlayer()) return;
    for (let i = teleportTrails.length - 1; i >= 0; i--) {
        const trail = teleportTrails[i];
        if (gameClock.elapsedMs >= trail.expiresAt) { teleportTrails.splice(i, 1); continue; }
        for (const monster of [...monsters]) {
            if (pathTouchesPickup(monster, [trail], monster.radius + 14)) damageMonster(monster, trail.damagePerSecond * Math.min(deltaMs, 50) / 1000);
        }
    }
    for (let i = abilityBursts.length - 1; i >= 0; i--) {
        if (gameClock.elapsedMs - abilityBursts[i].createdAt >= 600) abilityBursts.splice(i, 1);
    }
}

function drawAbilityEffects() {
    ctx.save(); ctx.lineCap = "round";
    for (const trail of teleportTrails) {
        ctx.globalAlpha = Math.min(1, (trail.expiresAt - gameClock.elapsedMs) / 500);
        ctx.strokeStyle = "rgba(94,255,199,.20)"; ctx.lineWidth = 28;
        ctx.beginPath(); ctx.moveTo(trail.x1, trail.y1); ctx.lineTo(trail.x2, trail.y2); ctx.stroke();
        ctx.strokeStyle = "#a8ffdb"; ctx.lineWidth = 3; ctx.stroke();
    }
    for (const burst of abilityBursts) {
        const progress = Math.min(1, (gameClock.elapsedMs - burst.createdAt) / 600);
        ctx.globalAlpha = 1 - progress; ctx.strokeStyle = burst.color; ctx.fillStyle = burst.color;
        ctx.lineWidth = 5 * (1 - progress) + 1;
        ctx.beginPath(); ctx.arc(burst.x, burst.y, burst.radius * Math.sqrt(progress), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha *= 0.15; ctx.fill();
    }
    ctx.restore();
}

function getDashReach() { return getAbilityLevel("dash") >= 3 ? 240 : 140; }

function planPhaseDash(dx, dy, reach) {
    // Plan a clear landing before moving, rather than stopping inside a wall.
    const probe = { x: player.x, y: player.y };
    const steps = Math.ceil(reach / 4), step = reach / steps;
    let safeReach = 0;
    for (let i = 1; i <= steps; i++) {
        moveActor(probe, dx * step, dy * step, player.size / 2, true, true, true);
        if (!bodyTouchesWall(probe.x, probe.y, player.size / 2, true)) safeReach = i * step;
    }
    return safeReach;
}

function showCooldownFeedback(name) {
    const remaining = getCooldownRemainingMs(name);
    if (remaining <= 0) return;
    const notice = document.getElementById("cooldownCursorNotice");
    notice.textContent = abilityCatalog[name].name + " · " + (remaining / 1000).toFixed(1) + "s · Not ready";
    notice.style.left = Math.max(8, Math.min(window.innerWidth - 238, mouse.x + 12)) + "px";
    notice.style.top = Math.max(8, Math.min(window.innerHeight - 42, mouse.y - 38)) + "px";
    notice.style.animation = "none"; void notice.offsetWidth; notice.style.animation = "";
    cooldownFeedback.until = gameClock.elapsedMs + 850;
    notice.hidden = false;
}

function updateCooldownFeedback() {
    document.getElementById("cooldownCursorNotice").hidden = !canControlPlayer() || gameClock.elapsedMs >= cooldownFeedback.until;
}

function updateRakeLoadout() {
    let count = 0;
    for (const name of ["piercingRound", "knockback", "explosiveKernel", "ricochet"]) {
        const owned = Boolean(player.unlocks[name]); count += Number(owned);
        const badge = document.getElementById("effectState-" + name);
        badge.textContent = owned ? "Unlocked" : "Locked";
        badge.classList.toggle("unlocked", owned);
    }
    document.getElementById("rakeEffectsCount").textContent = count + "/4";
}
