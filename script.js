/********************************************************************************************
 * FinanceTrack — Deep‑Refactored Script.js  (Section 1/8)
 * Full Feature Parity + New Line Charts + Category Filters
 * Refactor Mode: A2 (Deep Refactor, Single‑File Architecture)
 *
 * This file maintains ALL original features from the uploaded script.js (turn9search1),
 * while reorganizing everything for clarity, maintainability, and performance.
 ********************************************************************************************/


/* ==========================================================================================
   CONFIGURATION
   ========================================================================================== */

const SHEET_ID  = "1bHv3ITXTmXkrSLgHUbD_CrzEWdgxfFBeJv9RYyjLBfc";     // same as original [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`; // [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)



/* ==========================================================================================
   STATE MANAGEMENT
   ========================================================================================== */

let ALL_TXNS            = [];   // all parsed transactions from Google Sheet [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
let ALL_YEARS           = [];   // unique years detected from dataset     [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
let SELECTED_YEAR       = "all";
let SELECTED_MONTH      = "all";

let YEAR_WINDOW_START   = 0;    // index of first visible year pill  [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
let PILLS_VISIBLE       = 5;    // number of year pills visible      [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)

let charts              = {};   // will store all Chart.js instances  [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
let autoRefreshInterval = null; // auto-refresh timer handle          [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)



/* ==========================================================================================
   UTILITY: DOM HELPERS
   ========================================================================================== */

const $ = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => document.querySelectorAll(sel);



// Toast Notifications (same behavior, cleaner implementation) [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
function showToast(message, type = "success") {
    const toast = $("toastMessage");
    if (!toast) return;

    toast.textContent = message;
    toast.className = `toast-message ${type}`;
    toast.classList.add("show");

    setTimeout(() => toast.classList.remove("show"), 3000);
}



/* ==========================================================================================
   UTILITY: SAFE JSON PARSING FOR GOOGLE GVIZ API
   ========================================================================================== */
// Google Visualization API wraps JSON inside JS function calls; this safely extracts it.  [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)

function getJSON(raw) {
    try {
        const start = raw.indexOf("{");
        const end   = raw.lastIndexOf("}") + 1;
        return JSON.parse(raw.substring(start, end));
    } catch (e) {
        console.error("GViz JSON parse error:", e);
        throw new Error("Failed to parse sheet data");
    }
}



/* ==========================================================================================
   UTILITY: DATE HELPERS
   ========================================================================================== */

// Handles Google "Date(YYYY,MM,DD)" format. 100% matching original implementation. [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
function parseGVizDate(v) {
    if (!v) return null;

    const m = String(v).match(/Date\((\d+),(\d+),(\d+)\)/);
    if (m) return new Date(+m[1], +m[2], +m[3]);

    const d = new Date(v);
    return isNaN(d) ? null : d;
}


// Month key: "YYYY-MM"  (same logic, extracted for readability) [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}


// Turns "2024-04" → "Apr"  (month-only label)  [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
function monthLabel(k) {
    const [y, m] = k.split("-");
    return new Date(+y, +m - 1).toLocaleString("default", { month: "short" });
}


// Pretty full date (same spec as original) [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
function fmtDate(d) {
    if (!d) return "—";
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}



/* ==========================================================================================
   UTILITY: NUMBER FORMATTERS
   ========================================================================================== */

// "$3,000" or "$3,000.24" (same as original fmtMoney)  [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
function fmtMoney(n, decimals = 0) {
    const abs = Math.abs(n);
    const formatted = abs.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
    return (n < 0 ? "-" : "") + "$" + formatted;
}


// Short format: "$3k", "$2.4M", etc. (matches original fmtShort) [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
function fmtShort(n) {
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";

    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1000)     return `${sign}$${(abs / 1000).toFixed(1)}k`;
    return `${sign}$${Math.round(abs)}`;
}


// Capitalizes strings ("income" → "Income")  [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);



/* ==========================================================================================
   UTILITY: CHART MANAGEMENT
   ========================================================================================== */

// Destroy & remove chart by ID (same behavior, cleaner version)  [1](https://ingov-my.sharepoint.com/personal/dlamichhane_indot_in_gov/Documents/Microsoft%20Copilot%20Chat%20Files/script.js)
function destroyChart(id) {
    if (charts[id]) {
        charts[id].destroy();
        delete charts[id];
    }
}
/********************************************************************************************
 * SECTION 2 — DATA PARSING & TRANSFORMATION
 * Cleaned + more reliable versions of:
 * - parseRows()
 * - computeStats()
 * - getFilteredTxns()
 ********************************************************************************************/


/* ==========================================================================================
   PARSE RAW GOOGLE SHEET ROWS → UNIFIED TRANSACTION OBJECTS
   ========================================================================================== */

function parseRows(rows) {
    if (!rows || rows.length === 0) return [];

    // Identify header row
    let header = null;
    let startIndex = 0;

    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const c = rows[i]?.c;
        if (c && c[0] && c[0].v === "Timestamp") {
            header = c;
            startIndex = i + 1;
            break;
        }
    }

    // Column index mapping
    const colIndex = {
        timestamp: -1,
        type: -1,
        date: -1,
        amount: -1,
        category: -1,
        payment: -1
    };

    // If header exists → map columns
    if (header) {
        header.forEach((cell, i) => {
            if (!cell || !cell.v) return;
            const v = cell.v.toString().toLowerCase();
            if (v.includes("timestamp")) colIndex.timestamp = i;
            else if (v.includes("type")) colIndex.type = i;
            else if (v.includes("date")) colIndex.date = i;
            else if (v.includes("amount")) colIndex.amount = i;
            else if (v.includes("category")) colIndex.category = i;
            else if (v.includes("payment")) colIndex.payment = i;
        });

        // fallback defaults
        if (colIndex.type === -1) colIndex.type = 1;
        if (colIndex.date === -1) colIndex.date = 2;
        if (colIndex.amount === -1) colIndex.amount = 3;
    }

    // Parse rows
    const parsed = rows.slice(startIndex).map(r => {
        const c = r.c;
        if (!c) return null;

        const type = (c[colIndex.type]?.v || "").toString().trim().toLowerCase();
        const date = parseGVizDate(c[colIndex.date]?.v);
        const amt  = Number(c[colIndex.amount]?.v);
        const cat  = (colIndex.category >= 0 && c[colIndex.category]?.v) 
                        ? c[colIndex.category].v.toString().trim()
                        : cap(type);
        const pay  = (colIndex.payment >= 0 && c[colIndex.payment]?.v)
                        ? c[colIndex.payment].v.toString().trim()
                        : "Unknown";

        if (!type || !date || isNaN(amt) || amt <= 0) return null;

        return {
            type,
            date,
            amt,
            category: cat,
            payment: pay,
            year: date.getFullYear()
        };
    })
    .filter(Boolean)
    .sort((a, b) => b.date - a.date);

    return parsed;
}



/* ==========================================================================================
   COMPUTE DASHBOARD STATISTICS
   ========================================================================================== */

function computeStats(txns) {
    let totalIncome = 0;
    let totalExpense = 0;
    let totalInvestment = 0;
    let totalLoan = 0;

    const monthMap = {};
    const categoryTotals = {};
    const paymentTotals = {};
    const balanceDelta = {};

    txns.forEach(t => {
        const mk = monthKey(t.date);
        if (!monthMap[mk]) {
            monthMap[mk] = { income: 0, expense: 0, investment: 0, loan: 0 };
        }
        if (!balanceDelta[mk]) balanceDelta[mk] = 0;

        if (t.type === "income") {
            totalIncome += t.amt;
            monthMap[mk].income += t.amt;
            balanceDelta[mk] += t.amt;
        }
        else if (t.type === "expense") {
            totalExpense += t.amt;
            monthMap[mk].expense += t.amt;
            balanceDelta[mk] -= t.amt;

            categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amt;
            paymentTotals[t.payment]  = (paymentTotals[t.payment]  || 0) + t.amt;
        }
        else if (t.type === "investment") {
            totalInvestment += t.amt;
            monthMap[mk].investment += t.amt;
            balanceDelta[mk] -= t.amt;
        }
        else if (t.type === "loan") {
            totalLoan += t.amt;
            monthMap[mk].loan += t.amt;
        }
    });

    const months = Object.keys(monthMap).sort();

    let running = 0;
    const runningBalance = months.map(m => {
        running += balanceDelta[m];
        return running;
    });

    const net = totalIncome - totalExpense - totalInvestment;
    const savingsRate = totalIncome > 0
        ? ((totalIncome - totalExpense) / totalIncome) * 100
        : 0;

    // Identify top category
    const topCat = Object.entries(categoryTotals)
        .sort((a, b) => b[1] - a[1])[0] || null;

    return {
        income: totalIncome,
        expense: totalExpense,
        investment: totalInvestment,
        loan: totalLoan,
        netBalance: net,
        savingsRate,
        months,
        monthMap,
        runningBalance,
        catMap: categoryTotals,
        payMap: paymentTotals,
        topCat,
        count: txns.length
    };
}



/* ==========================================================================================
   FILTERED TRANSACTIONS (year + month)
   ========================================================================================== */

function getFilteredTxns() {
    let tx = SELECTED_YEAR === "all"
        ? ALL_TXNS
        : ALL_TXNS.filter(t => t.year === SELECTED_YEAR);

    if (SELECTED_MONTH !== "all") {
        tx = tx.filter(t => monthKey(t.date) === SELECTED_MONTH);
    }

    return tx;
}
/********************************************************************************************
 * SECTION 3 — FILTERING LOGIC (YEAR, MONTH, CATEGORY)
 * This section includes:
 *  - Year navigation
 *  - Month dropdown
 *  - Category dropdowns for Expense & Income (full-width bars, D2)
 ********************************************************************************************/


/* ==========================================================================================
   YEAR NAVIGATION (Year Pills)
   ========================================================================================== */

function buildYearNav() {
    const pills = $("yearPills");
    const prev  = $("yearPrev");
    const next  = $("yearNext");

    if (!pills) return;

    // Enable/disable arrows
    if (prev) prev.disabled = YEAR_WINDOW_START === 0;
    if (next) next.disabled = YEAR_WINDOW_START + PILLS_VISIBLE >= ALL_YEARS.length;

    const visibleYears = ALL_YEARS.slice(
        YEAR_WINDOW_START,
        YEAR_WINDOW_START + PILLS_VISIBLE
    );

    pills.innerHTML = "";

    // "All" pill
    const allBtn = document.createElement("button");
    allBtn.textContent = "All";
    allBtn.className = "year-pill all-pill" + (SELECTED_YEAR === "all" ? " active" : "");
    allBtn.onclick = () => selectYear("all");
    pills.appendChild(allBtn);

    // Year pills
    visibleYears.forEach(y => {
        const btn = document.createElement("button");
        btn.textContent = y;
        btn.className = "year-pill" + (SELECTED_YEAR === y ? " active" : "");
        btn.onclick = () => selectYear(y);
        pills.appendChild(btn);
    });
}


// Called from year buttons
function selectYear(year) {
    SELECTED_YEAR = year;
    SELECTED_MONTH = "all";

    const monthFilter = $("monthFilter");
    if (monthFilter) monthFilter.value = "all";

    renderDashboard();
    showToast(`Showing ${year === "all" ? "all years" : year}`, "success");
}


// Scroll years left/right
window.shiftYear = function (dir) {
    const maxStart = Math.max(0, ALL_YEARS.length - PILLS_VISIBLE);

    YEAR_WINDOW_START = Math.min(
        maxStart,
        Math.max(0, YEAR_WINDOW_START + dir)
    );

    buildYearNav();
};



/* ==========================================================================================
   MONTH FILTER DROPDOWN
   ========================================================================================== */

function populateMonthFilter() {
    const monthSelect = $("monthFilter");
    if (!monthSelect) return;

    // Determine which txns to read months from
    const txns = SELECTED_YEAR === "all"
        ? ALL_TXNS
        : ALL_TXNS.filter(t => t.year === SELECTED_YEAR);

    const months = [...new Set(txns.map(t => monthKey(t.date)))].sort();

    // Reset
    monthSelect.innerHTML = `<option value="all">📅 All Months</option>`;

    // Current month auto-select logic
    const now = new Date();
    const keyNow = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    months.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = `${monthLabel(m)} ${m.split("-")[0]}`;

        if (m === keyNow) {
            opt.selected = true;
            SELECTED_MONTH = m;
        }

        monthSelect.appendChild(opt);
    });

    // If no month auto-selected, choose latest
    if (SELECTED_MONTH === "all" && months.length > 0) {
        SELECTED_MONTH = months[months.length - 1];
        monthSelect.value = SELECTED_MONTH;
    }

    // Change handler
    monthSelect.onchange = (e) => {
        SELECTED_MONTH = e.target.value;
        renderDashboard();
        showToast(
            `Filtered to ${
                SELECTED_MONTH === "all" ? "all months" : monthLabel(SELECTED_MONTH)
            }`,
            "success"
        );
    };
}



/* ==========================================================================================
   CATEGORY FILTERS (D2 FULL‑WIDTH FILTER BARS)
   ========================================================================================== */

function populateCategoryFilters(txns) {
    const expenseSelect = $("expenseCategoryFilter");
    const incomeSelect  = $("incomeCategoryFilter");

    if (!expenseSelect || !incomeSelect) return;

    const expenseCats = [...new Set(txns.filter(t => t.type === "expense").map(t => t.category))];
    const incomeCats  = [...new Set(txns.filter(t => t.type === "income").map(t => t.category))];

    // Reset
    expenseSelect.innerHTML = `<option value="all">All Categories</option>`;
    incomeSelect.innerHTML  = `<option value="all">All Categories</option>`;

    // Insert expense categories
    expenseCats.forEach(cat => {
        const o = document.createElement("option");
        o.value = cat;
        o.textContent = cat;
        expenseSelect.appendChild(o);
    });

    // Insert income categories
    incomeCats.forEach(cat => {
        const o = document.createElement("option");
        o.value = cat;
        o.textContent = cat;
        incomeSelect.appendChild(o);
    });

    // Attach handlers
    expenseSelect.onchange = () => {
        renderExpenseLineChart();  // new line chart version
    };

    incomeSelect.onchange = () => {
        renderIncomeLineChart();   // new line chart version
    };
/********************************************************************************************
 * SECTION 4 — CHART BUILDER UTILITIES
 * Provides:
 *  - color palettes
 *  - reusable dataset builders
 *  - safe chart instantiation helpers
 *  - canvas setup helpers
 ********************************************************************************************/


/* ==========================================================================================
   SHARED COLOR PALETTES
   ========================================================================================== */

const COLORS = {
    income:      "#10b981",
    expense:     "#ef4444",
    investment:  "#3b82f6",
    purple:      "#8b5cf6",

    // Palettes for category lines
    categorySet1: [
        "#ef4444", "#f97316", "#f59e0b", "#8b5cf6", "#06b6d4",
        "#0ea5e9", "#6366f1", "#14b8a6", "#16a34a", "#65a30d"
    ],
    categorySet2: [
        "#10b981", "#14b8a6", "#3b82f6", "#8b5cf6", "#06b6d4",
        "#0ea5e9", "#6366f1", "#16a34a", "#65a30d", "#059669"
    ]
};



/* ==========================================================================================
   CANVAS RESET UTIL: ensures clean chart rendering
   ========================================================================================== */

function prepareCanvas(chartId) {
    const el = document.getElementById(chartId);
    if (!el) return null;

    destroyChart(chartId);
    return el;
}



/* ==========================================================================================
   GENERIC DATASET BUILDERS
   ========================================================================================== */

// Build a simple line dataset
function buildLineDataset({ label, data, color, fill = false, tension = 0.35 }) {
    return {
        label,
        data,
        borderColor: color,
        backgroundColor: fill ? color + "33" : color,
        borderWidth: 3,
        tension,
        fill,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: color,
        pointBorderWidth: 1,
        pointBorderColor: "#fff"
    };
}


// Build a simple bar dataset
function buildBarDataset({ label, data, color }) {
    return {
        label,
        data,
        backgroundColor: color,
        borderRadius: 8
    };
}



/* ==========================================================================================
   INITIALIZING A CHART.JS INSTANCE SAFELY
   ========================================================================================== */

function createChart(ctx, config) {
    return new Chart(ctx, config);
}



/* ==========================================================================================
   REUSABLE SCALES FOR CONSISTENCY
   ========================================================================================== */

const TREND_SCALES = {
    x: {
        grid: { display: false },
        ticks: {
            maxRotation: 45,
            minRotation: 45,
            autoSkip: true,
            maxTicksLimit: 12
        }
    },
    y: {
        ticks: {
            callback: (v) => fmtShort(v),
            color: "#475569"
        },
        grid: { color: "#e2e8f0" }
    }
/********************************************************************************************
 * SECTION 5 — MONTHLY CASHFLOW + EXPENSE TREND LINE CHART
 ********************************************************************************************/


/* ==========================================================================================
   MONTHLY CASHFLOW BAR CHART  (Income vs Expense vs Investment)
   ========================================================================================== */

function renderMonthly(stats) {
    const ctx = prepareCanvas("monthlyChart");
    if (!ctx || !stats.months.length) return;

    const labels = stats.months.map(monthLabel);

    const datasets = [
        buildBarDataset({
            label: "Income",
            data: stats.months.map(m => stats.monthMap[m].income),
            color: COLORS.income
        }),
        buildBarDataset({
            label: "Expenses",
            data: stats.months.map(m => stats.monthMap[m].expense),
            color: COLORS.expense
        }),
        buildBarDataset({
            label: "Investment",
            data: stats.months.map(m => stats.monthMap[m].investment),
            color: COLORS.investment
        }),
    ];

    createChart(ctx, {
        type: "bar",
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (c) => ` ${c.dataset.label}: ${fmtMoney(c.parsed.y, 2)}`
                    }
                }
            },
            scales: {
                x: { grid: { display: false } },
                y: {
                    ticks: { callback: (v) => fmtShort(v) },
                }
            }
        }
    });
}



/* ==========================================================================================
   NEW EXPENSE TREND LINE CHART (replaces old bar chart)
   ========================================================================================== */

// This function REPLACES your old renderExpenseCatChart(), but we preserve the
// original FUNCTION NAME for compatibility across your dashboard.
//
// The new version:
//  ✔ Line chart over time (month-by-month)
//  ✔ Full-width category filter (D2)
//  ✔ Shows either ALL categories or one selected category
//  ✔ Uses new chart utilities

function renderExpenseCatChart(stats) {
    renderExpenseLineChart(stats);
}


// Actual implementation of the line chart:
function renderExpenseLineChart(statsOverride = null) {
    const txns = getFilteredTxns();
    const stats = statsOverride || computeStats(txns);

    const ctx = prepareCanvas("expenseCatChart");
    if (!ctx) return;

    const categorySelect = document.getElementById("expenseCategoryFilter");
    const selectedCat = categorySelect ? categorySelect.value : "all";

    const months = stats.months;
    if (!months.length) return;

    // Determine categories to draw
    const categories = selectedCat === "all"
        ? [...new Set(txns.filter(t => t.type === "expense").map(t => t.category))]
        : [selectedCat];

    // Build dataset list
    const datasets = categories.map((cat, idx) => {
        // Build array like: [AprAmount, MayAmount, JunAmount, ...]
        const dataPoints = months.map(m =>
            txns
                .filter(t => t.type === "expense" && t.category === cat && monthKey(t.date) === m)
                .reduce((sum, t) => sum + t.amt, 0)
        );

        return buildLineDataset({
            label: cat,
            data: dataPoints,
            color: COLORS.categorySet1[idx % COLORS.categorySet1.length],
            fill: false,
            tension: 0.35
        });
    });

    // Total header (optional)
    const totalSpan = document.getElementById("expCatTotal");
    if (totalSpan) {
        const total = txns
            .filter(t => t.type === "expense")
            .reduce((s, t) => s + t.amt, 0);

        const catCount = new Set(txns.filter(t => t.type === "expense").map(t => t.category)).size;

        totalSpan.innerHTML = `Total: ${fmtMoney(total)} · ${catCount} categories`;
    }

    // Create the chart
    createChart(ctx, {
        type: "line",
        data: {
            labels: months.map(monthLabel),
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true }
            },
            scales: TREND_SCALES
        }
    });
}
  /********************************************************************************************
 * SECTION 6 — INCOME TREND LINE CHART + DAILY BALANCE TIMELINE
 ********************************************************************************************/


/* ==========================================================================================
   NEW INCOME TREND LINE CHART (replaces old bar chart)
   ========================================================================================== */

function renderIncomeCatChart() {
    // Keep original function name, but call our new version:
    renderIncomeLineChart();
}

function renderIncomeLineChart(statsOverride = null) {
    const txns = getFilteredTxns();
    const stats = statsOverride || computeStats(txns);

    const ctx = prepareCanvas("incomeCatChart");
    if (!ctx) return;

    const categorySelect = document.getElementById("incomeCategoryFilter");
    const selectedCat = categorySelect ? categorySelect.value : "all";

    const months = stats.months;
    if (!months.length) return;

    const categories = selectedCat === "all"
        ? [...new Set(txns.filter(t => t.type === "income").map(t => t.category))]
        : [selectedCat];

    const datasets = categories.map((cat, idx) => {
        const dataPoints = months.map(m =>
            txns
                .filter(t => t.type === "income" && t.category === cat && monthKey(t.date) === m)
                .reduce((s, t) => s + t.amt, 0)
        );

        return buildLineDataset({
            label: cat,
            data: dataPoints,
            color: COLORS.categorySet2[idx % COLORS.categorySet2.length],
            fill: false,
            tension: 0.35
        });
    });

    // Update header information
    const totalSpan = document.getElementById("incCatTotal");
    if (totalSpan) {
        const total = txns
            .filter(t => t.type === "income")
            .reduce((s, t) => s + t.amt, 0);

        const catCount = new Set(txns.filter(t => t.type === "income").map(t => t.category)).size;

        totalSpan.innerHTML = `Total: ${fmtMoney(total)} · ${catCount} categories`;
    }

    // Render chart
    createChart(ctx, {
        type: "line",
        data: {
            labels: months.map(monthLabel),
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true }
            },
            scales: TREND_SCALES
        }
    });
}



/* ==========================================================================================
   DAILY BALANCE CHART
   ========================================================================================== */

function renderDailyBalance() {
    const ctx = prepareCanvas("dailyBalanceChart");
    if (!ctx) return;

    const txns = getFilteredTxns();
    if (txns.length === 0) return;

    // Sort oldest → newest
    const sorted = [...txns].sort((a, b) => a.date - b.date);

    // Running balance per day
    let running = 0;
    const daily = new Map();

    sorted.forEach(t => {
        let delta = 0;

        if (t.type === "income") delta = t.amt;
        else if (t.type === "expense" || t.type === "investment") delta = -t.amt;

        running += delta;

        const key = t.date.toISOString().split("T")[0];
        daily.set(key, {
            date: t.date,
            balance: running
        });
    });

    const points = Array.from(daily.values()).sort((a, b) => a.date - b.date);

    const labels = points.map(p =>
        p.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    );
    const balances = points.map(p => p.balance);

    createChart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Running Balance",
                    data: balances,
                    borderColor: COLORS.purple,
                    backgroundColor: COLORS.purple + "22",
                    borderWidth: 3,
                    tension: 0.35,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointBackgroundColor: COLORS.purple,
                    pointBorderColor: "#fff",
                    pointBorderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) =>
                            ` Balance: ${fmtMoney(ctx.parsed.y, 2)}`
                    }
                }
            },
            scales: TREND_SCALES,
            interaction: { mode: "index", intersect: false }
        }
    });
}
  /********************************************************************************************
 * SECTION 7 — PAYMENT METHODS · YOY COMPARISON · ANNUAL SUMMARY · RECENT TXNS
 ********************************************************************************************/


/* ==========================================================================================
   PAYMENT METHODS DOUGHNUT CHART
   ========================================================================================== */

function renderPayment(stats) {
    const ctx = prepareCanvas("paymentChart");
    const legend = $("paymentLegend");

    if (!ctx) return;

    const entries = Object.entries(stats.payMap)
        .sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
        if (legend) legend.innerHTML = `<p class="text-muted">No payment data</p>`;
        return;
    }

    const labels = entries.map(e => e[0]);
    const data = entries.map(e => e[1]);
    const colors = COLORS.categorySet1.slice(0, entries.length);

    createChart(ctx, {
        type: "doughnut",
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderColor: "#fff",
                borderWidth: 2
            }]
        },
        options: {
            cutout: "65%",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
        }
    });

    if (legend) {
        legend.innerHTML = entries.map((e, i) => `
            <div class="donut-leg-item">
                <span class="donut-leg-dot" style="background:${colors[i]}"></span>
                <span class="donut-leg-label">${e[0]}</span>
                <span class="donut-leg-val">${fmtMoney(e[1])}</span>
            </div>
        `).join("");
    }
}



/* ==========================================================================================
   YEAR-OVER-YEAR (YOY) BAR CHART
   ========================================================================================== */

function renderYoYCombined() {
    const ctx = prepareCanvas("yoyChart");
    if (!ctx) return;

    const years = [...new Set(ALL_TXNS.map(t => t.year))].sort();

    const incomeData = years.map(y =>
        ALL_TXNS.filter(t => t.year === y && t.type === "income")
            .reduce((s, t) => s + t.amt, 0)
    );

    const expenseData = years.map(y =>
        ALL_TXNS.filter(t => t.year === y && t.type === "expense")
            .reduce((s, t) => s + t.amt, 0)
    );

    const investmentData = years.map(y =>
        ALL_TXNS.filter(t => t.year === y && t.type === "investment")
            .reduce((s, t) => s + t.amt, 0)
    );

    const legend = $("yoyLegend");
    if (legend) {
        legend.innerHTML = `
            <span><span class="leg-sq" style="background:${COLORS.income}"></span>Income</span>
            <span><span class="leg-sq" style="background:${COLORS.expense}"></span>Expenses</span>
            <span><span class="leg-sq" style="background:${COLORS.investment}"></span>Investments</span>
        `;
    }

    createChart(ctx, {
        type: "bar",
        data: {
            labels: years,
            datasets: [
                buildBarDataset({ label: "Income", data: incomeData, color: COLORS.income }),
                buildBarDataset({ label: "Expenses", data: expenseData, color: COLORS.expense }),
                buildBarDataset({ label: "Investments", data: investmentData, color: COLORS.investment }),
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: "top" },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y, 2)}`
                    }
                }
            },
            scales: {
                y: { ticks: { callback: (v) => fmtShort(v) } },
                x: { grid: { display: false } }
            }
        }
    });
}



/* ==========================================================================================
   ANNUAL SUMMARY TABLE
   ========================================================================================== */

function renderAnnualTable() {
    const body = $("annualBody");
    if (!body) return;

    const years = [...new Set(ALL_TXNS.map(t => t.year))].sort();

    const yearStats = years.map(y => ({
        year: y,
        ...computeStats(ALL_TXNS.filter(t => t.year === y))
    }));

    if (!yearStats.length) {
        body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px">No data yet</td></tr>`;
        return;
    }

    const totals = {
        income: 0, expense: 0, investment: 0, count: 0
    };

    yearStats.forEach(y => {
        totals.income += y.income;
        totals.expense += y.expense;
        totals.investment += y.investment;
        totals.count += y.count;
    });

    totals.net = totals.income - totals.expense - totals.investment;
    totals.savings = totals.income > 0 ? ((totals.income - totals.expense) / totals.income) * 100 : 0;

    body.innerHTML = `
        ${yearStats.map(y => `
            <tr class="clickable-row" data-year="${y.year}">
                <td class="yr-cell">${y.year}</td>
                <td class="mono c-green">${fmtMoney(y.income)}</td>
                <td class="mono c-red">${fmtMoney(y.expense)}</td>
                <td class="mono c-blue">${fmtMoney(y.investment)}</td>
                <td class="mono ${y.netBalance >= 0 ? "c-green" : "c-red"}">${fmtMoney(y.netBalance)}</td>
                <td><span class="savings-badge ${y.savingsRate >= 20 ? "good" : y.savingsRate >= 10 ? "ok" : "low"}">
                    ${Math.round(y.savingsRate)}%
                </span></td>
                <td class="mono">${y.count}</td>
            </tr>
        `).join("")}
        <tr style="border-top:2px solid var(--border-light);font-weight:600">
            <td class="yr-cell">All Time</td>
            <td class="mono c-green">${fmtMoney(totals.income)}</td>
            <td class="mono c-red">${fmtMoney(totals.expense)}</td>
            <td class="mono c-blue">${fmtMoney(totals.investment)}</td>
            <td class="mono ${totals.net >= 0 ? "c-green" : "c-red"}">${fmtMoney(totals.net)}</td>
            <td><span class="savings-badge ${
                totals.savings >= 20 ? "good" : totals.savings >= 10 ? "ok" : "low"
            }">${Math.round(totals.savings)}%</span></td>
            <td class="mono">${totals.count}</td>
        </tr>
    `;

    // Enable row click (year selection)
    qsa("#annualBody .clickable-row").forEach(row => {
        row.addEventListener("click", () => {
            const yr = parseInt(row.dataset.year);
            selectYear(yr);
        });
    });
}



/* ==========================================================================================
   RECENT TRANSACTIONS TABLE
   ========================================================================================== */

function renderTransactions(txns) {
    const body = $("txBody");
    const meta = $("txMeta");

    if (!body) return;

    const recent = txns.slice(0, 25);

    if (meta) {
        meta.textContent =
            `${SELECTED_YEAR === "all" ? "All time" : SELECTED_YEAR}`
            + (SELECTED_MONTH !== "all" ? ` · ${monthLabel(SELECTED_MONTH)}` : "")
/********************************************************************************************
 * SECTION 8 — EXPORT · AUTO‑REFRESH · REFRESH DATA · BOOTSTRAP
 ********************************************************************************************/


/* ==========================================================================================
   EXPORT TO CSV
   ========================================================================================== */

window.exportToCSV = function () {
    const txns = getFilteredTxns();
    if (txns.length === 0) {
        showToast("No data to export", "warning");
        return;
    }

    const headers = ["Date", "Type", "Category", "Payment Method", "Amount"];

    const rows = txns.map(t => [
        t.date.toISOString().split("T")[0],
        t.type,
        t.category,
        t.payment,
        t.amt
    ]);

    const csv = [headers, ...rows]
        .map(r => r.join(","))
        .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `finance_export_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();

    URL.revokeObjectURL(url);

    showToast(`Exported ${txns.length} transactions to CSV`, "success");
};



/* ==========================================================================================
   AUTO‑REFRESH TIMER
   ========================================================================================== */

function startAutoRefresh(minutes = 5) {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);

    autoRefreshInterval = setInterval(() => {
        refreshData();
    }, minutes * 60 * 1000);

    console.log(`Auto-refresh enabled every ${minutes} minutes`);
}



/* ==========================================================================================
   REFRESH DATA FROM GOOGLE SHEETS
   ========================================================================================== */

window.refreshData = async function () {
    const refreshBtn = $("refreshBtn");
    if (refreshBtn) refreshBtn.style.transform = "rotate(180deg)";

    try {
        const response = await fetch(SHEET_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const text = await response.text();
        const json = getJSON(text);

        ALL_TXNS = parseRows(json.table.rows || []);

        if (ALL_TXNS.length === 0) throw new Error("No transactions found");

        ALL_YEARS = [...new Set(ALL_TXNS.map(t => t.year))].sort();

        const curYear = new Date().getFullYear();
        SELECTED_YEAR = ALL_YEARS.includes(curYear) ? curYear : "all";
        SELECTED_MONTH = "all";

        const idx = ALL_YEARS.indexOf(SELECTED_YEAR);
        YEAR_WINDOW_START = idx >= 0 ? Math.max(0, idx - Math.floor(PILLS_VISIBLE / 2)) : 0;

        buildYearNav();
        populateMonthFilter();
        renderDashboard();

        // Update sync time
        const sync = $("lastSync");
        if (sync) {
            sync.textContent = new Date().toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit"
            });
        }

        showToast(`Loaded ${ALL_TXNS.length} transactions`, "success");

    } catch (err) {
        console.error("Refresh error:", err);
        showToast("Failed to refresh data. Check your sheet sharing settings.", "error");

    } finally {
        if (refreshBtn) {
            setTimeout(() => {
                refreshBtn.style.transform = "";
            }, 500);
        }
    }
};



/* ==========================================================================================
   BOOTSTRAP — INITIAL DATA LOAD
   ========================================================================================== */

async function boot() {
    const loadingState = $("loadingState");
    const errorState   = $("errorState");
    const dashboard    = $("dashboard");

    try {
        // “Still loading…” fallback after 5 seconds
        const timeoutId = setTimeout(() => {
            if (ALL_TXNS.length === 0 && loadingState) {
                loadingState.innerHTML = `
                    <div class="loader-ring"></div>
                    <p>Still loading... This may take a moment</p>
                    <p class="loading-hint">Check your internet connection</p>
                `;
            }
        }, 5000);

        const response = await fetch(SHEET_URL);
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const text = await response.text();
        const json = getJSON(text);

        ALL_TXNS = parseRows(json.table.rows || []);
        if (ALL_TXNS.length === 0) throw new Error("No transactions found");

        ALL_YEARS = [...new Set(ALL_TXNS.map(t => t.year))].sort();

        const curYear = new Date().getFullYear();
        SELECTED_YEAR = ALL_YEARS.includes(curYear) ? curYear : "all";

        const idx = ALL_YEARS.indexOf(SELECTED_YEAR);
        YEAR_WINDOW_START = idx >= 0 ? Math.max(0, idx - Math.floor(PILLS_VISIBLE / 2)) : 0;

        if (loadingState) loadingState.style.display = "none";
        if (dashboard) dashboard.style.display = "block";

        const sync = $("lastSync");
        if (sync) {
            sync.textContent = new Date().toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit"
            });
        }

        buildYearNav();
        populateMonthFilter();
        renderDashboard();

        // Enable auto-refresh
        startAutoRefresh(5);

        showToast("Dashboard ready! Data loaded successfully.", "success");

    } catch (err) {
        console.error("Boot error:", err);

        if (loadingState) loadingState.style.display = "none";
        if (errorState)   errorState.style.display   = "block";

        const msg = qs(".error-message");
        if (msg) {
            if (err.message.includes("HTTP 404")) {
                msg.textContent =
                    "Google Sheet not found. Please check that your sheet is shared publicly.";
            } else if (err.message.includes("Failed to fetch")) {
                msg.textContent =
                    "Network error. Check your internet connection or CORS restrictions.";
            } else {
                msg.textContent = `Error: ${err.message}. Make sure your sheet is public and contains data.`;
            }
        }
    }
}



// Start the dashboard
boot();
