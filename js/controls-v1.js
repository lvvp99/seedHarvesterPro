const keyBindings = (() => {
    const defaults = { moveUp: "w", moveLeft: "a", moveDown: "s", moveRight: "d", teleport: "1",
        energyShield: "2", dash: "3", timeFreeze: "4", lure: "5", rakeFrenzy: "6",
        pause: " ", autoAim: "c", cancel: "escape" };
    const names = { moveUp: "Move up", moveLeft: "Move left", moveDown: "Move down", moveRight: "Move right",
        teleport: "Teleport", energyShield: "Energy Shield", dash: "Dash", timeFreeze: "Time Freeze",
        lure: "Lure", rakeFrenzy: "Rake Frenzy", pause: "Pause / resume", autoAim: "Auto aim / mouse aim", cancel: "Cancel readied ability" };
    const storageKey = "seedHarvester.keyBindings.v1";
    const valid = key => typeof key === "string" && (key.length === 1 || ["escape", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", "enter", "backspace", "delete", "home", "end", "pageup", "pagedown"].includes(key));
    let bindings = { ...defaults }, waitingFor = null;
    const buttons = {};
    const dialog = document.getElementById("keybindingsDialog");
    try {
        const stored = JSON.parse(window.localStorage.getItem(storageKey) || "null");
        if (stored && Object.keys(defaults).every(name => valid(stored[name]))
            && new Set(Object.values(defaults).map((_, i) => stored[Object.keys(defaults)[i]])).size === Object.keys(defaults).length) bindings = { ...stored };
    } catch { /* Default controls remain usable when storage is unavailable. */ }

    const normalize = event => event.code === "Space" ? " " : (event.key || "").toLowerCase();
    const label = action => ({ " ": "Space", escape: "Esc", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→" })[bindings[action]] || bindings[action]?.toUpperCase() || "";
    const actionFor = event => Object.keys(defaults).find(name => bindings[name] === normalize(event));
    const isOpen = () => dialog.open;
    function message(text) { document.getElementById("bindingMessage").textContent = text; }
    function persist() {
        try { window.localStorage.setItem(storageKey, JSON.stringify(bindings)); return true; }
        catch { message("Controls changed for this visit. Browser storage is unavailable."); return false; }
    }
    function refresh() {
        for (const [name, button] of Object.entries(buttons)) {
            button.textContent = waitingFor === name ? "Press a key…" : label(name);
            button.setAttribute("aria-label", "Change " + names[name] + ". Current key: " + label(name));
            button.classList.toggle("listening", waitingFor === name);
        }
        for (const element of document.querySelectorAll("[data-keybinding]")) element.textContent = label(element.dataset.keybinding);
        pauseBtn.textContent = (manuallyPaused ? "Resume" : "Pause") + " (" + label("pause") + ")";
        pauseBtn.title = "Pause or resume (" + label("pause") + ")";
        pauseBtn.setAttribute("aria-keyshortcuts", label("pause"));
        document.getElementById("pauseOverlay").textContent = "Paused · Press " + label("pause") + " to resume";
        autoTargetToggle.textContent = "Aim: " + (weaponState.automaticTarget ? "Auto" : "Mouse") + " (" + label("autoAim") + ")";
        autoTargetToggle.title = "Switch basic attack aim (" + label("autoAim") + ")";
        autoTargetToggle.setAttribute("aria-keyshortcuts", label("autoAim"));
        for (const name of Object.keys(abilityHud)) document.getElementById(name + "Key").textContent = label(name);
        updateAbilityHud();
    }
    function assign(action, key) {
        if (!Object.hasOwn(defaults, action) || !valid(key)) { message("Choose a letter, number, arrow or other single key. Tab and browser shortcuts are reserved."); return false; }
        const conflict = Object.keys(defaults).find(name => name !== action && bindings[name] === key);
        if (conflict) { message(label(conflict) + " is already used for " + names[conflict] + ". Choose another key."); return false; }
        bindings[action] = key; waitingFor = null;
        message(names[action] + " bound to " + label(action) + "."); persist(); refresh(); return true;
    }
    function open() {
        if (dialog.open || gameOver || isMysteryChoiceOpen() || isAbilityGuideOpen()) return;
        waitingFor = null; message("Select a control, then press its new key. Each key can have one action.");
        dialog.showModal(); updateGamePauseState(); refresh();
    }
    function close() { waitingFor = null; dialog.close(); }
    function init() {
        const list = document.getElementById("keybindingList");
        for (const [name, title] of Object.entries(names)) {
            const row = document.createElement("div"); row.className = "bindingRow";
            const text = document.createElement("span"); text.textContent = title;
            const button = document.createElement("button"); button.type = "button"; button.id = "bind-" + name;
            button.addEventListener("click", () => { waitingFor = name; message("Press a new key for " + title + "."); refresh(); });
            buttons[name] = button; row.appendChild(text); row.appendChild(button); list.appendChild(row);
        }
        document.getElementById("keybindingsBtn").addEventListener("click", open);
        document.getElementById("closeKeybindingsBtn").addEventListener("click", close);
        document.getElementById("cancelBindingBtn").addEventListener("click", () => { waitingFor = null; message("Key change cancelled."); refresh(); });
        document.getElementById("resetKeybindingsBtn").addEventListener("click", () => {
            bindings = { ...defaults }; waitingFor = null; message("All key bindings reset to defaults."); persist(); refresh();
        });
        dialog.addEventListener("close", () => { waitingFor = null; updateGamePauseState(); });
        dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
        window.addEventListener("keydown", event => {
            if (!dialog.open || !waitingFor) return;
            event.preventDefault();
            if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
            assign(waitingFor, normalize(event));
        }, true);
        refresh();
    }
    return { actionFor, label, isOpen, init, refresh };
})();
