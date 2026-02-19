// Dashboard State
let allIssues = [];
let allProjects = [];
let allInitiatives = [];
let metricsChartInstance = null;
let lastUpdate = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    await fetchData();
    renderDashboard();

    // Auto-refresh every 10 minutes
    setInterval(async () => {
        await fetchData();
        renderDashboard();
    }, CONFIG.REFRESH_INTERVAL);

    // Manual refresh button
    document.getElementById('refresh-btn').addEventListener('click', async () => {
        await fetchData();
        renderDashboard();
    });
});

// Shared fetch helper — one GraphQL call through the Worker
async function callWorker(query) {
    const response = await fetch(CONFIG.WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const result = await response.json();
    if (result.errors) console.warn('GraphQL errors:', result.errors);
    return result.data || null;
}

// Fetch data from Linear API (via Cloudflare Worker proxy)
// Issues and projects are fetched independently so one failure doesn't blank both.
async function fetchData() {
    await Promise.all([fetchIssues(), fetchProjects()]);

    lastUpdate = new Date();
    document.getElementById('last-updated').textContent =
        `Updated: ${lastUpdate.toLocaleTimeString()}`;
}

async function fetchIssues() {
    try {
        const data = await callWorker(`
            query {
                issues(
                    first: 250
                    filter: { team: { id: { eq: "${CONFIG.TEAM_ID}" } } }
                    orderBy: updatedAt
                ) {
                    nodes {
                        id identifier title
                        state { name type }
                        priority priorityLabel dueDate
                        project { id name }
                        url
                        assignee { name }
                    }
                }
            }
        `);
        allIssues = data?.issues?.nodes || [];
    } catch (e) {
        console.error('Issues fetch failed:', e);
    }
}

async function fetchProjects() {
    try {
        const data = await callWorker(`
            query {
                projects(first: 50, orderBy: updatedAt) {
                    nodes {
                        id name color startDate targetDate url
                        status { name }
                        initiatives { nodes { id name } }
                    }
                }
            }
        `);
        allProjects = data?.projects?.nodes || [];
        // Build initiative list from project relationships
        const initMap = {};
        allProjects.forEach(p => {
            (p.initiatives?.nodes || []).forEach(init => {
                initMap[init.id] = init;
            });
        });
        allInitiatives = Object.values(initMap);
    } catch (e) {
        console.error('Projects fetch failed:', e);
    }
}

// Render dashboard — Gantt first, then issue detail sections
function renderDashboard() {
    renderGantt();
    renderSummaryCards();
    renderUrgentDeadlines();
    renderActiveWork();
    renderInReview();
    renderBlockedIssues();
    renderMetricsChart();
}

// ─── Gantt Chart ───────────────────────────────────────────────────────────────

function renderGantt() {
    const container = document.getElementById('gantt-chart');

    if (allProjects.length === 0) {
        container.innerHTML = '<p class="loading">No projects found</p>';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate date range from all project start/end dates
    const allDates = allProjects
        .flatMap(p => [p.startDate, p.targetDate].filter(Boolean))
        .map(d => parseLocalDate(d));

    let rangeStart, rangeEnd;
    if (allDates.length > 0) {
        const minDate = new Date(Math.min(...allDates));
        const maxDate = new Date(Math.max(...allDates));
        // Snap to month boundaries
        rangeStart = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        rangeEnd   = new Date(maxDate.getFullYear(), maxDate.getMonth() + 2, 0);
    } else {
        rangeStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        rangeEnd   = new Date(today.getFullYear(), today.getMonth() + 4, 0);
    }

    // Ensure today is always visible
    if (today < rangeStart) rangeStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    if (today > rangeEnd)   rangeEnd   = new Date(today.getFullYear(), today.getMonth() + 2, 0);

    const totalMs   = rangeEnd - rangeStart;
    const todayPct  = toGanttPct(today, rangeStart, totalMs);

    // Build list of first-of-month markers
    const months = [];
    let m = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    while (m <= rangeEnd) {
        months.push(new Date(m));
        m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    }

    // Group projects under their initiative
    const groups = {}; // initiativeId → { id, name, targetDate, projects[] }
    const unassigned = [];

    allInitiatives.forEach(init => {
        groups[init.id] = { ...init, projects: [] };
    });

    allProjects.forEach(project => {
        const inits = project.initiatives?.nodes || [];
        if (inits.length > 0) {
            const init = inits[0]; // assign to first initiative
            if (!groups[init.id]) {
                groups[init.id] = { id: init.id, name: init.name, targetDate: null, projects: [] };
            }
            groups[init.id].projects.push(project);
        } else {
            unassigned.push(project);
        }
    });

    // Build HTML rows
    let rows = '';

    Object.values(groups)
        .filter(g => g.projects.length > 0)
        .forEach(initiative => {
            // Derive initiative time span from its projects
            const projDates = initiative.projects
                .flatMap(p => [p.startDate, p.targetDate].filter(Boolean))
                .map(d => parseLocalDate(d));

            let initBar = '';
            if (projDates.length > 0) {
                const s = toGanttPct(new Date(Math.min(...projDates)), rangeStart, totalMs);
                const rawEnd = initiative.targetDate
                    ? parseLocalDate(initiative.targetDate)
                    : new Date(Math.max(...projDates));
                const e = toGanttPct(rawEnd, rangeStart, totalMs);
                const w = Math.max(0.5, e - s);
                initBar = `<div class="gantt-initiative-bar" style="left:${s.toFixed(2)}%;width:${w.toFixed(2)}%" title="${escapeHtml(initiative.name)}"></div>`;
            }

            rows += `
                <div class="gantt-row gantt-initiative-row">
                    <div class="gantt-label gantt-initiative-label">${escapeHtml(initiative.name)}</div>
                    <div class="gantt-timeline">
                        <div class="gantt-today-line" style="left:${todayPct.toFixed(2)}%"></div>
                        ${initBar}
                    </div>
                </div>`;

            initiative.projects.forEach(p => {
                rows += renderProjectRow(p, today, rangeStart, totalMs, todayPct);
            });
        });

    if (unassigned.length > 0) {
        const hasInitiatives = Object.values(groups).some(g => g.projects.length > 0);
        if (hasInitiatives) {
            rows += `
                <div class="gantt-row gantt-initiative-row">
                    <div class="gantt-label gantt-initiative-label">Other Projects</div>
                    <div class="gantt-timeline">
                        <div class="gantt-today-line" style="left:${todayPct.toFixed(2)}%"></div>
                    </div>
                </div>`;
        }
        unassigned.forEach(p => {
            rows += renderProjectRow(p, today, rangeStart, totalMs, todayPct);
        });
    }

    // Month label header row
    let monthLabels = '';
    months.forEach(mo => {
        const pct = toGanttPct(mo, rangeStart, totalMs);
        const label = mo.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        monthLabels += `<div class="gantt-month-mark" style="left:${pct.toFixed(2)}%">
            <div class="gantt-grid-line"></div>
            <div class="gantt-month-label">${label}</div>
        </div>`;
    });

    container.innerHTML = `
        <div class="gantt-wrap">
            <div class="gantt-row gantt-header-row">
                <div class="gantt-label"></div>
                <div class="gantt-timeline gantt-header-timeline">
                    ${monthLabels}
                    <div class="gantt-today-line gantt-today-header" style="left:${todayPct.toFixed(2)}%">
                        <span class="gantt-today-label">Today</span>
                    </div>
                </div>
            </div>
            ${rows}
        </div>`;
}

function renderProjectRow(project, today, rangeStart, totalMs, todayPct) {
    const start = project.startDate ? parseLocalDate(project.startDate) : null;
    const end   = project.targetDate ? parseLocalDate(project.targetDate) : null;

    const stateName = project.status?.name || '';
    const stateType = ''; // derive from name only
    const isOverdue = end && end < today
        && !stateName.toLowerCase().includes('complet')
        && !stateName.toLowerCase().includes('cancel');

    const cls = ganttBarClass(stateType, stateName, isOverdue);

    let barHtml = '';
    if (start || end) {
        const s = toGanttPct(start || today, rangeStart, totalMs);
        const e = toGanttPct(end   || new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000), rangeStart, totalMs);
        const w = Math.max(0.5, e - s);
        const tipDates = `${start ? start.toLocaleDateString() : 'No start'} → ${end ? end.toLocaleDateString() : 'No target'}`;
        barHtml = `<div class="gantt-bar ${cls}"
            style="left:${s.toFixed(2)}%;width:${w.toFixed(2)}%"
            title="${escapeHtml(project.name + ' · ' + stateName + ' · ' + tipDates)}">
            ${w > 8 ? `<span>${escapeHtml(project.name)}</span>` : ''}
        </div>`;
    } else {
        barHtml = `<span class="gantt-no-date">No dates set</span>`;
    }

    const pillClass = ganttPillClass(stateType, stateName, isOverdue);

    return `
        <div class="gantt-row gantt-project-row">
            <div class="gantt-label">
                <span class="gantt-indent">↳</span>
                <a href="${project.url}" target="_blank" title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</a>
                <span class="gantt-pill ${pillClass}">${escapeHtml(stateName || 'Unknown')}</span>
            </div>
            <div class="gantt-timeline">
                <div class="gantt-today-line" style="left:${todayPct.toFixed(2)}%"></div>
                ${barHtml}
            </div>
        </div>`;
}

function toGanttPct(date, rangeStart, totalMs) {
    return Math.max(0, Math.min(100, (new Date(date) - rangeStart) / totalMs * 100));
}

function ganttBarClass(type, name, isOverdue) {
    if (isOverdue) return 'bar-overdue';
    const n = (name + ' ' + type).toLowerCase();
    if (n.includes('complet')) return 'bar-completed';
    if (n.includes('cancel'))  return 'bar-cancelled';
    if (n.includes('progress') || n.includes('active') || n.includes('started') || n.includes('inprogress')) return 'bar-active';
    if (n.includes('hold') || n.includes('pause'))     return 'bar-paused';
    return 'bar-backlog';
}

function ganttPillClass(type, name, isOverdue) {
    if (isOverdue) return 'pill-overdue';
    const n = (name + ' ' + type).toLowerCase();
    if (n.includes('complet')) return 'pill-completed';
    if (n.includes('cancel'))  return 'pill-cancelled';
    if (n.includes('progress') || n.includes('active') || n.includes('started') || n.includes('inprogress')) return 'pill-active';
    return 'pill-default';
}

// ─── Summary Cards ─────────────────────────────────────────────────────────────

function renderSummaryCards() {
    const urgent  = allIssues.filter(i =>
        i.priorityLabel === 'Urgent' &&
        !['Done', 'Canceled', 'Duplicate'].includes(i.state.name)
    );
    const active  = allIssues.filter(i => ['In Progress', 'Active'].includes(i.state.name));
    const blocked = allIssues.filter(i => i.state.name === 'Blocked');
    const done    = allIssues.filter(i => i.state.name === 'Done');

    document.getElementById('urgent-count').textContent  = urgent.length;
    document.getElementById('active-count').textContent  = active.length;
    document.getElementById('blocked-count').textContent = blocked.length;
    document.getElementById('done-count').textContent    = done.length;
}

// ─── Urgent Deadlines ──────────────────────────────────────────────────────────

function renderUrgentDeadlines() {
    const today    = new Date();
    const sevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    const urgentDeadlines = allIssues
        .filter(i => {
            if (!i.dueDate) return false;
            if (['Done', 'Canceled', 'Duplicate'].includes(i.state.name)) return false;
            return parseLocalDate(i.dueDate) <= sevenDays;
        })
        .sort((a, b) => parseLocalDate(a.dueDate) - parseLocalDate(b.dueDate));

    const container = document.getElementById('urgent-deadlines');
    container.innerHTML = urgentDeadlines.length === 0
        ? '<p class="loading">No urgent deadlines in the next 7 days ✅</p>'
        : urgentDeadlines.map(i => renderIssueItem(i, true)).join('');
}

// ─── Active Work ───────────────────────────────────────────────────────────────

function renderActiveWork() {
    const activeIssues = allIssues
        .filter(i => ['In Progress', 'Active'].includes(i.state.name))
        .sort((a, b) => {
            const order = { 'Urgent': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'No priority': 4 };
            const ap = order[a.priorityLabel] ?? 4;
            const bp = order[b.priorityLabel] ?? 4;
            if (ap !== bp) return ap - bp;
            if (a.dueDate && !b.dueDate) return -1;
            if (!a.dueDate && b.dueDate) return 1;
            if (a.dueDate && b.dueDate) return parseLocalDate(a.dueDate) - parseLocalDate(b.dueDate);
            return 0;
        });

    const container = document.getElementById('active-work');
    container.innerHTML = activeIssues.length === 0
        ? '<p class="loading">No active work</p>'
        : activeIssues.map(i => renderIssueItem(i)).join('');
}

// ─── In Review ─────────────────────────────────────────────────────────────────

function renderInReview() {
    const inReviewIssues = allIssues.filter(i => i.state.name === 'In Review');

    const container = document.getElementById('in-review');
    container.innerHTML = inReviewIssues.length === 0
        ? '<p class="loading">Nothing in review right now</p>'
        : inReviewIssues.map(i => renderIssueItem(i)).join('');
}

// ─── Blocked Issues ────────────────────────────────────────────────────────────

function renderBlockedIssues() {
    const blockedIssues = allIssues.filter(i => i.state.name === 'Blocked');

    const container = document.getElementById('blocked-issues');
    container.innerHTML = blockedIssues.length === 0
        ? '<p class="loading">No blocked issues ✅</p>'
        : blockedIssues.map(i => renderIssueItem(i)).join('');
}

// ─── Issue Item ────────────────────────────────────────────────────────────────

function renderIssueItem(issue, showDueDate = false) {
    const priorityClass = issue.priorityLabel
        ? `priority-${issue.priorityLabel.toLowerCase()}` : '';

    const dueInfo = issue.dueDate
        ? `<span class="due-soon">📅 Due ${formatDate(issue.dueDate)}</span>` : '';

    const statusBadge = `<span class="status-badge status-${issue.state.name.toLowerCase().replace(/ /g, '-')}">${issue.state.name}</span>`;

    const projectInfo = issue.project ? `<span>📁 ${escapeHtml(issue.project.name)}</span>` : '';
    const assigneeInfo = issue.assignee ? `<span>👤 ${escapeHtml(issue.assignee.name)}</span>` : '';

    return `
        <div class="issue-item">
            <div class="issue-header">
                <div>
                    <a href="${issue.url}" target="_blank" class="issue-id">${issue.identifier}</a>
                    <div class="issue-title">${escapeHtml(issue.title)}</div>
                </div>
                ${statusBadge}
            </div>
            <div class="issue-meta">
                ${issue.priorityLabel ? `<span class="${priorityClass}">⚡ ${issue.priorityLabel}</span>` : ''}
                ${projectInfo}
                ${assigneeInfo}
                ${showDueDate || issue.dueDate ? dueInfo : ''}
            </div>
        </div>`;
}

// ─── Metrics Chart ─────────────────────────────────────────────────────────────

function renderMetricsChart() {
    const ctx = document.getElementById('metrics-chart');

    const statusCounts = {
        'Backlog': 0, 'Todo': 0, 'In Progress': 0,
        'Active': 0, 'Blocked': 0, 'In Review': 0, 'Done': 0
    };
    allIssues.forEach(issue => {
        if (Object.prototype.hasOwnProperty.call(statusCounts, issue.state.name)) {
            statusCounts[issue.state.name]++;
        }
    });

    // Destroy previous instance before recreating (prevents duplicate charts on refresh)
    if (metricsChartInstance) {
        metricsChartInstance.destroy();
        metricsChartInstance = null;
    }

    metricsChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(statusCounts),
            datasets: [{
                label: 'Issue Count',
                data: Object.values(statusCounts),
                backgroundColor: [
                    '#6c757d', '#ffc107', '#fd7e14',
                    '#dc3545', '#6c757d', '#17a2b8', '#28a745'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'Issues by Status' }
            },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 5 } } }
        }
    });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Parse a YYYY-MM-DD date string as local midnight (not UTC midnight).
// JS treats bare date strings as UTC, which shifts the displayed date by one day
// for timezones behind UTC (e.g., US Eastern).
function parseLocalDate(str) {
    if (!str) return null;
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function formatDate(dateString) {
    const date  = parseLocalDate(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString())    return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';

    const diff = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
    if (diff < 7 && diff > 0) return `in ${diff} days`;
    if (diff < 0) return `${Math.abs(diff)} days ago (OVERDUE)`;
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
