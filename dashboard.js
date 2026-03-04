// Dashboard State
let allIssues = [];
let allProjects = [];
let allInitiatives = [];
let metricsChartInstance = null;
let lastUpdate = null;
let ganttRangeMonths = null; // null = span all data automatically
let ganttRangePreset = 'This Quarter'; // active range preset
let ganttCustomStart = null; // custom range start Date
let ganttCustomEnd = null;   // custom range end Date
let ganttLabelWidth = 240;   // px — updated by drag, persists across re-renders
let ganttLabelAutoSize = true;
let milestoneTooltips = [];
let selectedAssignee = 'All';
let ganttSectionExpanded = false; // collapsed by default
const expandedAccordions = new Set();

// Gantt range preset options
const GANTT_RANGE_PRESETS = [
    'This Month', 'This Quarter', 'This Year',
    'Last Month', 'Last Quarter', 'Last Year',
    'Custom Range'
];

// Compute start/end dates for a given preset
function ganttPresetDates(preset) {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    switch (preset) {
        case 'This Month':
            return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0) };
        case 'This Quarter': {
            const q = Math.floor(m / 3) * 3;
            return { start: new Date(y, q, 1), end: new Date(y, q + 3, 0) };
        }
        case 'This Year':
            return { start: new Date(y, 0, 1), end: new Date(y, 11, 31) };
        case 'Last Month':
            return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0) };
        case 'Last Quarter': {
            const q = Math.floor(m / 3) * 3 - 3;
            return { start: new Date(y, q, 1), end: new Date(y, q + 3, 0) };
        }
        case 'Last Year':
            return { start: new Date(y - 1, 0, 1), end: new Date(y - 1, 11, 31) };
        default:
            return null;
    }
}

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
    selectedAssignee = readAssigneeQueryParam();
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

    // Gantt section accordion toggle
    const ganttToggle = document.getElementById('gantt-toggle');
    if (ganttToggle) {
        ganttToggle.addEventListener('click', (e) => {
            // Don't toggle when clicking inside controls
            if (e.target.closest('.gantt-scale-controls')) return;
            ganttSectionExpanded = !ganttSectionExpanded;
            const chart = document.getElementById('gantt-chart');
            const icon = document.getElementById('gantt-toggle-icon');
            if (ganttSectionExpanded) {
                chart.classList.remove('hidden');
                icon.classList.add('expanded');
            } else {
                chart.classList.add('hidden');
                icon.classList.remove('expanded');
            }
        });
    }

    // Gantt range combobox
    const rangeCombo = document.getElementById('gantt-range-combobox');
    if (rangeCombo) {
        rangeCombo.addEventListener('focus', () => showGanttRangeDropdown());
        rangeCombo.addEventListener('input', () => showGanttRangeDropdown(rangeCombo.value));
        rangeCombo.addEventListener('keydown', handleGanttRangeComboboxKey);
        rangeCombo.addEventListener('blur', () => setTimeout(() => {
            closeGanttRangeDropdown();
        }, 150));
    }

    // Custom date range inputs
    const customStart = document.getElementById('gantt-custom-start');
    const customEnd = document.getElementById('gantt-custom-end');
    if (customStart && customEnd) {
        const onCustomChange = () => {
            if (customStart.value && customEnd.value) {
                ganttCustomStart = parseLocalDate(customStart.value);
                ganttCustomEnd = parseLocalDate(customEnd.value);
                renderGantt();
            }
        };
        customStart.addEventListener('change', onCustomChange);
        customEnd.addEventListener('change', onCustomChange);
    }

    // Apply default preset (This Quarter)
    applyGanttPreset('This Quarter');

    // Assignee combobox filter
    const assigneeCombo = document.getElementById('assignee-combobox');
    if (assigneeCombo) {
        assigneeCombo.addEventListener('focus', () => showAssigneeDropdown());
        assigneeCombo.addEventListener('input', () => showAssigneeDropdown(assigneeCombo.value));
        assigneeCombo.addEventListener('keydown', handleAssigneeComboboxKey);
        assigneeCombo.addEventListener('blur', () => setTimeout(() => {
            selectedAssignee = normalizeAssigneeSelection(assigneeCombo.value);
            assigneeCombo.value = selectedAssignee;
            updateAssigneeQueryParam(selectedAssignee);
            closeAssigneeDropdown();
            renderDashboard();
        }, 150));
    }

    // Ctrl+Scroll to zoom the Gantt time range

    document.getElementById('gantt-section')?.addEventListener('wheel', e => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const current = ganttRangeMonths ?? computeDataRangeMonths();
        const raw = Math.max(1, Math.min(120, current * (1 + e.deltaY / 250)));
        ganttRangeMonths = Math.max(1, Math.round(trySnapMonths(raw)));
        ganttRangePreset = null; // clear preset on manual zoom
        renderGantt();
    }, { passive: false });

    // Drag-to-scroll on the Gantt chart
    const ganttChart = document.getElementById('gantt-chart');
    if (ganttChart) {
        let isDragging = false;
        let didDrag = false; // true if mouse moved enough to count as a drag
        let startX = 0;
        let scrollStart = 0;
        const DRAG_THRESHOLD = 4; // px — movement below this is a click, not a drag

        ganttChart.addEventListener('mousedown', e => {
            // Don't start drag on links, inputs, or interactive elements
            if (e.target.closest('a, input, button, .gantt-label-resizer')) return;
            isDragging = true;
            didDrag = false;
            startX = e.clientX;
            scrollStart = ganttChart.scrollLeft;
        });

        window.addEventListener('mousemove', e => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            if (!didDrag && Math.abs(dx) >= DRAG_THRESHOLD) {
                didDrag = true;
                ganttChart.classList.add('is-dragging');
            }
            if (didDrag) {
                e.preventDefault();
                ganttChart.scrollLeft = scrollStart - dx;
            }
        });

        window.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            ganttChart.classList.remove('is-dragging');
        });

        // Suppress click events that follow a drag (prevents toggling accordions/projects)
        ganttChart.addEventListener('click', e => {
            if (didDrag) {
                e.stopPropagation();
                e.preventDefault();
                didDrag = false;
            }
        }, true); // capture phase so it fires before onclick handlers
    }

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
    renderAssigneeCombobox();

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
                        parent { id identifier }
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
                        projectMilestones(first: 50) {
                            nodes {
                                id
                                name
                                targetDate
                            }
                        }
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
    renderActiveItems();
    renderUrgentDeadlines();
    renderActiveWork();
    renderInReview();
    renderBlockedIssues();
    renderPendingWaiting();
}

// ─── Gantt Chart ───────────────────────────────────────────────────────────────

function renderGantt() {
    const issues = getFilteredIssues();
    const container = document.getElementById('gantt-chart');

    if (allProjects.length === 0) {
        container.innerHTML = '<p class="loading" style="padding:0 20px">No projects found</p>';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Selected view range — driven by preset or custom range
    let viewStart, viewEnd;
    if (ganttRangePreset === 'Custom Range' && ganttCustomStart && ganttCustomEnd) {
        viewStart = new Date(ganttCustomStart);
        viewEnd = new Date(ganttCustomEnd);
    } else if (ganttRangePreset && ganttRangePreset !== 'Custom Range') {
        const pd = ganttPresetDates(ganttRangePreset);
        if (pd) { viewStart = pd.start; viewEnd = pd.end; }
    }
    // Fallback if no preset produced a range (e.g. after ctrl+scroll override)
    if (!viewStart || !viewEnd) {
        if (ganttRangeMonths !== null) {
            viewStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            viewEnd   = new Date(viewStart.getFullYear(), viewStart.getMonth() + ganttRangeMonths, 0);
        } else {
            const allDates = allProjects
                .flatMap(p => [p.startDate, p.targetDate].filter(Boolean))
                .map(d => parseLocalDate(d));
            if (allDates.length > 0) {
                const minDate = new Date(Math.min(...allDates));
                const maxDate = new Date(Math.max(...allDates));
                viewStart = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
                viewEnd   = new Date(maxDate.getFullYear(), maxDate.getMonth() + 2, 0);
            } else {
                viewStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                viewEnd   = new Date(today.getFullYear(), today.getMonth() + 4, 0);
            }
        }
    }

    // Extend render range beyond the selected view so users can scroll to see more
    const viewMs = viewEnd - viewStart;
    const padMs = viewMs; // pad by the full view duration on each side
    const rangeStart = new Date(viewStart.getTime() - padMs);
    const rangeEnd   = new Date(viewEnd.getTime() + padMs);

    const totalMs  = rangeEnd - rangeStart;
    const todayPct = toGanttPct(today, rangeStart, totalMs);

    // The visible portion as a fraction of the full rendered range (for sizing)
    const viewMonths = Math.max(1, Math.round(viewMs / (30.44 * 24 * 60 * 60 * 1000)));
    const effectiveMonths = Math.max(1, Math.round(totalMs / (30.44 * 24 * 60 * 60 * 1000)));

    // Timeline width: make the view range fill roughly the container, so the
    // full rendered range (3× the view) is wider and scrollable
    const timelineMinWidth = Math.max(700, Math.round(Math.max(700, Math.min(5000, Math.round(6000 / viewMonths))) * (effectiveMonths / viewMonths)));

    // Update range combobox display (no-op during active typing)
    const rangeCombo = document.getElementById('gantt-range-combobox');
    if (rangeCombo && document.activeElement !== rangeCombo) {
        rangeCombo.value = ganttRangePreset || `${viewMonths} months`;
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

        activeProjs.forEach(p => { rows += renderProjectRow(p, today, rangeStart, totalMs, todayPct, rangeEnd, issues); });

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
                completedProjs.forEach(p => { rows += renderProjectRow(p, today, rangeStart, totalMs, todayPct, rangeEnd, issues); });
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
    // Alternating calendar year bands
    let yearBands = '';
    let prevYearStart = null;
    let prevYear = null;

    months.forEach(mo => {
        const pct   = toGanttPct(mo, rangeStart, totalMs);
        const label = mo.toLocaleDateString('en-US', { month: 'long' });
        const month = mo.getMonth(); // 0=Jan
        const year  = mo.getFullYear();

        // Determine boundary classes
        let lineClass = 'gantt-grid-line';
        let extraMarkup = '';

        if (month === 0) {
            // January = calendar year boundary (line between Dec and Jan)
            lineClass += ' gantt-grid-line-cy';
            extraMarkup += `<div class="gantt-year-label gantt-cy-label">CY ${year}</div>`;
        }
        if (month === 9) {
            // October = fiscal year boundary (line between Sep and Oct)
            lineClass += ' gantt-grid-line-fy';
            const fy = year + 1; // FY starts in Oct, named for the ending year
            extraMarkup += `<div class="gantt-year-label gantt-fy-label">FY ${fy}</div>`;
        }

        // Alternating calendar year bands
        if (prevYear !== null && year !== prevYear) {
            // Close previous band
            const bandStartPct = toGanttPct(prevYearStart, rangeStart, totalMs);
            const bandClass = prevYear % 2 === 0 ? 'gantt-year-band-even' : 'gantt-year-band-odd';
            yearBands += `<div class="gantt-year-band ${bandClass}" style="left:${bandStartPct.toFixed(2)}%;width:${(pct - bandStartPct).toFixed(2)}%"></div>`;
            prevYearStart = mo;
        }
        if (prevYearStart === null) {
            prevYearStart = mo;
        }
        prevYear = year;

        monthLabels += `<div class="gantt-month-mark" style="left:${pct.toFixed(2)}%">
            <div class="${lineClass}"></div>
            <div class="gantt-month-label">${label}</div>
            ${extraMarkup}
        </div>`;
    });

    // Close final year band
    if (prevYearStart !== null) {
        const bandStartPct = toGanttPct(prevYearStart, rangeStart, totalMs);
        const bandClass = prevYear % 2 === 0 ? 'gantt-year-band-even' : 'gantt-year-band-odd';
        yearBands += `<div class="gantt-year-band ${bandClass}" style="left:${bandStartPct.toFixed(2)}%;width:${(100 - bandStartPct).toFixed(2)}%"></div>`;
    }

    container.innerHTML = `
        <div class="gantt-wrap" style="--gantt-tl-width:${timelineMinWidth}px">
            <div class="gantt-row gantt-header-row">
                <div class="gantt-label"></div>
                <div class="gantt-timeline gantt-header-timeline">
                    ${yearBands}
                    ${monthLabels}
                    <div class="gantt-today-line gantt-today-header" style="left:${todayPct.toFixed(2)}%">
                        <span class="gantt-today-label">Today</span>
                    </div>
                </div>
            </div>
            ${rows}
        </div>`;

    autoSizeGanttLabelColumn();
    setupGanttResizer();
    initGanttTooltips();

    // Scroll so the selected view range is visible (viewStart aligned to left edge)
    // Use the actual timeline element width (not scrollWidth, which includes the sticky label column)
    const firstTimeline = container.querySelector('.gantt-timeline');
    if (firstTimeline) {
        const viewStartPct = (viewStart - rangeStart) / totalMs;
        container.scrollLeft = Math.round(firstTimeline.offsetWidth * viewStartPct);
    }
}

function autoSizeGanttLabelColumn(force = false) {
    if (!ganttLabelAutoSize && !force) return;

    const labels = Array.from(document.querySelectorAll('#gantt-chart .gantt-label'));
    if (labels.length === 0) return;

    const maxContentWidth = labels.reduce((max, el) => {
        return Math.max(max, measureLabelContentWidth(el));
    }, 0);

    const desired = Math.max(240, Math.min(1000, Math.ceil(maxContentWidth + 28)));
    ganttLabelWidth = desired;
    document.documentElement.style.setProperty('--gantt-label-width', `${ganttLabelWidth}px`);
}

function measureLabelContentWidth(labelEl) {
    const clone = labelEl.cloneNode(true);
    clone.style.position = 'absolute';
    clone.style.visibility = 'hidden';
    clone.style.left = '-99999px';
    clone.style.top = '0';
    clone.style.width = 'max-content';
    clone.style.maxWidth = 'none';
    clone.style.overflow = 'visible';
    clone.style.whiteSpace = 'nowrap';
    clone.style.padding = getComputedStyle(labelEl).padding;

    document.body.appendChild(clone);
    const width = clone.scrollWidth;
    clone.remove();
    return width;
}

function setupGanttResizer() {
    const container = document.getElementById('gantt-chart');
    if (!container) return;

    const resizer = document.createElement('div');
    resizer.className = 'gantt-label-resizer';
    // Position accounts for horizontal scroll so resizer stays at label edge
    const updateResizerPos = () => {
        resizer.style.left = (ganttLabelWidth + container.scrollLeft) + 'px';
    };
    updateResizerPos();
    container.appendChild(resizer);

    // On scroll: pin labels in place via CSS variable and keep resizer aligned
    container.addEventListener('scroll', () => {
        container.style.setProperty('--gantt-scroll-offset', container.scrollLeft + 'px');
        updateResizerPos();
    });

    resizer.addEventListener('mousedown', e => {
        e.preventDefault();
        ganttLabelAutoSize = false;
        const startX = e.clientX;
        const startWidth = ganttLabelWidth;
        resizer.classList.add('is-dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMove = e => {
            const dx = e.clientX - startX;
            ganttLabelWidth = Math.max(120, Math.min(1000, startWidth + dx));
            document.documentElement.style.setProperty('--gantt-label-width', ganttLabelWidth + 'px');
            updateResizerPos();
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

    resizer.addEventListener('dblclick', e => {
        e.preventDefault();
        ganttLabelAutoSize = true;
        autoSizeGanttLabelColumn(true);
        updateResizerPos();
    });
}

function renderProjectRow(project, today, rangeStart, totalMs, todayPct, rangeEnd, issues) {
    const start = project.startDate ? parseLocalDate(project.startDate) : null;
    const end   = project.targetDate ? parseLocalDate(project.targetDate) : null;

    const stateName = project.status?.name || '';
    const isOverdue = end && end < today
        && !stateName.toLowerCase().includes('complet')
        && !stateName.toLowerCase().includes('cancel');

    const cls = ganttBarClass('', stateName, isOverdue);

    let barHtml = '';
    let barLabelHtml = '';
    if (start || end) {
        const s = toGanttPct(start || today, rangeStart, totalMs);
        const e = toGanttPct(end || rangeEnd, rangeStart, totalMs);
        const w = Math.max(0.5, e - s);
        const fadeClass = !end ? ' gantt-bar-fade-end' : '';
        const tipDates = `${start ? start.toLocaleDateString() : 'No start'} → ${end ? end.toLocaleDateString() : 'No end date set'}`;
        barLabelHtml = `<div class="gantt-bar-label" style="left:${s.toFixed(2)}%">${escapeHtml(project.name)}</div>`;
        barHtml = `<div class="gantt-bar ${cls}${fadeClass}"
            style="left:${s.toFixed(2)}%;width:${w.toFixed(2)}%"
            title="${escapeHtml(project.name + ' · ' + stateName + ' · ' + tipDates)}">
        </div>`;
    } else {
        barHtml = `<span class="gantt-no-date">No dates set</span>`;
    }

    const milestoneHtml = (project.projectMilestones?.nodes || [])
        .filter(m => m.targetDate)
        .map(m => {
            const d = parseLocalDate(m.targetDate);
            const pct = toGanttPct(d, rangeStart, totalMs);
            const tip = encodeURIComponent(`${d.toLocaleDateString()} · ${m.name}`);
            return `<div class="gantt-milestone" style="left:${pct.toFixed(2)}%" data-milestone-tip="${tip}"></div>`;
        }).join('');

    const pillClass = ganttPillClass('', stateName, isOverdue);

    // Issues belonging to this project, sorted by status then due date
    const projectIssues = flattenIssueHierarchy(
        issues.filter(i => i.project?.id === project.id),
        (a, b) => {
            const ord = { 'Active': 0, 'In Progress': 1, 'Blocked': 2, 'In Review': 3,
                          'Todo': 4, 'Backlog': 5, 'Done': 6, 'Canceled': 7, 'Duplicate': 8 };
            const ao = ord[a.state?.name] ?? 5;
            const bo = ord[b.state?.name] ?? 5;
            if (ao !== bo) return ao - bo;
            if (a.dueDate && !b.dueDate) return -1;
            if (!a.dueDate && b.dueDate) return 1;
            if (a.dueDate && b.dueDate) return parseLocalDate(a.dueDate) - parseLocalDate(b.dueDate);
            return 0;
        }
    );

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
                ${barLabelHtml}
                ${barHtml}
                ${milestoneHtml}
            </div>
        </div>`;

    if (isExpanded) {
        const doneStates = ['Done', 'Canceled', 'Duplicate'];
        const activeIssues    = projectIssues.filter(({ issue }) => !doneStates.includes(issue.state?.name));
        const completedIssues = projectIssues.filter(({ issue }) =>  doneStates.includes(issue.state?.name));

        activeIssues.forEach(({ issue, depth }) => {
            html += renderIssueGanttRow(issue, rangeStart, totalMs, todayPct, depth);
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
                completedIssues.forEach(({ issue, depth }) => {
                    html += renderIssueGanttRow(issue, rangeStart, totalMs, todayPct, depth);
                });
            }
        }
    }

    return html;
}

function renderIssueGanttRow(issue, rangeStart, totalMs, todayPct, depth = 0) {
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
        timelineContent = `<div class="gantt-issue-dot ${dotClass}" style="left:${pct.toFixed(2)}%" data-issue-tip="${encodeURIComponent(tipText)}"></div>`;
    }

    const pillClass = ganttIssuePillClass(stateName, isOverdue);
    const assigneePill = issue.assignee?.name
        ? `<span class="gantt-pill pill-assignee">${escapeHtml(issue.assignee.name)}</span>`
        : '';

    const depthPad = Math.min(6, Math.max(0, depth)) * 21;

    const stateSlug = (stateName || 'unknown').toLowerCase().replace(/ /g, '-');

    return `
        <div class="gantt-row gantt-issue-row issue-state-${stateSlug}">
            <div class="gantt-label gantt-issue-label">
                <span class="gantt-issue-indent" style="margin-left:${18 + depthPad}px">↳</span>
                <a href="${issue.url}" target="_blank" class="gantt-issue-id">${escapeHtml(issue.identifier)}</a>
                <span class="gantt-issue-title" title="${escapeHtml(issue.title)}">${escapeHtml(issue.title)}</span>
                ${assigneePill}
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

function initGanttTooltips() {
    milestoneTooltips.forEach(t => t.destroy());
    milestoneTooltips = [];

    if (typeof tippy !== 'function') return;

    const sharedOpts = {
        theme: 'milestone',
        trigger: 'mouseenter focus',
        placement: 'bottom',
        delay: [0, 2200],
        duration: [120, 180],
        offset: [0, 10],
        interactive: false,
        appendTo: () => document.body,
        onShow(instance) {
            milestoneTooltips.forEach(other => {
                if (other !== instance) other.hide(0);
            });
        },
    };

    // Milestone tooltips
    document.querySelectorAll('.gantt-milestone').forEach(el => {
        const encoded = el.getAttribute('data-milestone-tip');
        if (!encoded) return;
        milestoneTooltips.push(tippy(el, { ...sharedOpts, content: decodeURIComponent(encoded) }));
    });

    // Issue due-date dot tooltips
    document.querySelectorAll('.gantt-issue-dot').forEach(el => {
        const encoded = el.getAttribute('data-issue-tip');
        if (!encoded) return;
        milestoneTooltips.push(tippy(el, { ...sharedOpts, content: decodeURIComponent(encoded) }));
    });
}

// ─── Summary Cards ─────────────────────────────────────────────────────────────

function renderSummaryCards() {
    const issues = getFilteredIssues();
    const today     = new Date();
    const sevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const doneStates = ['Done', 'Canceled', 'Duplicate'];

    // Urgent = issues with a due date within 7 days (matches the Urgent Deadlines section)
    const urgent  = issues.filter(i => {
        if (!i.dueDate) return false;
        if (doneStates.includes(i.state.name) || i.state.name === 'In Review') return false;
        return parseLocalDate(i.dueDate) <= sevenDays;
    });
    const active  = issues.filter(i => ['In Progress', 'Active'].includes(i.state.name));
    const blocked = issues.filter(i => i.state.name === 'Blocked');
    const review  = issues.filter(i => i.state.name === 'In Review');
    const waiting = issues.filter(i => ['Waiting', 'Pending'].includes(i.state.name));

    document.getElementById('urgent-count').textContent  = urgent.length;
    document.getElementById('active-count').textContent  = active.length;
    document.getElementById('blocked-count').textContent = blocked.length;
    document.getElementById('review-count').textContent  = review.length;
    document.getElementById('waiting-count').textContent = waiting.length;
}

// ─── Urgent Deadlines ──────────────────────────────────────────────────────────

function renderUrgentDeadlines() {
    const issues = getFilteredIssues();
    const today    = new Date();
    const sevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    const urgentDeadlines = issues
        .filter(i => {
            if (!i.dueDate) return false;
            if (['Done', 'Canceled', 'Duplicate', 'In Review'].includes(i.state.name)) return false;
            return parseLocalDate(i.dueDate) <= sevenDays;
        })
        .sort((a, b) => parseLocalDate(a.dueDate) - parseLocalDate(b.dueDate));

    const container = document.getElementById('urgent-deadlines');
    const sortedUrgent = flattenIssueHierarchy(urgentDeadlines, (a, b) => parseLocalDate(a.dueDate) - parseLocalDate(b.dueDate));
    container.innerHTML = sortedUrgent.length === 0
        ? '<p class="loading">No urgent deadlines in the next 7 days ✅</p>'
        : sortedUrgent.map(({ issue, depth }) => renderIssueItem(issue, true, depth)).join('');
}

// ─── Active Work ───────────────────────────────────────────────────────────────

function renderActiveItems() {
    const issues = getFilteredIssues();
    const activeItems = issues
        .filter(i => i.state.name === 'Active')
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

    const container = document.getElementById('active-items');
    const sortedActive = flattenIssueHierarchy(activeItems, (a, b) => {
        const order = { 'Urgent': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'No priority': 4 };
        const ap = order[a.priorityLabel] ?? 4;
        const bp = order[b.priorityLabel] ?? 4;
        if (ap !== bp) return ap - bp;
        if (a.dueDate && !b.dueDate) return -1;
        if (!a.dueDate && b.dueDate) return 1;
        if (a.dueDate && b.dueDate) return parseLocalDate(a.dueDate) - parseLocalDate(b.dueDate);
        return 0;
    });
    container.innerHTML = sortedActive.length === 0
        ? '<p class="loading">No active items</p>'
        : sortedActive.map(({ issue, depth }) => renderIssueItem(issue, false, depth)).join('');
}

function renderActiveWork() {
    const issues = getFilteredIssues();
    const activeIssues = issues
        .filter(i => i.state.name === 'In Progress')
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
    const sortedActive = flattenIssueHierarchy(activeIssues, (a, b) => {
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
    container.innerHTML = sortedActive.length === 0
        ? '<p class="loading">No active work</p>'
        : sortedActive.map(({ issue, depth }) => renderIssueItem(issue, false, depth)).join('');
}

// ─── In Review ─────────────────────────────────────────────────────────────────

function renderInReview() {
    const issues = getFilteredIssues();
    const inReviewIssues = issues.filter(i => i.state.name === 'In Review');

    const container = document.getElementById('in-review');
    const sortedReview = flattenIssueHierarchy(inReviewIssues);
    container.innerHTML = sortedReview.length === 0
        ? '<p class="loading">Nothing in review right now</p>'
        : sortedReview.map(({ issue, depth }) => renderIssueItem(issue, false, depth)).join('');
}

// ─── Blocked Issues ────────────────────────────────────────────────────────────

function renderBlockedIssues() {
    const issues = getFilteredIssues();
    const blockedIssues = issues.filter(i => i.state.name === 'Blocked');

    const container = document.getElementById('blocked-issues');
    const sortedBlocked = flattenIssueHierarchy(blockedIssues);
    container.innerHTML = sortedBlocked.length === 0
        ? '<p class="loading">No blocked issues ✅</p>'
        : sortedBlocked.map(({ issue, depth }) => renderIssueItem(issue, false, depth)).join('');
}

// ─── Pending / Waiting ────────────────────────────────────────────────────────

function renderPendingWaiting() {
    const issues = getFilteredIssues();
    const pendingWaitingIssues = issues
        .filter(i => ['Pending', 'Waiting'].includes(i.state.name))
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

    const container = document.getElementById('pending-waiting');
    const sortedPending = flattenIssueHierarchy(pendingWaitingIssues, (a, b) => {
        const order = { 'Urgent': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'No priority': 4 };
        const ap = order[a.priorityLabel] ?? 4;
        const bp = order[b.priorityLabel] ?? 4;
        if (ap !== bp) return ap - bp;
        if (a.dueDate && !b.dueDate) return -1;
        if (!a.dueDate && b.dueDate) return 1;
        if (a.dueDate && b.dueDate) return parseLocalDate(a.dueDate) - parseLocalDate(b.dueDate);
        return 0;
    });
    container.innerHTML = sortedPending.length === 0
        ? '<p class="loading">No pending/waiting issues ✅</p>'
        : sortedPending.map(({ issue, depth }) => renderIssueItem(issue, false, depth)).join('');
}

// ─── Issue Item ────────────────────────────────────────────────────────────────

function renderIssueItem(issue, showDueDate = false, depth = 0) {
    const priorityClass = issue.priorityLabel
        ? `priority-${issue.priorityLabel.toLowerCase()}` : '';

    const dueInfo = issue.dueDate
        ? `<span class="due-soon">📅 Due ${formatDate(issue.dueDate)}</span>` : '';

    const statusSlug = issue.state.name.toLowerCase().replace(/ /g, '-');
    const statusBadge = `<span class="status-badge status-${statusSlug}">${issue.state.name}</span>`;

    const projectInfo = issue.project ? `<span>📁 ${escapeHtml(issue.project.name)}</span>` : '';
    const assigneeInfo = issue.assignee ? `<span>👤 ${escapeHtml(issue.assignee.name)}</span>` : '';

    const safeDepth = Math.min(6, Math.max(0, depth));

    return `
        <div class="issue-item issue-state-${statusSlug}" style="--issue-depth:${safeDepth}">
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
    const issues = getFilteredIssues();
    const ctx = document.getElementById('metrics-chart');

    const statusCounts = {
        'Backlog': 0, 'Todo': 0, 'In Progress': 0,
        'Active': 0, 'Waiting': 0, 'Blocked': 0, 'In Review': 0, 'Done': 0
    };
    issues.forEach(issue => {
        const stateName = issue.state.name === 'Pending' ? 'Waiting' : issue.state.name;
        if (Object.prototype.hasOwnProperty.call(statusCounts, stateName)) {
            statusCounts[stateName]++;
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
                    '#dc3545', '#0066cc', '#6c757d', '#17a2b8', '#28a745'
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

function renderAssigneeCombobox() {
    const input = document.getElementById('assignee-combobox');
    if (!input) return;

    selectedAssignee = normalizeAssigneeSelection(selectedAssignee);
    input.value = selectedAssignee;
}

function getAvailableAssignees() {
    const activeIssueAssignees = allIssues
        .filter(i => i.assignee?.name)
        .filter(i => !['completed', 'canceled'].includes(i.state?.type))
        .map(i => i.assignee.name);

    return Array.from(new Set(activeIssueAssignees))
        .sort((a, b) => a.localeCompare(b));
}

function showAssigneeDropdown(query = '') {
    const dropdown = document.getElementById('assignee-combobox-dropdown');
    if (!dropdown) return;

    const q = (query || '').trim().toLowerCase();
    const assignees = ['All', ...getAvailableAssignees()].filter(name => name.toLowerCase().includes(q));

    dropdown.innerHTML = assignees.length
        ? assignees.map(name => `<div class="combobox-option" onmousedown="selectAssigneeOption('${name.replace(/'/g, "\\'")}')">${escapeHtml(name)}</div>`).join('')
        : '<div class="combobox-empty">No assignees found</div>';

    dropdown.style.display = 'block';
}

function closeAssigneeDropdown() {
    const dropdown = document.getElementById('assignee-combobox-dropdown');
    if (dropdown) dropdown.style.display = 'none';
}

function selectAssigneeOption(name) {
    const input = document.getElementById('assignee-combobox');
    if (!input) return;
    selectedAssignee = normalizeAssigneeSelection(name);
    input.value = selectedAssignee;
    updateAssigneeQueryParam(selectedAssignee);
    closeAssigneeDropdown();
    renderDashboard();
}

function handleAssigneeComboboxKey(event) {
    const dropdown = document.getElementById('assignee-combobox-dropdown');
    if (!dropdown || dropdown.style.display === 'none') return;

    const options = Array.from(dropdown.querySelectorAll('.combobox-option'));
    if (options.length === 0) return;

    const active = dropdown.querySelector('.combobox-option.active');
    let idx = active ? options.indexOf(active) : -1;

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (active) active.classList.remove('active');
        idx = idx < options.length - 1 ? idx + 1 : 0;
        options[idx].classList.add('active');
        options[idx].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (active) active.classList.remove('active');
        idx = idx > 0 ? idx - 1 : options.length - 1;
        options[idx].classList.add('active');
        options[idx].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (active) {
            active.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        } else if (options[0]) {
            options[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
    } else if (event.key === 'Escape') {
        closeAssigneeDropdown();
    }
}

function normalizeAssigneeSelection(value) {
    const raw = canonicalizeAssigneeInput(value);
    if (!raw || raw.toLowerCase() === 'all') return 'All';

    const available = getAvailableAssignees();
    const matches = available.find(name => canonicalizeAssigneeInput(name).toLowerCase() === raw.toLowerCase());

    return matches || 'All';
}

function canonicalizeAssigneeInput(value) {
    return (value || '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function readAssigneeQueryParam() {
    const params = new URLSearchParams(window.location.search);
    return canonicalizeAssigneeInput(params.get('assignee') || 'All') || 'All';
}

function updateAssigneeQueryParam(assignee) {
    const params = new URLSearchParams(window.location.search);
    if (!assignee || assignee === 'All') params.delete('assignee');
    else params.set('assignee', assignee.replace(/\s+/g, '-'));

    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`;
    history.replaceState(null, '', next);
}

function getFilteredIssues() {
    if (selectedAssignee === 'All') return allIssues;
    return allIssues.filter(i => (i.assignee?.name || '') === selectedAssignee);
}

function flattenIssueHierarchy(issues, compareFn = defaultIssueSort) {
    const byId = new Map(issues.map(i => [i.id, i]));
    const childrenByParent = new Map();

    issues.forEach(issue => {
        const parentId = issue.parent?.id;
        if (!parentId || !byId.has(parentId)) return;
        if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
        childrenByParent.get(parentId).push(issue);
    });

    const roots = issues.filter(issue => {
        const parentId = issue.parent?.id;
        return !parentId || !byId.has(parentId);
    }).sort(compareFn);

    const out = [];
    const visit = (issue, depth) => {
        out.push({ issue, depth });
        const children = (childrenByParent.get(issue.id) || []).sort(compareFn);
        children.forEach(child => visit(child, depth + 1));
    };

    roots.forEach(root => visit(root, 0));
    return out;
}

function defaultIssueSort(a, b) {
    const order = { 'Urgent': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'No priority': 4 };
    const ap = order[a.priorityLabel] ?? 4;
    const bp = order[b.priorityLabel] ?? 4;
    if (ap !== bp) return ap - bp;
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    if (a.dueDate && b.dueDate) return parseLocalDate(a.dueDate) - parseLocalDate(b.dueDate);
    return 0;
}

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

// ─── Gantt Range Combobox ───────────────────────────────────────────────────

function applyGanttPreset(preset) {
    ganttRangePreset = preset;
    ganttRangeMonths = null;
    const combo = document.getElementById('gantt-range-combobox');
    if (combo) combo.value = preset;

    const customDiv = document.getElementById('gantt-custom-range');
    if (preset === 'Custom Range') {
        customDiv?.classList.remove('hidden');
        // Seed custom inputs with current quarter if empty
        const cs = document.getElementById('gantt-custom-start');
        const ce = document.getElementById('gantt-custom-end');
        if (cs && !cs.value) {
            const pd = ganttPresetDates('This Quarter');
            cs.value = toISODate(pd.start);
            ce.value = toISODate(pd.end);
            ganttCustomStart = pd.start;
            ganttCustomEnd = pd.end;
        }
    } else {
        customDiv?.classList.add('hidden');
    }
    renderGantt();
}

function toISODate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function showGanttRangeDropdown(filter) {
    const dd = document.getElementById('gantt-range-combobox-dropdown');
    if (!dd) return;
    const lc = (filter || '').toLowerCase();
    const opts = GANTT_RANGE_PRESETS.filter(p => !lc || p.toLowerCase().includes(lc));
    if (opts.length === 0) {
        dd.innerHTML = '<div class="combobox-empty">No matches</div>';
    } else {
        dd.innerHTML = opts.map(p =>
            `<div class="combobox-option${p === ganttRangePreset ? ' active' : ''}" data-value="${escapeHtml(p)}">${escapeHtml(p)}</div>`
        ).join('');
        dd.querySelectorAll('.combobox-option').forEach(el => {
            el.addEventListener('mousedown', e => {
                e.preventDefault();
                applyGanttPreset(el.dataset.value);
                closeGanttRangeDropdown();
                document.getElementById('gantt-range-combobox')?.blur();
            });
        });
    }
    dd.style.display = '';
}

function closeGanttRangeDropdown() {
    const dd = document.getElementById('gantt-range-combobox-dropdown');
    if (dd) dd.style.display = 'none';
}

function handleGanttRangeComboboxKey(e) {
    const dd = document.getElementById('gantt-range-combobox-dropdown');
    if (!dd) return;
    const items = [...dd.querySelectorAll('.combobox-option')];
    const activeIdx = items.findIndex(el => el.classList.contains('active'));

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(activeIdx + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle('active', i === next));
        items[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(activeIdx - 1, 0);
        items.forEach((el, i) => el.classList.toggle('active', i === prev));
        items[prev]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const sel = items[activeIdx >= 0 ? activeIdx : 0];
        if (sel) applyGanttPreset(sel.dataset.value);
        closeGanttRangeDropdown();
        e.target.blur();
    } else if (e.key === 'Escape') {
        closeGanttRangeDropdown();
        e.target.blur();
    }
}
