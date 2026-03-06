// -----------------------------
// PWA service worker
// -----------------------------
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js")
            .then(() => console.log("Service Worker registered"))
            .catch(err => console.log("Service Worker failed:", err));
    });
}

// =============================
// Pomodoro + Tasks + Settings + Theme + Habit Tracker + Calendar
// =============================

// --- Default Settings ---
const DEFAULTS = { focus: 25, shortBreak: 5, longBreak: 15 };

// --- Editable Settings (minutes) ---
let settings = { ...DEFAULTS };

// --- Theme State ---
let theme = "dark"; // "light" | "dark"

// --- Pomodoro State ---
let currentMode = "focus"; // "focus" | "shortBreak" | "longBreak"
let focusSessionsCompleted = 0;
let timeLeft = settings.focus * 60;
let totalTimeForCurrentMode = settings.focus * 60;
let timerInterval = null;
let isRunning = false;

// --- Task State (date-based) ---
let selectedDateKey = null; // "YYYY-MM-DD"
let datedTasks = {}; // { "YYYY-MM-DD": [{ id, text, done, type: "task"|"event" }] }

// --- Habit Tracker State ---
let habitData = {
    lastStudyDate: null, // "YYYY-MM-DD"
    streak: 0,
    daily: {} // { "YYYY-MM-DD": { sessions: 0, minutes: 0 } }
};

// --- Calendar State ---
let calViewDate = new Date(); // current month being shown

// =============================
// DOM Elements
// =============================

// Timer
const timerEl = document.getElementById("timer");
const modeLabelEl = document.getElementById("modeLabel");
const sessionCountEl = document.getElementById("sessionCount");
const statusTextEl = document.getElementById("statusText");
const progressFillEl = document.getElementById("progressFill");
const tomatoesDisplayEl = document.getElementById("tomatoesDisplay");

const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");

const focusModeBtn = document.getElementById("focusModeBtn");
const shortBreakBtn = document.getElementById("shortBreakBtn");
const longBreakBtn = document.getElementById("longBreakBtn");

// Tasks
const taskInputEl = document.getElementById("taskInput");
const addTaskBtnEl = document.getElementById("addTaskBtn");
const taskListEl = document.getElementById("taskList");
const taskCountBadgeEl = document.getElementById("taskCountBadge");

// Settings
const focusInputEl = document.getElementById("focusInput");
const shortInputEl = document.getElementById("shortInput");
const longInputEl = document.getElementById("longInput");
const applySettingsBtnEl = document.getElementById("applySettingsBtn");
const resetDefaultsBtnEl = document.getElementById("resetDefaultsBtn");

// Theme
const themeToggleBtnEl = document.getElementById("themeToggleBtn");

// Habit Tracker
const habitTodaySessionsEl = document.getElementById("habitTodaySessions");
const habitTodayMinutesEl = document.getElementById("habitTodayMinutes");
const habitStreakEl = document.getElementById("habitStreak");
const resetHabitBtnEl = document.getElementById("resetHabitBtn");

// Calendar
const calPrevBtnEl = document.getElementById("calPrevBtn");
const calNextBtnEl = document.getElementById("calNextBtn");
const calMonthLabelEl = document.getElementById("calMonthLabel");
const calendarTitleMonthEl = document.getElementById("calendarTitleMonth");
const calGridEl = document.getElementById("calGrid");
const calInfoEl = document.getElementById("calInfo");

// Calendar event/deadline UI (linked to tasks)
const selectedDateLabelEl = document.getElementById("selectedDateLabel");
const calEventInputEl = document.getElementById("calEventInput");
const addCalEventBtnEl = document.getElementById("addCalEventBtn");
const calEventListEl = document.getElementById("calEventList");

// Spotify (embed + open-on-start)
const spotifyWrapEl = document.getElementById("spotifyWrap");
const spotifyPlayerEl = document.getElementById("spotifyPlayer");

const SPOTIFY_TRACK_URI = "spotify:track:04boE4u1AupbrGlI62WvoO";
const SPOTIFY_TRACK_ID = "04boE4u1AupbrGlI62WvoO";
const SPOTIFY_OPEN_URL = `https://open.spotify.com/track/${SPOTIFY_TRACK_ID}`;
const SPOTIFY_EMBED_BASE = `https://open.spotify.com/embed/track/${SPOTIFY_TRACK_ID}?utm_source=generator`;

let spotifyOpenedThisFocusStart = false;

// =============================
// Utility Helpers
// =============================

function spotifyThemeParam() {
    // Spotify embed: theme=0 is dark, theme=1 is light
    return theme === "dark" ? "0" : "1";
}

function syncSpotifyEmbedTheme() {
    if (!spotifyPlayerEl) return;
    spotifyPlayerEl.src = `${SPOTIFY_EMBED_BASE}&theme=${spotifyThemeParam()}`;
}

function showSpotifyPlayer() {
    if (!spotifyWrapEl) return;
    spotifyWrapEl.hidden = false;
}

function isFreshFocusStart() {
    return currentMode === "focus" && timeLeft === totalTimeForCurrentMode;
}

function handleSpotifyOnStartClick() {
    // Only show at the start of a focus session (not break / not resume mid-session)
    if (currentMode !== "focus") return;

    showSpotifyPlayer();
    syncSpotifyEmbedTheme();

    // No new tab opening
    // Autoplay is typically blocked in iframes, so user may need to press play.
}

function pad2(n) {
    return String(n).padStart(2, "0");
}

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function makeId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// =============================
// Date Helpers
// =============================
function getTodayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function getTodayKeyLocal() {
    return getTodayKey();
}

function getYesterdayKey() {
    const now = new Date();
    now.setDate(now.getDate() - 1);
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function dateKeyFromParts(y, mIndex0, day) {
    return `${y}-${pad2(mIndex0 + 1)}-${pad2(day)}`;
}

function formatPrettyDateFromKey(key) {
    if (!key) return "No date selected";
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

// =============================
// Timer Helpers
// =============================
function getModeDuration(mode) {
    if (mode === "focus") return settings.focus * 60;
    if (mode === "shortBreak") return settings.shortBreak * 60;
    return settings.longBreak * 60;
}

function getModeLabel(mode) {
    if (mode === "focus") return "Focus Time 📚";
    if (mode === "shortBreak") return "Short Break ☕";
    return "Long Break 🌿";
}

function getStatusText() {
    if (isRunning) {
        if (currentMode === "focus") return "You got this! Stay focused 💪";
        if (currentMode === "shortBreak") return "Small break time — relax a bit ☕";
        return "Long break time — recharge your brain 🌿";
    }

    if (timeLeft === totalTimeForCurrentMode) {
        return currentMode === "focus"
            ? "Ready to focus? Press Start!"
            : "Ready for your break? Press Start!";
    }

    return "Paused. Take your time 💫";
}

function updateTomatoesDisplay() {
    if (!tomatoesDisplayEl) return;

    const cycleCount = focusSessionsCompleted % 4;
    if (cycleCount === 0 && focusSessionsCompleted > 0) {
        tomatoesDisplayEl.textContent = "🍅🍅🍅🍅";
    } else if (cycleCount === 0) {
        tomatoesDisplayEl.textContent = "🍅";
    } else {
        tomatoesDisplayEl.textContent = "🍅".repeat(cycleCount);
    }
}

function updateProgressBar() {
    if (!progressFillEl) return;

    const elapsed = totalTimeForCurrentMode - timeLeft;
    const percent = (elapsed / totalTimeForCurrentMode) * 100;
    progressFillEl.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function updateDisplay() {
    if (timerEl) timerEl.textContent = formatTime(timeLeft);
    if (modeLabelEl) modeLabelEl.textContent = getModeLabel(currentMode);
    if (sessionCountEl) {
        sessionCountEl.textContent = `Focus sessions completed: ${focusSessionsCompleted}`;
    }
    if (statusTextEl) statusTextEl.textContent = getStatusText();

    updateProgressBar();
    updateTomatoesDisplay();

    document.title = `${formatTime(timeLeft)} • Pomodoro`;
}

function stopTimer() {
    isRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
    updateDisplay();
}

function startTimer() {
    if (isRunning) return;

    // Spotify trigger (uses the Start button click = user gesture)
    handleSpotifyOnStartClick();

    isRunning = true;
    updateDisplay();
    timerInterval = setInterval(tick, 1000);
}

function updateStartPauseButton() {
    updateTimerButtons();
}

function updateTimerButtons() {
    if (!startBtn || !resetBtn) return;

    if (isRunning) {
        startBtn.textContent = "⏸ Pause";
        startBtn.classList.remove("start");
        startBtn.classList.add("pause");
        resetBtn.classList.remove("hidden");
    } else {
        startBtn.textContent = "▶ Start";
        startBtn.classList.add("start");
        startBtn.classList.remove("pause");

        if (timeLeft !== totalTimeForCurrentMode) {
            resetBtn.classList.remove("hidden");
        } else {
            resetBtn.classList.add("hidden");
        }
    }
}

function toggleTimer() {
    if (isRunning) {
        stopTimer();
    } else {
        startTimer();
    }
    updateTimerButtons();
}

function resetTimer() {
    spotifyOpenedThisFocusStart = false;
    stopTimer();
    timeLeft = getModeDuration(currentMode);
    totalTimeForCurrentMode = timeLeft;
    updateDisplay();
    updateTimerButtons();
}

function setMode(mode) {
    spotifyOpenedThisFocusStart = false;
    stopTimer();
    currentMode = mode;
    timeLeft = getModeDuration(mode);
    totalTimeForCurrentMode = timeLeft;
    updateDisplay();
    updateTimerButtons();
}

function playBeep() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(784, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.22);
    } catch (_) {
        // ignore audio errors
    }
}

function tick() {
    if (timeLeft > 0) {
        timeLeft--;
        updateDisplay();
    } else {
        playBeep();
        nextModeAfterFinish();
    }
    updateStartPauseButton();
}

function nextModeAfterFinish() {
    spotifyOpenedThisFocusStart = false;

    if (currentMode === "focus") {
        focusSessionsCompleted++;
        recordCompletedFocusSession();
        recordFocusSession(settings.focus);
        currentMode = (focusSessionsCompleted % 4 === 0) ? "longBreak" : "shortBreak";
    } else {
        currentMode = "focus";
    }

    timeLeft = getModeDuration(currentMode);
    totalTimeForCurrentMode = timeLeft;
    updateDisplay();
    updateTimerButtons();
}
// =============================
// Settings
// =============================
function applySettings() {
    stopTimer();

    const focusVal = clamp(parseInt(focusInputEl?.value || "25", 10), 1, 180);
    const shortVal = clamp(parseInt(shortInputEl?.value || "5", 10), 1, 60);
    const longVal = clamp(parseInt(longInputEl?.value || "15", 10), 1, 120);

    if (focusInputEl) focusInputEl.value = focusVal;
    if (shortInputEl) shortInputEl.value = shortVal;
    if (longInputEl) longInputEl.value = longVal;

    settings.focus = focusVal;
    settings.shortBreak = shortVal;
    settings.longBreak = longVal;

    // Reset current mode duration to use new settings
    timeLeft = getModeDuration(currentMode);
    totalTimeForCurrentMode = timeLeft;

    updateDisplay();
}

function resetDefaults() {
    stopTimer();

    settings = { ...DEFAULTS };

    if (focusInputEl) focusInputEl.value = settings.focus;
    if (shortInputEl) shortInputEl.value = settings.shortBreak;
    if (longInputEl) longInputEl.value = settings.longBreak;

    timeLeft = getModeDuration(currentMode);
    totalTimeForCurrentMode = timeLeft;

    updateDisplay();
}

// =============================
// Theme
// =============================

function saveTheme() {
    localStorage.setItem("pomodoroTheme", theme);
}

function loadTheme() {
    const saved = localStorage.getItem("pomodoroTheme");
    if (saved === "dark" || saved === "light") theme = saved;
}

function applyTheme() {
    if (theme === "dark") {
        document.documentElement.classList.add("dark");
        document.body.classList.add("dark");
        if (themeToggleBtnEl) themeToggleBtnEl.textContent = "☀️ Light Mode";
    } else {
        document.documentElement.classList.remove("dark");
        document.body.classList.remove("dark");
        if (themeToggleBtnEl) themeToggleBtnEl.textContent = "🌙 Dark Mode";
    }

    syncSpotifyEmbedTheme();
}
function toggleTheme() {
    theme = theme === "light" ? "dark" : "light";
    applyTheme();
    saveTheme();
}
// =============================
// Date-based Tasks (with localStorage)
// =============================
function saveDatedTasks() {
    localStorage.setItem("pomodoroDatedTasks", JSON.stringify(datedTasks));
}

function loadDatedTasks() {
    const saved = localStorage.getItem("pomodoroDatedTasks");
    if (!saved) return;

    try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
            datedTasks = parsed;
        }
    } catch (error) {
        console.log("Failed to load dated tasks:", error);
    }
}

function ensureDateTasks(key) {
    if (!key) return;
    if (!datedTasks[key]) datedTasks[key] = [];
}

function getTasksForDate(key) {
    if (!key) return [];
    ensureDateTasks(key);
    return datedTasks[key];
}

function getTasksForSelectedDate() {
    return getTasksForDate(selectedDateKey);
}

// Backward-compatible wrappers (existing save/load calls still work)
function saveTasks() {
    saveDatedTasks();
}

function loadTasks() {
    // New format
    loadDatedTasks();

    // Optional migration from old flat "pomodoroTasks"
    // (only if new storage is empty)
    const hasNewData = Object.keys(datedTasks).length > 0;
    if (hasNewData) return;

    const oldSaved = localStorage.getItem("pomodoroTasks");
    if (!oldSaved) return;

    try {
        const parsed = JSON.parse(oldSaved);
        if (Array.isArray(parsed) && parsed.length > 0) {
            const todayKey = getTodayKeyLocal();
            ensureDateTasks(todayKey);
            datedTasks[todayKey] = parsed.map((t) => ({
                id: makeId(),
                text: t.text || "",
                done: !!t.done,
                type: "task"
            }));
            saveDatedTasks();
        }
    } catch (e) {
        console.log("Old task migration failed:", e);
    }
}

function updateTaskCountBadge() {
    if (!taskCountBadgeEl) return;

    const list = getTasksForSelectedDate();
    const total = list.length;
    const done = list.filter((t) => t.done).length;
    taskCountBadgeEl.textContent = `${done} / ${total} done`;
}

function sortTasksForDate(key) {
    if (!key || !datedTasks[key]) return;

    datedTasks[key].sort((a, b) => {
        // false (not done) first, true (done) last
        if (!!a.done === !!b.done) return 0;
        return a.done ? 1 : -1;
    });
}

function renderTasks() {
    if (!taskListEl) return;

    const list = getTasksForSelectedDate();
    sortTasksForDate(selectedDateKey);
    taskListEl.innerHTML = "";

    if (!selectedDateKey) {
        const empty = document.createElement("div");
        empty.className = "task-empty";
        empty.textContent = "Select a calendar date first 📅";
        taskListEl.appendChild(empty);
        updateTaskCountBadge();
        return;
    }

    if (list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "task-empty";
        empty.textContent = "No tasks/deadlines for this date";
        taskListEl.appendChild(empty);
        updateTaskCountBadge();
        return;
    }

    list.forEach((task, index) => {
        const item = document.createElement("div");
        item.className = `task-item ${task.done ? "done" : ""}`;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "task-check";
        checkbox.checked = !!task.done;
        checkbox.addEventListener("change", () => {
            list[index].done = !list[index].done;

            if (list[index].done) {
                recordCompletedTaskToday(1);
            } else {
                recordCompletedTaskToday(-1);
            }

            saveTasks();
            renderTasks();
            renderCalendarEventList();
            renderCalendar();
            updateCalendarInfoForSelectedDate();
        });

        const text = document.createElement("div");
        text.className = "task-text";
        text.textContent = task.type === "event" ? `📅 ${task.text}` : task.text;

        const del = document.createElement("button");
        del.className = "task-delete";
        del.textContent = "🗑";
        del.title = "Delete task";
        del.addEventListener("click", () => {
            list.splice(index, 1);
            saveTasks();
            renderTasks();
            renderCalendarEventList();
            renderCalendar();
            updateCalendarInfoForSelectedDate();
        });

        item.appendChild(checkbox);
        item.appendChild(text);
        item.appendChild(del);

        taskListEl.appendChild(item);
    });

    updateTaskCountBadge();
}

function addTask() {
    if (!taskInputEl) return;

    if (!selectedDateKey) {
        selectedDateKey = getTodayKeyLocal();
    }

    const text = taskInputEl.value.trim();
    if (!text) {
        taskInputEl.focus();
        return;
    }

    ensureDateTasks(selectedDateKey);
    datedTasks[selectedDateKey].push({
        id: makeId(),
        text,
        done: false,
        type: "task"
    });

    saveTasks();

    taskInputEl.value = "";
    renderTasks();
    renderCalendar();
    updateCalendarInfoForSelectedDate();
    taskInputEl.focus();
}

// =============================
// Habit Tracker (with localStorage)
// =============================
function saveHabitData() {
    localStorage.setItem("pomodoroHabitData", JSON.stringify(habitData));
}

function loadHabitData() {
    const saved = localStorage.getItem("pomodoroHabitData");
    if (!saved) return;

    try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
            habitData = {
                lastStudyDate: parsed.lastStudyDate || null,
                streak: Number(parsed.streak) || 0,
                daily: parsed.daily && typeof parsed.daily === "object" ? parsed.daily : {}
            };
        }
    } catch (error) {
        console.log("Failed to load habit data:", error);
    }
}

function ensureTodayHabitEntry() {
    const todayKey = getTodayKey();
    if (!habitData.daily[todayKey]) {
        habitData.daily[todayKey] = { sessions: 0, minutes: 0 };
    }
}



function updateHabitUI() {
    if (!habitTodaySessionsEl || !habitTodayMinutesEl || !habitStreakEl) return;

    ensureTodayHabitEntry();
    const todayKey = getTodayKey();
    const todayData = habitData.daily[todayKey];

    habitTodaySessionsEl.textContent = `${todayData.sessions} 🍅`;
    habitTodayMinutesEl.textContent = `${todayData.minutes} min`;
    habitStreakEl.textContent = `${habitData.streak} 🔥`;
}

function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getWeekDates() {
    const dates = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        dates.push(getLocalDateString(d));
    }

    return dates;
}

function getDashboardData() {
    return JSON.parse(localStorage.getItem("pomodoroDashboard")) || {
        sessionsByDate: {},
        studyMinutesByDate: {},
        completedTasksByDate: {}
    };
}

function saveDashboardData(data) {
    localStorage.setItem("pomodoroDashboard", JSON.stringify(data));
}

function recordFocusSession(minutes) {
    const data = getDashboardData();
    const today = getLocalDateString();

    data.sessionsByDate[today] = (data.sessionsByDate[today] || 0) + 1;
    data.studyMinutesByDate[today] = (data.studyMinutesByDate[today] || 0) + minutes;

    saveDashboardData(data);
}

function recordCompletedTaskToday(change = 1) {
    const data = getDashboardData();
    const today = getLocalDateString();

    data.completedTasksByDate[today] = (data.completedTasksByDate[today] || 0) + change;

    if (data.completedTasksByDate[today] < 0) {
        data.completedTasksByDate[today] = 0;
    }

    saveDashboardData(data);
}

function recordCompletedFocusSession() {
    const todayKey = getTodayKey();
    const yesterdayKey = getYesterdayKey();

    ensureTodayHabitEntry();

    // Add today's stats using current focus duration setting
    habitData.daily[todayKey].sessions += 1;
    habitData.daily[todayKey].minutes += settings.focus;

    // Update streak once per day
    if (habitData.lastStudyDate !== todayKey) {
        if (habitData.lastStudyDate === yesterdayKey) {
            habitData.streak += 1;
        } else {
            habitData.streak = 1;
        }
        habitData.lastStudyDate = todayKey;
    }

    saveHabitData();
    updateHabitUI();
    renderCalendar(); // refresh calendar immediately
    updateCalendarInfoForSelectedDate();
}

function resetHabitData() {
    habitData = {
        lastStudyDate: null,
        streak: 0,
        daily: {}
    };
    saveHabitData();
    updateHabitUI();
    renderCalendar();
    updateCalendarInfoForSelectedDate();
}

// =============================
// Calendar-linked Events (stored in datedTasks as type="event")
// =============================
function updateSelectedDateLabel() {
    if (!selectedDateLabelEl) return;
    selectedDateLabelEl.textContent = selectedDateKey
        ? `Selected: ${formatPrettyDateFromKey(selectedDateKey)}`
        : "No date selected";
}

function updateCalendarInfoForSelectedDate() {
    if (!calInfoEl) return;

    if (!selectedDateKey) {
        calInfoEl.textContent = "Click a day to see your study stats and deadlines.";
        return;
    }

    const dayData = habitData?.daily?.[selectedDateKey];
    const allItems = getTasksForDate(selectedDateKey);
    const events = allItems.filter((x) => x.type === "event");
    const pendingEvents = events.filter((x) => !x.done).length;

    if (!dayData) {
        calInfoEl.innerHTML = `📅 <b>${selectedDateKey}</b>: No study recorded • <b>${pendingEvents}</b> pending deadline(s) (${events.length} total).`;
    } else {
        calInfoEl.innerHTML = `📅 <b>${selectedDateKey}</b>: <b>${dayData.sessions}</b> focus session(s), <b>${dayData.minutes}</b> minute(s) • <b>${pendingEvents}</b> pending deadline(s) (${events.length} total).`;
    }
}

function renderCalendarEventList() {
    if (!calEventListEl) return;

    calEventListEl.innerHTML = "";

    if (!selectedDateKey) {
        const empty = document.createElement("div");
        empty.className = "task-empty";
        empty.textContent = "Select a date first 📅";
        calEventListEl.appendChild(empty);
        return;
    }

    sortTasksForDate(selectedDateKey);
    const list = getTasksForSelectedDate().filter((t) => t.type === "event");

    if (list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "task-empty";
        empty.textContent = "No deadlines/events for this day";
        calEventListEl.appendChild(empty);
        return;
    }

    list.forEach((ev) => {
        const row = document.createElement("div");
        row.className = `task-item ${ev.done ? "done" : ""}`;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "task-check";
        checkbox.checked = !!ev.done;
        checkbox.addEventListener("change", () => {
            ev.done = !ev.done;

            if (ev.done) {
                recordCompletedTaskToday(1);
            } else {
                recordCompletedTaskToday(-1);
            }

            saveTasks();
            renderCalendarEventList();
            renderTasks();
            renderCalendar();
            updateCalendarInfoForSelectedDate();
        });

        const text = document.createElement("div");
        text.className = "task-text";
        text.textContent = ev.text;

        const del = document.createElement("button");
        del.className = "task-delete";
        del.textContent = "🗑";
        del.title = "Delete event";
        del.addEventListener("click", () => {
            const all = getTasksForSelectedDate();
            const indexInAll = all.findIndex((x) => x.id === ev.id);
            if (indexInAll >= 0) {
                all.splice(indexInAll, 1);
            }
            saveTasks();
            renderCalendarEventList();
            renderTasks();
            renderCalendar();
            updateCalendarInfoForSelectedDate();
        });

        row.appendChild(checkbox);
        row.appendChild(text);
        row.appendChild(del);
        calEventListEl.appendChild(row);
    });
}

function addCalendarEventAsTask() {
    if (!calEventInputEl) return;

    if (!selectedDateKey) {
        selectedDateKey = getTodayKeyLocal();
    }

    const text = calEventInputEl.value.trim();
    if (!text) {
        calEventInputEl.focus();
        return;
    }

    ensureDateTasks(selectedDateKey);
    datedTasks[selectedDateKey].push({
        id: makeId(),
        text,
        done: false,
        type: "event"
    });

    saveTasks();
    calEventInputEl.value = "";

    renderCalendarEventList();
    renderTasks(); // linked to tasks
    renderCalendar();
    updateCalendarInfoForSelectedDate();
    calEventInputEl.focus();
}

function selectCalendarDate(key) {
    selectedDateKey = key;

    // If selected date is in another month, keep month view as-is (normal UX)
    // But if you want auto-jump to selected month later, we can add it.

    updateSelectedDateLabel();
    renderTasks();
    renderCalendarEventList();
    renderCalendar();
    updateCalendarInfoForSelectedDate();
}

// =============================
// Calendar
// =============================
function renderCalendar() {
    if (!calGridEl || !calMonthLabelEl) return;

    const year = calViewDate.getFullYear();
    const month = calViewDate.getMonth(); // 0-11

    const monthName = calViewDate.toLocaleString(undefined, { month: "long" });
    calMonthLabelEl.textContent = `${monthName} ${year}`;

    if (calendarTitleMonthEl) {
        calendarTitleMonthEl.textContent = monthName;
    }

    calGridEl.innerHTML = "";

    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const todayKey = getTodayKeyLocal();

    // Leading blanks
    for (let i = 0; i < startWeekday; i++) {
        const blank = document.createElement("div");
        blank.className = "cal-day muted";
        blank.style.cursor = "default";
        blank.textContent = "";
        calGridEl.appendChild(blank);
    }

    // Days
    for (let day = 1; day <= daysInMonth; day++) {
        const key = dateKeyFromParts(year, month, day);
        const dayData = habitData?.daily?.[key];
        const dayItems = getTasksForDate(key);
        const dayEvents = dayItems.filter((x) => x.type === "event");
        const pendingEvents = dayEvents.filter((x) => !x.done).length;

        const cell = document.createElement("div");
        cell.className = "cal-day";
        cell.textContent = day;

        if (key === todayKey) cell.classList.add("today");
        if (key === selectedDateKey) cell.classList.add("selected");

        if (dayData && (dayData.sessions > 0 || dayData.minutes > 0)) {
            cell.classList.add("studied");
        }

        // Small event badge (requires optional CSS .cal-event-dot, but works without it too)
        if (dayEvents.length > 0) {
            const badge = document.createElement("span");
            badge.className = "cal-event-dot";
            badge.textContent = pendingEvents > 0 ? String(pendingEvents) : "✓";
            cell.appendChild(badge);
        }

        cell.addEventListener("click", () => {
            selectCalendarDate(key);
        });

        calGridEl.appendChild(cell);
    }

    // Keep selected-date info visible
    updateCalendarInfoForSelectedDate();
}

function calendarPrevMonth() {
    calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() - 1, 1);
    renderCalendar();
}

function calendarNextMonth() {
    calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() + 1, 1);
    renderCalendar();
}

// =============================
// Event Listeners
// =============================

// Timer
if (startBtn) startBtn.addEventListener("click", toggleTimer);
if (resetBtn) resetBtn.addEventListener("click", resetTimer);

// Quick mode buttons
if (focusModeBtn) focusModeBtn.addEventListener("click", () => setMode("focus"));
if (shortBreakBtn) shortBreakBtn.addEventListener("click", () => setMode("shortBreak"));
if (longBreakBtn) longBreakBtn.addEventListener("click", () => setMode("longBreak"));

// Tasks
if (addTaskBtnEl) addTaskBtnEl.addEventListener("click", addTask);
if (taskInputEl) {
    taskInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addTask();
    });
}

// Settings
if (applySettingsBtnEl) applySettingsBtnEl.addEventListener("click", applySettings);
if (resetDefaultsBtnEl) resetDefaultsBtnEl.addEventListener("click", resetDefaults);

// Theme
if (themeToggleBtnEl) themeToggleBtnEl.addEventListener("click", toggleTheme);

// Habit
if (resetHabitBtnEl) resetHabitBtnEl.addEventListener("click", resetHabitData);

// Calendar
if (calPrevBtnEl) calPrevBtnEl.addEventListener("click", calendarPrevMonth);
if (calNextBtnEl) calNextBtnEl.addEventListener("click", calendarNextMonth);

// Calendar events (linked to tasks)
if (addCalEventBtnEl) addCalEventBtnEl.addEventListener("click", addCalendarEventAsTask);
if (calEventInputEl) {
    calEventInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addCalendarEventAsTask();
    });
}

// Save data when app is hidden (better for PWA behavior)
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        saveTasks();
        saveHabitData();
    }
});

// Extra safety on close/reload
window.addEventListener("beforeunload", () => {
    saveTasks();
    saveHabitData();
});

// =============================
// Init
// =============================

// Sync inputs with defaults
if (focusInputEl) focusInputEl.value = settings.focus;
if (shortInputEl) shortInputEl.value = settings.shortBreak;
if (longInputEl) longInputEl.value = settings.longBreak;

// Initialize timer display
totalTimeForCurrentMode = getModeDuration(currentMode);
timeLeft = totalTimeForCurrentMode;

// Initial UI render
loadTheme();
applyTheme();
updateDisplay();
resetBtn?.classList.add("hidden");
updateTimerButtons();

// Load data
loadTasks();
loadHabitData();
updateHabitUI();

// Default selected date = today
selectedDateKey = getTodayKeyLocal();

// Make calendar open on current month (today)
calViewDate = new Date();

// Render linked UI
updateSelectedDateLabel();
renderTasks();
renderCalendarEventList();
renderCalendar();