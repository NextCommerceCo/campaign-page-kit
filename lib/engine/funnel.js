/**
 * Campaign funnel map — serialize and validate the page graph.
 *
 * Collects routing data from parsed frontmatter, builds a directed graph
 * (nodes + edges), validates structural integrity, and writes funnel.json.
 */

const fs = require('fs');
const path = require('path');

/**
 * Map a frontmatter URL value to a node ID.
 *
 * Example: "/summer-sale/checkout/" → "checkout"
 *          "/summer-sale/"          → "index"
 *
 * @param {string} url           - The URL from frontmatter (e.g. next_success_url)
 * @param {string} campaignSlug  - The campaign slug to strip as prefix
 * @returns {string} node ID
 */
function urlToNodeId(url, campaignSlug) {
    if (!url) return null;
    // Skip external and non-path URLs (http, https, protocol-relative, mailto, tel, etc.)
    if (/^https?:\/\//i.test(url)) return null;
    if (/^\/\//.test(url)) return null;            // protocol-relative
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null; // any URI scheme (mailto:, tel:, ftp:, etc.)
    // Strip query string and fragment before processing
    let id = url.split('?')[0].split('#')[0];
    // Strip leading slash, campaign prefix, and trailing slash
    id = id.replace(/^\//, '').replace(/\/$/, '');
    const prefix = campaignSlug;
    if (id.startsWith(prefix + '/')) {
        id = id.slice(prefix.length + 1);
    } else if (id === prefix) {
        id = 'index';
    }
    // Strip .html extension if present
    id = id.replace(/\.html$/, '');
    return id || 'index';
}

/**
 * Edge kind mapping from frontmatter field to edge kind.
 */
const EDGE_FIELDS = {
    next_success_url: 'success',
    next_upsell_accept: 'accept',
    next_upsell_decline: 'decline',
};

/**
 * Generate a funnel map from collected page data.
 *
 * @param {string}   campaignSlug - Campaign slug
 * @param {object[]} pages        - Array of { relFile, frontmatter, url }
 * @returns {{ json: object, errors: string[], warnings: string[] }}
 */
function generateFunnelMap(campaignSlug, pages) {
    const nodes = [];
    const edges = [];

    for (const page of pages) {
        const { relFile, frontmatter, url } = page;
        // Derive node ID from the resolved URL (not filename) so that custom
        // permalinks produce the same ID that urlToNodeId resolves for edges.
        const nodeId = urlToNodeId(url, campaignSlug) || 'index';

        nodes.push({
            id: nodeId,
            path: url,
            type: frontmatter.page_type || null,
            title: frontmatter.title || nodeId,
            sourceFile: relFile,
        });

        // Extract edges from frontmatter routing fields
        for (const [field, kind] of Object.entries(EDGE_FIELDS)) {
            const targetUrl = frontmatter[field];
            if (targetUrl) {
                const targetId = urlToNodeId(targetUrl, campaignSlug);
                if (targetId) {
                    edges.push({ source: nodeId, target: targetId, kind });
                }
            }
        }
    }

    const graph = {
        campaign: campaignSlug,
        generatedAt: new Date().toISOString(),
        entryPoint: `/${campaignSlug}/`,
        nodes,
        edges,
        validation: { errors: [], warnings: [] },
    };

    const { errors, warnings } = validateFunnel(graph);
    graph.validation.errors = errors;
    graph.validation.warnings = warnings;

    return { json: graph, errors, warnings };
}

/**
 * Validate the funnel graph.
 *
 * @param {object} graph - The funnel graph object
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateFunnel(graph) {
    const errors = [];
    const warnings = [];
    const nodeIds = new Set(graph.nodes.map(n => n.id));
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

    // Rule: Duplicate pages — two pages resolving to the same node ID
    const seenIds = new Map();
    for (const node of graph.nodes) {
        if (seenIds.has(node.id)) {
            errors.push(`Duplicate page: ${seenIds.get(node.id)} and ${node.sourceFile} both resolve to node ID "${node.id}"`);
        } else {
            seenIds.set(node.id, node.sourceFile);
        }
    }

    // Rule: Missing entry point
    if (!nodeIds.has('index')) {
        errors.push(`Missing entry point: campaign "${graph.campaign}" has no index page`);
    }

    // Rule: Broken links — edge targets must exist
    for (const edge of graph.edges) {
        if (!nodeIds.has(edge.target)) {
            const sourceNode = nodeMap.get(edge.source);
            const sourceFile = sourceNode ? sourceNode.sourceFile : edge.source;
            errors.push(`Broken link: ${sourceFile} has ${edge.kind} edge to "${edge.target}" which does not exist`);
        }
    }

    // Rule: Asymmetric upsell — upsell pages need both accept and decline
    for (const node of graph.nodes) {
        if (node.type === 'upsell') {
            const nodeEdges = graph.edges.filter(e => e.source === node.id);
            const hasAccept = nodeEdges.some(e => e.kind === 'accept');
            const hasDecline = nodeEdges.some(e => e.kind === 'decline');
            if (hasAccept && !hasDecline) {
                errors.push(`Asymmetric upsell: ${node.sourceFile} has "accept" but no "decline" path`);
            }
            if (hasDecline && !hasAccept) {
                errors.push(`Asymmetric upsell: ${node.sourceFile} has "decline" but no "accept" path`);
            }
        }
    }

    // Rule: Orphan pages — BFS from entry point
    if (nodeIds.has('index')) {
        const reachable = new Set();
        const queue = ['index'];
        while (queue.length > 0) {
            const current = queue.shift();
            if (reachable.has(current)) continue;
            reachable.add(current);
            for (const edge of graph.edges) {
                if (edge.source === current && nodeIds.has(edge.target) && !reachable.has(edge.target)) {
                    queue.push(edge.target);
                }
            }
        }
        for (const node of graph.nodes) {
            if (!reachable.has(node.id)) {
                errors.push(`Orphan page: ${node.sourceFile} is not reachable from the entry point`);
            }
        }
    }

    // Rule: Missing terminal — every non-receipt typed node must have a path to a receipt.
    // This catches both dead-end nodes (no outgoing edges) and cycles that never reach
    // a receipt (e.g. checkout→upsell→checkout with no receipt).
    const receiptNodes = new Set(graph.nodes.filter(n => n.type === 'receipt').map(n => n.id));
    if (nodeIds.has('index') && receiptNodes.size > 0) {
        // Reverse BFS from receipt nodes: find all nodes that can reach a receipt
        const canReachReceipt = new Set(receiptNodes);
        const rQueue = [...receiptNodes];
        while (rQueue.length > 0) {
            const current = rQueue.shift();
            // Find all nodes with an edge TO current
            for (const edge of graph.edges) {
                if (edge.target === current && nodeIds.has(edge.source) && !canReachReceipt.has(edge.source)) {
                    canReachReceipt.add(edge.source);
                    rQueue.push(edge.source);
                }
            }
        }
        for (const node of graph.nodes) {
            if (node.type === 'receipt') continue;
            if (!node.type) continue;
            if (!canReachReceipt.has(node.id)) {
                errors.push(`Missing terminal: ${node.sourceFile} (type: ${node.type}) has no path to a receipt page`);
            }
        }
    } else if (nodeIds.has('index') && graph.nodes.some(n => n.type) && receiptNodes.size === 0) {
        // If there are typed pages but no receipt at all
        errors.push(`Missing terminal: campaign "${graph.campaign}" has no receipt page`);
    }

    return { errors, warnings };
}

/**
 * Write funnel.json to the output directory.
 *
 * @param {object} json       - The funnel graph object
 * @param {string} outputPath - Output base directory (_site/)
 * @param {string} campaignSlug
 */
function writeFunnelJson(json, outputPath, campaignSlug) {
    const outDir = path.join(outputPath, campaignSlug);
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'funnel.json');
    fs.writeFileSync(outFile, JSON.stringify(json, null, 2), 'utf8');
    return outFile;
}

module.exports = { generateFunnelMap, validateFunnel, writeFunnelJson, urlToNodeId };
