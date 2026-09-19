const cooldownPickups = [];
let nextCooldownPickupAt = 25000;
let cooldownResetNoticeUntil = 0;

function spawnCooldownPickup() {
    if (cooldownPickups.length || canvas.width < 200 || canvas.height - gameHudHeight < 150) return false;
    for (let i = 0; i < 20; i++) {
        const point = findHayPosition();
        if (!point) return false;
        if (point.x < Math.max(canvas.width * 0.55, getDeathZoneWidth() + 55)
            || harvestPickups.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 70)) continue;
        cooldownPickups.push({ ...point, spawnedAt: gameClock.elapsedMs });
        gameAudio.play("ready"); return true;
    }
    return false;
}

function resetAbilityCooldowns() {
    for (const state of Object.values(abilityState)) state.lastUsedAt = gameClock.elapsedMs - state.cooldownMs;
    cooldownResetNoticeUntil = gameClock.elapsedMs + 2400;
    document.getElementById("cooldownResetNotice").textContent = "↻ All 6 ability cooldowns reset!";
    collectionEffects.push({ x: player.x, y: player.y - 35, label: "↻ Cooldowns reset!", collectedAt: gameClock.elapsedMs });
    gameAudio.play("ready"); updateAbilityHud(); updateCooldownPickupHud();
}

function updateCooldownPickups(segments) {
    if (!canControlPlayer()) return;
    if (gameClock.elapsedMs >= nextCooldownPickupAt) {
        const spawned = spawnCooldownPickup();
        nextCooldownPickupAt = gameClock.elapsedMs + (spawned ? 45000 + Math.random() * 25000 : 3000);
    }
    for (let i = cooldownPickups.length - 1; i >= 0; i--) {
        const pickup = cooldownPickups[i];
        if (gameClock.elapsedMs - pickup.spawnedAt >= 18000 || pickup.x < -32) { cooldownPickups.splice(i, 1); continue; }
        if (!pathTouchesPickup(pickup, segments, getMysteryPickupRadius(player.size / 2 + 23))) continue;
        cooldownPickups.splice(i, 1); resetAbilityCooldowns();
    }
}

function updateCooldownPickupHud() {
    const active = gameStarted && !gameOver && gameClock.elapsedMs < cooldownResetNoticeUntil;
    document.getElementById("cooldownResetNotice").hidden = !active;
    document.getElementById("abilityBar").classList.toggle("cooldownsReset", active);
}

function drawCooldownPickups() {
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const pickup of cooldownPickups) {
        const pulse = Math.sin((gameClock.elapsedMs - pickup.spawnedAt) / 180) * 3;
        ctx.fillStyle = "rgba(94, 235, 255, 0.18)"; ctx.strokeStyle = "#6eebff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pickup.x, pickup.y, 25 + pulse, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#b5f6ff"; ctx.font = "bold 34px Arial"; ctx.fillText("↻", pickup.x, pickup.y);
        ctx.font = "bold 11px Arial"; ctx.strokeStyle = "#10242d"; ctx.lineWidth = 4;
        ctx.strokeText("RESET COOLDOWNS", pickup.x, pickup.y + 40); ctx.fillText("RESET COOLDOWNS", pickup.x, pickup.y + 40);
    }
    ctx.restore();
}
