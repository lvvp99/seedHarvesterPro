// Every level has its own rake silhouette, material and ornamentation.
const rakeNames = ["Field Rake", "Copper Tines", "Bramble Rake", "Iron Harrow", "Steel Sweep",
    "Frost Fork", "Glacier Rake", "Storm Tines", "Thunder Harrow", "Skybreaker",
    "Ember Rake", "Blazing Fork", "Inferno Tines", "Sunforge", "Phoenix Harrow",
    "Void Rake", "Star Reaper", "Astral Harrow", "Celestial Crown", "Harvest Sovereign"];
const rakeLevels = rakeNames.map((name, index) => ({
    level: index + 1, name, damage: 20 + index * 7 + index * index * 2,
    tines: 3 + Math.floor(index / 2), headWidth: 16 + index * 0.65,
    tineLength: 7 + index % 5 * 1.5, bands: 1 + index % 5,
    color: ["#b8a58c", "#c88b58", "#adc892", "#b7c9d4", "#e5edf5",
        "#79c9e8", "#a1eaff", "#66c4ff", "#a8bbff", "#dcf7ff",
        "#e99656", "#ffb957", "#ff7665", "#ffd271", "#fff0b0",
        "#b990ff", "#debdff", "#b1f1ff", "#fff6cb", "#ffd95a"][index]
}));
const maxPlayerLevel = 20;
const rakeState = { nextThrowAt: 0, cooldownMs: 450, aimAngle: -Math.PI / 2 };

function getXpRequired(level = player.level) {
    return level >= maxPlayerLevel ? 0 : 40 + (level - 1) * 20 + (level - 1) ** 2 * 4;
}

function getRake(level = player.level) { return rakeLevels[clamp(level, 1, maxPlayerLevel) - 1]; }
function getRakeDamage() { return Math.round(getRake().damage * player.rakeDamageMultiplier); }

function awardXp(amount, position = player) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const reward = Math.floor(amount);
    player.totalXp += reward;
    if (player.level < maxPlayerLevel) player.xp += reward;
    collectionEffects.push({ x: position.x, y: position.y, label: "+" + reward + " XP", collectedAt: gameClock.elapsedMs });
    let gained = false;
    while (player.level < maxPlayerLevel && player.xp >= getXpRequired()) {
        player.xp -= getXpRequired();
        player.level++;
        gained = true;
    }
    if (player.level === maxPlayerLevel) player.xp = 0;
    if (gained) {
        gameAudio.play("unlock");
        collectionEffects.push({ x: player.x, y: player.y - 25,
            label: "Level " + player.level + " · " + getRake().name, collectedAt: gameClock.elapsedMs });
    }
    updateProgressionHud();
    updateStatsPanel();
}

function updateProgressionHud() {
    const capped = player.level === maxPlayerLevel;
    const required = getXpRequired();
    const bar = document.getElementById("xpBar");
    document.getElementById("playerLevel").textContent = player.level + "/20";
    document.getElementById("xpText").textContent = capped ? "MAX LEVEL" : player.xp + " / " + required + " XP";
    bar.style.width = (capped ? 100 : player.xp / required * 100) + "%";
    const meter = document.getElementById("xpMeter");
    meter.setAttribute("aria-valuenow", String(capped ? 100 : player.xp));
    meter.setAttribute("aria-valuemax", String(capped ? 100 : required));
    meter.setAttribute("aria-valuetext", capped ? "Maximum level, 20 of 20" : player.xp + " of " + required + " XP, level " + player.level + " of 20");
    document.getElementById("rakeName").textContent = getRake().name;
    updateRakeStatus();
}

function updateRakeStatus() {
    const remaining = Math.max(0, rakeState.nextThrowAt - gameClock.elapsedMs);
    const label = isRakeFrenzyActive() ? "Frenzy · " + Math.ceil((abilityState.rakeFrenzy.activeUntil - gameClock.elapsedMs) / 1000) + "s · Click rapidly!" : remaining > 0 ? "Recovering · " + (remaining / 1000).toFixed(1) + "s" : "Left-click · Ready";
    const status = document.getElementById("rakeStatus");
    if (status.textContent !== label) status.textContent = label;
}

function getPlayerAimAngle() {
    const dx = mouse.x - player.x, dy = mouse.y - player.y;
    if (Math.hypot(dx, dy) > 0.01) rakeState.aimAngle = Math.atan2(dy, dx);
    return rakeState.aimAngle;
}

function throwRake() {
    if (!canControlPlayer() || (!isRakeFrenzyActive() && gameClock.elapsedMs < rakeState.nextThrowAt)) return false;
    const angle = getPlayerAimAngle();
    const speed = 12 + player.level * 0.12;
    bullets.push({ kind: "rake", level: player.level, x: player.x, y: player.y,
        dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed, angle, size: Math.round(10 + getRake().headWidth * 0.4),
        damage: getRakeDamage(), piercing: player.unlocks.piercingRound,
        knockback: player.unlocks.knockback, explosive: player.unlocks.explosiveKernel,
        bouncesRemaining: player.unlocks.ricochet ? 2 : 0 });
    rakeState.nextThrowAt = gameClock.elapsedMs + rakeState.cooldownMs;
    gameAudio.play("shot");
    updateRakeStatus();
    return true;
}

function drawRake(context, x, y, angle, level, scale = 1) {
    const rake = getRake(level);
    context.save(); context.translate(x, y); context.rotate(angle); context.scale(scale, scale);
    context.lineCap = "round"; context.lineJoin = "round";
    if (level >= 10) { context.shadowColor = rake.color; context.shadowBlur = 4 + level / 3; }
    context.strokeStyle = "#231e16"; context.lineWidth = 7;
    context.beginPath(); context.moveTo(-23, 0); context.lineTo(15, 0); context.stroke();
    context.strokeStyle = level < 6 ? "#9a683a" : rake.color; context.lineWidth = 4;
    context.stroke();
    context.strokeStyle = "#fff0c1"; context.lineWidth = 2;
    for (let band = 0; band < rake.bands; band++) {
        const bx = -17 + band * 5;
        context.beginPath(); context.moveTo(bx, -2.5); context.lineTo(bx, 2.5); context.stroke();
    }
    const w = rake.headWidth;
    context.strokeStyle = "#231e16"; context.lineWidth = 7;
    context.beginPath(); context.moveTo(13, -w); context.lineTo(13, w); context.stroke();
    context.strokeStyle = rake.color; context.lineWidth = 4; context.stroke();
    for (let tine = 0; tine < rake.tines; tine++) {
        const ty = -w + tine / (rake.tines - 1) * w * 2;
        context.beginPath(); context.moveTo(13, ty);
        context.lineTo(13 + rake.tineLength, ty + (level % 2 ? 0 : Math.sign(ty) * 2));
        context.stroke();
    }
    if (level >= 6) {
        context.fillStyle = level >= 16 ? "#fff9d7" : "#e2fcff";
        context.beginPath(); context.moveTo(5, 0); context.lineTo(11, -5);
        context.lineTo(17, 0); context.lineTo(11, 5); context.closePath(); context.fill();
    }
    if (level >= 11) {
        context.beginPath(); context.moveTo(7, -w - 5); context.lineTo(16, -w - 2);
        context.moveTo(7, w + 5); context.lineTo(16, w + 2); context.stroke();
    }
    if (level >= 16) {
        context.strokeStyle = "#fff4b5"; context.lineWidth = 1.5;
        context.beginPath(); context.arc(10, 0, 9 + (level - 16), 0, Math.PI * 2); context.stroke();
    }
    context.restore();
}

function drawHarvester(x = player.x, y = player.y, heldWeapon = true) {
    if (!player.image) return;
    const angle = getPlayerAimAngle();
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle + Math.PI / 2);
    // Preserve the supplied sprite's proportions while using a stable collision body.
    const height = 54, width = height * (player.image.naturalWidth || 786) / (player.image.naturalHeight || 868);
    ctx.drawImage(player.image, -width / 2, -height / 2, width, height);
    ctx.restore();
    if (heldWeapon && gameClock.elapsedMs >= rakeState.nextThrowAt) {
        drawRake(ctx, x + Math.cos(angle) * 8 - Math.sin(angle) * 19,
            y + Math.sin(angle) * 8 + Math.cos(angle) * 19, angle, player.level, 0.75);
    }
}
