// Local survival records: keep ten recent runs and an all-time best.
const survivalHistory = (() => {
    const storageKey = "seedHarvester.survivalHistory.v1";
    let storageAvailable = true;
    let currentRun = null;
    let lastSavedMs = 0;
    const validTime = value => Number.isSafeInteger(value) && value >= 0;

    function read() {
        try {
            const data = JSON.parse(window.localStorage.getItem(storageKey) || "null");
            if (!data || !Array.isArray(data.recent)) return { bestMs: 0, recent: [] };
            const recent = data.recent.filter(run => run && typeof run.id === "string"
                && validTime(run.elapsedMs) && Number.isFinite(Date.parse(run.startedAt)))
                .slice(0, 10).map(run => ({ id: run.id, startedAt: run.startedAt,
                    elapsedMs: run.elapsedMs, completed: run.completed === true }));
            return { bestMs: Math.max(validTime(data.bestMs) ? data.bestMs : 0, ...recent.map(run => run.elapsedMs)), recent };
        } catch { storageAvailable = false; return null; }
    }

    let records = read() || { bestMs: 0, recent: [] };

    function formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const parts = [Math.floor(seconds / 60) % 60, seconds % 60];
        if (seconds >= 3600) parts.unshift(Math.floor(seconds / 3600));
        return parts.map(part => String(part).padStart(2, "0")).join(":");
    }

    function render() {
        document.getElementById("bestSurvivalTime").textContent = records.recent.length || records.bestMs ? formatTime(records.bestMs) : "—";
        const list = document.getElementById("survivalHistoryList");
        list.textContent = "";
        document.getElementById("historyEmpty").hidden = records.recent.length > 0;
        document.getElementById("historyStorageNote").textContent = storageAvailable
            ? "Last 10 runs · Saved in this browser" : "Browser storage unavailable · Records last for this visit only";
        for (const run of records.recent) {
            const item = document.createElement("li");
            const date = document.createElement("span");
            date.textContent = new Date(run.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                + (run.completed ? "" : " · Left game");
            const time = document.createElement("strong");
            time.textContent = formatTime(run.elapsedMs);
            item.appendChild(date); item.appendChild(time); list.appendChild(item);
        }
    }

    function begin() {
        currentRun = { id: Date.now().toString(36) + Math.random().toString(36).slice(2), startedAt: new Date().toISOString() };
        lastSavedMs = 0;
    }

    function save(elapsedMs, completed = false) {
        if (!currentRun || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
        const duration = Math.floor(elapsedMs);
        if (!completed && duration === 0) return;
        const latest = read();
        if (latest) {
            const merged = new Map([...latest.recent, ...records.recent].map(run => [run.id, run]));
            records = { bestMs: Math.max(records.bestMs, latest.bestMs),
                recent: [...merged.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 10) };
        }
        const previous = records.recent.find(run => run.id === currentRun.id);
        records.recent = [{ ...currentRun, elapsedMs: Math.max(duration, previous?.elapsedMs || 0),
            completed: completed || previous?.completed === true }, ...records.recent.filter(run => run.id !== currentRun.id)].slice(0, 10);
        records.bestMs = Math.max(records.bestMs, duration);
        try { window.localStorage.setItem(storageKey, JSON.stringify(records)); storageAvailable = true; }
        catch { storageAvailable = false; }
        lastSavedMs = duration;
        if (completed) { currentRun = null; render(); }
    }

    function checkpoint(elapsedMs) {
        if (elapsedMs - lastSavedMs >= 5000) save(elapsedMs);
    }

    render();
    return { begin, save, checkpoint, formatTime };
})();
