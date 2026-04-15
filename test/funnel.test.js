const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { generateFunnelMap, validateFunnel, writeFunnelJson, urlToNodeId } = require('../lib/engine/funnel');
const { build } = require('../lib/engine/build');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTmpDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-test-'));
    return fn(dir).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

function writeFixture(base, relPath, content) {
    const full = path.join(base, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
}

// ---------------------------------------------------------------------------
// urlToNodeId — unit tests
// ---------------------------------------------------------------------------

test('urlToNodeId: strips campaign prefix and trailing slash', () => {
    assert.equal(urlToNodeId('/summer-sale/checkout/', 'summer-sale'), 'checkout');
});

test('urlToNodeId: campaign root maps to index', () => {
    assert.equal(urlToNodeId('/summer-sale/', 'summer-sale'), 'index');
});

test('urlToNodeId: campaign slug alone maps to index', () => {
    assert.equal(urlToNodeId('/summer-sale', 'summer-sale'), 'index');
});

test('urlToNodeId: handles .html extension', () => {
    assert.equal(urlToNodeId('/sale/checkout.html', 'sale'), 'checkout');
});

test('urlToNodeId: returns null for empty input', () => {
    assert.equal(urlToNodeId('', 'sale'), null);
    assert.equal(urlToNodeId(null, 'sale'), null);
    assert.equal(urlToNodeId(undefined, 'sale'), null);
});

test('urlToNodeId: returns null for external URLs', () => {
    assert.equal(urlToNodeId('https://example.com/thank-you', 'sale'), null);
    assert.equal(urlToNodeId('http://example.com/checkout', 'sale'), null);
    assert.equal(urlToNodeId('HTTPS://EXAMPLE.COM/page', 'sale'), null);
});

// ---------------------------------------------------------------------------
// generateFunnelMap — valid funnel
// ---------------------------------------------------------------------------

test('generateFunnelMap: builds correct nodes and edges for a valid funnel', () => {
    const pages = [
        {
            relFile: 'sale/index.html',
            frontmatter: { title: 'Product', page_type: 'product', next_success_url: '/sale/checkout/' },
            url: '/sale/',
        },
        {
            relFile: 'sale/checkout.html',
            frontmatter: { title: 'Checkout', page_type: 'checkout', next_success_url: '/sale/upsell-1/' },
            url: '/sale/checkout/',
        },
        {
            relFile: 'sale/upsell-1.html',
            frontmatter: {
                title: 'Upsell 1', page_type: 'upsell',
                next_upsell_accept: '/sale/thank-you/',
                next_upsell_decline: '/sale/thank-you/',
            },
            url: '/sale/upsell-1/',
        },
        {
            relFile: 'sale/thank-you.html',
            frontmatter: { title: 'Thank You', page_type: 'receipt' },
            url: '/sale/thank-you/',
        },
    ];

    const { json, errors, warnings } = generateFunnelMap('sale', pages);

    assert.equal(json.campaign, 'sale');
    assert.equal(json.entryPoint, '/sale/');
    assert.equal(json.nodes.length, 4);
    assert.equal(json.edges.length, 4);
    assert.equal(errors.length, 0);
    assert.equal(warnings.length, 0);

    // Verify node IDs
    const nodeIds = json.nodes.map(n => n.id);
    assert.deepEqual(nodeIds, ['index', 'checkout', 'upsell-1', 'thank-you']);

    // Verify edges
    const edgeDescriptions = json.edges.map(e => `${e.source}->${e.target}:${e.kind}`);
    assert.ok(edgeDescriptions.includes('index->checkout:success'));
    assert.ok(edgeDescriptions.includes('checkout->upsell-1:success'));
    assert.ok(edgeDescriptions.includes('upsell-1->thank-you:accept'));
    assert.ok(edgeDescriptions.includes('upsell-1->thank-you:decline'));
});

test('generateFunnelMap: includes sourceFile and type on nodes', () => {
    const pages = [
        {
            relFile: 'sale/index.html',
            frontmatter: { title: 'Home', page_type: 'product', next_success_url: '/sale/receipt/' },
            url: '/sale/',
        },
        {
            relFile: 'sale/receipt.html',
            frontmatter: { title: 'Done', page_type: 'receipt' },
            url: '/sale/receipt/',
        },
    ];

    const { json } = generateFunnelMap('sale', pages);
    const indexNode = json.nodes.find(n => n.id === 'index');
    assert.equal(indexNode.sourceFile, 'sale/index.html');
    assert.equal(indexNode.type, 'product');
    assert.equal(indexNode.title, 'Home');
});

// ---------------------------------------------------------------------------
// generateFunnelMap — permalink edge resolution
// ---------------------------------------------------------------------------

test('generateFunnelMap: custom permalink resolves node ID from URL, not filename', () => {
    const pages = [
        {
            relFile: 'sale/index.html',
            frontmatter: { title: 'Product', page_type: 'product', next_success_url: '/sale/thank-you/' },
            url: '/sale/',
        },
        {
            // File is receipt.html but URL is /sale/thank-you/ via permalink
            relFile: 'sale/receipt.html',
            frontmatter: { title: 'Thank You', page_type: 'receipt' },
            url: '/sale/thank-you/',
        },
    ];

    const { json, errors } = generateFunnelMap('sale', pages);

    // Node ID should be 'thank-you' (from URL), not 'receipt' (from filename)
    const receiptNode = json.nodes.find(n => n.sourceFile === 'sale/receipt.html');
    assert.equal(receiptNode.id, 'thank-you');

    // Edge from index should resolve to 'thank-you', matching the node
    const edge = json.edges.find(e => e.source === 'index' && e.kind === 'success');
    assert.equal(edge.target, 'thank-you');

    // No broken link errors — node and edge IDs match
    assert.equal(errors.length, 0);
});

test('generateFunnelMap: external URLs in routing fields are skipped (no phantom edges)', () => {
    const pages = [
        {
            relFile: 'sale/index.html',
            frontmatter: { title: 'Product', page_type: 'product', next_success_url: 'https://example.com/checkout' },
            url: '/sale/',
        },
    ];

    const { json } = generateFunnelMap('sale', pages);
    assert.equal(json.edges.length, 0);
});

// ---------------------------------------------------------------------------
// validateFunnel — broken link
// ---------------------------------------------------------------------------

test('validateFunnel: detects broken link', () => {
    const graph = {
        campaign: 'sale',
        entryPoint: '/sale/',
        nodes: [
            { id: 'index', path: '/sale/', type: 'product', title: 'Home', sourceFile: 'sale/index.html' },
        ],
        edges: [
            { source: 'index', target: 'nonexistent', kind: 'success' },
        ],
    };

    const { errors } = validateFunnel(graph);
    assert.ok(errors.some(e => e.includes('Broken link') && e.includes('nonexistent')));
});

// ---------------------------------------------------------------------------
// validateFunnel — orphan page
// ---------------------------------------------------------------------------

test('validateFunnel: detects orphan page', () => {
    const graph = {
        campaign: 'sale',
        entryPoint: '/sale/',
        nodes: [
            { id: 'index', path: '/sale/', type: 'product', title: 'Home', sourceFile: 'sale/index.html' },
            { id: 'receipt', path: '/sale/receipt/', type: 'receipt', title: 'Done', sourceFile: 'sale/receipt.html' },
            { id: 'orphan', path: '/sale/orphan/', type: 'product', title: 'Lost', sourceFile: 'sale/orphan.html' },
        ],
        edges: [
            { source: 'index', target: 'receipt', kind: 'success' },
        ],
    };

    const { errors } = validateFunnel(graph);
    assert.ok(errors.some(e => e.includes('Orphan page') && e.includes('orphan')));
    // Index and receipt should NOT be flagged as orphans
    assert.ok(!errors.some(e => e.includes('Orphan page') && e.includes('index')));
    assert.ok(!errors.some(e => e.includes('Orphan page') && e.includes('sale/receipt.html')));
});

// ---------------------------------------------------------------------------
// validateFunnel — missing terminal
// ---------------------------------------------------------------------------

test('validateFunnel: detects missing terminal (no receipt page)', () => {
    const graph = {
        campaign: 'sale',
        entryPoint: '/sale/',
        nodes: [
            { id: 'index', path: '/sale/', type: 'product', title: 'Home', sourceFile: 'sale/index.html' },
            { id: 'checkout', path: '/sale/checkout/', type: 'checkout', title: 'Pay', sourceFile: 'sale/checkout.html' },
        ],
        edges: [
            { source: 'index', target: 'checkout', kind: 'success' },
        ],
    };

    const { errors } = validateFunnel(graph);
    assert.ok(errors.some(e => e.includes('Missing terminal')));
});

test('validateFunnel: detects dead-end non-receipt page', () => {
    const graph = {
        campaign: 'sale',
        entryPoint: '/sale/',
        nodes: [
            { id: 'index', path: '/sale/', type: 'product', title: 'Home', sourceFile: 'sale/index.html' },
            { id: 'checkout', path: '/sale/checkout/', type: 'checkout', title: 'Pay', sourceFile: 'sale/checkout.html' },
            { id: 'receipt', path: '/sale/receipt/', type: 'receipt', title: 'Done', sourceFile: 'sale/receipt.html' },
        ],
        edges: [
            { source: 'index', target: 'checkout', kind: 'success' },
            // checkout has no outgoing edge — dead end
        ],
    };

    const { errors } = validateFunnel(graph);
    assert.ok(errors.some(e => e.includes('Missing terminal') && e.includes('checkout')));
});

// ---------------------------------------------------------------------------
// validateFunnel — asymmetric upsell
// ---------------------------------------------------------------------------

test('validateFunnel: detects upsell with accept but no decline', () => {
    const graph = {
        campaign: 'sale',
        entryPoint: '/sale/',
        nodes: [
            { id: 'index', path: '/sale/', type: 'product', title: 'Home', sourceFile: 'sale/index.html' },
            { id: 'upsell', path: '/sale/upsell/', type: 'upsell', title: 'Upsell', sourceFile: 'sale/upsell.html' },
            { id: 'receipt', path: '/sale/receipt/', type: 'receipt', title: 'Done', sourceFile: 'sale/receipt.html' },
        ],
        edges: [
            { source: 'index', target: 'upsell', kind: 'success' },
            { source: 'upsell', target: 'receipt', kind: 'accept' },
            // missing decline edge
        ],
    };

    const { errors } = validateFunnel(graph);
    assert.ok(errors.some(e => e.includes('Asymmetric upsell') && e.includes('accept') && e.includes('no "decline"')));
});

test('validateFunnel: detects upsell with decline but no accept', () => {
    const graph = {
        campaign: 'sale',
        entryPoint: '/sale/',
        nodes: [
            { id: 'index', path: '/sale/', type: 'product', title: 'Home', sourceFile: 'sale/index.html' },
            { id: 'upsell', path: '/sale/upsell/', type: 'upsell', title: 'Upsell', sourceFile: 'sale/upsell.html' },
            { id: 'receipt', path: '/sale/receipt/', type: 'receipt', title: 'Done', sourceFile: 'sale/receipt.html' },
        ],
        edges: [
            { source: 'index', target: 'upsell', kind: 'success' },
            { source: 'upsell', target: 'receipt', kind: 'decline' },
            // missing accept edge
        ],
    };

    const { errors } = validateFunnel(graph);
    assert.ok(errors.some(e => e.includes('Asymmetric upsell') && e.includes('decline') && e.includes('no "accept"')));
});

// ---------------------------------------------------------------------------
// validateFunnel — missing entry point
// ---------------------------------------------------------------------------

test('validateFunnel: detects missing entry point', () => {
    const graph = {
        campaign: 'sale',
        entryPoint: '/sale/',
        nodes: [
            { id: 'checkout', path: '/sale/checkout/', type: 'checkout', title: 'Pay', sourceFile: 'sale/checkout.html' },
        ],
        edges: [],
    };

    const { errors } = validateFunnel(graph);
    assert.ok(errors.some(e => e.includes('Missing entry point')));
});

// ---------------------------------------------------------------------------
// validateFunnel — clean funnel passes
// ---------------------------------------------------------------------------

test('validateFunnel: valid funnel has zero errors', () => {
    const graph = {
        campaign: 'sale',
        entryPoint: '/sale/',
        nodes: [
            { id: 'index', path: '/sale/', type: 'product', title: 'Home', sourceFile: 'sale/index.html' },
            { id: 'checkout', path: '/sale/checkout/', type: 'checkout', title: 'Pay', sourceFile: 'sale/checkout.html' },
            { id: 'upsell', path: '/sale/upsell/', type: 'upsell', title: 'Upsell', sourceFile: 'sale/upsell.html' },
            { id: 'receipt', path: '/sale/receipt/', type: 'receipt', title: 'Done', sourceFile: 'sale/receipt.html' },
        ],
        edges: [
            { source: 'index', target: 'checkout', kind: 'success' },
            { source: 'checkout', target: 'upsell', kind: 'success' },
            { source: 'upsell', target: 'receipt', kind: 'accept' },
            { source: 'upsell', target: 'receipt', kind: 'decline' },
        ],
    };

    const { errors, warnings } = validateFunnel(graph);
    assert.equal(errors.length, 0);
    assert.equal(warnings.length, 0);
});

// ---------------------------------------------------------------------------
// writeFunnelJson — filesystem
// ---------------------------------------------------------------------------

test('writeFunnelJson: writes JSON to correct path', async () => {
    await withTmpDir(async (dir) => {
        const json = { campaign: 'test', nodes: [], edges: [] };
        const outFile = writeFunnelJson(json, dir, 'test');
        assert.equal(outFile, path.join(dir, 'test', 'funnel.json'));
        const content = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        assert.equal(content.campaign, 'test');
    });
});

// ---------------------------------------------------------------------------
// build() integration — funnel.json output
// ---------------------------------------------------------------------------

test('build: outputs funnel.json for a valid campaign', async () => {
    await withTmpDir(async (dir) => {
        const srcPath = path.join(dir, 'src');
        const outputPath = path.join(dir, '_site');

        writeFixture(srcPath, 'sale/index.html',
            '---\ntitle: Product\npage_type: product\nnext_success_url: /sale/checkout/\n---\n<h1>Buy</h1>');
        writeFixture(srcPath, 'sale/checkout.html',
            '---\ntitle: Checkout\npage_type: checkout\nnext_success_url: /sale/receipt/\n---\n<p>Pay</p>');
        writeFixture(srcPath, 'sale/receipt.html',
            '---\ntitle: Thank You\npage_type: receipt\n---\n<p>Done</p>');

        const { built, errors } = await build({
            srcPath, outputPath,
            campaigns: { 'sale': { name: 'Summer Sale' } },
        });

        assert.equal(built, 3);
        assert.equal(errors, 0);

        // Check funnel.json exists and is valid
        const funnelPath = path.join(outputPath, 'sale', 'funnel.json');
        assert.ok(fs.existsSync(funnelPath), 'funnel.json should exist');

        const funnel = JSON.parse(fs.readFileSync(funnelPath, 'utf8'));
        assert.equal(funnel.campaign, 'sale');
        assert.equal(funnel.nodes.length, 3);
        assert.equal(funnel.edges.length, 2);
        assert.equal(funnel.validation.errors.length, 0);
    });
});

test('build: funnel.json contains validation errors for broken funnel', async () => {
    await withTmpDir(async (dir) => {
        const srcPath = path.join(dir, 'src');
        const outputPath = path.join(dir, '_site');

        // Broken link: next_success_url points to nonexistent page
        writeFixture(srcPath, 'sale/index.html',
            '---\ntitle: Product\npage_type: product\nnext_success_url: /sale/nonexistent/\n---\n<h1>Buy</h1>');

        const result = await build({
            srcPath, outputPath,
            campaigns: { 'sale': { name: 'Summer Sale' } },
        });

        // Build should report funnel errors
        assert.ok(result.funnelErrors > 0, 'should report funnel errors');

        // funnel.json should still be written with errors recorded
        const funnelPath = path.join(outputPath, 'sale', 'funnel.json');
        assert.ok(fs.existsSync(funnelPath), 'funnel.json should exist even with errors');

        const funnel = JSON.parse(fs.readFileSync(funnelPath, 'utf8'));
        assert.ok(funnel.validation.errors.length > 0, 'should have validation errors');
        assert.ok(funnel.validation.errors.some(e => e.includes('Broken link')));
    });
});

test('build: lenient mode downgrades funnel errors to warnings', async () => {
    await withTmpDir(async (dir) => {
        const srcPath = path.join(dir, 'src');
        const outputPath = path.join(dir, '_site');

        writeFixture(srcPath, 'sale/index.html',
            '---\ntitle: Product\npage_type: product\nnext_success_url: /sale/nonexistent/\n---\n<h1>Buy</h1>');

        const result = await build({
            srcPath, outputPath,
            campaigns: { 'sale': { name: 'Summer Sale' } },
            lenient: true,
        });

        // In lenient mode, funnel errors should be zero (downgraded to warnings)
        assert.equal(result.funnelErrors, 0);

        const funnelPath = path.join(outputPath, 'sale', 'funnel.json');
        const funnel = JSON.parse(fs.readFileSync(funnelPath, 'utf8'));
        // Errors moved to warnings in lenient mode
        assert.ok(funnel.validation.warnings.length > 0);
    });
});
