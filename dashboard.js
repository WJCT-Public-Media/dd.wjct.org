// Dashboard State
let allIssues = [];
let allProjects = [];
let allInitiatives = [];
let metricsChartInstance = null;
let lastUpdate = null;
let ganttRangeMonths = null; // null = span all data automatically
let ganttLabelWidth = 240;   // px — updated by drag, persists across re-renders
const expandedAccordions = new Set();

// Accordion toggle — called from inline onclick in Gantt HTML
function toggleAccordion(key) {
    if (expandedAccordions.has(key)) expandedAccordions.delete(key);
    else expandedAccordions.add(key);
    renderGantt();
}

// Project issue accordion — called from inline onclick on project rows
const expandedProjects = new Set();
function toggleProject(id) {
    if (expandedProjects.has(id)) expandedProjects.delete(id);
    else expandedProjects.add(id);
    renderGantt();
}

// Completed-issues accordion inside a project expansion
const expandedProjectCompleted = new Set();
function toggleProjectCompleted(id) {
    if (expandedProjectCompleted.has(id)) expandedProjectCompleted.delete(id);
    else expandedProjectCompleted.add(id);
    renderGantt();
}

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

    // Gantt range input
    const rangeInput = document.getElementById('gantt-range-input');
    if (rangeInput) {
        rangeInput.addEventListener('change', () => {
            let v = parseInt(rangeInput.value, 10);
            if (isNaN(v) || v < 1) v = 1;
            if (v > 120) v = 120;
            ganttRangeMonths = v;
            rangeInput.value = v;
            renderGantt();
        });
        rangeInput.addEventListener('keydown', e => { if (e.key === 'Enter') rangeInput.blur(); });
    }

    // Ctrl+Scroll to zoom the Gantt time range
    document.getElementById('gantt-section')?.addEventListener('wheel', e => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const current = ganttRangeMonths ?? computeDataRangeMonths();
        const raw = Math.max(1, Math.min(120, current * (1 + e.deltaY / 250)));
        ganttRangeMonths = Math.max(1, Math.round(trySnapMonths(raw)));
        renderGantt();
    }, { passive: false });
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
    renderMetricsChart();
    renderUrgentDeadlines();
    renderActiveWork();
    renderInReview();
    renderBlockedIssues();
}

// ─── Gantt Chart ───────────────────────────────────────────────────────────────

function renderGantt() {
    const container = document.getElementById('gantt-chart');

    if (allProjects.length === 0) {
        container.innerHTML = '<p class="loading" style="padding:0 20px">No projects found</p>';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Date range
    const allDates = allProjects
        .flatMap(p => [p.startDate, p.targetDate].filter(Boolean))
        .map(d => parseLocalDate(d));

    let rangeStart, rangeEnd;
    if (ganttRangeMonths === null) {
        if (allDates.length > 0) {
            const minDate = new Date(Math.min(...allDates));
            const maxDate = new Date(Math.max(...allDates));
            rangeStart = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
            rangeEnd   = new Date(maxDate.getFullYear(), maxDate.getMonth() + 2, 0);
        } else {
            rangeStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            rangeEnd   = new Date(today.getFullYear(), today.getMonth() + 4, 0);
        }
    } else {
        rangeStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        rangeEnd   = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + ganttRangeMonths, 0);
    }
    if (today < rangeStart) rangeStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    if (today > rangeEnd)   rangeEnd   = new Date(today.getFullYear(), today.getMonth() + 2, 0);

    const totalMs  = rangeEnd - rangeStart;
    const todayPct = toGanttPct(today, rangeStart, totalMs);

    // Dynamic timeline width: zoom in = wider canvas (more px/month)
    const effectiveMonths = Math.max(1, Math.round(totalMs / (30.44 * 24 * 60 * 60 * 1000)));
    const timelineMinWidth = Math.max(700, Math.min(5000, Math.round(6000 / effectiveMonths)));

    // Update range input without interrupting active typing
    const rangeInput = document.getElementById('gantt-range-input');
    if (rangeInput && document.activeElement !== rangeInput) {
        rangeInput.value = effectiveMonths;
    }

    // Month markers
    const months = [];
    let m = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    while (m <= rangeEnd) {
        months.push(new Date(m));
        m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    }

    // Group projects by initiative
    const groups = {};
    const unassigned = [];
    allInitiatives.forEach(init => { groups[init.id] = { ...init, projects: [] }; });
    allProjects.forEach(project => {
        const inits = project.initiatives?.nodes || [];
        if (inits.length > 0) {
            const init = inits[0];
            if (!groups[init.id]) groups[init.id] = { id: init.id, name: init.name, targetDate: null, projects: [] };
            groups[init.id].projects.push(project);
        } else {
            unassigned.push(project);
        }
    });

    // Sort within groups: In Progress → Backlog → Completed
    Object.values(groups).forEach(g => {
        g.projects.sort((a, b) => projectStatusOrder(a.status?.name) - projectStatusOrder(b.status?.name));
    });
    unassigned.sort((a, b) => projectStatusOrder(a.status?.name) - projectStatusOrder(b.status?.name));

    // Build rows
    let rows = '';

    function renderGroup(label, projects, labelExtra = '') {
        const projDates = projects
            .flatMap(p => [p.startDate, p.targetDate].filter(Boolean))
            .map(d => parseLocalDate(d));
        let initBar = '';
        if (projDates.length > 0) {
            const s = toGanttPct(new Date(Math.min(...projDates)), rangeStart, totalMs);
            const e = toGanttPct(new Date(Math.max(...projDates)), rangeStart, totalMs);
            const w = Math.max(0.5, e - s);
            initBar = `<div class="gantt-initiative-bar" style="left:${s.toFixed(2)}%;width:${w.toFixed(2)}%" title="${escapeHtml(label)}"></div>`;
        }
        rows += `
            <div class="gantt-row gantt-initiative-row">
                <div class="gantt-label gantt-initiative-label">${escapeHtml(label)}${labelExtra}</div>
                <div class="gantt-timeline">
                    <div class="gantt-today-line" style="left:${todayPct.toFixed(2)}%"></div>
                    ${initBar}
                </div>
            </div>`;

        const activeProjs    = projects.filter(p => !isProjectCompleted(p));
        const completedProjs = projects.filter(p => isProjectCompleted(p));

        activeProjs.forEach(p => { rows += renderProjectRow(p, today, rangeStart, totalMs, todayPct, rangeEnd); });

        if (completedProjs.length > 0) {
            const key      = `${label}_completed`;
            const expanded = expandedAccordions.has(key);
            rows += `
                <div class="gantt-row gantt-accordion-row" onclick="toggleAccordion('${escapeHtml(key)}')">
                    <div class="gantt-label gantt-accordion-label">
                        <span class="gantt-indent">↳</span>
                        <span class="gantt-accordion-icon">${expanded ? '▼' : '▶'}</span>
                        <span>${completedProjs.length} completed</span>
                    </div>
                    <div class="gantt-timeline">
                        <div class="gantt-today-line" style="left:${todayPct.toFixed(2)}%"></div>
                    </div>
                </div>`;
            if (expanded) {
                completedProjs.forEach(p => { rows += renderProjectRow(p, today, rangeStart, totalMs, todayPct, rangeEnd); });
            }
        }
    }

    Object.values(groups)
        .filter(g => g.projects.length > 0)
        .forEach(initiative => renderGroup(initiative.name, initiative.projects));

    if (unassigned.length > 0) {
        const hasInitiatives = Object.values(groups).some(g => g.projects.length > 0);
        renderGroup(hasInitiatives ? 'Other Projects' : 'Projects', unassigned);
    }

    // Month label header
    let monthLabels = '';
    months.forEach(mo => {
        const pct   = toGanttPct(mo, rangeStart, totalMs);
        const label = mo.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        monthLabels += `<div class="gantt-month-mark" style="left:${pct.toFixed(2)}%">
            <div class="gantt-grid-line"></div>
            <div class="gantt-month-label">${label}</div>
        </div>`;
    });

    container.innerHTML = `
        <div class="gantt-wrap" style="--gantt-tl-width:${timelineMinWidth}px">
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

    setupGanttResizer();
}

function setupGanttResizer() {
    const container = document.getElementById('gantt-chart');
    if (!container) return;

    const resizer = document.createElement('div');
    resizer.className = 'gantt-label-resizer';
    resizer.style.left = ganttLabelWidth + 'px';
    container.appendChild(resizer);

    resizer.addEventListener('mousedown', e => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = ganttLabelWidth;
        resizer.classList.add('is-dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMove = e => {
            const dx = e.clientX - startX;
            ganttLabelWidth = Math.max(120, Math.min(1000, startWidth + dx));
            document.documentElement.style.setProperty('--gantt-label-width', ganttLabelWidth + 'px');
            resizer.style.left = ganttLabelWidth + 'px';
        };

        const onUp = () => {
            resizer.classList.remove('is-dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function renderProjectRow(project, today, rangeStart, totalMs, todayPct, rangeEnd) {
    const start = project.startDate ? parseLocalDate(project.startDate) : null;
    const end   = project.targetDate ? parseLocalDate(project.targetDate) : null;

    const stateName = project.status?.name || '';
    const isOverdue = end && end < today
        && !stateName.toLowerCase().includes('complet')
        && !stateName.toLowerCase().includes('cancel');

    const cls = ganttBarClass('', stateName, isOverdue);

    let barHtml = '';
    if (start || end) {
        const s = toGanttPct(start || today, rangeStart, totalMs);
        const e = toGanttPct(end || rangeEnd, rangeStart, totalMs);
        const w = Math.max(0.5, e - s);
        const fadeClass = !end ? ' gantt-bar-fade-end' : '';
        const tipDates = `${start ? start.toLocaleDateString() : 'No start'} → ${end ? end.toLocaleDateString() : 'No end date set'}`;
        barHtml = `<div class="gantt-bar ${cls}${fadeClass}"
            style="left:${s.toFixed(2)}%;width:${w.toFixed(2)}%"
            title="${escapeHtml(project.name + ' · ' + stateName + ' · ' + tipDates)}">
            ${w > 8 ? `<span>${escapeHtml(project.name)}</span>` : ''}
        </div>`;
    } else {
        barHtml = `<span class="gantt-no-date">No dates set</span>`;
    }

    const pillClass = ganttPillClass('', stateName, isOverdue);

    // Issues belonging to this project, sorted by status then due date
    const projectIssues = allIssues
        .filter(i => i.project?.id === project.id)
        .sort((a, b) => {
            const ord = { 'Active': 0, 'In Progress': 1, 'Blocked': 2, 'In Review': 3,
                          'Todo': 4, 'Backlog': 5, 'Done': 6, 'Canceled': 7, 'Duplicate': 8 };
            const ao = ord[a.state?.name] ?? 5;
            const bo = ord[b.state?.name] ?? 5;
            if (ao !== bo) return ao - bo;
            if (a.dueDate && !b.dueDate) return -1;
            if (!a.dueDate && b.dueDate) return 1;
            if (a.dueDate && b.dueDate) return parseLocalDate(a.dueDate) - parseLocalDate(b.dueDate);
            return 0;
        });

    const hasIssues  = projectIssues.length > 0;
    const isExpanded = expandedProjects.has(project.id);

    const expandIcon = hasIssues
        ? `<span class="gantt-project-expand-icon">${isExpanded ? '▼' : '▶'}</span>`
        : `<span class="gantt-project-expand-icon gantt-project-expand-empty"></span>`;

    const rowAttrs = hasIssues
        ? ` class="gantt-row gantt-project-row gantt-project-expandable" onclick="toggleProject('${project.id}')"`
        : ` class="gantt-row gantt-project-row"`;

    const linkAttrs = hasIssues ? ' onclick="event.stopPropagation()"' : '';

    let html = `
        <div${rowAttrs}>
            <div class="gantt-label">
                <span class="gantt-indent">↳</span>
                ${expandIcon}
                <a href="${project.url}" target="_blank"${linkAttrs} title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</a>
                <span class="gantt-pill ${pillClass}">${escapeHtml(stateName || 'Unknown')}</span>
            </div>
            <div class="gantt-timeline">
                <div class="gantt-today-line" style="left:${todayPct.toFixed(2)}%"></div>
                ${barHtml}
            </div>
        </div>`;

    if (isExpanded) {
        const doneStates = ['Done', 'Canceled', 'Duplicate'];
        const activeIssues    = projectIssues.filter(i => !doneStates.includes(i.state?.name));
        const completedIssues = projectIssues.filter(i =>  doneStates.includes(i.state?.name));

        activeIssues.forEach(issue => {
            html += renderIssueGanttRow(issue, rangeStart, totalMs, todayPct);
        });

        if (completedIssues.length > 0) {
            const compExpanded = expandedProjectCompleted.has(project.id);
            html += `
        <div class="gantt-row gantt-issue-accordion-row" onclick="event.stopPropagation(); toggleProjectCompleted('${project.id}')">
            <div class="gantt-label gantt-issue-label">
                <span class="gantt-issue-indent">↳</span>
                <span class="gantt-accordion-icon">${compExpanded ? '▼' : '▶'}</span>
                <span>${completedIssues.length} completed</span>
            </div>
            <div class="gantt-timeline">
                <div class="gantt-today-line" style="left:${todayPct.toFixed(2)}%"></div>
            </div>
        </div>`;
            if (compExpanded) {
                completedIssues.forEach(issue => {
                    html += renderIssueGanttRow(issue, rangeStart, totalMs, todayPct);
                });
            }
        }
    }

    return html;
}

function renderIssueGanttRow(issue, rangeStart, totalMs, todayPct) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dueDate   = issue.dueDate ? parseLocalDate(issue.dueDate) : null;
    const stateName = issue.state?.name || '';
    const isOverdue = dueDate && dueDate < today
        && !['Done', 'Canceled', 'Duplicate'].includes(stateName);

    let timelineContent = '';
    if (dueDate) {
        const pct      = toGanttPct(dueDate, rangeStart, totalMs);
        const dotClass = ganttIssueDotClass(stateName, isOverdue);
        const tipText  = `${issue.identifier}: ${issue.title} · Due ${dueDate.toLocaleDateString()}`;
        timelineContent = `<div class="gantt-issue-dot ${dotClass}" style="left:${pct.toFixed(2)}%" title="${escapeHtml(tipText)}"></div>`;
    }

    const pillClass = ganttIssuePillClass(stateName, isOverdue);

    return `
        <div class="gantt-row gantt-issue-row">
            <div class="gantt-label gantt-issue-label">
                <span class="gantt-issue-indent">↳</span>
                <a href="${issue.url}" target="_blank" class="gantt-issue-id">${escapeHtml(issue.identifier)}</a>
                <span class="gantt-issue-title" title="${escapeHtml(issue.title)}">${escapeHtml(issue.title)}</span>
                <span class="gantt-pill ${pillClass}">${escapeHtml(stateName)}</span>
            </div>
            <div class="gantt-timeline">
                <div class="gantt-today-line" style="left:${todayPct.toFixed(2)}%"></div>
                ${timelineContent}
            </div>
        </div>`;
}

function ganttIssueDotClass(stateName, isOverdue) {
    if (isOverdue) return 'issue-dot-overdue';
    const n = stateName.toLowerCase();
    if (n.includes('done') || n.includes('complet') || n.includes('cancel')) return 'issue-dot-done';
    if (n.includes('progress') || n.includes('active')) return 'issue-dot-active';
    if (n.includes('review')) return 'issue-dot-review';
    if (n.includes('blocked')) return 'issue-dot-blocked';
    return 'issue-dot-default';
}

function ganttIssuePillClass(stateName, isOverdue) {
    if (isOverdue) return 'pill-overdue';
    const n = stateName.toLowerCase();
    if (n.includes('done') || n.includes('complet') || n.includes('cancel')) return 'pill-completed';
    if (n.includes('progress') || n.includes('active')) return 'pill-active';
    if (n.includes('review')) return 'pill-review';
    if (n.includes('blocked')) return 'pill-blocked';
    return 'pill-default';
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
    const today     = new Date();
    const sevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const doneStates = ['Done', 'Canceled', 'Duplicate'];

    // Urgent = issues with a due date within 7 days (matches the Urgent Deadlines section)
    const urgent  = allIssues.filter(i => {
        if (!i.dueDate) return false;
        if (doneStates.includes(i.state.name) || i.state.name === 'In Review') return false;
        return parseLocalDate(i.dueDate) <= sevenDays;
    });
    const active  = allIssues.filter(i => ['In Progress', 'Active'].includes(i.state.name));
    const blocked = allIssues.filter(i => i.state.name === 'Blocked');
    const done    = allIssues.filter(i => i.state.name === 'Done');
    const review  = allIssues.filter(i => i.state.name === 'In Review');

    document.getElementById('urgent-count').textContent  = urgent.length;
    document.getElementById('active-count').textContent  = active.length;
    document.getElementById('blocked-count').textContent = blocked.length;
    document.getElementById('done-count').textContent    = done.length;
    document.getElementById('review-count').textContent  = review.length;
}

// ─── Urgent Deadlines ──────────────────────────────────────────────────────────

function renderUrgentDeadlines() {
    const today    = new Date();
    const sevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    const urgentDeadlines = allIssues
        .filter(i => {
            if (!i.dueDate) return false;
            if (['Done', 'Canceled', 'Duplicate', 'In Review'].includes(i.state.name)) return false;
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
            // Active before In Progress
            const statusOrd = { 'Active': 0, 'In Progress': 1 };
            const so = (statusOrd[a.state.name] ?? 2) - (statusOrd[b.state.name] ?? 2);
            if (so !== 0) return so;
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

// Sort order for project status: In Progress first, then Backlog/other, then Completed/Cancelled
function projectStatusOrder(stateName) {
    const n = (stateName || '').toLowerCase();
    if (n.includes('progress') || n.includes('active')) return 0;
    if (n.includes('complet') || n.includes('cancel')) return 2;
    return 1; // backlog, paused, planned, etc.
}

function isProjectCompleted(project) {
    const n = (project.status?.name || '').toLowerCase();
    return n.includes('complet') || n.includes('cancel');
}

// Snap months to common values if within 12% threshold (used during Ctrl+Scroll zoom)
function trySnapMonths(months) {
    for (const snap of [1, 3, 6, 12, 24, 36]) {
        if (Math.abs(months - snap) / snap < 0.12) return snap;
    }
    return months;
}

// Compute total months spanned by all project data (used as default range)
function computeDataRangeMonths() {
    if (allProjects.length === 0) return 12;
    const dates = allProjects
        .flatMap(p => [p.startDate, p.targetDate].filter(Boolean))
        .map(d => parseLocalDate(d));
    if (dates.length === 0) return 12;
    const start = new Date(Math.min(...dates));
    const end   = new Date(Math.max(...dates));
    return Math.max(1, Math.round((end - start) / (30.44 * 24 * 60 * 60 * 1000)));
}

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
