// Dashboard State
let allIssues = [];
let lastUpdate = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    await fetchData();
    renderDashboard();
    
    // Auto-refresh every 10 minutes
    setInterval(async () => {
        await fetchData();
        renderDashboard();
    }, 10 * 60 * 1000);
    
    // Manual refresh button
    document.getElementById('refresh-btn').addEventListener('click', async () => {
        await fetchData();
        renderDashboard();
    });
});

// Fetch data from Linear API (via Cloudflare Worker proxy)
async function fetchData() {
    try {
        const response = await fetch(CONFIG.WORKER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: `
                    query {
                        issues(
                            first: 250
                            filter: {
                                assignee: { email: { eq: "rhollister@wjct.org" } }
                            }
                            orderBy: updatedAt
                        ) {
                            nodes {
                                id
                                identifier
                                title
                                description
                                state {
                                    name
                                    type
                                }
                                priority
                                priorityLabel
                                dueDate
                                createdAt
                                updatedAt
                                project {
                                    name
                                }
                                url
                            }
                        }
                    }
                `
            })
        });
        
        const data = await response.json();
        
        if (data.errors) {
            console.error('Linear API errors:', data.errors);
            return;
        }
        
        allIssues = data.data.issues.nodes;
        lastUpdate = new Date();
        
        // Update last updated time
        document.getElementById('last-updated').textContent = 
            `Updated: ${lastUpdate.toLocaleTimeString()}`;
            
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

// Render dashboard
function renderDashboard() {
    renderSummaryCards();
    renderUrgentDeadlines();
    renderActiveWork();
    renderBlockedIssues();
    renderProjectsOverview();
    renderMetricsChart();
}

// Render summary cards
function renderSummaryCards() {
    const urgent = allIssues.filter(i => 
        i.priorityLabel === 'Urgent' && 
        !['Done', 'Canceled', 'Duplicate'].includes(i.state.name)
    );
    const active = allIssues.filter(i => 
        ['In Progress', 'Active'].includes(i.state.name)
    );
    const blocked = allIssues.filter(i => 
        i.state.name === 'Blocked'
    );
    const done = allIssues.filter(i => 
        i.state.name === 'Done'
    );
    
    document.getElementById('urgent-count').textContent = urgent.length;
    document.getElementById('active-count').textContent = active.length;
    document.getElementById('blocked-count').textContent = blocked.length;
    document.getElementById('done-count').textContent = done.length;
}

// Render urgent deadlines
function renderUrgentDeadlines() {
    const today = new Date();
    const sevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const urgentDeadlines = allIssues
        .filter(i => {
            if (!i.dueDate) return false;
            if (['Done', 'Canceled', 'Duplicate'].includes(i.state.name)) return false;
            const dueDate = new Date(i.dueDate);
            return dueDate <= sevenDays;
        })
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    
    const container = document.getElementById('urgent-deadlines');
    
    if (urgentDeadlines.length === 0) {
        container.innerHTML = '<p class="loading">No urgent deadlines in the next 7 days ✅</p>';
        return;
    }
    
    container.innerHTML = urgentDeadlines.map(issue => renderIssueItem(issue, true)).join('');
}

// Render active work
function renderActiveWork() {
    const activeIssues = allIssues
        .filter(i => ['In Progress', 'Active', 'In Review'].includes(i.state.name))
        .sort((a, b) => {
            // Sort by priority then due date
            const priorityOrder = { 'Urgent': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'No priority': 4 };
            const aPriority = priorityOrder[a.priorityLabel] || 4;
            const bPriority = priorityOrder[b.priorityLabel] || 4;
            
            if (aPriority !== bPriority) return aPriority - bPriority;
            if (a.dueDate && !b.dueDate) return -1;
            if (!a.dueDate && b.dueDate) return 1;
            if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
            return 0;
        });
    
    const container = document.getElementById('active-work');
    
    if (activeIssues.length === 0) {
        container.innerHTML = '<p class="loading">No active work</p>';
        return;
    }
    
    container.innerHTML = activeIssues.map(issue => renderIssueItem(issue)).join('');
}

// Render blocked issues
function renderBlockedIssues() {
    const blockedIssues = allIssues
        .filter(i => i.state.name === 'Blocked');
    
    const container = document.getElementById('blocked-issues');
    
    if (blockedIssues.length === 0) {
        container.innerHTML = '<p class="loading">No blocked issues ✅</p>';
        return;
    }
    
    container.innerHTML = blockedIssues.map(issue => renderIssueItem(issue)).join('');
}

// Render issue item
function renderIssueItem(issue, showDueDate = false) {
    const priorityClass = issue.priorityLabel ? 
        `priority-${issue.priorityLabel.toLowerCase()}` : '';
    
    const dueInfo = issue.dueDate ? 
        `<span class="due-soon">📅 Due ${formatDate(issue.dueDate)}</span>` : '';
    
    const statusBadge = `<span class="status-badge status-${issue.state.name.toLowerCase().replace(' ', '-')}">${issue.state.name}</span>`;
    
    const projectInfo = issue.project ? 
        `<span>📁 ${issue.project.name}</span>` : '';
    
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
                ${showDueDate || issue.dueDate ? dueInfo : ''}
            </div>
        </div>
    `;
}

// Render projects overview
function renderProjectsOverview() {
    const projectStats = {};
    
    allIssues.forEach(issue => {
        const projectName = issue.project?.name || 'No Project';
        if (!projectStats[projectName]) {
            projectStats[projectName] = {
                name: projectName,
                total: 0,
                active: 0,
                done: 0,
                blocked: 0
            };
        }
        
        projectStats[projectName].total++;
        
        if (['In Progress', 'Active'].includes(issue.state.name)) {
            projectStats[projectName].active++;
        } else if (issue.state.name === 'Done') {
            projectStats[projectName].done++;
        } else if (issue.state.name === 'Blocked') {
            projectStats[projectName].blocked++;
        }
    });
    
    // Sort by active issues descending
    const projects = Object.values(projectStats)
        .sort((a, b) => b.active - a.active)
        .filter(p => p.active > 0 || p.blocked > 0) // Only show projects with active or blocked work
        .slice(0, 8); // Top 8 projects
    
    const container = document.getElementById('projects-overview');
    
    if (projects.length === 0) {
        container.innerHTML = '<p class="loading">No active projects</p>';
        return;
    }
    
    container.innerHTML = projects.map(project => `
        <div class="project-card">
            <div class="project-name">${escapeHtml(project.name)}</div>
            <div class="project-stats">
                <span>🔥 <strong>${project.active}</strong> active</span>
                ${project.blocked > 0 ? `<span>🚧 <strong>${project.blocked}</strong> blocked</span>` : ''}
                <span>✅ <strong>${project.done}</strong> done</span>
            </div>
        </div>
    `).join('');
}

// Render metrics chart
function renderMetricsChart() {
    const ctx = document.getElementById('metrics-chart');
    
    const statusCounts = {
        'Backlog': 0,
        'Todo': 0,
        'In Progress': 0,
        'Active': 0,
        'Blocked': 0,
        'In Review': 0,
        'Done': 0
    };
    
    allIssues.forEach(issue => {
        const status = issue.state.name;
        if (statusCounts.hasOwnProperty(status)) {
            statusCounts[status]++;
        }
    });
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(statusCounts),
            datasets: [{
                label: 'Issue Count',
                data: Object.values(statusCounts),
                backgroundColor: [
                    '#6c757d', // Backlog
                    '#ffc107', // Todo
                    '#fd7e14', // In Progress
                    '#dc3545', // Active
                    '#6c757d', // Blocked
                    '#17a2b8', // In Review
                    '#28a745'  // Done
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: 'Issues by Status'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 5
                    }
                }
            }
        }
    });
}

// Helper: Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    
    const diff = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
    if (diff < 7 && diff > 0) return `in ${diff} days`;
    if (diff < 0) return `${Math.abs(diff)} days ago (OVERDUE)`;
    
    return date.toLocaleDateString();
}

// Helper: Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
