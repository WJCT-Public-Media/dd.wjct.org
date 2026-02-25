let allClosedIssues = [];
let selectedAssignee = 'All';
let historyChart = null;

const timeframeState = {
    preset: 'year',
    start: null,
    end: null,
};

document.addEventListener('DOMContentLoaded', async () => {
    await fetchHistoryData();
    renderHistory();

    setInterval(async () => {
        await fetchHistoryData();
        renderHistory();
    }, CONFIG.REFRESH_INTERVAL);

    document.getElementById('history-refresh-btn')?.addEventListener('click', async () => {
        await fetchHistoryData();
        renderHistory();
    });

    setupAssigneeCombobox();
    setupTimeframeControls();
});

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

async function fetchHistoryData() {
    try {
        const data = await callWorker(`
            query {
                issues(
                    first: 250
                    filter: {
                        team: { id: { eq: "${CONFIG.TEAM_ID}" } }
                        state: { type: { eq: "completed" } }
                    }
                    orderBy: updatedAt
                ) {
                    nodes {
                        id
                        identifier
                        title
                        url
                        completedAt
                        autoClosedAt
                        updatedAt
                        state { name type }
                        assignee { name }
                        project { name }
                    }
                }
            }
        `);

        allClosedIssues = (data?.issues?.nodes || [])
            .filter(i => i.state?.type === 'completed' || (i.state?.name || '').toLowerCase() === 'done')
            .map(i => {
                const closedAt = i.completedAt || i.autoClosedAt || i.updatedAt;
                return { ...i, closedAt, completedDate: closedAt ? parseDateOnly(closedAt) : null };
            })
            .filter(i => i.completedDate);

        document.getElementById('history-last-updated').textContent =
            `Updated: ${new Date().toLocaleTimeString()}`;

        renderAssigneeCombobox();
    } catch (e) {
        console.error('History fetch failed:', e);
        document.getElementById('history-last-updated').textContent =
            `Updated: ${new Date().toLocaleTimeString()} (history load error)`;
    }
}

function setupAssigneeCombobox() {
    const input = document.getElementById('history-assignee-combobox');
    if (!input) return;

    input.addEventListener('focus', () => showAssigneeDropdown());
    input.addEventListener('input', () => showAssigneeDropdown(input.value));
    input.addEventListener('keydown', handleAssigneeComboboxKey);
    input.addEventListener('blur', () => setTimeout(() => {
        selectedAssignee = normalizeAssignee(input.value);
        input.value = selectedAssignee;
        closeAssigneeDropdown();
        renderHistory();
    }, 150));
}

function renderAssigneeCombobox() {
    const input = document.getElementById('history-assignee-combobox');
    if (!input) return;
    selectedAssignee = normalizeAssignee(selectedAssignee);
    input.value = selectedAssignee;
}

function getAvailableAssignees() {
    const names = allClosedIssues.map(i => i.assignee?.name).filter(Boolean);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

function normalizeAssignee(value) {
    const raw = (value || '').trim();
    if (!raw || raw.toLowerCase() === 'all') return 'All';
    return getAvailableAssignees().find(n => n.toLowerCase() === raw.toLowerCase()) || 'All';
}

function showAssigneeDropdown(query = '') {
    const dropdown = document.getElementById('history-assignee-dropdown');
    if (!dropdown) return;

    const q = (query || '').trim().toLowerCase();
    const options = ['All', ...getAvailableAssignees()].filter(n => n.toLowerCase().includes(q));

    dropdown.innerHTML = options.length
        ? options.map(name => `<div class="combobox-option" onmousedown="selectAssignee('${name.replace(/'/g, "\\'")}')">${escapeHtml(name)}</div>`).join('')
        : '<div class="combobox-empty">No assignees found</div>';

    dropdown.style.display = 'block';
}

function closeAssigneeDropdown() {
    const dropdown = document.getElementById('history-assignee-dropdown');
    if (dropdown) dropdown.style.display = 'none';
}

function selectAssignee(name) {
    const input = document.getElementById('history-assignee-combobox');
    if (!input) return;
    selectedAssignee = normalizeAssignee(name);
    input.value = selectedAssignee;
    closeAssigneeDropdown();
    renderHistory();
}

function handleAssigneeComboboxKey(event) {
    const dropdown = document.getElementById('history-assignee-dropdown');
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
        if (active) active.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    } else if (event.key === 'Escape') {
        closeAssigneeDropdown();
    }
}

function setupTimeframeControls() {
    const timeframe = document.getElementById('history-timeframe');
    const startInput = document.getElementById('history-start-date');
    const endInput = document.getElementById('history-end-date');
    const customWrap = document.getElementById('history-custom-dates');

    timeframe?.addEventListener('change', () => {
        timeframeState.preset = timeframe.value;
        const isCustom = timeframeState.preset === 'custom';
        customWrap.classList.toggle('hidden', !isCustom);

        if (isCustom) {
            const [defaultStart, defaultEnd] = getDateRange();
            if (!startInput.value) startInput.value = toYmd(defaultStart);
            if (!endInput.value) endInput.value = toYmd(defaultEnd);
        }

        renderHistory();
    });

    startInput?.addEventListener('change', renderHistory);
    endInput?.addEventListener('change', renderHistory);
}

function getDateRange() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (timeframeState.preset === 'custom') {
        const startValue = document.getElementById('history-start-date')?.value;
        const endValue = document.getElementById('history-end-date')?.value;
        const start = startValue ? parseYmd(startValue) : new Date(today.getFullYear(), today.getMonth(), 1);
        const end = endValue ? parseYmd(endValue) : today;
        return [start, end];
    }

    if (timeframeState.preset === 'week') {
        const day = today.getDay();
        const diffToMonday = (day + 6) % 7;
        const start = new Date(today);
        start.setDate(today.getDate() - diffToMonday);
        return [start, today];
    }

    if (timeframeState.preset === 'month') {
        return [new Date(today.getFullYear(), today.getMonth(), 1), today];
    }

    if (timeframeState.preset === 'quarter') {
        const qStartMonth = Math.floor(today.getMonth() / 3) * 3;
        return [new Date(today.getFullYear(), qStartMonth, 1), today];
    }

    return [new Date(today.getFullYear(), 0, 1), today];
}

function getFilteredClosedIssues() {
    const [start, end] = getDateRange();
    const endInclusive = new Date(end);
    endInclusive.setHours(23, 59, 59, 999);

    return allClosedIssues.filter(i => {
        if (!i.completedDate) return false;
        if (selectedAssignee !== 'All' && (i.assignee?.name || '') !== selectedAssignee) return false;
        return i.completedDate >= start && i.completedDate <= endInclusive;
    });
}

function renderHistory() {
    const issues = getFilteredClosedIssues();
    const grouped = groupByDate(issues);

    renderCards(grouped);
    renderChart(grouped);
    renderClosedList(grouped);
}

function renderCards(grouped) {
    const days = Object.keys(grouped).sort();
    const total = days.reduce((sum, d) => sum + grouped[d].length, 0);
    const avg = days.length ? (total / days.length) : 0;

    let busiestLabel = '—';
    if (days.length) {
        const busiestKey = days.reduce((best, cur) => grouped[cur].length > grouped[best].length ? cur : best, days[0]);
        busiestLabel = `${formatDateHeading(parseYmd(busiestKey))} (${grouped[busiestKey].length})`;
    }

    document.getElementById('history-closed-count').textContent = String(total);
    document.getElementById('history-daily-average').textContent = avg.toFixed(1);
    document.getElementById('history-busiest-day').textContent = busiestLabel;
}

function renderChart(grouped) {
    const ctx = document.getElementById('history-chart');
    if (!ctx) return;

    const [start, end] = getDateRange();
    const labels = [];
    const values = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = toYmd(d);
        labels.push(key);
        values.push((grouped[key] || []).length);
    }

    if (historyChart) {
        historyChart.destroy();
        historyChart = null;
    }

    historyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.map(k => formatShortDate(parseYmd(k))),
            datasets: [{
                label: 'Closed Issues',
                data: values,
                backgroundColor: 'rgba(40, 167, 69, 0.6)',
                borderColor: 'rgba(40, 167, 69, 1)',
                borderWidth: 1,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'Issues Closed Per Day' },
            },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
            },
        },
    });
}

function renderClosedList(grouped) {
    const container = document.getElementById('history-closed-list');
    const days = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

    if (!days.length) {
        container.innerHTML = '<p class="loading">No closed issues in this range.</p>';
        return;
    }

    container.innerHTML = days.map(day => {
        const issues = grouped[day]
            .slice()
            .sort((a, b) => a.identifier.localeCompare(b.identifier));

        return `
            <div class="history-day-group">
                <h3 class="history-day-header">${formatDateHeading(parseYmd(day))}</h3>
                <div class="issue-list">
                    ${issues.map(renderClosedIssueItem).join('')}
                </div>
            </div>
        `;
    }).join('');
}

function renderClosedIssueItem(issue) {
    const assignee = issue.assignee?.name ? `👤 ${escapeHtml(issue.assignee.name)}` : '';
    const project = issue.project?.name ? `📁 ${escapeHtml(issue.project.name)}` : '';

    return `
        <div class="issue-item issue-state-done">
            <div class="issue-header">
                <div>
                    <a href="${issue.url}" target="_blank" class="issue-id">${issue.identifier}</a>
                    <div class="issue-title">${escapeHtml(issue.title)}</div>
                </div>
                <span class="status-badge status-done">${escapeHtml(issue.state?.name || 'Done')}</span>
            </div>
            <div class="issue-meta">
                ${assignee ? `<span>${assignee}</span>` : ''}
                ${project ? `<span>${project}</span>` : ''}
            </div>
        </div>
    `;
}

function groupByDate(issues) {
    const grouped = {};
    issues.forEach(issue => {
        const key = toYmd(issue.completedDate);
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(issue);
    });
    return grouped;
}

function parseDateOnly(iso) {
    const d = new Date(iso);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseYmd(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function toYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatDateHeading(date) {
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    });
}

function formatShortDate(date) {
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
