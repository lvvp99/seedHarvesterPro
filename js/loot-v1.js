const mysteryBoxes = [];
const healthPotions = [];
const bossLootDrops = [];
const lootSettings = { mysteryLifetimeMs: 5000, potionLifetimeMs: 20000, potionHealing: 35, radius: 24 };
const lootState = { nextMysteryAt: 20000, nextPotionAt: 12000, choosing: false, choices: [], rerolls: 0 };
const mysteryDialog = document.getElementById("mysteryDialog");
const mysteryCards = [0, 1, 2].map(index => ({
    button: document.getElementById("mysteryCard" + index),
    icon: document.getElementById("mysteryIcon" + index),
    kind: document.getElementById("mysteryKind" + index),
    title: document.getElementById("mysteryTitle" + index),
    description: document.getElementById("mysteryDescription" + index)
}));

function isMysteryChoiceOpen() { return lootState.choosing; }

function findLootPosition() {
    if (canvas.width < 200 || canvas.height - gameHudHeight < 150) return null;
    for (let attempt = 0; attempt < 20; attempt++) {
        const point = findHayPosition();
        if (!point) return null;
        if (point.x < Math.max(canvas.width * 0.45, getDeathZoneWidth() + 60)) continue;
        if ([...mysteryBoxes, ...healthPotions, ...bossLootDrops, ...harvestPickups, ...cooldownPickups]
            .some(pickup => Math.hypot(pickup.x - point.x, pickup.y - point.y) < 75)) continue;
        return point;
    }
    return null;
}

function spawnMysteryBox() {
    if (mysteryBoxes.some(box => !box.bossDrop) || lootState.choosing) return false;
    const point = findLootPosition();
    if (!point) return false;
    mysteryBoxes.push({ ...point, spawnedAt: gameClock.elapsedMs });
    gameAudio.play("ready");
    return true;
}

function spawnHealthPotion() {
    if (healthPotions.length >= 2) return false;
    const point = findLootPosition();
    if (!point) return false;
    healthPotions.push({ ...point, spawnedAt: gameClock.elapsedMs });
    gameAudio.play("hay");
    return true;
}

function restoreHealth(amount) {
    const restored = Math.min(amount, Math.max(0, player.maxHealth - player.health));
    if (restored <= 0) return 0;
    player.health += restored;
    collectionEffects.push({ x: player.x, y: player.y - 28, label: "+" + Number(restored.toFixed(1)) + " HP", collectedAt: gameClock.elapsedMs });
    gameAudio.play("collect"); updateHud();
    return restored;
}

function getMysteryBonuses() {
    const bonuses = [
        { id: "seeds", icon: "🌾", kind: "Seed stash", name: "Golden harvest", description: "Gain 1,000 seeds to spend on upgrades.",
            apply() { player.seeds += 1000; } },
        { id: "vitality", icon: "♥", kind: "For this run", name: "Deep roots", description: "Gain 25 maximum HP and restore 25 HP.",
            apply() { player.maxHealth += 25; restoreHealth(25); } },
        { id: "rakePower", icon: "✦", kind: "For this run", name: "Sharpened tines", description: "Your thrown rake deals 15% more damage, including future weapon upgrades.",
            apply() { player.rakeDamageMultiplier *= 1.15; } }
    ];
    if (player.health < player.maxHealth) bonuses.push({ id: "heal", icon: "✚", kind: "Recovery", name: "Second wind", description: "Restore all your missing health.",
        apply() { restoreHealth(player.maxHealth); } });
    bonuses.push({ id: "level", icon: "↑", kind: "Level up", name: "Growing season", description: "Gain exactly one character level. Every fifth level summons a stronger boss.",
        apply() { awardXp(getXpRequired() - player.xp, player, false); } });
    if (Object.keys(abilityState).some(name => getCooldownRemainingMs(name) > 0)) bonuses.push({ id: "cooldowns", icon: "↻", kind: "Instant recharge", name: "Fresh start", description: "Reset all six ability cooldowns immediately.",
        apply() { resetAbilityCooldowns(); } });
    for (const [id, icon, name, description] of [
        ["piercingRound", "➶", "Piercing Round", "Unlock the rake effect that passes through one enemy to hit another."],
        ["knockback", "➜", "Knockback", "Unlock the rake effect that pushes enemies back on impact."],
        ["explosiveKernel", "✹", "Explosive Kernel", "Unlock the rake effect that deals splash damage to nearby enemies."],
        ["ricochet", "⤴", "Ricochet", "Unlock up to two wall bounces for every rake you throw."]
    ]) {
        if (!player.unlocks[id]) bonuses.push({ id, icon, kind: "Free rake effect", name, description,
            apply() { player.unlocks[id] = true; } });
    }
    return bonuses.concat(getExtraMysteryBonuses());
}

function findNearbyLootPosition(anchor, occupied = [], index = 0) {
    const radius = lootSettings.radius + 3;
    if (canvas.width < radius * 2 || canvas.height - gameHudHeight < radius * 2) return null;
    const left = Math.min(canvas.width / 2, getDeathZoneWidth() + radius + 20);
    const right = Math.max(left, canvas.width - radius - 12);
    const top = Math.min(canvas.height / 2, gameHudHeight + radius + 20);
    const bottom = Math.max(top, canvas.height - radius - 20);
    for (let attempt = 0; attempt < 90; attempt++) {
        const angle = index * Math.PI * 0.4 + attempt * 2.399963;
        const distance = 78 + Math.floor(attempt / 14) * 25;
        const candidate = {
            x: clamp(anchor.x + Math.cos(angle) * distance, left, right),
            y: clamp(anchor.y + Math.sin(angle) * distance, top, bottom)
        };
        if (!bodyTouchesWall(candidate.x, candidate.y, radius)
            && !occupied.some(pickup => Math.hypot(pickup.x - candidate.x, pickup.y - candidate.y) < 61)) return candidate;
    }
    // Tiny/resized arenas may not fit five separate drops. Overlap is safe: each box
    // opens only one choice and leaves the others on the paused map until resumed.
    const candidate = freeActorPoint({ x: clamp(anchor.x, left, right), y: clamp(anchor.y, top, bottom) }, radius);
    return !bodyTouchesWall(candidate.x, candidate.y, radius) ? candidate : null;
}

function spawnMysterySupplies(kind, count) {
    const occupied = [...mysteryBoxes, ...healthPotions, ...bossLootDrops];
    let spawned = 0;
    for (let index = 0; index < count; index++) {
        const point = findNearbyLootPosition(player, occupied, index);
        if (!point) continue;
        const pickup = { ...point, spawnedAt: gameClock.elapsedMs };
        if (kind === "hay") { pickup.seeds = 50; hayStacks.push(pickup); }
        else if (kind === "potion") healthPotions.push(pickup);
        occupied.push(pickup); spawned++;
    }
    return spawned;
}

function dropBossLoot(stage, point) {
    // Keep the short-lived boxes within reach even when the final blow was ranged.
    const distance = Math.hypot(point.x - player.x, point.y - player.y);
    const fraction = distance > 100 ? 100 / distance : 1;
    const anchor = { x: player.x + (point.x - player.x) * fraction, y: player.y + (point.y - player.y) * fraction };
    const occupied = [...mysteryBoxes, ...healthPotions, ...bossLootDrops];
    const rewards = ["mystery", "mystery", "mystery", "seeds", "weapon"];
    for (let index = 0; index < rewards.length; index++) {
        // The boss's cleared arena is a fallback if nearby passages are packed.
        const position = findNearbyLootPosition(anchor, occupied, index) || freeActorPoint(point, lootSettings.radius);
        const pending = canvas.width < 54 || canvas.height - gameHudHeight < 54
            || bodyTouchesWall(position.x, position.y, lootSettings.radius);
        const pickup = { ...position, spawnedAt: gameClock.elapsedMs, bossDrop: true, pending };
        if (rewards[index] === "mystery") mysteryBoxes.push(pickup);
        else bossLootDrops.push({ ...pickup, kind: rewards[index], seeds: 500 + stage * 250 });
        occupied.push(pickup);
    }
    gameAudio.play("ready");
}

function rollMysteryChoices(previous = []) {
    const pool = getMysteryBonuses();
    const unseen = pool.filter(bonus => !previous.includes(bonus.id));
    const seen = pool.filter(bonus => previous.includes(bonus.id));
    lootState.choices = [];
    for (let i = 0; i < 3; i++) {
        const options = unseen.length ? unseen : seen;
        lootState.choices.push(options.splice(Math.floor(Math.random() * options.length), 1)[0]);
    }
}

function getMysteryRerollCost() { return 50 * 2 ** lootState.rerolls; }

function renderMysteryChoices() {
    for (const [index, bonus] of lootState.choices.entries()) {
        const card = mysteryCards[index];
        card.button.disabled = false;
        card.button.setAttribute("aria-label", bonus.name + ". " + bonus.description);
        card.icon.textContent = bonus.icon; card.kind.textContent = bonus.kind;
        card.title.textContent = bonus.name; card.description.textContent = bonus.description;
    }
    const cost = getMysteryRerollCost(), button = document.getElementById("rerollMysteryBtn");
    const hasNewBonuses = getMysteryBonuses().some(bonus => !lootState.choices.some(choice => choice.id === bonus.id));
    button.textContent = "Reroll · " + cost + " seeds";
    button.disabled = !hasNewBonuses || player.seeds < cost;
    document.getElementById("mysterySeedBalance").textContent = Math.floor(player.seeds);
    document.getElementById("rerollMessage").textContent = !hasNewBonuses ? "All remaining bonuses are already shown."
        : player.seeds < cost ? "Need " + (cost - Math.floor(player.seeds)) + " more seeds." : "New choices · cost doubles each reroll.";
}

function rerollMysteryChoices() {
    if (!lootState.choosing || gameOver || document.hidden) return false;
    const previous = lootState.choices.map(bonus => bonus.id), cost = getMysteryRerollCost();
    if (player.seeds < cost || !getMysteryBonuses().some(bonus => !previous.includes(bonus.id))) return false;
    player.seeds -= cost; lootState.rerolls++;
    rollMysteryChoices(previous); renderMysteryChoices(); updateSeedCount(); gameAudio.play("purchase");
    return true;
}
document.getElementById("rerollMysteryBtn").addEventListener("click", rerollMysteryChoices);

function openMysteryChoice() {
    if (!canControlPlayer() || lootState.choosing) return false;
    lootState.rerolls = 0; rollMysteryChoices(); lootState.choosing = true;
    renderMysteryChoices();
    updateGamePauseState(); updateAbilityHud(); updateStatsPanel();
    mysteryDialog.showModal();
    gameAudio.play("open");
    return true;
}

function chooseMysteryBonus(index) {
    if (!lootState.choosing || !gameStarted || gameOver || document.hidden) return false;
    const bonus = lootState.choices[index];
    if (!bonus) return false;
    // Consume the choice before applying it so rapid or repeated clicks cannot grant it twice.
    lootState.choosing = false;
    lootState.choices = [];
    for (const card of mysteryCards) card.button.disabled = true;
    bonus.apply();
    collectionEffects.push({ x: player.x, y: player.y - 50, label: bonus.name + "!", collectedAt: gameClock.elapsedMs });
    gameAudio.play("unlock");
    mysteryDialog.close();
    updateGamePauseState(); updateHud(); updateProgressionHud(); updateStatsPanel(); updateAbilityHud();
    document.activeElement?.blur();
    return true;
}

function dismissMysteryChoice() {
    lootState.choosing = false; lootState.choices = [];
    if (mysteryDialog.open) mysteryDialog.close();
}

for (let index = 0; index < mysteryCards.length; index++) {
    mysteryCards[index].button.addEventListener("click", () => chooseMysteryBonus(index));
}
mysteryDialog.addEventListener("cancel", event => event.preventDefault());
mysteryDialog.addEventListener("close", () => {
    // A reward must be selected; Escape or an incidental close cannot bypass it.
    if (lootState.choosing && !gameOver) mysteryDialog.showModal();
});

function updateLootPickups(segments) {
    if (!canControlPlayer()) return;
    for (const pickup of [...mysteryBoxes, ...bossLootDrops]) {
        if (!pickup.pending) continue;
        const point = findNearbyLootPosition(player, [...mysteryBoxes, ...bossLootDrops].filter(other => other !== pickup));
        if (point) Object.assign(pickup, point, { pending: false, spawnedAt: gameClock.elapsedMs });
    }
    for (const [pickups, lifetime] of [[mysteryBoxes, lootSettings.mysteryLifetimeMs], [healthPotions, lootSettings.potionLifetimeMs]]) {
        for (let i = pickups.length - 1; i >= 0; i--) {
            if (pickups[i].pending) continue;
            if (gameClock.elapsedMs - pickups[i].spawnedAt >= lifetime || pickups[i].x < -32) pickups.splice(i, 1);
        }
    }
    if (gameClock.elapsedMs >= lootState.nextMysteryAt) {
        const spawned = spawnMysteryBox();
        lootState.nextMysteryAt = gameClock.elapsedMs + (spawned ? 35000 + Math.random() * 20000 : 3000);
    }
    if (gameClock.elapsedMs >= lootState.nextPotionAt) {
        const spawned = spawnHealthPotion();
        lootState.nextPotionAt = gameClock.elapsedMs + (spawned ? 18000 + Math.random() * 12000 : 3000);
    }
    for (let i = bossLootDrops.length - 1; i >= 0; i--) {
        const pickup = bossLootDrops[i];
        if (pickup.pending) continue;
        // Guaranteed boss rewards wait at the safe edge instead of being lost to scrolling.
        const safeEdge = Math.min(canvas.width - 28, getDeathZoneWidth() + 35);
        if (pickup.x < safeEdge) {
            Object.assign(pickup, freeActorPoint({ x: safeEdge, y: pickup.y }, lootSettings.radius));
        }
        if (!pathTouchesPickup(pickup, segments, getMysteryPickupRadius(player.size / 2 + lootSettings.radius))) continue;
        bossLootDrops.splice(i, 1);
        if (pickup.kind === "weapon") upgradeRakeWeapon();
        else {
            player.seeds += pickup.seeds; updateSeedCount();
            collectionEffects.push({ x: pickup.x, y: pickup.y - 30,
                label: "Jackpot! +" + pickup.seeds + " seeds", collectedAt: gameClock.elapsedMs });
            gameAudio.play("unlock");
        }
        updateStatsPanel();
    }
    for (let i = healthPotions.length - 1; i >= 0; i--) {
        if (player.health >= player.maxHealth || !pathTouchesPickup(healthPotions[i], segments, getMysteryPickupRadius(player.size / 2 + 19))) continue;
        healthPotions.splice(i, 1); restoreHealth(lootSettings.potionHealing + mysteryBonuses.potionBonus);
    }
    for (let i = mysteryBoxes.length - 1; i >= 0; i--) {
        if (mysteryBoxes[i].pending) continue;
        if (!pathTouchesPickup(mysteryBoxes[i], segments, getMysteryPickupRadius(player.size / 2 + lootSettings.radius))) continue;
        mysteryBoxes.splice(i, 1);
        openMysteryChoice();
        break;
    }
}

function resizeLootPickups() {
    for (const pickups of [mysteryBoxes, healthPotions, bossLootDrops]) {
        for (let i = pickups.length - 1; i >= 0; i--) {
            const point = freeActorPoint(clampPointToCanvas(pickups[i].x, pickups[i].y), lootSettings.radius);
            if (canvas.width < 100 || canvas.height - gameHudHeight < 100 || bodyTouchesWall(point.x, point.y, lootSettings.radius)) {
                if (pickups[i].bossDrop) pickups[i].pending = true;
                else pickups.splice(i, 1);
            }
            else Object.assign(pickups[i], point);
        }
    }
}

function drawLootPickups() {
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const pickup of bossLootDrops) {
        if (pickup.pending) continue;
        const pulse = Math.sin((gameClock.elapsedMs - pickup.spawnedAt) / 200) * 3;
        const color = pickup.kind === "weapon" ? "#9aeeff" : "#ffe085";
        ctx.fillStyle = pickup.kind === "weapon" ? "rgba(115,216,255,.2)" : "rgba(255,217,101,.2)";
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pickup.x, pickup.y, 27 + pulse, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = color; ctx.font = "bold 27px Arial";
        ctx.fillText(pickup.kind === "weapon" ? "⚒" : "🌾", pickup.x, pickup.y);
        ctx.font = "bold 11px Arial"; ctx.strokeStyle = "#152019"; ctx.lineWidth = 4;
        const label = pickup.kind === "weapon" ? "WEAPON UPGRADE" : "JACKPOT · " + pickup.seeds;
        ctx.strokeText(label, pickup.x, pickup.y + 40); ctx.fillText(label, pickup.x, pickup.y + 40);
    }
    for (const box of mysteryBoxes) {
        if (box.pending) continue;
        const remaining = Math.max(0, lootSettings.mysteryLifetimeMs - (gameClock.elapsedMs - box.spawnedAt));
        ctx.fillStyle = "rgba(182, 138, 255, .18)";
        ctx.beginPath(); ctx.arc(box.x, box.y, 31, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = remaining <= 2000 ? "#ff957c" : box.bossDrop ? "#ffe29b" : "#e6bbff"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(box.x, box.y, 31, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining / lootSettings.mysteryLifetimeMs); ctx.stroke();
        ctx.fillStyle = "#49345e"; ctx.strokeStyle = "#ffe29b"; ctx.lineWidth = 2;
        ctx.fillRect(box.x - 21, box.y - 23, 42, 46); ctx.strokeRect(box.x - 21, box.y - 23, 42, 46);
        ctx.fillStyle = "#ffe29b"; ctx.fillRect(box.x - 24, box.y - 25, 48, 7);
        ctx.font = "bold 23px Arial"; ctx.fillText("?", box.x, box.y - 5);
        ctx.font = "bold 12px Arial"; ctx.fillStyle = "#fff5dc";
        ctx.fillText(Math.ceil(remaining / 1000) + "s", box.x, box.y + 14);
    }
    for (const potion of healthPotions) {
        ctx.fillStyle = "rgba(255, 106, 130, .16)";
        ctx.beginPath(); ctx.arc(potion.x, potion.y, 25 + Math.sin((gameClock.elapsedMs - potion.spawnedAt) / 240) * 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#c74666"; ctx.strokeStyle = "#ffd0d9"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(potion.x, potion.y + 3, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#f9a8b8"; ctx.fillRect(potion.x - 7, potion.y - 21, 14, 12);
        ctx.fillStyle = "#b1915d"; ctx.fillRect(potion.x - 8, potion.y - 24, 16, 6);
        ctx.fillStyle = "#fff5f7"; ctx.fillRect(potion.x - 9, potion.y, 18, 6); ctx.fillRect(potion.x - 3, potion.y - 6, 6, 18);
    }
    ctx.restore();
}
