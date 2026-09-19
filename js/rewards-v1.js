// Mystery rewards belong to this run. Permanent coins and ability levels are separate.
const mysteryBonuses = {
    regeneration: 0, regenerationElapsedMs: 0, xpBonus: 0,
    killHealing: 0, seedsPerKill: 0,
    potionBonus: 0, aftershock: 0, aftershockReadyAt: 0
};

function getMysteryXpMultiplier() { return 1 + mysteryBonuses.xpBonus; }

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

function getMysteryBonusesSummary() {
    const summaries = [];
    if (mysteryBonuses.regeneration) summaries.push("Regeneration " + Number(mysteryBonuses.regeneration.toFixed(1)) + " HP/s");
    if (mysteryBonuses.xpBonus) summaries.push("XP +" + Math.round(mysteryBonuses.xpBonus * 100) + "%");
    if (mysteryBonuses.killHealing) summaries.push("Kill healing " + Number(mysteryBonuses.killHealing.toFixed(1)) + " HP");
    if (mysteryBonuses.seedsPerKill) summaries.push("Seeds per kill " + mysteryBonuses.seedsPerKill);
    if (mysteryBonuses.potionBonus) summaries.push("Potion healing +" + mysteryBonuses.potionBonus + " HP");
    if (mysteryBonuses.aftershock) summaries.push("Kill burst " + mysteryBonuses.aftershock + " damage / 1.2s");
    return summaries;
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

function getExtraMysteryBonuses() {
    const bonuses = [
        { id: "weaponUpgrade", icon: "⚒", kind: "New weapon", name: "The next rake", description: "Find the next rake tier: a new look and +10 base damage. Your character level stays the same.",
            apply() { upgradeRakeWeapon(); } },
        { id: "regeneration", icon: "🌱", kind: "Regeneration", name: "Living roots", description: "Regenerate 0.3 HP every second. Picking this again adds another 0.3 HP/s.",
            apply() { mysteryBonuses.regeneration += 0.3; } },
        { id: "xpBonus", icon: "📚", kind: "Experience", name: "Field studies", description: "Earn 10% more enemy XP. Repeated copies add another 10 percentage points.",
            apply() { mysteryBonuses.xpBonus += 0.1; } },
        { id: "killHealing", icon: "💚", kind: "Recovery", name: "Siphon roots", description: "Restore 0.4 HP whenever an enemy dies. Copies stack.",
            apply() { mysteryBonuses.killHealing += 0.4; } },
        { id: "supplyRain", icon: "🎁", kind: "Map supplies", name: "Supply rain", description: "Drop 5 rich hay stacks nearby, each holding 50 seeds before your harvest bonus.",
            apply() { spawnMysterySupplies("hay", 5); } },
        { id: "harvestBoost", icon: "🌻", kind: "Harvest", name: "Golden soil", description: "Add 10 percentage points to your hay seed value multiplier.",
            apply() { player.seedMultiplier += 0.1; } },
        { id: "basicPower", icon: "✴", kind: "Basic attack", name: "Heavy kernels", description: "Add 10 damage to every basic attack.",
            apply() { player.damage += 10; } },
        { id: "basicTempo", icon: "➟", kind: "Basic attack", name: "Quick sowing", description: "Fire 0.12 more basic attacks per second.",
            apply() { player.fireRate += 0.12; } },
        { id: "fleetFooted", icon: "🥾", kind: "Movement", name: "Trail boots", description: "Move 9 pixels per second faster.",
            apply() { player.speed += 0.15; } },
        { id: "luckySeeds", icon: "🍀", kind: "Basic attack", name: "Lucky kernels", description: "Add 2 percentage points to basic attack critical chance.",
            apply() { player.criticalChance += 0.02; } },
        { id: "swiftSeeds", icon: "➶", kind: "Basic attack", name: "Windborne seeds", description: "Basic attack projectiles travel 60 pixels per second faster.",
            apply() { player.bulletSpeed += 1; } },
        { id: "seedsPerKill", icon: "🪙", kind: "Seed bounty", name: "Compost bounty", description: "Enemies now also give you 1 seed when defeated. Repeated copies add 1 more seed per kill.",
            apply() { mysteryBonuses.seedsPerKill++; } },
        { id: "herbalist", icon: "⚕", kind: "Recovery", name: "Herbalist", description: "Health potions heal 15 more HP. Also restore 15 HP now.",
            apply() { mysteryBonuses.potionBonus += 15; restoreHealth(15); } },
        { id: "quickRecovery", icon: "↻", kind: "Ability cooldowns", name: "Clockwork charm", description: "Reduce every ability's cooldown by 3%. Does not reset cooldowns already running.",
            apply() { for (const state of Object.values(abilityState)) state.cooldownMs *= 0.97; } },
        { id: "rakeHandling", icon: "⚒", kind: "Rake recovery", name: "Balanced handle", description: "Reduce the pause between normal rake throws by 5%.",
            apply() { rakeState.cooldownMs *= 0.95; } },
        { id: "aftershock", icon: "✹", kind: "Kill effect", name: "Spore burst", description: "Defeated enemies release a small 4-damage blast, at most once every 1.2 seconds. Copies add 4 damage.",
            apply() { mysteryBonuses.aftershock += 4; } },
        { id: "survivalKit", icon: "🎒", kind: "Supplies", name: "Survival kit", description: "Gain 250 seeds and restore 20 HP.",
            apply() { player.seeds += 250; restoreHealth(20); } },
    ];
    if (hayStacks.some(stack => stack.x >= 0 && stack.x <= canvas.width && stack.y >= gameHudHeight && stack.y <= canvas.height)) {
        bonuses.push({ id: "harvestAll", icon: "🌾", kind: "Instant harvest", name: "Harvest moon", description: "Collect every hay stack currently visible on the map, including its harvest bonus.",
            apply() { harvestMysteryHay(); } });
    }
    if (monsters.length) bonuses.push({ id: "shockwave", icon: "💥", kind: "Immediate attack", name: "Thresher pulse", description: "Blast enemies within 260 pixels for 45 damage.",
        apply() { abilityExplosion(player, 260, 45, "#ffcf70"); } });
    return bonuses;
}
