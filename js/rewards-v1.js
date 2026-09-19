// Mystery rewards belong to this run. Permanent coins and ability levels are separate.
const mysteryBonuses = {
    regeneration: 0, regenerationElapsedMs: 0, pickupReach: 0, xpBonus: 0,
    armor: 0, killHealing: 0, slowAura: 0, levelHealing: 0, seedsPerKill: 0,
    potionBonus: 0, aftershock: 0, aftershockReadyAt: 0
};

function getMysteryXpMultiplier() { return 1 + mysteryBonuses.xpBonus; }
function getMysteryPickupRadius(radius) { return radius + mysteryBonuses.pickupReach; }
function getMysteryDamageTaken(damage) { return damage / (1 + mysteryBonuses.armor); }

function getMysteryMonsterSpeed(monster, speed) {
    if (!mysteryBonuses.slowAura || Math.hypot(monster.x - player.x, monster.y - player.y) > 140 + monster.radius) return speed;
    return speed / (1 + mysteryBonuses.slowAura * (monster.bossStage ? 0.5 : 1));
}

function healFromMysteryBonus(amount) {
    if (!(amount > 0) || player.health <= 0) return;
    const previous = player.health;
    player.health = Math.min(player.maxHealth, player.health + amount);
    if (previous !== player.health) updateHud();
}

function updateMysteryBonuses(deltaMs) {
    if (!canControlPlayer()) return;
    mysteryBonuses.regenerationElapsedMs += Math.max(0, Math.min(deltaMs, 50));
    if (mysteryBonuses.regenerationElapsedMs >= 1000) {
        const seconds = Math.floor(mysteryBonuses.regenerationElapsedMs / 1000);
        mysteryBonuses.regenerationElapsedMs %= 1000;
        healFromMysteryBonus(mysteryBonuses.regeneration * seconds);
    }
}

function applyMysteryKillBonuses(monster) {
    healFromMysteryBonus(mysteryBonuses.killHealing);
    if (mysteryBonuses.seedsPerKill) {
        player.seeds += mysteryBonuses.seedsPerKill;
        updateSeedCount();
    }
    if (mysteryBonuses.aftershock > 0 && gameClock.elapsedMs >= mysteryBonuses.aftershockReadyAt) {
        // Set the cooldown before damage: kills caused by this burst cannot recurse.
        mysteryBonuses.aftershockReadyAt = gameClock.elapsedMs + 1200;
        abilityExplosion(monster, 85, mysteryBonuses.aftershock, "#b7f2a0");
    }
}

function onMysteryLevelUp() { healFromMysteryBonus(mysteryBonuses.levelHealing); }

function getMysteryBonusesSummary() {
    const summaries = [];
    if (mysteryBonuses.regeneration) summaries.push("Regeneration " + Number(mysteryBonuses.regeneration.toFixed(1)) + " HP/s");
    if (mysteryBonuses.pickupReach) summaries.push("Pickup reach +" + mysteryBonuses.pickupReach + "px");
    if (mysteryBonuses.xpBonus) summaries.push("XP +" + Math.round(mysteryBonuses.xpBonus * 100) + "%");
    if (mysteryBonuses.armor) summaries.push("Damage reduction " + Math.round((1 - 1 / (1 + mysteryBonuses.armor)) * 100) + "%");
    if (mysteryBonuses.killHealing) summaries.push("Kill healing " + Number(mysteryBonuses.killHealing.toFixed(1)) + " HP");
    if (mysteryBonuses.slowAura) summaries.push("Frost aura " + Math.round((1 - 1 / (1 + mysteryBonuses.slowAura)) * 100) + "% slow");
    if (mysteryBonuses.levelHealing) summaries.push("Level-up healing " + mysteryBonuses.levelHealing + " HP");
    if (mysteryBonuses.seedsPerKill) summaries.push("Seeds per kill " + mysteryBonuses.seedsPerKill);
    if (mysteryBonuses.potionBonus) summaries.push("Potion healing +" + mysteryBonuses.potionBonus + " HP");
    if (mysteryBonuses.aftershock) summaries.push("Kill burst " + mysteryBonuses.aftershock + " damage / 1.2s");
    return summaries;
}

function drawMysteryBonusEffects() {
    if (!mysteryBonuses.slowAura) return;
    ctx.save(); ctx.strokeStyle = "rgba(126, 215, 255, .28)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(player.x, player.y, 140, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
}

function harvestMysteryHay() {
    let amount = 0;
    for (let index = hayStacks.length - 1; index >= 0; index--) {
        const stack = hayStacks[index];
        if (stack.x < 0 || stack.x > canvas.width || stack.y < gameHudHeight || stack.y > canvas.height) continue;
        amount += collectStackSeeds(stack);
        harvestBursts.push({ x: stack.x, y: stack.y, createdAt: gameClock.elapsedMs });
        hayStacks.splice(index, 1);
    }
    player.seeds += amount;
    updateSeedCount();
    return amount;
}

function grantMysteryAbility(name, durationMs) {
    abilityState[name].activeUntil = Math.max(gameClock.elapsedMs, abilityState[name].activeUntil) + durationMs;
    if (name === "rakeFrenzy") abilityState[name].castLevel = getAbilityLevel(name);
}

function getExtraMysteryBonuses() {
    const bonuses = [
        { id: "weaponUpgrade", icon: "⚒", kind: "New weapon", name: "The next rake", description: "Find the next rake tier: a new look and +2 base damage. Your character level stays the same.",
            apply() { upgradeRakeWeapon(); } },
        { id: "regeneration", icon: "🌱", kind: "For this run", name: "Living roots", description: "Regenerate 0.3 HP every second. Picking this again adds another 0.3 HP/s.",
            apply() { mysteryBonuses.regeneration += 0.3; } },
        { id: "magnet", icon: "🧲", kind: "For this run", name: "Magnetic pockets", description: "Collect hay and other pickups from 25 pixels farther away.",
            apply() { mysteryBonuses.pickupReach += 25; } },
        { id: "xpBonus", icon: "📚", kind: "For this run", name: "Field studies", description: "Earn 10% more enemy XP. Repeated copies add another 10 percentage points.",
            apply() { mysteryBonuses.xpBonus += 0.1; } },
        { id: "armor", icon: "◈", kind: "For this run", name: "Barkskin", description: "Take about 9% less damage with the first copy. Repeated copies strengthen your armor with smaller gains.",
            apply() { mysteryBonuses.armor += 0.1; } },
        { id: "killHealing", icon: "💚", kind: "For this run", name: "Siphon roots", description: "Restore 0.4 HP whenever an enemy dies. Copies stack.",
            apply() { mysteryBonuses.killHealing += 0.4; } },
        { id: "slowAura", icon: "❄", kind: "For this run", name: "Frost garden", description: "Enemies within 140 pixels move about 13% slower. Half strength against bosses; copies strengthen the slow.",
            apply() { mysteryBonuses.slowAura += 0.15; } },
        { id: "shieldGift", icon: "🛡", kind: "Immediate protection", name: "Safe haven", description: "Gain 5 seconds of Energy Shield without spending its cooldown. Adds to an active shield.",
            apply() { grantMysteryAbility("energyShield", 5000); } },
        { id: "freezeGift", icon: "⌛", kind: "Immediate protection", name: "Stolen seconds", description: "Freeze enemies and map movement for 4 seconds without spending the ability cooldown.",
            apply() { grantMysteryAbility("timeFreeze", 4000); } },
        { id: "frenzyGift", icon: "⚡", kind: "Immediate attack", name: "Wild harvest", description: "Gain 5 seconds of Rake Frenzy with your current ability level, without spending its cooldown.",
            apply() { grantMysteryAbility("rakeFrenzy", 5000); } },
        { id: "supplyRain", icon: "🎁", kind: "Map supplies", name: "Supply rain", description: "Drop 5 rich hay stacks nearby, each holding 50 seeds before your harvest bonus.",
            apply() { spawnMysterySupplies("hay", 5); } },
        { id: "harvestBoost", icon: "🌻", kind: "For this run", name: "Golden soil", description: "Add 10 percentage points to your hay seed value multiplier.",
            apply() { player.seedMultiplier += 0.1; } },
        { id: "basicPower", icon: "✴", kind: "For this run", name: "Heavy kernels", description: "Add 1 damage to every basic attack.",
            apply() { player.damage += 1; } },
        { id: "basicTempo", icon: "➟", kind: "For this run", name: "Quick sowing", description: "Fire 0.12 more basic attacks per second.",
            apply() { player.fireRate += 0.12; } },
        { id: "fleetFooted", icon: "🥾", kind: "For this run", name: "Trail boots", description: "Move 9 pixels per second faster.",
            apply() { player.speed += 0.15; } },
        { id: "luckySeeds", icon: "🍀", kind: "For this run", name: "Lucky kernels", description: "Add 2 percentage points to basic attack critical chance.",
            apply() { player.criticalChance += 0.02; } },
        { id: "swiftSeeds", icon: "➶", kind: "For this run", name: "Windborne seeds", description: "Basic attack projectiles travel 60 pixels per second faster.",
            apply() { player.bulletSpeed += 1; } },
        { id: "levelHealing", icon: "🌿", kind: "For this run", name: "Renewal", description: "Restore 8 HP whenever you gain a character level. Repeated copies add another 8 HP.",
            apply() { mysteryBonuses.levelHealing += 8; } },
        { id: "seedsPerKill", icon: "🪙", kind: "For this run", name: "Compost bounty", description: "Enemies now also give you 1 seed when defeated. Repeated copies add 1 more seed per kill.",
            apply() { mysteryBonuses.seedsPerKill++; } },
        { id: "herbalist", icon: "⚕", kind: "For this run", name: "Herbalist", description: "Health potions heal 15 more HP. Also restore 15 HP now.",
            apply() { mysteryBonuses.potionBonus += 15; restoreHealth(15); } },
        { id: "quickRecovery", icon: "↻", kind: "For this run", name: "Clockwork charm", description: "Reduce every ability's cooldown by 3%. Does not reset cooldowns already running.",
            apply() { for (const state of Object.values(abilityState)) state.cooldownMs *= 0.97; } },
        { id: "rakeHandling", icon: "⚒", kind: "For this run", name: "Balanced handle", description: "Reduce the pause between normal rake throws by 5%.",
            apply() { rakeState.cooldownMs *= 0.95; } },
        { id: "aftershock", icon: "✹", kind: "For this run", name: "Spore burst", description: "Defeated enemies release a small 4-damage blast, at most once every 1.2 seconds. Copies add 4 damage.",
            apply() { mysteryBonuses.aftershock += 4; } },
        { id: "survivalKit", icon: "🎒", kind: "Supplies", name: "Survival kit", description: "Gain 250 seeds and restore 20 HP.",
            apply() { player.seeds += 250; restoreHealth(20); } },
        { id: "heartwood", icon: "♥", kind: "For this run", name: "Heartwood", description: "Gain 10 maximum HP, restore 10 HP and add 0.05 armor.",
            apply() { player.maxHealth += 10; restoreHealth(10); mysteryBonuses.armor += 0.05; } }
    ];
    if (hayStacks.some(stack => stack.x >= 0 && stack.x <= canvas.width && stack.y >= gameHudHeight && stack.y <= canvas.height)) {
        bonuses.push({ id: "harvestAll", icon: "🌾", kind: "Instant harvest", name: "Harvest moon", description: "Collect every hay stack currently visible on the map, including its harvest bonus.",
            apply() { harvestMysteryHay(); } });
    }
    if (monsters.length) bonuses.push({ id: "shockwave", icon: "💥", kind: "Immediate attack", name: "Thresher pulse", description: "Blast enemies within 260 pixels for 45 damage.",
        apply() { abilityExplosion(player, 260, 45, "#ffcf70"); } });
    return bonuses;
}
