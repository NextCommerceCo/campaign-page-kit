/**
 * Funnel visual — generate a self-contained HTML visualization of the funnel graph.
 *
 * Produces a standalone HTML file with inline CSS + JS that renders an SVG DAG.
 * Zero external dependencies. Works offline. Layout computed at render time.
 */

const fs = require('fs');
const path = require('path');

/**
 * Generate and write funnel.html to the CPK artifacts directory.
 *
 * @param {object} json         - The funnel graph object (from generateFunnelMap)
 * @param {string} cpkPath      - CPK artifacts base directory (.cpk/)
 * @param {string} campaignSlug - Campaign slug
 * @returns {string} Path to the written HTML file
 */
function writeFunnelHtml(json, cpkPath, campaignSlug) {
    const outDir = path.join(cpkPath, campaignSlug);
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'funnel.html');

    // Safely embed graph data via JSON.stringify, then escape </script> sequences
    // to prevent the HTML parser from interpreting them as closing tags.
    const graphJson = JSON.stringify(json).replace(/<\//g, '<\\/');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Funnel: ${escapeHtml(json.campaign)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8f9fa; color: #1a1a2e; padding: 24px; }
h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
.meta { font-size: 13px; color: #666; margin-bottom: 16px; }
.errors-panel { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
.errors-panel h2 { font-size: 14px; color: #dc2626; margin-bottom: 8px; }
.errors-panel ul { list-style: none; padding: 0; }
.errors-panel li { font-size: 13px; color: #991b1b; padding: 2px 0; }
.errors-panel li::before { content: "\\2716 "; color: #dc2626; }
.warnings-panel { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
.warnings-panel h2 { font-size: 14px; color: #d97706; margin-bottom: 8px; }
.warnings-panel ul { list-style: none; padding: 0; }
.warnings-panel li { font-size: 13px; color: #92400e; padding: 2px 0; }
.warnings-panel li::before { content: "\\26A0 "; color: #d97706; }
.graph-container { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; overflow-x: auto; }
svg text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.node-rect { rx: 8; ry: 8; stroke-width: 2; }
.node-title { font-size: 13px; font-weight: 600; fill: #1a1a2e; }
.node-type { font-size: 10px; font-weight: 500; fill: #fff; }
.node-path { font-size: 10px; fill: #666; }
.edge-line { fill: none; stroke-width: 2; }
.edge-label { font-size: 10px; font-weight: 500; }
.edge-arrow { stroke-width: 2; }
.orphan-section { margin-top: 16px; padding-top: 16px; border-top: 1px dashed #d1d5db; }
.orphan-label { font-size: 12px; color: #6b7280; font-style: italic; }
.type-badge { rx: 4; ry: 4; }
.healthy { background: #f0fdf4; border-color: #86efac; }
</style>
</head>
<body>
<h1>Funnel: ${escapeHtml(json.campaign)}</h1>
<div class="meta">Generated ${escapeHtml(json.generatedAt)} &middot; Entry: ${escapeHtml(json.entryPoint)}</div>
<div id="errors"></div>
<div id="warnings"></div>
<div class="graph-container" id="graph"></div>
<script>
const graph = ${graphJson};
(function() {
    // Render validation panels
    var errorsEl = document.getElementById('errors');
    var warningsEl = document.getElementById('warnings');
    if (graph.validation.errors.length > 0) {
        errorsEl.className = 'errors-panel';
        var h = document.createElement('h2');
        h.textContent = graph.validation.errors.length + ' Validation Error' + (graph.validation.errors.length !== 1 ? 's' : '');
        errorsEl.appendChild(h);
        var ul = document.createElement('ul');
        graph.validation.errors.forEach(function(e) {
            var li = document.createElement('li');
            li.textContent = e;
            ul.appendChild(li);
        });
        errorsEl.appendChild(ul);
    }
    if (graph.validation.warnings.length > 0) {
        warningsEl.className = 'warnings-panel';
        var h2 = document.createElement('h2');
        h2.textContent = graph.validation.warnings.length + ' Warning' + (graph.validation.warnings.length !== 1 ? 's' : '');
        warningsEl.appendChild(h2);
        var ul2 = document.createElement('ul');
        graph.validation.warnings.forEach(function(w) {
            var li = document.createElement('li');
            li.textContent = w;
            ul2.appendChild(li);
        });
        warningsEl.appendChild(ul2);
    }
    if (graph.validation.errors.length === 0 && graph.validation.warnings.length === 0) {
        var container = document.querySelector('.graph-container');
        container.classList.add('healthy');
    }

    // Compute BFS depth from entry point
    var nodeMap = {};
    graph.nodes.forEach(function(n) { nodeMap[n.id] = n; });
    var depths = {};
    var edgeTargets = new Set(graph.edges.map(function(e) { return e.target; }));
    var validNodeIds = new Set(graph.nodes.map(function(n) { return n.id; }));

    // BFS from index
    var queue = [{ id: 'index', depth: 0 }];
    var visited = new Set();
    while (queue.length > 0) {
        var current = queue.shift();
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        depths[current.id] = current.depth;
        graph.edges.forEach(function(e) {
            if (e.source === current.id && validNodeIds.has(e.target) && !visited.has(e.target)) {
                queue.push({ id: e.target, depth: current.depth + 1 });
            }
        });
    }

    // Orphan nodes get depth = -1
    var orphans = [];
    graph.nodes.forEach(function(n) {
        if (depths[n.id] === undefined) {
            depths[n.id] = -1;
            orphans.push(n);
        }
    });

    // Group nodes by depth
    var columns = {};
    var maxDepth = 0;
    graph.nodes.forEach(function(n) {
        var d = depths[n.id];
        if (d < 0) return; // orphans handled separately
        if (!columns[d]) columns[d] = [];
        columns[d].push(n);
        if (d > maxDepth) maxDepth = d;
    });

    // Layout constants
    var NODE_W = 180;
    var NODE_H = 70;
    var COL_GAP = 80;
    var ROW_GAP = 30;
    var PAD_X = 40;
    var PAD_Y = 40;

    // Compute node positions
    var positions = {};
    var maxColHeight = 0;
    for (var d = 0; d <= maxDepth; d++) {
        var col = columns[d] || [];
        var colHeight = col.length * NODE_H + (col.length - 1) * ROW_GAP;
        if (colHeight > maxColHeight) maxColHeight = colHeight;
    }
    for (var d2 = 0; d2 <= maxDepth; d2++) {
        var col2 = columns[d2] || [];
        var colHeight2 = col2.length * NODE_H + (col2.length - 1) * ROW_GAP;
        var startY = PAD_Y + (maxColHeight - colHeight2) / 2;
        col2.forEach(function(n, i) {
            positions[n.id] = {
                x: PAD_X + d2 * (NODE_W + COL_GAP),
                y: startY + i * (NODE_H + ROW_GAP)
            };
        });
    }

    // Position orphans below
    var orphanStartY = PAD_Y + maxColHeight + 60;
    orphans.forEach(function(n, i) {
        positions[n.id] = {
            x: PAD_X + i * (NODE_W + COL_GAP),
            y: orphanStartY
        };
    });

    var svgWidth = PAD_X * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP;
    if (orphans.length > 0) {
        var orphanWidth = PAD_X * 2 + orphans.length * NODE_W + (orphans.length - 1) * COL_GAP;
        if (orphanWidth > svgWidth) svgWidth = orphanWidth;
    }
    var svgHeight = orphans.length > 0 ? orphanStartY + NODE_H + PAD_Y : PAD_Y * 2 + maxColHeight;
    if (svgHeight < 200) svgHeight = 200;
    if (svgWidth < 300) svgWidth = 300;

    // Type colors
    var TYPE_COLORS = {
        product: { fill: '#dbeafe', stroke: '#3b82f6', badge: '#3b82f6' },
        checkout: { fill: '#dcfce7', stroke: '#22c55e', badge: '#22c55e' },
        upsell: { fill: '#fef3c7', stroke: '#f59e0b', badge: '#f59e0b' },
        downsell: { fill: '#fef3c7', stroke: '#f59e0b', badge: '#f59e0b' },
        receipt: { fill: '#f3e8ff', stroke: '#a855f7', badge: '#a855f7' }
    };
    var DEFAULT_COLOR = { fill: '#f3f4f6', stroke: '#9ca3af', badge: '#9ca3af' };

    // Edge colors
    var EDGE_COLORS = { success: '#22c55e', accept: '#3b82f6', decline: '#ef4444' };

    // Error node IDs (for red border)
    var errorNodeIds = new Set();
    graph.validation.errors.forEach(function(e) {
        graph.nodes.forEach(function(n) {
            if (e.indexOf(n.sourceFile) !== -1 || e.indexOf('"' + n.id + '"') !== -1) {
                errorNodeIds.add(n.id);
            }
        });
    });

    // Build SVG
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', svgWidth);
    svg.setAttribute('height', svgHeight);
    svg.setAttribute('viewBox', '0 0 ' + svgWidth + ' ' + svgHeight);

    // Arrow marker
    var defs = document.createElementNS(ns, 'defs');
    ['success', 'accept', 'decline'].forEach(function(kind) {
        var marker = document.createElementNS(ns, 'marker');
        marker.setAttribute('id', 'arrow-' + kind);
        marker.setAttribute('viewBox', '0 0 10 8');
        marker.setAttribute('refX', '10');
        marker.setAttribute('refY', '4');
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '8');
        marker.setAttribute('orient', 'auto');
        var p = document.createElementNS(ns, 'path');
        p.setAttribute('d', 'M0,0 L10,4 L0,8 Z');
        p.setAttribute('fill', EDGE_COLORS[kind] || '#9ca3af');
        marker.appendChild(p);
        defs.appendChild(marker);
    });
    svg.appendChild(defs);

    // Draw edges first (behind nodes)
    graph.edges.forEach(function(e) {
        var sp = positions[e.source];
        var tp = positions[e.target];
        if (!sp || !tp) return;

        var x1 = sp.x + NODE_W;
        var y1 = sp.y + NODE_H / 2;
        var x2 = tp.x;
        var y2 = tp.y + NODE_H / 2;

        var line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', EDGE_COLORS[e.kind] || '#9ca3af');
        line.setAttribute('class', 'edge-line');
        line.setAttribute('marker-end', 'url(#arrow-' + e.kind + ')');
        svg.appendChild(line);

        // Edge label
        var lx = (x1 + x2) / 2;
        var ly = (y1 + y2) / 2 - 6;
        var label = document.createElementNS(ns, 'text');
        label.setAttribute('x', lx);
        label.setAttribute('y', ly);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('class', 'edge-label');
        label.setAttribute('fill', EDGE_COLORS[e.kind] || '#9ca3af');
        label.textContent = e.kind;
        svg.appendChild(label);
    });

    // Draw nodes
    graph.nodes.forEach(function(n) {
        var pos = positions[n.id];
        if (!pos) return;
        var colors = TYPE_COLORS[n.type] || DEFAULT_COLOR;
        var hasError = errorNodeIds.has(n.id);

        var g = document.createElementNS(ns, 'g');

        // Node rectangle
        var rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', pos.x);
        rect.setAttribute('y', pos.y);
        rect.setAttribute('width', NODE_W);
        rect.setAttribute('height', NODE_H);
        rect.setAttribute('fill', hasError ? '#fef2f2' : colors.fill);
        rect.setAttribute('stroke', hasError ? '#dc2626' : colors.stroke);
        rect.setAttribute('class', 'node-rect');
        if (hasError) rect.setAttribute('stroke-dasharray', '4,2');
        g.appendChild(rect);

        // Type badge
        if (n.type) {
            var badgeW = n.type.length * 6.5 + 12;
            var badge = document.createElementNS(ns, 'rect');
            badge.setAttribute('x', pos.x + 8);
            badge.setAttribute('y', pos.y + 6);
            badge.setAttribute('width', badgeW);
            badge.setAttribute('height', 16);
            badge.setAttribute('fill', hasError ? '#dc2626' : colors.badge);
            badge.setAttribute('class', 'type-badge');
            g.appendChild(badge);

            var badgeText = document.createElementNS(ns, 'text');
            badgeText.setAttribute('x', pos.x + 8 + badgeW / 2);
            badgeText.setAttribute('y', pos.y + 17);
            badgeText.setAttribute('text-anchor', 'middle');
            badgeText.setAttribute('class', 'node-type');
            badgeText.textContent = n.type;
            g.appendChild(badgeText);
        }

        // Title
        var title = document.createElementNS(ns, 'text');
        title.setAttribute('x', pos.x + 8);
        title.setAttribute('y', pos.y + 38);
        title.setAttribute('class', 'node-title');
        title.textContent = n.title.length > 22 ? n.title.substring(0, 20) + '...' : n.title;
        g.appendChild(title);

        // Path
        var pathText = document.createElementNS(ns, 'text');
        pathText.setAttribute('x', pos.x + 8);
        pathText.setAttribute('y', pos.y + 54);
        pathText.setAttribute('class', 'node-path');
        pathText.textContent = n.path;
        g.appendChild(pathText);

        svg.appendChild(g);
    });

    // Orphan label
    if (orphans.length > 0) {
        var orphanLabel = document.createElementNS(ns, 'text');
        orphanLabel.setAttribute('x', PAD_X);
        orphanLabel.setAttribute('y', orphanStartY - 12);
        orphanLabel.setAttribute('class', 'orphan-label');
        orphanLabel.textContent = 'Unreachable pages:';
        svg.appendChild(orphanLabel);
    }

    document.getElementById('graph').appendChild(svg);
})();
</script>
</body>
</html>`;

    fs.writeFileSync(outFile, html, 'utf8');
    return outFile;
}

/**
 * Escape HTML special characters for safe embedding in HTML attributes/content.
 * Used only for static template parts (campaign name, timestamps).
 * Graph data is embedded via JSON.stringify, not this function.
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = { writeFunnelHtml, escapeHtml };
