// Weapons are loot progression, separate from the harvester's experience level.
const rakeNames = ["Field Rake", "Copper Tines", "Bramble Rake", "Iron Harrow", "Steel Sweep",
    "Frost Fork", "Glacier Rake", "Storm Tines", "Thunder Harrow", "Skybreaker",
    "Ember Rake", "Blazing Fork", "Inferno Tines", "Sunforge", "Phoenix Harrow",
    "Void Rake", "Star Reaper", "Astral Harrow", "Celestial Crown", "Harvest Sovereign",
    "Jade Serpent", "Emerald Fang", "Verdant Guardian", "Worldroot Harrow", "Forest Monarch",
    "Bloodmoon Rake", "Crimson Eclipse", "Garnet Reaper", "Dread Harvester", "Nightfall Crown",
    "Prismatic Fork", "Aurora Harrow", "Nebula Reaper", "Comet Breaker", "Galaxy Sovereign",
    "Dawnbringer", "Solar Dominion", "Eternal Harvest", "Genesis Harrow", "Infinity Reaper"];
const rakeLevels = rakeNames.map((name, index) => ({
    level: index + 1, name, damage: 12 + index * 10,
    tines: Math.min(14, 3 + Math.floor(index / 2)),
    headWidth: 16 + Math.min(index, 19) * 0.65 + Math.max(0, index - 19) * 0.22,
    tineLength: 7 + index % 5 * 1.5, bands: 1 + index % 5,
    color: ["#b8a58c", "#c88b58", "#adc892", "#b7c9d4", "#e5edf5",
        "#79c9e8", "#a1eaff", "#66c4ff", "#a8bbff", "#dcf7ff",
        "#e99656", "#ffb957", "#ff7665", "#ffd271", "#fff0b0",
        "#b990ff", "#debdff", "#b1f1ff", "#fff6cb", "#ffd95a",
        "#41cf98", "#79efaa", "#bdff8d", "#a8c954", "#e1ffb0",
        "#ed426d", "#ff669d", "#ff8d84", "#ba63a8", "#e7a8e8",
        "#82fff0", "#a7b2ff", "#d39dff", "#7bdef5", "#d7e9ff",
        "#ffe7a0", "#ffbd4a", "#fffbd2", "#dcffec", "#ffffff"][index],
    accent: ["#baffc6", "#ffd0e2", "#d9ccff", "#ffe391"][Math.max(0, Math.floor((index - 20) / 5))]
}));
const rakeState = { nextThrowAt: 0, cooldownMs: 450, aimAngle: -Math.PI / 2 };

function getXpRequired(level = player.level) {
    return 40 + (level - 1) * 20 + (level - 1) ** 2 * 4;
}

function getRake(tier = player.rakeTier) {
    const rank = Math.max(1, Math.floor(tier));
    const style = rakeLevels[(rank - 1) % rakeLevels.length];
    const cycle = Math.floor((rank - 1) / rakeLevels.length);
    return { ...style, tier: rank, damage: 12 + (rank - 1) * 10,
        name: style.name + (cycle ? " · Ascended " + cycle : "") };
}
function getRakeDamage() { return Math.round(getRake().damage * player.rakeDamageMultiplier); }

function upgradeRakeWeapon(levels = 1) {
    if (!Number.isSafeInteger(levels) || levels < 1) return getRake();
    player.rakeTier += levels;
    const rake = getRake();
    collectionEffects.push({ x: player.x, y: player.y - 35, label: "New weapon · " + rake.name, collectedAt: gameClock.elapsedMs });
    gameAudio.play("unlock"); updateProgressionHud(); updateStatsPanel();
    return rake;
}

function awardXp(amount, position = player, multiply = true) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const reward = Math.floor(amount * (multiply ? getMysteryXpMultiplier() : 1));
    player.totalXp += reward;
    player.xp += reward;
    collectionEffects.push({ x: position.x, y: position.y, label: "+" + reward + " XP", collectedAt: gameClock.elapsedMs });
    let gained = false;
    while (player.xp >= getXpRequired()) {
        player.xp -= getXpRequired();
        player.level++;
        queueBossForLevel(player.level);
        gained = true;
    }
    if (gained) {
        gameAudio.play("unlock");
        collectionEffects.push({ x: player.x, y: player.y - 25,
            label: "Level " + player.level, collectedAt: gameClock.elapsedMs });
    }
    updateProgressionHud();
    updateStatsPanel();
}

function updateProgressionHud() {
    const required = getXpRequired();
    const bar = document.getElementById("xpBar");
    document.getElementById("playerLevel").textContent = "Lv " + player.level;
    document.getElementById("xpText").textContent = player.xp + " / " + required + " XP";
    bar.style.width = player.xp / required * 100 + "%";
    const meter = document.getElementById("xpMeter");
    meter.setAttribute("aria-valuenow", String(player.xp));
    meter.setAttribute("aria-valuemax", String(required));
    meter.setAttribute("aria-valuetext", player.xp + " of " + required + " XP, level " + player.level);
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
    const speed = 12 + Math.log2(player.rakeTier + 1) * 0.12;
    const count = isRakeFrenzyActive() ? abilityState.rakeFrenzy.castLevel || 1 : 1;
    for (let i = 0; i < count; i++) {
        const shotAngle = angle + (i - (count - 1) / 2) * 0.22;
        bullets.push({ kind: "rake", level: player.rakeTier, x: player.x, y: player.y,
            dx: Math.cos(shotAngle) * speed, dy: Math.sin(shotAngle) * speed, angle: shotAngle, size: Math.round(10 + getRake().headWidth * 0.4),
            damage: getRakeDamage(), piercing: player.unlocks.piercingRound,
            knockback: player.unlocks.knockback, explosive: player.unlocks.explosiveKernel,
            bouncesRemaining: player.unlocks.ricochet ? 2 : 0 });
    }
    rakeState.nextThrowAt = gameClock.elapsedMs + rakeState.cooldownMs;
    gameAudio.play("shot");
    updateRakeStatus();
    return true;
}

function drawRake(context, x, y, angle, level, scale = 1) {
    const rake = getRake(level);
    level = rake.level;
    context.save(); context.translate(x, y); context.rotate(angle); context.scale(scale, scale);
    context.lineCap = "round"; context.lineJoin = "round";
    if (level >= 10) { context.shadowColor = rake.color; context.shadowBlur = Math.min(12, 4 + level / 3); }
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
        context.beginPath(); context.arc(10, 0, 9 + Math.min(8, level - 16), 0, Math.PI * 2); context.stroke();
    }
    if (level >= 21) {
        // Later weapons gain new silhouettes without unbounded projectile size.
        context.strokeStyle = rake.accent; context.lineWidth = 2;
        const crest = 3 + (level - 21) % 5;
        for (const side of [-1, 1]) {
            context.beginPath(); context.moveTo(11, side * (w - 7));
            context.lineTo(1 - crest, side * w);
            context.lineTo(15 + crest, side * (w + 3)); context.stroke();
        }
    }
    if (level >= 26) {
        context.beginPath(); context.moveTo(6, -w + 5); context.lineTo(6, w - 5); context.stroke();
        for (const side of [-1, 1]) {
            context.beginPath(); context.moveTo(-19, side * 3);
            context.lineTo(-23, side * 8); context.lineTo(-11, side * 4); context.stroke();
        }
    }
    if (level >= 31) {
        context.fillStyle = rake.accent;
        for (const side of [-1, 1]) {
            const cy = side * (w - 9);
            context.beginPath(); context.moveTo(6, cy); context.lineTo(11, cy - 4);
            context.lineTo(16, cy); context.lineTo(11, cy + 4); context.closePath(); context.fill();
        }
    }
    if (level >= 36) {
        context.lineWidth = 1.5;
        context.beginPath(); context.arc(10, 0, 22, 0, Math.PI * 2); context.stroke();
        const rays = 4 + level - 36;
        for (let ray = 0; ray < rays; ray++) {
            const theta = ray / rays * Math.PI * 2;
            context.beginPath(); context.moveTo(10 + Math.cos(theta) * 20, Math.sin(theta) * 20);
            context.lineTo(10 + Math.cos(theta) * 25, Math.sin(theta) * 25); context.stroke();
        }
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
            y + Math.sin(angle) * 8 + Math.cos(angle) * 19, angle, player.rakeTier, 0.75);
    }
}
