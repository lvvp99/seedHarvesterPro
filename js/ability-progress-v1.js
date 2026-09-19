const abilityCatalog = {
    teleport: { name: "Teleport", icons: ["◎", "◉", "✺"], levels: [
        "Teleport to the mouse marker.", "Teleport and leave a large explosion behind (140 px, 3× rake damage).",
        "Keep the explosion and leave a 3-second damaging trail to your destination (75% rake damage per second)."] },
    energyShield: { name: "Energy Shield", icons: ["◇", "◈", "✧"], levels: [
        "Block damage for 2 seconds.", "Block damage for 4 seconds.", "Block damage for 6 seconds."] },
    dash: { name: "Dash", icons: ["➜", "➠", "»"], levels: [
        "Sprint 140 px toward the cursor.", "Sprint up to 140 px through walls, landing on clear ground.",
        "Sprint up to 240 px through walls, landing on clear ground."] },
    timeFreeze: { name: "Time Freeze", icons: ["❄", "❅", "❆"], levels: [
        "Freeze enemies and map scrolling for 3 seconds.", "Freeze enemies and map scrolling for 5 seconds.",
        "Freeze enemies and map scrolling for 7 seconds."] },
    lure: { name: "Lure", icons: ["✦", "✷", "✹"], levels: [
        "Place a lure that attracts enemies for 10 seconds.", "Attract enemies at extreme speed for 10 seconds. Walls still block them.",
        "Keep the fast attraction and explode when the lure expires (170 px, 4× rake damage)."] },
    rakeFrenzy: { name: "Rake Frenzy", icons: ["⚡", "ϟϟ", "ϟϟϟ"], levels: [
        "Remove rake recovery for 5 seconds: one rake per click.", "For 5 seconds, throw two rakes in a spread per click with no recovery.",
        "For 5 seconds, throw three rakes in a spread per click with no recovery."] }
};

const abilityProgress = (() => {
    const storageKey = "seedHarvester.abilityProgress.v1";
    const fresh = () => ({ coins: 0, levels: Object.fromEntries(Object.keys(abilityCatalog).map(name => [name, 1])) });
    let storageAvailable = true;
    function read() {
        try {
            const data = JSON.parse(window.localStorage.getItem(storageKey) || "null");
            const result = fresh();
            if (Number.isSafeInteger(data?.coins) && data.coins >= 0) result.coins = data.coins;
            for (const name of Object.keys(result.levels)) {
                if (Number.isInteger(data?.levels?.[name]) && data.levels[name] >= 1 && data.levels[name] <= 3) result.levels[name] = data.levels[name];
            }
            return result;
        } catch { storageAvailable = false; return null; }
    }
    let state = read() || fresh(), awardedMinutes = 0;
    const views = [];
    function save() {
        try { window.localStorage.setItem(storageKey, JSON.stringify(state)); storageAvailable = true; }
        catch { storageAvailable = false; }
    }
    const level = name => state.levels[name] || 1;
    const cost = name => level(name) === 1 ? 10 : level(name) === 2 ? 30 : 0;
    function render() {
        for (const id of ["menuCoins", "hudCoins", "guideCoins"]) document.getElementById(id).textContent = state.coins.toLocaleString();
        document.getElementById("abilityStorageNote").textContent = storageAvailable
            ? "Coins and ability levels are saved in this browser. Upgrades apply to your next cast."
            : "Browser storage is unavailable. Coins and ability levels last for this visit only.";
        document.getElementById("guideStorageNote").textContent = document.getElementById("abilityStorageNote").textContent;
        for (const view of views) {
            const current = level(view.name), price = cost(view.name);
            view.level.textContent = (view.compact ? "Lv " : "Level ") + current + "/3";
            view.article.dataset.level = String(current);
            if (view.description) view.description.textContent = abilityCatalog[view.name].levels[current - 1];
            if (view.icon) view.icon.textContent = abilityCatalog[view.name].icons[current - 1];
            view.button.textContent = current === 3 ? "Max level" : (view.compact ? "Upgrade · " : "Level " + (current + 1) + " · ") + price + " coins";
            view.button.title = current < 3 ? "Level " + (current + 1) + ": " + abilityCatalog[view.name].levels[current] : "All benefits unlocked";
            view.button.disabled = current === 3 || state.coins < price || gameOver || isMysteryChoiceOpen() || document.hidden;
            view.button.setAttribute("aria-label", current === 3 ? abilityCatalog[view.name].name + " at maximum level"
                : "Upgrade " + abilityCatalog[view.name].name + " to level " + (current + 1) + " for " + price + " coins");
        }
    }
    function awardMinutes(elapsedMs) {
        const minute = Math.floor(elapsedMs / 60000);
        if (!Number.isSafeInteger(minute) || minute <= awardedMinutes) return 0;
        const earned = minute * (minute + 1) / 2 - awardedMinutes * (awardedMinutes + 1) / 2;
        if (!Number.isSafeInteger(earned)) return 0;
        state = (storageAvailable ? read() : null) || state;
        state.coins = Math.min(Number.MAX_SAFE_INTEGER, state.coins + earned);
        awardedMinutes = minute;
        save(); render();
        collectionEffects.push({ x: player.x, y: player.y - 35, label: "+" + earned + " coins", collectedAt: gameClock.elapsedMs });
        gameAudio.play("collect");
        return earned;
    }
    function purchase(name) {
        if (!abilityCatalog[name] || gameOver || isMysteryChoiceOpen() || document.hidden) return false;
        state = (storageAvailable ? read() : null) || state;
        const price = cost(name);
        if (!price || state.coins < price) { gameAudio.play("denied"); render(); return false; }
        state.coins -= price; state.levels[name]++;
        save(); render(); syncAbilityDurations(); updateAbilityHud(); gameAudio.play("unlock");
        return true;
    }
    function make(tag, text, className) {
        const element = document.createElement(tag);
        if (text) element.textContent = text;
        if (className) element.className = className;
        return element;
    }
    function init() {
        for (const context of ["menu", "guide"]) {
            const container = document.getElementById(context === "menu" ? "abilityUpgradeCards" : "abilityGuideCards");
            for (const [name, definition] of Object.entries(abilityCatalog)) {
                const compact = context === "menu";
                const article = make(compact ? "div" : "article", "", compact ? "abilityUpgradeRow" : "abilityGuideCard");
                const levelLabel = make("span", "", "abilityLevelLabel");
                let description = null, icon = null;
                if (compact) {
                    icon = make("span", "", "abilityRowIcon"); icon.setAttribute("aria-hidden", "true");
                    const label = make("span", definition.name, "abilityRowName");
                    article.appendChild(icon); article.appendChild(label); article.appendChild(levelLabel);
                } else {
                    const header = make("div", "", "abilityUpgradeHeading");
                    header.appendChild(make("h3", definition.name)); header.appendChild(levelLabel); article.appendChild(header);
                    description = make("p", "", "abilityCurrentBenefit");
                    article.appendChild(description);
                    const levels = make("div", "", "abilityLevelGuide");
                    for (let n = 1; n <= 3; n++) {
                        const figure = make("figure"), illustration = make("img"), caption = make("figcaption");
                        illustration.src = "imgs/abilities/" + name + "-" + n + ".svg";
                        illustration.alt = definition.name + " level " + n + ": " + definition.levels[n - 1];
                        illustration.width = 240; illustration.height = 120;
                        caption.appendChild(make("strong", "Level " + n)); caption.appendChild(make("span", definition.levels[n - 1]));
                        figure.appendChild(illustration); figure.appendChild(caption); levels.appendChild(figure);
                    }
                    article.appendChild(levels);
                }
                const button = make("button", "", "abilityCoinUpgrade"); button.type = "button"; button.id = context + "Upgrade-" + name;
                button.addEventListener("click", () => purchase(name)); article.appendChild(button); container.appendChild(article);
                views.push({ name, article, level: levelLabel, description, button, icon, compact });
            }
        }
        window.addEventListener("storage", event => { if (event.key === storageKey || event.key === null) { state = read() || state; render(); syncAbilityDurations(); updateAbilityHud(); } });
        render(); syncAbilityDurations();
    }
    return { init, render, level, cost, purchase, awardMinutes, beginRun() { awardedMinutes = 0; }, get coins() { return state.coins; } };
})();

function getAbilityLevel(name) { return abilityProgress.level(name); }
function syncAbilityDurations() {
    abilityState.energyShield.durationMs = [2000, 4000, 6000][getAbilityLevel("energyShield") - 1];
    abilityState.timeFreeze.durationMs = [3000, 5000, 7000][getAbilityLevel("timeFreeze") - 1];
}
function isAbilityGuideOpen() { return document.getElementById("abilityGuideDialog").open; }
function openAbilityGuide() {
    if (gameOver || isMysteryChoiceOpen() || keyBindings.isOpen() || isAbilityGuideOpen()) return;
    abilityProgress.render(); document.getElementById("abilityGuideDialog").showModal();
    updateGamePauseState(); gameAudio.play("open");
}
document.getElementById("abilityInfoBtn").addEventListener("click", openAbilityGuide);
document.getElementById("menuAbilityInfoBtn").addEventListener("click", openAbilityGuide);
document.getElementById("closeAbilityGuideBtn").addEventListener("click", () => document.getElementById("abilityGuideDialog").close());
document.getElementById("abilityGuideDialog").addEventListener("close", () => { updateGamePauseState(); gameAudio.play("close"); document.activeElement?.blur(); });
