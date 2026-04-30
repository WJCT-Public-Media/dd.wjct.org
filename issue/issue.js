let allIssues = [];
let lastUpdate = null;

const TEAM_ID = CONFIG.TEAM_ID;
const DEFAULT_ISSUE = 'DM-1077';

function readRequestedIdentifier() {
    const hash = (window.location.hash || '').replace(/^#/, '').trim().toUpperCase();
    return hash || DEFAULT_ISSUE;
}

function setRequestedIdentifier(identifier) {
    const normalized = normalizeIdentifier(identifier);
    if (!normalized) return;
    window.location.hash = normalized;
}

function normalizeIdentifier(value) {
    return (value || '').trim().toUpperCase();
}

document.addEventListener('DOMContentLoaded', async () => {
    bindUi();
    bindIssueCardNavigation();
    syncInputToHash();
    await fetchIssues();
    renderPage();

    setInterval(async () => {
        await fetchIssues();
        renderPage();
    }, CONFIG.REFRESH_INTERVAL);

    window.addEventListener('hashchange', () => {
        syncInputToHash();
        renderPage();
    });
});

function bindUi() {
    document.getElementById('refresh-btn')?.addEventListener('click', async () => {
        await fetchIssues();
        renderPage();
    });

    document.getElementById('load-issue-btn')?.addEventListener('click', () => {
        const input = document.getElementById('issue-identifier-input');
        setRequestedIdentifier(input?.value);
    });

    document.getElementById('issue-identifier-input')?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            setRequestedIdentifier(event.target.value);
        }
    });
}

function syncInputToHash() {
    const input = document.getElementById('issue-identifier-input');
    if (input) input.value = readRequestedIdentifier();
}

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

async function fetchIssues() {
    try {
        const data = await callWorker(`
            query {
                issues(
                    first: 250
                    filter: { team: { id: { eq: "${TEAM_ID}" } } }
                    orderBy: updatedAt
                ) {
                    nodes {
                        id
                        identifier
                        title
                        description
                        dueDate
                        priority
                        priorityLabel
                        url
                        state { name type }
                        assignee { name }
                        labels { nodes { name color } }
                        parent { id identifier title }
                    }
                }
            }
        `);

        allIssues = data?.issues?.nodes || [];
        lastUpdate = new Date();
        const stamp = document.getElementById('last-updated');
        if (stamp) stamp.textContent = `Updated: ${lastUpdate.toLocaleTimeString()}`;
    } catch (error) {
        console.error('Issue fetch failed:', error);
        const container = document.getElementById('issue-detail-content');
        if (container) {
            container.innerHTML = `<p class="loading">Unable to load issues right now.</p>`;
        }
    }
}

function renderPage() {
    const identifier = readRequestedIdentifier();
    const issue = allIssues.find(item => item.identifier === identifier);
    const detail = document.getElementById('issue-detail-content');
    const subissuesSection = document.getElementById('subissues-section');
    const subissuesList = document.getElementById('subissues-list');

    if (!detail || !subissuesSection || !subissuesList) return;

    if (!identifier) {
        detail.innerHTML = `<p class="loading">Enter a Linear issue like DM-1077.</p>`;
        subissuesSection.classList.add('hidden');
        return;
    }

    if (!issue) {
        detail.innerHTML = `
            <div class="issue-detail-empty">
                <h2>Issue not found</h2>
                <p>I couldn't find <strong>${escapeHtml(identifier)}</strong> in the latest dashboard issue set.</p>
            </div>`;
        subissuesSection.classList.add('hidden');
        return;
    }

    detail.innerHTML = renderIssueDetail(issue);

    const flattenedChildren = flattenIssueHierarchy(
        allIssues.filter(item => item.parent?.id === issue.id)
    );

    if (flattenedChildren.length === 0) {
        subissuesSection.classList.add('hidden');
        subissuesList.innerHTML = '';
        return;
    }

    subissuesSection.classList.remove('hidden');
    subissuesList.innerHTML = flattenedChildren
        .map(({ issue: child, depth }) => renderIssueSummaryCard(child, depth))
        .join('');
}

function renderIssueDetail(issue) {
    const statusSlug = slugifyState(issue.state?.name || 'Unknown');
    const labels = issue.labels?.nodes || [];
    const hasDescription = (issue.description || '').trim().length > 0;
    const parentHtml = issue.parent
        ? `<div class="issue-detail-parent">Parent issue: <a href="#${escapeHtml(issue.parent.identifier)}">${escapeHtml(issue.parent.identifier)}</a> — ${escapeHtml(issue.parent.title || '')}</div>`
        : '';

    return `
        <article class="issue-detail-card issue-state-${statusSlug}">
            <div class="issue-header issue-detail-header">
                <div>
                    <a href="${issue.url}" target="_blank" class="issue-id">${escapeHtml(issue.identifier)}</a>
                    <h2 class="issue-detail-title">${escapeHtml(issue.title)}</h2>
                    ${parentHtml}
                </div>
                <span class="status-badge status-${statusSlug}">${escapeHtml(issue.state?.name || 'Unknown')}</span>
            </div>

            <div class="issue-detail-grid">
                ${renderDetailField('Status', issue.state?.name || '—')}
                ${renderDetailField('Priority', issue.priorityLabel || 'No priority')}
                ${renderDetailField('Assignee(s)', issue.assignee?.name || 'Unassigned')}
                ${renderDetailField('Due date', issue.dueDate ? formatDate(issue.dueDate) : 'None')}
            </div>

            <div class="issue-meta issue-detail-meta">
                <span>⚡ ${escapeHtml(issue.priorityLabel || 'No priority')}</span>
                <span>👤 ${escapeHtml(issue.assignee?.name || 'Unassigned')}</span>
                <span>📅 ${escapeHtml(issue.dueDate ? formatDate(issue.dueDate) : 'No due date')}</span>
                <span class="issue-meta-labels">🏷️ ${renderLabels(labels)}</span>
            </div>

            <div class="issue-detail-description">
                <h3>Description</h3>
                <div class="issue-description-body${hasDescription ? '' : ' issue-description-empty'}">${hasDescription ? renderDescription(issue.description) : 'No description provided.'}</div>
            </div>
        </article>`;
}

function renderDetailField(label, value, allowHtml = false) {
    return `
        <div class="issue-detail-field">
            <div class="issue-detail-label">${escapeHtml(label)}</div>
            <div class="issue-detail-value">${allowHtml ? value : escapeHtml(value)}</div>
        </div>`;
}

function renderLabels(labels) {
    if (!labels.length) return '<span class="issue-detail-muted">No labels</span>';

    return labels.map(label => {
        const bg = hexToRgba(label.color, 0.14);
        const border = label.color || '#dee2e6';
        return `<span class="detail-label-chip" style="background:${bg}; border-color:${border};">${escapeHtml(label.name)}</span>`;
    }).join(' ');
}

function renderDescription(text) {
    return markdownToHtml(text || '');
}

function markdownToHtml(markdown) {
    const normalized = String(markdown || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return '';

    const lines = normalized.split('\n');
    const html = [];
    let paragraph = [];
    let listType = null;
    let listItems = [];
    let inCodeBlock = false;
    let codeLines = [];

    const flushParagraph = () => {
        if (!paragraph.length) return;
        html.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
        paragraph = [];
    };

    const flushList = () => {
        if (!listType || !listItems.length) return;
        html.push(`<${listType}>${listItems.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${listType}>`);
        listType = null;
        listItems = [];
    };

    const flushCodeBlock = () => {
        if (!inCodeBlock) return;
        html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCodeBlock = false;
        codeLines = [];
    };

    for (const line of lines) {
        if (line.trim().startsWith('```')) {
            flushParagraph();
            flushList();
            if (inCodeBlock) flushCodeBlock();
            else inCodeBlock = true;
            continue;
        }

        if (inCodeBlock) {
            codeLines.push(line);
            continue;
        }

        if (!line.trim()) {
            flushParagraph();
            flushList();
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            flushParagraph();
            flushList();
            const level = heading[1].length;
            html.push(`<h${level + 2 > 6 ? 6 : level + 2}>${renderInlineMarkdown(heading[2])}</h${level + 2 > 6 ? 6 : level + 2}>`);
            continue;
        }

        if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
            flushParagraph();
            flushList();
            html.push('<hr>');
            continue;
        }

        const blockquote = line.match(/^>\s?(.*)$/);
        if (blockquote) {
            flushParagraph();
            flushList();
            html.push(`<blockquote>${renderInlineMarkdown(blockquote[1])}</blockquote>`);
            continue;
        }

        const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
        if (unordered) {
            flushParagraph();
            if (listType && listType !== 'ul') flushList();
            listType = 'ul';
            listItems.push(unordered[1]);
            continue;
        }

        const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (ordered) {
            flushParagraph();
            if (listType && listType !== 'ol') flushList();
            listType = 'ol';
            listItems.push(ordered[1]);
            continue;
        }

        paragraph.push(line.trim());
    }

    flushParagraph();
    flushList();
    flushCodeBlock();

    return html.join('');
}

function renderInlineMarkdown(text) {
    let html = escapeHtml(text || '');
    const tokens = [];
    const stash = (value) => {
        const token = `@@TOKEN${tokens.length}@@`;
        tokens.push(value);
        return token;
    };

    html = html.replace(/`([^`]+)`/g, (_, code) => stash(`<code>${code}</code>`));
    html = html.replace(/!\[([^\]]*)\]\(&lt;(https?:\/\/[^\s&]+)&gt;\)/g, (_, alt, url) => stash(`<img src="${url}" alt="${alt}">`));
    html = html.replace(/!\[([^\]]*)\]\(<(https?:\/\/[^\s>]+)>\)/g, (_, alt, url) => stash(`<img src="${url}" alt="${alt}">`));
    html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_, alt, url) => stash(`<img src="${url}" alt="${alt}">`));
    html = html.replace(/\[([^\]]+)\]\(&lt;(https?:\/\/[^\s&]+)&gt;\)/g, (_, label, url) => stash(`<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`));
    html = html.replace(/\[([^\]]+)\]\(<(https?:\/\/[^\s>]+)>\)/g, (_, label, url) => stash(`<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`));
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => stash(`<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`));
    html = html.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (_, lead, url) => `${lead}${stash(`<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`)}`);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
    html = html.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return html.replace(/@@TOKEN(\d+)@@/g, (_, index) => tokens[Number(index)] || '');
}

function renderIssueSummaryCard(issue, depth = 0) {
    const statusSlug = slugifyState(issue.state?.name || 'Unknown');
    const safeDepth = Math.min(6, Math.max(0, depth));
    const labels = issue.labels?.nodes || [];
    const hasDescription = (issue.description || '').trim().length > 0;

    return `
        <div class="issue-item issue-item-link issue-state-${statusSlug}" style="--issue-depth:${safeDepth}" data-detail-url="#${escapeHtml(issue.identifier)}" role="link" tabindex="0">
            <div class="issue-header">
                <div>
                    <a href="${issue.url}" target="_blank" class="issue-id">${escapeHtml(issue.identifier)}</a>
                    <div class="issue-title">${escapeHtml(issue.title)}</div>
                </div>
                <span class="status-badge status-${statusSlug}">${escapeHtml(issue.state?.name || 'Unknown')}</span>
            </div>
            <div class="issue-meta">
                <span>⚡ ${escapeHtml(issue.priorityLabel || 'No priority')}</span>
                <span>👤 ${escapeHtml(issue.assignee?.name || 'Unassigned')}</span>
                <span>📅 ${escapeHtml(issue.dueDate ? formatDate(issue.dueDate) : 'No due date')}</span>
                <span class="issue-meta-labels">🏷️ ${renderLabels(labels)}</span>
            </div>
            <div class="issue-subdescription${hasDescription ? '' : ' issue-description-empty'}">${hasDescription ? renderDescription(issue.description) : 'No description provided.'}</div>
        </div>`;
}

function bindIssueCardNavigation() {
    document.addEventListener('click', (event) => {
        if (event.target.closest('a, button, input, textarea, select, label')) return;
        const card = event.target.closest('.issue-item-link');
        if (!card) return;
        const url = card.getAttribute('data-detail-url');
        if (url) window.location.href = url;
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const card = event.target.closest('.issue-item-link');
        if (!card) return;
        event.preventDefault();
        const url = card.getAttribute('data-detail-url');
        if (url) window.location.href = url;
    });
}

function flattenIssueHierarchy(issues) {
    const byId = new Map(issues.map(issue => [issue.id, issue]));
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
    }).sort(defaultIssueSort);

    const flattened = [];
    const visit = (issue, depth) => {
        flattened.push({ issue, depth });
        const children = (childrenByParent.get(issue.id) || []).sort(defaultIssueSort);
        children.forEach(child => visit(child, depth + 1));
    };

    roots.forEach(root => visit(root, 0));
    return flattened;
}

function defaultIssueSort(a, b) {
    const order = { 'Urgent': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'No priority': 4 };
    const aPriority = order[a.priorityLabel] ?? 4;
    const bPriority = order[b.priorityLabel] ?? 4;
    if (aPriority !== bPriority) return aPriority - bPriority;
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    if (a.dueDate && b.dueDate) return parseLocalDate(a.dueDate) - parseLocalDate(b.dueDate);
    return a.identifier.localeCompare(b.identifier);
}

function slugifyState(value) {
    return (value || 'unknown').toLowerCase().replace(/\s+/g, '-');
}

function formatDate(dateString) {
    const date = parseLocalDate(dateString);
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

function parseLocalDate(str) {
    if (!str) return null;
    const [year, month, day] = str.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function hexToRgba(hex, alpha = 0.15) {
    const value = (hex || '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(value)) return `rgba(108, 117, 125, ${alpha})`;

    const int = parseInt(value, 16);
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
