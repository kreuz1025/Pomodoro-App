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

function calculateStreak(studyMinutesByDate) {
    let streak = 0;
    const today = new Date();

    for (let i = 0; i < 365; i++) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        const dateStr = getLocalDateString(d);

        if ((studyMinutesByDate[dateStr] || 0) > 0) {
            streak++;
        } else {
            break;
        }
    }

    return streak;
}

let theme = "dark";
let themeToggleBtnEl = null;

function loadTheme() {
    const saved = localStorage.getItem("pomodoroTheme");
    if (saved === "dark" || saved === "light") {
        theme = saved;
    }
}

function applyTheme() {
    if (theme === "dark") {
        document.documentElement.classList.add("dark");
        document.body.classList.add("dark");
        if (themeToggleBtnEl) {
            themeToggleBtnEl.textContent = "☀️ Light Mode";
        }
    } else {
        document.documentElement.classList.remove("dark");
        document.body.classList.remove("dark");
        if (themeToggleBtnEl) {
            themeToggleBtnEl.textContent = "🌙 Dark Mode";
        }
    }
}

function saveTheme() {
    localStorage.setItem("pomodoroTheme", theme);
}

function toggleTheme() {
    theme = theme === "light" ? "dark" : "light";
    applyTheme();
    saveTheme();
}

function updateDashboardUI() {
    const data = getDashboardData();
    const today = getLocalDateString();
    const weekDates = getWeekDates();

    const focusSessionsToday = data.sessionsByDate[today] || 0;
    const studyTimeToday = data.studyMinutesByDate[today] || 0;
    const completedTasksToday = data.completedTasksByDate[today] || 0;
    const currentStreak = calculateStreak(data.studyMinutesByDate);

    let studyTimeWeek = 0;
    weekDates.forEach(date => {
        studyTimeWeek += data.studyMinutesByDate[date] || 0;
    });

    document.getElementById("focusSessionsToday").textContent = focusSessionsToday;
    document.getElementById("studyTimeToday").textContent = `${studyTimeToday} min`;
    document.getElementById("completedTasksToday").textContent = completedTasksToday;
    document.getElementById("currentStreak").textContent = `${currentStreak} day${currentStreak !== 1 ? "s" : ""}`;
    document.getElementById("studyTimeWeek").textContent = `${studyTimeWeek} min`;
}

document.addEventListener("DOMContentLoaded", () => {
    themeToggleBtnEl = document.getElementById("themeToggleBtn");

    loadTheme();
    applyTheme();
    updateDashboardUI();

    if (themeToggleBtnEl) {
        themeToggleBtnEl.addEventListener("click", toggleTheme);
    }
});