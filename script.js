/********************************************************************************************
 * FinanceTrack — COMPLETE FIXED VERSION
 * Fixed: Text visibility in legends, Daily Balance shows up to today
 ********************************************************************************************/

/* ==========================================================================================
   CONFIGURATION
   ========================================================================================== */

const SHEET_ID  = "1bHv3ITXTmXkrSLgHUbD_CrzEWdgxfFBeJv9RYyjLBfc";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;

/* ==========================================================================================
   STATE MANAGEMENT
   ========================================================================================== */

let ALL_TXNS            = [];
let ALL_YEARS           = [];
let SELECTED_YEAR       = "all";
let SELECTED_MONTH      = "all";

let YEAR_WINDOW_START   = 0;
let PILLS_VISIBLE       = 5;

let charts              = {};
let autoRefreshInterval = null;

/* ==========================================================================================
   UTILITY: DOM HELPERS
   ========================================================================================== */

const $ = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => document.querySelectorAll(sel);

function showToast(message, type = "success") {
    const toast = $("toastMessage");
    if (!toast) return;

    toast.textContent = message;
    toast.className = `toast-message ${type}`;
    toast.classList.add("show");

    setTimeout(() => toast.classList.remove("show"), 3000);
}

/* ==========================================================================================
   UTILITY: SAFE JSON PARSING
   ========================================================================================== */

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

function parseGVizDate(v) {
    if (!v) return null;
    const str = String(v).trim();

    const gviz = str.match(/Date\((\d+),(\d+),(\d+)\)/);
    if (gviz) {
        return new Date(+gviz[1], +gviz[2], +gviz[3]);
    }

    const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) {
        const day = +dmy[1], month = +dmy[2], year = +dmy[3];
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return new Date(year, month - 1, day);
        }
    }

    const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
        const month = +mdy[1], day = +mdy[2], year = +mdy[3];
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return new Date(year, month - 1, day);
        }
    }

    const d = new Date(str);
    return isNaN(d) ? null : d;
}

function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(k) {
    const [y, m] = k.split("-");
    return new Date(+y, +m - 1).toLocaleString("default", { month: "short" });
}

function fmtDate(d) {
    if (!d) return "—";
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function dateKey(d) {
    return d.toISOString().split("T")[0];
}

/* ==========================================================================================
   UTILITY: NUMBER FORMATTERS
   ========================================================================================== */

function fmtMoney(n, decimals = 0) {
    const abs = Math.abs(n);
    const formatted = abs.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
    return (n < 0 ? "-" : "") + "$" + formatted;
}

function fmtShort(n) {
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";

    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1000)     return `${sign}$${(abs / 1000).toFixed(1)}k`;
    return `${sign}$${Math.round(abs)}`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ==========================================================================================
   UTILITY: CHART MANAGEMENT
   ========================================================================================== */

function destroyChart(id) {
    if (charts[id]) {
        charts[id].destroy();
        delete charts[id];
    }
}

function prepareCanvas(chartId) {
    const el = document.getElementById(chartId);
    if (!el) return null;
    destroyChart(chartId);
    return el;
}

function createChart(ctx, config) {
    const instance = new Chart(ctx, config);
    return instance;
}

/* ==========================================================================================
   DATA PARSING & TRANSFORMATION - UPDATED FOR YOUR SHEET STRUCTURE
   ========================================================================================== */

function parseRows(rows, cols) {
    if (!rows || rows.length === 0) return [];

    const colIndex = {
        timestamp: -1,
        type: -1,
        date: -1,
        amount: -1,
        expenseCategory: -1,
        incomeCategory: -1,
        payment: -1
    };

    function mapHeaderCell(label, i) {
        if (!label) return;
        const v = label.toString().toLowerCase().trim();
        
        if (v.includes("timestamp")) colIndex.timestamp = i;
        else if (v.includes("transaction type") || v.includes("type")) colIndex.type = i;
        else if (v.includes("date")) colIndex.date = i;
        else if (v.includes("amount") || v.includes("$")) colIndex.amount = i;
        else if (v.includes("expense categories")) colIndex.expenseCategory = i;
        else if (v.includes("income categories")) colIndex.incomeCategory = i;
        else if (v.includes("payment method")) colIndex.payment = i;
    }

    let startIndex = 0;
    let foundHeaders = false;
    
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const c = rows[i]?.c;
        if (c) {
            const headerValues = c.map(cell => cell?.v?.toString().toLowerCase().trim() || "");
            if (headerValues.some(v => v.includes("timestamp") || v.includes("transaction type"))) {
                headerValues.forEach((v, idx) => mapHeaderCell(v, idx));
                startIndex = i + 1;
                foundHeaders = true;
                break;
            }
        }
    }

    if (!foundHeaders && cols && cols.some(c => c && c.label)) {
        cols.forEach((c, i) => mapHeaderCell(c?.label, i));
    }

    if (colIndex.type === -1) colIndex.type = 1;
    if (colIndex.date === -1) colIndex.date = 2;
    if (colIndex.amount === -1) colIndex.amount = 3;
    if (colIndex.expenseCategory === -1) colIndex.expenseCategory = 4;
    if (colIndex.incomeCategory === -1) colIndex.incomeCategory = 5;
    if (colIndex.payment === -1) colIndex.payment = 6;

    console.log("Final column mapping:", colIndex);

    const parsed = rows.slice(startIndex).map((r, rowIndex) => {
        const c = r.c;
        if (!c) return null;

        const type = (c[colIndex.type]?.v || "").toString().trim().toLowerCase();
        const date = parseGVizDate(c[colIndex.date]?.v);
        const amt = Number(c[colIndex.amount]?.v);
        
        let cat = "";
        if (colIndex.expenseCategory >= 0 && c[colIndex.expenseCategory]?.v) {
            cat = c[colIndex.expenseCategory].v.toString().trim();
        } else if (colIndex.incomeCategory >= 0 && c[colIndex.incomeCategory]?.v) {
            cat = c[colIndex.incomeCategory].v.toString().trim();
        }
        if (!cat) {
            cat = cap(type);
        }

        const pay = (colIndex.payment >= 0 && c[colIndex.payment]?.v)
            ? c[colIndex.payment].v.toString().trim()
            : "Unknown";

        if (!type || !date || isNaN(amt) || amt <= 0) return null;

        return {
            type: type,
            date: date,
            amt: amt,
            category: cat,
            payment: pay,
            year: date.getFullYear()
        };
    })
    .filter(Boolean)
    .sort((a, b) => b.date - a.date);

    console.log(`✅ Parsed ${parsed.length} transactions`);

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
   FILTERED TRANSACTIONS
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

/* ==========================================================================================
   YEAR NAVIGATION
   ========================================================================================== */

function buildYearNav() {
    const pills = $("yearPills");
    const prev  = $("yearPrev");
    const next  = $("yearNext");

    if (!pills) return;

    if (prev) prev.disabled = YEAR_WINDOW_START === 0;
    if (next) next.disabled = YEAR_WINDOW_START + PILLS_VISIBLE >= ALL_YEARS.length;

    const visibleYears = ALL_YEARS.slice(
        YEAR_WINDOW_START,
        YEAR_WINDOW_START + PILLS_VISIBLE
    );

    pills.innerHTML = "";

    const allBtn = document.createElement("button");
    allBtn.textContent = "All";
    allBtn.className = "year-pill all-pill" + (SELECTED_YEAR === "all" ? " active" : "");
    allBtn.onclick = () => selectYear("all");
    pills.appendChild(allBtn);

    visibleYears.forEach(y => {
        const btn = document.createElement("button");
        btn.textContent = y;
        btn.className = "year-pill" + (SELECTED_YEAR === y ? " active" : "");
        btn.onclick = () => selectYear(y);
        pills.appendChild(btn);
    });
}

function selectYear(year) {
    SELECTED_YEAR = year;
    SELECTED_MONTH = "all";

    const monthFilter = $("monthFilter");
    if (monthFilter) monthFilter.value = "all";

    renderDashboard();
    showToast(`Showing ${year === "all" ? "all years" : year}`, "success");
}

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

    const txns = SELECTED_YEAR === "all"
        ? ALL_TXNS
        : ALL_TXNS.filter(t => t.year === SELECTED_YEAR);

    const months = [...new Set(txns.map(t => monthKey(t.date)))].sort();

    monthSelect.innerHTML = `<option value="all">📅 All Months</option>`;

    const now = new Date();
    const keyNow = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    let foundCurrent = false;

    months.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = `${monthLabel(m)} ${m.split("-")[0]}`;

        if (m === keyNow) {
            opt.selected = true;
            SELECTED_MONTH = m;
            foundCurrent = true;
        }

        monthSelect.appendChild(opt);
    });

    if (!foundCurrent && months.length > 0) {
        SELECTED_MONTH = months[months.length - 1];
        monthSelect.value = SELECTED_MONTH;
    }

    monthSelect.onchange = null;
    monthSelect.onchange = (e) => {
        SELECTED_MONTH = e.target.value;
        renderDashboard();
        showToast(
            `Filtered to ${SELECTED_MONTH === "all" ? "all months" : monthLabel(SELECTED_MONTH)}`,
            "success"
        );
    };
}

/* ==========================================================================================
   COLOR PALETTES - More attractive colors for income
   ========================================================================================== */

const COLORS = {
    income:      "#10b981",
    expense:     "#ef4444",
    investment:  "#3b82f6",
    purple:      "#8b5cf6"
};

// More attractive income colors (greens, teals, blues, purples)
const INCOME_COLORS = [
    "#059669", // Emerald
    "#0d9488", // Teal
    "#0891b2", // Cyan
    "#2563eb", // Blue
    "#7c3aed", // Purple
    "#0ea5e9", // Sky Blue
    "#14b8a6", // Teal Light
    "#06b6d4", // Cyan Light
    "#6366f1", // Indigo
    "#8b5cf6", // Violet
    "#10b981", // Emerald Light
    "#22d3ee", // Cyan Bright
];

// Expense colors (warmer colors)
const EXPENSE_COLORS = [
    "#dc2626", "#ea580c", "#d97706", "#9333ea", "#0891b2",
    "#2563eb", "#4f46e5", "#0d9488", "#059669", "#65a30d",
    "#db2777", "#e11d48", "#f97316", "#f59e0b", "#a855f7"
];

function getIncomeColor(index) {
    return INCOME_COLORS[index % INCOME_COLORS.length];
}

function getExpenseColor(index) {
    return EXPENSE_COLORS[index % EXPENSE_COLORS.length];
}

function getCategoryColor(index) {
    return EXPENSE_COLORS[index % EXPENSE_COLORS.length];
}

/* ==========================================================================================
   DATASET BUILDERS
   ========================================================================================== */

function buildBarDataset({ label, data, color }) {
    return {
        label,
        data,
        backgroundColor: color,
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4
    };
}

/* ==========================================================================================
   MONTHLY CASHFLOW CHART
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

    const chart = createChart(ctx, {
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
                    beginAtZero: true
                }
            }
        }
    });
    charts.monthlyChart = chart;
}

/* ==========================================================================================
   MONTHLY EXPENSE BREAKDOWN - DYNAMIC CATEGORIES
   ========================================================================================== */

function renderExpenseCatChart(stats) {
    const txns = getFilteredTxns();
    const statsLocal = stats || computeStats(txns);

    const ctx = prepareCanvas("expenseCatChart");
    if (!ctx) return;

    const months = statsLocal.months;
    if (!months.length) return;

    const categories = [...new Set(txns.filter(t => t.type === "expense").map(t => t.category))];
    categories.sort();

    const datasets = categories.map((cat, idx) => {
        const dataPoints = months.map(m => {
            return txns
                .filter(t => t.type === "expense" && t.category === cat && monthKey(t.date) === m)
                .reduce((sum, t) => sum + t.amt, 0);
        });

        return {
            label: cat,
            data: dataPoints,
            backgroundColor: getExpenseColor(idx),
            borderColor: getExpenseColor(idx),
            borderWidth: 1,
            borderRadius: 4
        };
    });

    const labels = months.map(monthLabel);

    const totalSpan = document.getElementById("expCatTotal");
    if (totalSpan) {
        const total = txns
            .filter(t => t.type === "expense")
            .reduce((s, t) => s + t.amt, 0);

        const catCount = categories.length;

        totalSpan.innerHTML = `Total: ${fmtMoney(total)} · ${catCount} categories · Monthly totals`;
    }

    const chart = createChart(ctx, {
        type: "bar",
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    display: true, 
                    position: "top",
                    labels: {
                        boxWidth: 12,
                        padding: 10,
                        font: { size: 11, weight: '500' },
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#475569'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            if (ctx.parsed.y === 0) return `${ctx.dataset.label}: $0`;
                            return `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y, 2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45,
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#475569'
                    }
                },
                y: {
                    ticks: {
                        callback: (v) => fmtShort(v),
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#475569'
                    },
                    grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border-light').trim() || '#e2e8f0' },
                    beginAtZero: true
                }
            }
        }
    });
    charts.expenseCatChart = chart;
}

/* ==========================================================================================
   MONTHLY INCOME BREAKDOWN - WITH ATTRACTIVE COLORS
   ========================================================================================== */

function renderIncomeCatChart(stats) {
    const txns = getFilteredTxns();
    const statsLocal = stats || computeStats(txns);

    const ctx = prepareCanvas("incomeCatChart");
    if (!ctx) return;

    const months = statsLocal.months;
    if (!months.length) return;

    const categories = [...new Set(txns.filter(t => t.type === "income").map(t => t.category))];
    categories.sort();

    const datasets = categories.map((cat, idx) => {
        const dataPoints = months.map(m => {
            return txns
                .filter(t => t.type === "income" && t.category === cat && monthKey(t.date) === m)
                .reduce((sum, t) => sum + t.amt, 0);
        });

        return {
            label: cat,
            data: dataPoints,
            backgroundColor: getIncomeColor(idx),
            borderColor: getIncomeColor(idx),
            borderWidth: 1,
            borderRadius: 4
        };
    });

    const labels = months.map(monthLabel);

    const totalSpan = document.getElementById("incCatTotal");
    if (totalSpan) {
        const total = txns
            .filter(t => t.type === "income")
            .reduce((s, t) => s + t.amt, 0);

        const catCount = categories.length;

        totalSpan.innerHTML = `Total: ${fmtMoney(total)} · ${catCount} categories · Monthly totals`;
    }

    const chart = createChart(ctx, {
        type: "bar",
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    display: true, 
                    position: "top",
                    labels: {
                        boxWidth: 12,
                        padding: 10,
                        font: { size: 11, weight: '500' },
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#475569'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            if (ctx.parsed.y === 0) return `${ctx.dataset.label}: $0`;
                            return `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y, 2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45,
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#475569'
                    }
                },
                y: {
                    ticks: {
                        callback: (v) => fmtShort(v),
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#475569'
                    },
                    grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border-light').trim() || '#e2e8f0' },
                    beginAtZero: true
                }
            }
        }
    });
    charts.incomeCatChart = chart;
}

/* ==========================================================================================
   DAILY BALANCE CHART - UPDATED TO SHOW UP TO TODAY
   ========================================================================================== */

function renderDailyBalance() {
    const ctx = prepareCanvas("dailyBalanceChart");
    if (!ctx) return;

    const txns = getFilteredTxns();
    
    // Get today's date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (txns.length === 0) {
        // Show empty state with just today
        const chart = createChart(ctx, {
            type: "line",
            data: {
                labels: [today.toLocaleDateString("en-US", { month: "short", day: "numeric" })],
                datasets: [{
                    label: "Running Balance",
                    data: [0],
                    borderColor: "#8b5cf6",
                    backgroundColor: "rgba(139, 92, 246, 0.15)",
                    borderWidth: 3,
                    tension: 0.3,
                    fill: true,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: "#8b5cf6",
                    pointBorderColor: "#fff",
                    pointBorderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` Balance: ${fmtMoney(ctx.parsed.y, 2)}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#475569'
                        }
                    },
                    y: {
                        ticks: {
                            callback: (v) => fmtShort(v),
                            color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#475569'
                        },
                        grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border-light').trim() || '#e2e8f0' },
                        beginAtZero: true
                    }
                },
                interaction: { mode: "index", intersect: false }
            }
        });
        charts.dailyBalanceChart = chart;
        return;
    }

    // Sort transactions by date (oldest to newest)
    const sorted = [...txns].sort((a, b) => a.date - b.date);
    
    // Get the first date and use today as the last date
    const firstDate = new Date(sorted[0].date);
    firstDate.setHours(0, 0, 0, 0);
    
    // Create a map of date -> balance
    const balanceMap = new Map();
    let running = 0;
    
    // First, calculate balance for each day that has transactions
    sorted.forEach(t => {
        let delta = 0;
        if (t.type === "income") delta = t.amt;
        else if (t.type === "expense" || t.type === "investment") delta = -t.amt;
        running += delta;
        const key = dateKey(t.date);
        balanceMap.set(key, running);
    });
    
    // Now create a continuous date range from first date to TODAY
    const dates = [];
    const balances = [];
    let currentDate = new Date(firstDate);
    let lastBalance = 0;
    
    // Get the starting balance (before any transactions)
    // Find the first transaction's balance
    const firstKey = dateKey(firstDate);
    if (balanceMap.has(firstKey)) {
        lastBalance = balanceMap.get(firstKey);
    }
    
    // Loop from first date to today
    while (currentDate <= today) {
        const key = dateKey(currentDate);
        dates.push(new Date(currentDate));
        
        // If we have a balance for this date, use it; otherwise carry forward
        if (balanceMap.has(key)) {
            lastBalance = balanceMap.get(key);
        }
        balances.push(lastBalance);
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Format labels
    const labels = dates.map(d => 
        d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    );

    // Get theme colors
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#475569';
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border-light').trim() || '#e2e8f0';

    const chart = createChart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Running Balance",
                    data: balances,
                    borderColor: "#8b5cf6",
                    backgroundColor: "rgba(139, 92, 246, 0.15)",
                    borderWidth: 3,
                    tension: 0.3,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: "#8b5cf6",
                    pointBorderColor: "#fff",
                    pointBorderWidth: 2,
                    spanGaps: true
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
                        label: (ctx) => {
                            const value = ctx.parsed.y;
                            return ` Balance: ${fmtMoney(value, 2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: 30,
                        color: textColor
                    }
                },
                y: {
                    ticks: {
                        callback: (v) => fmtShort(v),
                        color: textColor
                    },
                    grid: { color: gridColor },
                    beginAtZero: false
                }
            },
            interaction: { mode: "index", intersect: false }
        }
    });
    charts.dailyBalanceChart = chart;
}

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
    const colors = entries.map((_, i) => getCategoryColor(i));
    
    // Get theme colors for legend text
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#475569';

    const chart = createChart(ctx, {
        type: "doughnut",
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderColor: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff',
                borderWidth: 2
            }]
        },
        options: {
            cutout: "65%",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { 
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((ctx.parsed / total) * 100).toFixed(1);
                            return `${ctx.label}: ${fmtMoney(ctx.parsed, 2)} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
    charts.paymentChart = chart;

    if (legend) {
        legend.innerHTML = entries.map((e, i) => `
            <div class="donut-leg-item">
                <span class="donut-leg-dot" style="background:${colors[i]}"></span>
                <span class="donut-leg-label" style="color:${textColor}">${e[0]}</span>
                <span class="donut-leg-val" style="color:${textColor}">${fmtMoney(e[1])}</span>
            </div>
        `).join("");
    }
}

/* ==========================================================================================
   YEAR-OVER-YEAR CHART
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

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#475569';
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border-light').trim() || '#e2e8f0';

    const chart = createChart(ctx, {
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
                legend: { 
                    position: "top",
                    labels: {
                        color: textColor
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y, 2)}`
                    }
                }
            },
            scales: {
                y: { 
                    ticks: { callback: (v) => fmtShort(v), color: textColor }, 
                    beginAtZero: true,
                    grid: { color: gridColor }
                },
                x: { 
                    grid: { display: false },
                    ticks: { color: textColor }
                }
            }
        }
    });
    charts.yoyChart = chart;
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
            <td><span class="savings-badge ${totals.savings >= 20 ? "good" : totals.savings >= 10 ? "ok" : "low"}">
                ${Math.round(totals.savings)}%
            </span></td>
            <td class="mono">${totals.count}</td>
        </tr>
    `;

    qsa("#annualBody .clickable-row").forEach(row => {
        row.addEventListener("click", () => {
            const yr = parseInt(row.dataset.year);
            selectYear(yr);
        });
    });
}

/* ==========================================================================================
   KPI CARDS
   ========================================================================================== */

function renderKPIs(stats) {
    const row = $("kpiRow");
    if (!row) return;

    const kpis = [
        { cls: "income",  icon: "Income",       val: fmtMoney(stats.income),  sub: `${stats.count} txns` },
        { cls: "expense", icon: "Expenses",      val: fmtMoney(stats.expense), sub: stats.topCat ? `Top: ${stats.topCat[0]}` : "—" },
        { cls: "invest",  icon: "Invested",      val: fmtMoney(stats.investment), sub: stats.months.length ? `${stats.months.length} mo. active` : "—" },
        { cls: "balance", icon: "Net Balance",   val: fmtMoney(stats.netBalance), sub: stats.netBalance >= 0 ? "Surplus" : "Deficit", valCls: stats.netBalance >= 0 ? "pos" : "neg" },
        { cls: "savings", icon: "Savings Rate",  val: `${Math.round(stats.savingsRate)}%`, sub: "of income saved" }
    ];

    row.innerHTML = kpis.map(k => `
        <div class="kpi ${k.cls}">
            <div class="kpi-icon"><span class="kpi-dot"></span>${k.icon}</div>
            <div class="kpi-val ${k.valCls || ""}">${k.val}</div>
            <div class="kpi-sub">${k.sub}</div>
        </div>
    `).join("");
}

/* ==========================================================================================
   CHIP ROW
   ========================================================================================== */

function renderChips(stats) {
    const row = $("chipRow");
    if (!row) return;

    const chips = [];

    if (stats.topCat) {
        chips.push(`Top category: <strong>${stats.topCat[0]}</strong> (${fmtMoney(stats.topCat[1])})`);
    }
    chips.push(`${stats.months.length} active month${stats.months.length === 1 ? "" : "s"}`);

    row.innerHTML = chips.map(c => `<div class="chip">${c}</div>`).join("");
}

/* ==========================================================================================
   VIEW LABEL
   ========================================================================================== */

function renderViewLabel() {
    const label = $("viewLabel");
    const desc  = $("viewDesc");
    if (!label || !desc) return;

    label.textContent = SELECTED_YEAR === "all" ? "All Time" : String(SELECTED_YEAR);
    desc.textContent = SELECTED_MONTH === "all"
        ? "Showing all months"
        : `Showing ${monthLabel(SELECTED_MONTH)} ${SELECTED_MONTH.split("-")[0]}`;
}

/* ==========================================================================================
   CASH FLOW LEGEND
   ========================================================================================== */

function renderCashLegend() {
    const legend = $("cashLegend");
    if (!legend) return;

    legend.innerHTML = `
        <span><span class="leg-sq" style="background:${COLORS.income}"></span>Income</span>
        <span><span class="leg-sq" style="background:${COLORS.expense}"></span>Expenses</span>
        <span><span class="leg-sq" style="background:${COLORS.investment}"></span>Investment</span>
    `;
}

/* ==========================================================================================
   RECENT TRANSACTIONS
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
            + ` · ${recent.length} of ${txns.length} shown`;
    }

    if (recent.length === 0) {
        body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px">No transactions yet</td></tr>`;
        return;
    }

    body.innerHTML = recent.map(t => `
        <tr>
            <td class="tx-date">${fmtDate(t.date)}</td>
            <td><span class="badge ${t.type}">${cap(t.type)}</span></td>
            <td>${t.category}</td>
            <td>${t.payment}</td>
            <td class="tx-amt ${t.type}">${t.type === "income" ? "+" : "-"}${fmtMoney(t.amt, 2)}</td>
        </tr>
    `).join("");
}

/* ==========================================================================================
   MASTER DASHBOARD RENDER
   ========================================================================================== */

function renderDashboard() {
    const txns = getFilteredTxns();
    const stats = computeStats(txns);

    renderViewLabel();
    renderKPIs(stats);
    renderChips(stats);
    renderCashLegend();

    renderMonthly(stats);
    renderExpenseCatChart(stats);
    renderIncomeCatChart(stats);
    renderDailyBalance();
    renderPayment(stats);
    renderYoYCombined();
    renderAnnualTable();
    renderTransactions(txns);
}

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
   AUTO-REFRESH
   ========================================================================================== */

function startAutoRefresh(minutes = 5) {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);

    autoRefreshInterval = setInterval(() => {
        refreshData();
    }, minutes * 60 * 1000);

    console.log(`Auto-refresh enabled every ${minutes} minutes`);
}

/* ==========================================================================================
   REFRESH DATA
   ========================================================================================== */

window.refreshData = async function () {
    const refreshBtn = $("refreshBtn");
    if (refreshBtn) refreshBtn.style.transform = "rotate(180deg)";

    try {
        const response = await fetch(SHEET_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const text = await response.text();
        const json = getJSON(text);

        ALL_TXNS = parseRows(json.table.rows || [], json.table.cols);

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
   BOOTSTRAP
   ========================================================================================== */

async function boot() {
    const loadingState = $("loadingState");
    const errorState   = $("errorState");
    const dashboard    = $("dashboard");

    try {
        console.log("🔍 Starting boot sequence...");

        const timeoutId = setTimeout(() => {
            if (ALL_TXNS.length === 0 && loadingState) {
                loadingState.innerHTML = `
                    <div class="loader-ring"></div>
                    <p>⏳ Still loading... This may take a moment</p>
                    <p class="loading-hint">Check your internet connection</p>
                `;
            }
        }, 5000);

        const response = await fetch(SHEET_URL);
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const text = await response.text();
        const json = getJSON(text);

        ALL_TXNS = parseRows(json.table.rows || [], json.table.cols);

        if (ALL_TXNS.length === 0) {
            throw new Error("No transactions found. Make sure your sheet has data.");
        }

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

        startAutoRefresh(5);

        showToast(`✅ Dashboard ready! Loaded ${ALL_TXNS.length} transactions.`, "success");

    } catch (err) {
        console.error("❌ Boot error:", err);

        if (loadingState) loadingState.style.display = "none";
        if (errorState) {
            errorState.style.display = "block";
            
            const msg = qs(".error-message");
            if (msg) {
                if (err.message.includes("HTTP 404")) {
                    msg.innerHTML = `
                        <strong>Sheet not found (404)</strong><br>
                        Check that your Sheet ID is correct.
                        <br><br>
                        Current Sheet ID: <code>${SHEET_ID}</code>
                    `;
                } else if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
                    msg.innerHTML = `
                        <strong>Network Error</strong><br>
                        Could not reach Google Sheets. Check your internet connection.
                    `;
                } else {
                    msg.innerHTML = `
                        <strong>Error: ${err.message}</strong>
                        <br><br>
                        <p>Check your browser console (F12) for more details.</p>
                    `;
                }
            }
        }
    }
}

// Start the dashboard
console.log("🚀 FinanceTrack booting...");
boot();
