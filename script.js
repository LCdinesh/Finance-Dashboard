// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
const SHEET_ID = "1bHv3ITXTmXkrSLgHUbD_CrzEWdgxfFBeJv9RYyjLBfc";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;

// ─────────────────────────────────────────────────────────────────────────────
// STATE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────
let ALL_TXNS = [];
let ALL_YEARS = [];
let YEAR_WINDOW_START = 0;
let PILLS_VISIBLE = 5;
let SELECTED_YEAR = "all";
let SELECTED_MONTH = "all";
let charts = {};
let autoRefreshInterval = null;

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────
function showToast(message, type = "success") {
  const toast = document.getElementById("toastMessage");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast-message ${type}`;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function getJSON(raw) {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}") + 1;
    return JSON.parse(raw.substring(start, end));
  } catch (e) {
    console.error("JSON parse error:", e);
    throw new Error("Failed to parse sheet data");
  }
}

function parseGVizDate(v) {
  if (!v) return null;
  // Handle Google Visualization API date format: Date(2026,4,5)
  const m = String(v).match(/Date\((\d+),(\d+),(\d+)/);
  if (m) return new Date(+m[1], +m[2], +m[3]);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function fmtMoney(n, decimals = 0) {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (n < 0 ? "-" : "") + "$" + formatted;
}

function fmtShort(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1000000) return sign + "$" + (abs / 1000000).toFixed(1) + "M";
  if (abs >= 1000) return sign + "$" + (abs / 1000).toFixed(1) + "k";
  return sign + "$" + Math.round(abs);
}

function fmtDate(d) {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function monthKey(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function monthLabel(k) {
  const [y, m] = k.split("-");
  return new Date(+y, +m - 1).toLocaleString("default", { month: "short" });
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA PROCESSING
// ─────────────────────────────────────────────────────────────────────────────
function parseRows(rows) {
  if (!rows || rows.length === 0) return [];
  
  // Find header row to map columns correctly
  let headerRow = null;
  let dataStartIndex = 0;
  
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (row.c && row.c[0] && row.c[0].v === "Timestamp") {
      headerRow = row.c;
      dataStartIndex = i + 1;
      break;
    }
  }
  
  if (!headerRow) {
    // If no header found, assume standard order: Timestamp, Type, Date, Amount, Category, Subcategory, Payment Method
    return rows
      .slice(1)
      .map((r) => {
        if (!r.c) return null;
        const type = r.c[1]?.v?.toString().trim().toLowerCase() || "";
        const date = parseGVizDate(r.c[2]?.v);
        const amt = Number(r.c[3]?.v);
        const category = r.c[4]?.v?.toString().trim() || cap(type);
        const payment = r.c[6]?.v?.toString().trim() || "Unknown";
        
        if (!date || isNaN(amt) || amt <= 0 || !type) return null;
        return { type, date, amt, category, payment, year: date.getFullYear() };
      })
      .filter(Boolean);
  }
  
  // Map columns based on headers
  const colIndex = {
    timestamp: -1,
    type: -1,
    date: -1,
    amount: -1,
    category: -1,
    payment: -1
  };
  
  headerRow.forEach((cell, idx) => {
    if (!cell || !cell.v) return;
    const val = cell.v.toString().toLowerCase();
    if (val.includes("timestamp")) colIndex.timestamp = idx;
    else if (val.includes("type")) colIndex.type = idx;
    else if (val.includes("date")) colIndex.date = idx;
    else if (val.includes("amount")) colIndex.amount = idx;
    else if (val.includes("category")) colIndex.category = idx;
    else if (val.includes("payment")) colIndex.payment = idx;
  });
  
  // Use defaults if columns not found
  if (colIndex.type === -1) colIndex.type = 1;
  if (colIndex.date === -1) colIndex.date = 2;
  if (colIndex.amount === -1) colIndex.amount = 3;
  
  return rows
    .slice(dataStartIndex)
    .map((r) => {
      if (!r.c) return null;
      const type = r.c[colIndex.type]?.v?.toString().trim().toLowerCase() || "";
      const date = parseGVizDate(r.c[colIndex.date]?.v);
      const amt = Number(r.c[colIndex.amount]?.v);
      const category = (colIndex.category >= 0 && r.c[colIndex.category]?.v?.toString().trim()) || cap(type);
      const payment = (colIndex.payment >= 0 && r.c[colIndex.payment]?.v?.toString().trim()) || "Unknown";
      
      if (!date || isNaN(amt) || amt <= 0 || !type) return null;
      return { type, date, amt, category, payment, year: date.getFullYear() };
    })
    .filter(Boolean)
    .sort((a, b) => b.date - a.date);
}

function computeStats(txns) {
  let income = 0, expense = 0, investment = 0, loan = 0;
  const monthMap = {}, catMap = {}, payMap = {}, balDelta = {};

  txns.forEach((t) => {
    const mo = monthKey(t.date);
    if (!monthMap[mo]) monthMap[mo] = { income: 0, expense: 0, investment: 0, loan: 0 };
    if (!balDelta[mo]) balDelta[mo] = 0;

    if (t.type === "income") { income += t.amt; monthMap[mo].income += t.amt; balDelta[mo] += t.amt; }
    if (t.type === "expense") { expense += t.amt; monthMap[mo].expense += t.amt; balDelta[mo] -= t.amt; catMap[t.category] = (catMap[t.category] || 0) + t.amt; }
    if (t.type === "investment") { investment += t.amt; monthMap[mo].investment += t.amt; balDelta[mo] -= t.amt; }
    if (t.type === "loan") { loan += t.amt; monthMap[mo].loan += t.amt; }
    if (t.type === "expense") { payMap[t.payment] = (payMap[t.payment] || 0) + t.amt; }
  });

  const months = Object.keys(monthMap).sort();
  let running = 0;
  const runningBalance = months.map((mo) => { running += balDelta[mo]; return running; });
  const netBalance = income - expense - investment;
  const savingsRate = income > 0 ? ((income - expense) / income) * 100 : 0;
  const topCat = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0] || null;

  return { income, expense, investment, loan, netBalance, savingsRate, monthMap, months, runningBalance, catMap, payMap, topCat, count: txns.length };
}

function getFilteredTxns() {
  let txns = SELECTED_YEAR === "all" ? ALL_TXNS : ALL_TXNS.filter((t) => t.year === SELECTED_YEAR);
  if (SELECTED_MONTH !== "all") txns = txns.filter((t) => monthKey(t.date) === SELECTED_MONTH);
  return txns;
}

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────
function buildYearNav() {
  const pills = document.getElementById("yearPills");
  const prev = document.getElementById("yearPrev");
  const next = document.getElementById("yearNext");

  if (prev) prev.disabled = YEAR_WINDOW_START === 0;
  if (next) next.disabled = YEAR_WINDOW_START + PILLS_VISIBLE >= ALL_YEARS.length;

  const visible = ALL_YEARS.slice(YEAR_WINDOW_START, YEAR_WINDOW_START + PILLS_VISIBLE);
  if (pills) {
    pills.innerHTML = "";

    const allPill = document.createElement("button");
    allPill.className = "year-pill all-pill" + (SELECTED_YEAR === "all" ? " active" : "");
    allPill.textContent = "All";
    allPill.onclick = () => selectYear("all");
    pills.appendChild(allPill);

    visible.forEach((yr) => {
      const pill = document.createElement("button");
      pill.className = "year-pill" + (SELECTED_YEAR === yr ? " active" : "");
      pill.textContent = yr;
      pill.onclick = () => selectYear(yr);
      pills.appendChild(pill);
    });
  }
}

window.shiftYear = function(dir) {
  YEAR_WINDOW_START = Math.max(0, Math.min(ALL_YEARS.length - PILLS_VISIBLE, YEAR_WINDOW_START + dir));
  buildYearNav();
};

function selectYear(yr) {
  SELECTED_YEAR = yr;
  SELECTED_MONTH = "all";
  const monthSelect = document.getElementById("monthFilter");
  if (monthSelect) monthSelect.value = "all";
  renderDashboard();
  showToast(`Showing ${yr === "all" ? "all years" : yr}`, "success");
}

function populateMonthFilter() {
  const monthSelect = document.getElementById("monthFilter");
  if (!monthSelect) return;

  let txns = SELECTED_YEAR === "all" ? ALL_TXNS : ALL_TXNS.filter((t) => t.year === SELECTED_YEAR);
  const months = [...new Set(txns.map((t) => monthKey(t.date)))].sort();

  monthSelect.innerHTML = '<option value="all">📅 All Months</option>';
  
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
  const targetKey = `${currentYear}-${currentMonth}`;
  
  months.forEach((month) => {
    const option = document.createElement("option");
    option.value = month;
    option.textContent = monthLabel(month) + " " + month.split("-")[0];
    if (month === targetKey) {
      option.selected = true;
      SELECTED_MONTH = month;
    }
    monthSelect.appendChild(option);
  });

  if (SELECTED_MONTH === "all" && months.length > 0) {
    SELECTED_MONTH = months[months.length - 1];
    monthSelect.value = SELECTED_MONTH;
  }

  monthSelect.onchange = (e) => {
    SELECTED_MONTH = e.target.value;
    renderDashboard();
    showToast(`Filtered to ${SELECTED_MONTH === "all" ? "all months" : monthLabel(SELECTED_MONTH)}`, "success");
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function renderDashboard() {
  const txns = getFilteredTxns();
  const s = computeStats(txns);

  const lbl = document.getElementById("viewLabel");
  const dsc = document.getElementById("viewDesc");
  if (lbl) {
    if (SELECTED_YEAR === "all") {
      lbl.textContent = "All Time";
      if (dsc) dsc.textContent = ALL_YEARS.length > 0 ? ALL_YEARS[0] + " – " + ALL_YEARS[ALL_YEARS.length - 1] : "";
    } else {
      lbl.textContent = String(SELECTED_YEAR);
      if (dsc) dsc.textContent = s.count + " transactions";
    }
    if (SELECTED_MONTH !== "all" && dsc) dsc.textContent += ` · ${monthLabel(SELECTED_MONTH)}`;
  }

  renderKPIs(s);
  renderChips(s);
  renderMonthly(s);
  renderExpenseCatChart(s);
  renderIncomeCatChart(txns);
  renderDailyBalance(); // FIXED: Now working properly
  renderPayment(s);
  renderYoYCombined();
  renderAnnualTable();
  renderTransactions(txns);
}

function renderKPIs(s) {
  const container = document.getElementById("kpiRow");
  if (!container) return;
  
  const balClass = s.netBalance >= 0 ? "pos" : "neg";
  const savLabel = s.savingsRate >= 20 ? "🎯 Great savings!" : s.savingsRate >= 10 ? "👍 On track" : "📈 Build savings";

  container.innerHTML = `
    <div class="kpi income">
      <div class="kpi-icon"><span class="kpi-dot"></span>Total Income</div>
      <div class="kpi-val">${fmtMoney(s.income)}</div>
      <div class="kpi-sub">All income sources</div>
    </div>
    <div class="kpi expense">
      <div class="kpi-icon"><span class="kpi-dot"></span>Total Expenses</div>
      <div class="kpi-val">${fmtMoney(s.expense)}</div>
      <div class="kpi-sub">All spending</div>
    </div>
    <div class="kpi invest">
      <div class="kpi-icon"><span class="kpi-dot"></span>Invested</div>
      <div class="kpi-val">${fmtMoney(s.investment)}</div>
      <div class="kpi-sub">Investments made</div>
    </div>
    <div class="kpi balance">
      <div class="kpi-icon"><span class="kpi-dot"></span>Net Balance</div>
      <div class="kpi-val ${balClass}">${fmtMoney(s.netBalance)}</div>
      <div class="kpi-sub">Income − expenses − investments</div>
    </div>
    <div class="kpi savings">
      <div class="kpi-icon"><span class="kpi-dot"></span>Savings Rate</div>
      <div class="kpi-val">${Math.round(s.savingsRate)}%</div>
      <div class="kpi-sub">${savLabel}</div>
    </div>
  `;
}

function renderChips(s) {
  const container = document.getElementById("chipRow");
  if (!container) return;
  
  const chips = [];
  if (s.topCat) chips.push({ text: `Biggest spend: <strong>${s.topCat[0]}</strong> — ${fmtMoney(s.topCat[1])}`, cls: "" });
  chips.push({ text: `<strong>${s.count}</strong> transactions`, cls: "" });
  if (s.savingsRate >= 20) chips.push({ text: `Saving <strong>${Math.round(s.savingsRate)}%</strong> of income`, cls: "good" });
  else if (s.savingsRate < 10 && s.income > 0) chips.push({ text: `Savings rate is low at <strong>${Math.round(s.savingsRate)}%</strong>`, cls: "warn" });
  const topPay = Object.entries(s.payMap).sort((a, b) => b[1] - a[1])[0];
  if (topPay) chips.push({ text: `Most used: <strong>${topPay[0]}</strong>`, cls: "" });

  container.innerHTML = chips.map(c => `<div class="chip ${c.cls}">${c.text}</div>`).join("");
}

function renderMonthly(s) {
  destroyChart("monthly");
  const legend = document.getElementById("cashLegend");
  if (legend) {
    legend.innerHTML = [
      ["#10b981", "Income"], ["#ef4444", "Expenses"], ["#3b82f6", "Investment"]
    ].map(([c, l]) => `<span><span class="leg-sq" style="background:${c}"></span>${l}</span>`).join("");
  }

  if (!s.months.length) return;

  const ctx = document.getElementById("monthlyChart");
  if (!ctx) return;

  charts["monthly"] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: s.months.map(monthLabel),
      datasets: [
        { label: "Income", data: s.months.map(m => s.monthMap[m].income), backgroundColor: "#10b981", borderRadius: 8 },
        { label: "Expenses", data: s.months.map(m => s.monthMap[m].expense), backgroundColor: "#ef4444", borderRadius: 8 },
        { label: "Investment", data: s.months.map(m => s.monthMap[m].investment), backgroundColor: "#3b82f6", borderRadius: 8 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => " " + ctx.dataset.label + ": " + fmtMoney(ctx.parsed.y, 2) } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => fmtShort(v) } } }
    }
  });
}

function renderExpenseCatChart(stats) {
  destroyChart("expenseCatChart");
  const entries = Object.entries(stats.catMap).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  const totalSpan = document.getElementById("expCatTotal");
  if (totalSpan) totalSpan.innerHTML = `Total: ${fmtMoney(total)} | ${entries.length} categories`;

  if (!entries.length) return;

  const ctx = document.getElementById("expenseCatChart");
  if (!ctx) return;

  charts["expenseCatChart"] = new Chart(ctx, {
    type: "bar",
    data: { labels: entries.map(([cat]) => cat), datasets: [{ label: "Amount Spent", data: entries.map(([, amt]) => amt), backgroundColor: "#ef4444", borderRadius: 8 }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => fmtShort(v) } } } }
  });
}

function renderIncomeCatChart(txns) {
  destroyChart("incomeCatChart");
  const incMap = {};
  txns.forEach(t => { if (t.type === "income") incMap[t.category] = (incMap[t.category] || 0) + t.amt; });
  const entries = Object.entries(incMap).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  const totalSpan = document.getElementById("incCatTotal");
  if (totalSpan) totalSpan.innerHTML = `Total: ${fmtMoney(total)} | ${entries.length} categories`;

  if (!entries.length) return;

  const ctx = document.getElementById("incomeCatChart");
  if (!ctx) return;

  charts["incomeCatChart"] = new Chart(ctx, {
    type: "bar",
    data: { labels: entries.map(([cat]) => cat), datasets: [{ label: "Income Received", data: entries.map(([, amt]) => amt), backgroundColor: "#10b981", borderRadius: 8 }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => fmtShort(v) } } } }
  });
}

// FIXED: Daily Balance Timeline - Now Working!
function renderDailyBalance() {
  destroyChart("dailyBalanceChart");
  
  const txns = getFilteredTxns();
  if (txns.length === 0) {
    console.log("No transactions for daily balance");
    return;
  }

  // Sort transactions by date (oldest first for running balance)
  const sortedTxns = [...txns].sort((a, b) => a.date - b.date);
  
  // Calculate running balance day by day
  const balanceOverTime = [];
  let runningBalance = 0;
  
  // Group by date to show daily balances
  const dailyMap = new Map();
  
  sortedTxns.forEach(t => {
    // Calculate delta based on transaction type
    let delta = 0;
    if (t.type === "income") {
      delta = t.amt;
    } else if (t.type === "expense" || t.type === "investment") {
      delta = -t.amt;
    }
    
    runningBalance += delta;
    
    const dateKey = t.date.toISOString().split('T')[0];
    // Only keep the latest balance for each day (or we can average, but latest is fine)
    dailyMap.set(dateKey, {
      date: t.date,
      balance: runningBalance
    });
  });
  
  // Convert to array and sort by date
  const dailyData = Array.from(dailyMap.values()).sort((a, b) => a.date - b.date);
  
  if (dailyData.length === 0) {
    console.log("No daily balance data to display");
    return;
  }
  
  // Format dates for display
  const labels = dailyData.map(d => d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  const balances = dailyData.map(d => d.balance);
  
  const ctx = document.getElementById("dailyBalanceChart");
  if (!ctx) {
    console.error("Daily balance chart canvas not found");
    return;
  }
  
  charts["dailyBalanceChart"] = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: "Running Balance",
        data: balances,
        borderColor: "#8b5cf6",
        backgroundColor: "rgba(139, 92, 246, 0.1)",
        borderWidth: 3,
        fill: true,
        tension: 0.4,
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
            label: (context) => {
              return ` Balance: ${fmtMoney(context.parsed.y, 2)}`;
            }
          }
        }
      },
      scales: {
        y: {
          ticks: { 
            callback: (v) => fmtShort(v),
            color: "#475569"
          },
          grid: { color: "#e2e8f0" },
          title: { display: true, text: "Balance ($)", color: "#475569" }
        },
        x: {
          ticks: { 
            maxRotation: 45,
            minRotation: 45,
            autoSkip: true,
            maxTicksLimit: 10
          },
          grid: { display: false },
          title: { display: true, text: "Date", color: "#475569" }
        }
      },
      interaction: {
        mode: 'index',
        intersect: false
      }
    }
  });
  
  console.log(`Daily balance chart created with ${dailyData.length} data points`);
}

function renderPayment(s) {
  destroyChart("paymentChart");
  const entries = Object.entries(s.payMap).sort((a, b) => b[1] - a[1]);
  const legend = document.getElementById("paymentLegend");

  if (!entries.length) { 
    if (legend) legend.innerHTML = "<p class='text-muted'>No payment data</p>"; 
    return; 
  }

  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];

  const ctx = document.getElementById("paymentChart");
  if (!ctx) return;

  charts["paymentChart"] = new Chart(ctx, {
    type: "doughnut",
    data: { 
      labels: entries.map(([k]) => k), 
      datasets: [{ 
        data: entries.map(([, v]) => v), 
        backgroundColor: colors.slice(0, entries.length), 
        borderWidth: 2, 
        borderColor: "#fff" 
      }] 
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false, 
      cutout: "65%", 
      plugins: { 
        legend: { display: false }, 
        tooltip: { callbacks: { label: ctx => " " + ctx.label + ": " + fmtMoney(ctx.parsed) } } 
      } 
    }
  });

  if (legend) {
    legend.innerHTML = entries.map(([pay, amt], i) => `
      <div class="donut-leg-item">
        <span class="donut-leg-dot" style="background:${colors[i % colors.length]}"></span>
        <span class="donut-leg-label">${pay}</span>
        <span class="donut-leg-val">${fmtMoney(amt)}</span>
      </div>
    `).join("");
  }
}

function renderYoYCombined() {
  destroyChart("yoyChart");
  const years = [...new Set(ALL_TXNS.map(t => t.year))].sort();
  
  const incomeData = years.map(year => ALL_TXNS.filter(t => t.year === year && t.type === "income").reduce((s, t) => s + t.amt, 0));
  const expenseData = years.map(year => ALL_TXNS.filter(t => t.year === year && t.type === "expense").reduce((s, t) => s + t.amt, 0));
  const investmentData = years.map(year => ALL_TXNS.filter(t => t.year === year && t.type === "investment").reduce((s, t) => s + t.amt, 0));

  const legend = document.getElementById("yoyLegend");
  if (legend) legend.innerHTML = `<span><span class="leg-sq" style="background:#10b981"></span>Income</span><span><span class="leg-sq" style="background:#ef4444"></span>Expenses</span><span><span class="leg-sq" style="background:#3b82f6"></span>Investments</span>`;

  const ctx = document.getElementById("yoyChart");
  if (!ctx) return;

  charts["yoyChart"] = new Chart(ctx, {
    type: "bar",
    data: { labels: years, datasets: [
      { label: "Income", data: incomeData, backgroundColor: "#10b981", borderRadius: 8, barPercentage: 0.7 },
      { label: "Expenses", data: expenseData, backgroundColor: "#ef4444", borderRadius: 8, barPercentage: 0.7 },
      { label: "Investments", data: investmentData, backgroundColor: "#3b82f6", borderRadius: 8, barPercentage: 0.7 }
    ] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { color: "#fff" } }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y, 2)}` } } },
      scales: { y: { ticks: { callback: v => fmtShort(v), color: "#fff" }, grid: { color: "rgba(255,255,255,0.1)" } }, x: { ticks: { color: "#fff" }, grid: { display: false } } }
    }
  });
}

function renderAnnualTable() {
  const yearlyStats = [...new Set(ALL_TXNS.map(t => t.year))].sort().map(year => {
    const txns = ALL_TXNS.filter(t => t.year === year);
    const stats = computeStats(txns);
    return { year, ...stats };
  });
  
  const body = document.getElementById("annualBody");
  if (!body) return;
  
  if (!yearlyStats.length) { body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px">No data yet</td></tr>'; return; }

  const totals = yearlyStats.reduce((acc, y) => { acc.income += y.income; acc.expense += y.expense; acc.investment += y.investment; acc.count += y.count; return acc; }, { income: 0, expense: 0, investment: 0, count: 0 });
  totals.net = totals.income - totals.expense - totals.investment;
  totals.savings = totals.income > 0 ? ((totals.income - totals.expense) / totals.income) * 100 : 0;

  body.innerHTML = [...yearlyStats].reverse().map(y => {
    const savCls = y.savingsRate >= 20 ? "good" : y.savingsRate >= 10 ? "ok" : "low";
    const netCls = y.netBalance >= 0 ? "c-green" : "c-red";
    return `<tr class="clickable-row" data-year="${y.year}" style="${SELECTED_YEAR === y.year ? "background:var(--bg-tertiary)" : ""}">
      <td class="yr-cell">${y.year}</td>
      <td class="mono c-green">${fmtMoney(y.income)}</td>
      <td class="mono c-red">${fmtMoney(y.expense)}</td>
      <td class="mono c-blue">${fmtMoney(y.investment)}</td>
      <td class="mono ${netCls}">${fmtMoney(y.netBalance)}</td>
      <td><span class="savings-badge ${savCls}">${Math.round(y.savingsRate)}%</span></td>
      <td class="mono">${y.count}</td>
    </tr>`;
  }).join('') + `<tr style="border-top:2px solid var(--border-light);font-weight:600">
    <td class="yr-cell">All Time</td>
    <td class="mono c-green">${fmtMoney(totals.income)}</td>
    <td class="mono c-red">${fmtMoney(totals.expense)}</td>
    <td class="mono c-blue">${fmtMoney(totals.investment)}</td>
    <td class="mono ${totals.net >= 0 ? "c-green" : "c-red"}">${fmtMoney(totals.net)}</td>
    <td><span class="savings-badge ${totals.savings >= 20 ? "good" : totals.savings >= 10 ? "ok" : "low"}">${Math.round(totals.savings)}%</span></td>
    <td class="mono">${totals.count}</td>
  </tr>`;

  document.querySelectorAll("#annualBody .clickable-row").forEach(row => {
    row.addEventListener("click", () => selectYear(parseInt(row.dataset.year)));
  });
}

function renderTransactions(txns) {
  const recent = txns.slice(0, 25);
  const meta = document.getElementById("txMeta");
  if (meta) meta.textContent = (SELECTED_YEAR === "all" ? "All time" : SELECTED_YEAR) + (SELECTED_MONTH !== "all" ? ` · ${monthLabel(SELECTED_MONTH)}` : "") + ` · showing ${recent.length} of ${txns.length}`;
  
  const body = document.getElementById("txBody");
  if (!body) return;
  
  if (!recent.length) { body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px">No transactions</td></tr>'; return; }
  
  body.innerHTML = recent.map(t => `
    <tr>
      <td class="tx-date">${fmtDate(t.date)}</td>
      <td><span class="badge ${t.type}">${cap(t.type)}</span></td>
      <td>${t.category}</td>
      <td>${t.payment}</td>
      <td class="tx-amt ${t.type}">${t.type === "income" ? "+" : "−"}${fmtMoney(t.amt, 2)}</td>
    </tr>
  `).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT FUNCTION
// ─────────────────────────────────────────────────────────────────────────────
window.exportToCSV = function() {
  const txns = getFilteredTxns();
  if (txns.length === 0) {
    showToast("No data to export", "warning");
    return;
  }
  
  const headers = ["Date", "Type", "Category", "Payment Method", "Amount"];
  const rows = txns.map(t => [
    t.date.toISOString().split('T')[0],
    t.type,
    t.category,
    t.payment,
    t.amt
  ]);
  
  const csvContent = [headers, ...rows].map(row => row.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `finance_export_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${txns.length} transactions to CSV`, "success");
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTO REFRESH
// ─────────────────────────────────────────────────────────────────────────────
function startAutoRefresh(minutes = 5) {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  autoRefreshInterval = setInterval(() => {
    refreshData();
  }, minutes * 60 * 1000);
  console.log(`Auto-refresh enabled every ${minutes} minutes`);
}

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH DATA FROM GOOGLE SHEETS
// ─────────────────────────────────────────────────────────────────────────────
window.refreshData = async function() {
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    refreshBtn.style.transform = "rotate(180deg)";
  }
  
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
    if (idx >= 0) YEAR_WINDOW_START = Math.max(0, idx - Math.floor(PILLS_VISIBLE / 2));
    
    buildYearNav();
    populateMonthFilter();
    renderDashboard();
    
    const syncSpan = document.getElementById("lastSync");
    if (syncSpan) syncSpan.textContent = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    
    showToast(`Loaded ${ALL_TXNS.length} transactions`, "success");
  } catch (err) {
    console.error("Refresh error:", err);
    showToast("Failed to refresh data. Check your sheet sharing settings.", "error");
  } finally {
    if (refreshBtn) {
      setTimeout(() => { refreshBtn.style.transform = ""; }, 500);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────
async function boot() {
  const loadingState = document.getElementById("loadingState");
  const errorState = document.getElementById("errorState");
  const dashboard = document.getElementById("dashboard");
  
  try {
    const timeoutId = setTimeout(() => {
      if (ALL_TXNS.length === 0 && loadingState) {
        loadingState.innerHTML = '<div class="loader-ring"></div><p>Still loading... This may take a moment</p><p class="loading-hint">Check your internet connection</p>';
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
    if (idx >= 0) YEAR_WINDOW_START = Math.max(0, idx - Math.floor(PILLS_VISIBLE / 2));
    
    if (loadingState) loadingState.style.display = "none";
    if (dashboard) dashboard.style.display = "block";
    
    const syncSpan = document.getElementById("lastSync");
    if (syncSpan) syncSpan.textContent = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    
    buildYearNav();
    populateMonthFilter();
    renderDashboard();
    
    // Start auto-refresh every 5 minutes
    startAutoRefresh(5);
    
    showToast("Dashboard ready! Data loaded successfully.", "success");
  } catch (err) {
    console.error("Boot error:", err);
    if (loadingState) loadingState.style.display = "none";
    if (errorState) errorState.style.display = "block";
    
    const errorMsg = document.querySelector(".error-message");
    if (errorMsg) {
      if (err.message.includes("HTTP 404")) {
        errorMsg.innerHTML = "Google Sheet not found. Please check that your sheet is shared publicly.";
      } else if (err.message.includes("Failed to fetch")) {
        errorMsg.innerHTML = "Network error. Check your internet connection and ensure CORS is not blocked.";
      } else {
        errorMsg.innerHTML = `Error: ${err.message}. Make sure your sheet is shared with "Anyone with link" and has data.`;
      }
    }
  }
}

// Start the application
boot();