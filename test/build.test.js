const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { resolveOutput } = require('../lib/engine/build');
const { createEngine, renderPage } = require('../lib/engine/render');
const { build } = require('../lib/engine/build');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTmpDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-campaign-test-'));
    return fn(dir).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

function writeFixture(base, relPath, content) {
    const full = path.join(base, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
}

const CAMPAIGN = { name: 'Test Campaign', slug: 'test-campaign' };
const BASE_LAYOUT = '<html><body>{{ content }}</body></html>';

// ---------------------------------------------------------------------------
// resolveOutput — pure unit tests
// ---------------------------------------------------------------------------

test('resolveOutput: index.html → campaign root', () => {
    const { url, outputFile } = resolveOutput('my-campaign/index.html', {}, '/out');
    assert.equal(url, '/my-campaign/');
    assert.equal(outputFile, path.join('/out', 'my-campaign', 'index.html'));
});

test('resolveOutput: named page → pretty URL', () => {
    const { url, outputFile } = resolveOutput('my-campaign/presell.html', {}, '/out');
    assert.equal(url, '/my-campaign/presell/');
    assert.equal(outputFile, path.join('/out', 'my-campaign', 'presell', 'index.html'));
});

test('resolveOutput: permalink frontmatter overrides path', () => {
    const { url, outputFile } = resolveOutput('my-campaign/anything.html', { permalink: '/custom/path/' }, '/out');
    assert.equal(url, '/custom/path/');
    assert.equal(outputFile, path.join('/out', 'custom', 'path', 'index.html'));
});

// ---------------------------------------------------------------------------
// renderPage — unit tests (no filesystem)
// ---------------------------------------------------------------------------

test('renderPage: renders campaign variable in body', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '<p>{{ campaign.name }}</p>',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: null,
    });
    assert.equal(html, '<p>Test Campaign</p>');
});

test('renderPage: wraps body in layout via content variable', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '<p>hello</p>',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: BASE_LAYOUT,
    });
    assert.equal(html, '<html><body><p>hello</p></body></html>');
});

test('renderPage: frontmatter is available in body and layout', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '<title>{{ title }}</title>',
        frontmatter: { title: 'My Page' },
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: '<html>{{ content }}</html>',
    });
    assert.equal(html, '<html><title>My Page</title></html>');
});

test('renderPage: campaign_asset filter prefixes slug', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '{{ "style.css" | campaign_asset }}',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: null,
    });
    assert.equal(html, '/test-campaign/style.css');
});

test('renderPage: campaign_asset passes through absolute URLs', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '{{ "https://cdn.example.com/img.png" | campaign_asset }}',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: null,
    });
    assert.equal(html, 'https://cdn.example.com/img.png');
});

test('renderPage: campaign_link resolves named page to pretty URL', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '{{ "checkout.html" | campaign_link }}',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: null,
    });
    assert.equal(html, '/test-campaign/checkout/');
});

test('renderPage: campaign_link resolves index.html to campaign root', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '{{ "index.html" | campaign_link }}',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: null,
    });
    assert.equal(html, '/test-campaign/');
});

test('renderPage: campaign_link passes through hash anchors', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '{{ "#section" | campaign_link }}',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: null,
    });
    assert.equal(html, '#section');
});

test('renderPage: campaign_link passes through absolute paths', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '{{ "/some/path/" | campaign_link }}',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: null,
    });
    assert.equal(html, '/some/path/');
});

test('renderPage: campaign_link passes through absolute URLs', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '{{ "https://external.com/page" | campaign_link }}',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: null,
    });
    assert.equal(html, 'https://external.com/page');
});

test('renderPage: campaign_asset returns empty string for empty filename', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '{{ "" | campaign_asset }}',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: null,
    });
    assert.equal(html, '');
});

test('renderPage: campaign_link returns empty string for empty filename', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '{{ "" | campaign_link }}',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: null,
    });
    assert.equal(html, '');
});

test('renderPage: campaign_asset returns filename when no campaign in context', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '{{ "style.css" | campaign_asset }}',
        frontmatter: {},
        campaign: null,
        pageData: { url: '/' },
        layoutSrc: null,
    });
    assert.equal(html, 'style.css');
});

test('renderPage: campaign_link returns filename when no campaign in context', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '{{ "page.html" | campaign_link }}',
        frontmatter: {},
        campaign: null,
        pageData: { url: '/' },
        layoutSrc: null,
    });
    assert.equal(html, 'page.html');
});

// ---------------------------------------------------------------------------
// environment variable — unit tests
// ---------------------------------------------------------------------------

test('renderPage: environment variable is available in body', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '<p>{{ environment }}</p>',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: null,
        environment: 'production',
    });
    assert.equal(html, '<p>production</p>');
});

test('renderPage: environment variable is available in layout', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '<p>body</p>',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: '<html>{{ environment }}:{{ content }}</html>',
        environment: 'development',
    });
    assert.equal(html, '<html>development:<p>body</p></html>');
});

test('renderPage: environment supports conditional logic', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '{% unless environment == "development" %}analytics{% endunless %}',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: null,
        environment: 'development',
    });
    assert.equal(html, '');
});

test('renderPage: environment renders analytics in production', async () => {
    const engine = createEngine('/unused');
    const html = await renderPage(engine, {
        body: '{% unless environment == "development" %}analytics{% endunless %}',
        frontmatter: {},
        campaign: CAMPAIGN,
        pageData: { url: '/test-campaign/' },
        layoutSrc: null,
        environment: 'production',
    });
    assert.equal(html, 'analytics');
});

// ---------------------------------------------------------------------------
// campaign_include — tag tests (real filesystem, isolated tmp dir)
// ---------------------------------------------------------------------------

test('campaign_include: renders a basic partial', async () => {
    await withTmpDir(async (dir) => {
        writeFixture(dir, 'test-campaign/_includes/greeting.html', '<p>Hello</p>');
        const engine = createEngine(dir);
        const html = await renderPage(engine, {
            body: "{% campaign_include 'greeting.html' %}",
            frontmatter: {},
            campaign: CAMPAIGN,
            pageData: { url: '/test-campaign/' },
            layoutSrc: null,
        });
        assert.equal(html.trim(), '<p>Hello</p>');
    });
});

test('campaign_include: args accessible as direct variables', async () => {
    await withTmpDir(async (dir) => {
        writeFixture(dir, 'test-campaign/_includes/greet.html', '<p>{{ name }}</p>');
        const engine = createEngine(dir);
        const html = await renderPage(engine, {
            body: "{% campaign_include 'greet.html' name=\"World\" %}",
            frontmatter: {},
            campaign: CAMPAIGN,
            pageData: { url: '/test-campaign/' },
            layoutSrc: null,
        });
        assert.equal(html.trim(), '<p>World</p>');
    });
});

test('campaign_include: args accessible via include.* (Eleventy-style)', async () => {
    await withTmpDir(async (dir) => {
        writeFixture(dir, 'test-campaign/_includes/greet.html', '<p>{{ include.name }}</p>');
        const engine = createEngine(dir);
        const html = await renderPage(engine, {
            body: "{% campaign_include 'greet.html' name=\"World\" %}",
            frontmatter: {},
            campaign: CAMPAIGN,
            pageData: { url: '/test-campaign/' },
            layoutSrc: null,
        });
        assert.equal(html.trim(), '<p>World</p>');
    });
});

test('campaign_include: array variable accessible via include.*', async () => {
    await withTmpDir(async (dir) => {
        writeFixture(dir, 'test-campaign/_includes/list.html',
            '{% for item in include.items %}<li>{{ item }}</li>{% endfor %}');
        const engine = createEngine(dir);
        const html = await renderPage(engine, {
            body: "{% campaign_include 'list.html' items=colors %}",
            frontmatter: { colors: ['red', 'blue'] },
            campaign: CAMPAIGN,
            pageData: { url: '/test-campaign/' },
            layoutSrc: null,
        });
        assert.equal(html.trim(), '<li>red</li><li>blue</li>');
    });
});

test('campaign_include: campaign context available inside include', async () => {
    await withTmpDir(async (dir) => {
        writeFixture(dir, 'test-campaign/_includes/asset.html', '{{ "img.png" | campaign_asset }}');
        const engine = createEngine(dir);
        const html = await renderPage(engine, {
            body: "{% campaign_include 'asset.html' %}",
            frontmatter: {},
            campaign: CAMPAIGN,
            pageData: { url: '/test-campaign/' },
            layoutSrc: null,
        });
        assert.equal(html.trim(), '/test-campaign/img.png');
    });
});

test('campaign_include: missing file logs error and renders empty', async () => {
    await withTmpDir(async (dir) => {
        const engine = createEngine(dir);
        const html = await renderPage(engine, {
            body: "{% campaign_include 'nonexistent.html' %}",
            frontmatter: {},
            campaign: CAMPAIGN,
            pageData: { url: '/test-campaign/' },
            layoutSrc: null,
        });
        assert.equal(html.trim(), '');
    });
});

test('campaign_include: boolean true arg is passed as true', async () => {
    await withTmpDir(async (dir) => {
        writeFixture(dir, 'test-campaign/_includes/flag.html',
            '{% if include.visible %}yes{% else %}no{% endif %}');
        const engine = createEngine(dir);
        const html = await renderPage(engine, {
            body: "{% campaign_include 'flag.html' visible=true %}",
            frontmatter: {},
            campaign: CAMPAIGN,
            pageData: { url: '/test-campaign/' },
            layoutSrc: null,
        });
        assert.equal(html.trim(), 'yes');
    });
});

test('campaign_include: boolean false arg is passed as false', async () => {
    await withTmpDir(async (dir) => {
        writeFixture(dir, 'test-campaign/_includes/flag.html',
            '{% if include.visible %}yes{% else %}no{% endif %}');
        const engine = createEngine(dir);
        const html = await renderPage(engine, {
            body: "{% campaign_include 'flag.html' visible=false %}",
            frontmatter: {},
            campaign: CAMPAIGN,
            pageData: { url: '/test-campaign/' },
            layoutSrc: null,
        });
        assert.equal(html.trim(), 'no');
    });
});

// ---------------------------------------------------------------------------
// build() — integration tests
// ---------------------------------------------------------------------------

test('build: builds an index page with layout', async () => {
    await withTmpDir(async (dir) => {
        const srcPath = path.join(dir, 'src');
        const outputPath = path.join(dir, '_site');

        writeFixture(srcPath, 'test-campaign/_layouts/base.html', BASE_LAYOUT);
        writeFixture(srcPath, 'test-campaign/index.html',
            '---\ntitle: Home\n---\n<h1>{{ campaign.name }}</h1>');

        const { built, errors } = await build({
            srcPath, outputPath,
            campaigns: { 'test-campaign': { name: 'Test Campaign' } },
        });

        assert.equal(built, 1);
        assert.equal(errors, 0);

        const html = fs.readFileSync(path.join(outputPath, 'test-campaign', 'index.html'), 'utf8');
        assert.ok(html.includes('<h1>Test Campaign</h1>'));
        assert.ok(html.includes('<html><body>'));
    });
});

test('build: named page outputs to pretty URL path', async () => {
    await withTmpDir(async (dir) => {
        const srcPath = path.join(dir, 'src');
        const outputPath = path.join(dir, '_site');

        writeFixture(srcPath, 'test-campaign/_layouts/base.html', BASE_LAYOUT);
        writeFixture(srcPath, 'test-campaign/checkout.html',
            '---\n---\n<p>checkout</p>');

        const { built } = await build({ srcPath, outputPath, campaigns: { 'test-campaign': { name: 'Test Campaign' } } });

        assert.equal(built, 1);
        assert.ok(fs.existsSync(path.join(outputPath, 'test-campaign', 'checkout', 'index.html')));
    });
});

test('build: skips page with no matching campaign', async () => {
    await withTmpDir(async (dir) => {
        const srcPath = path.join(dir, 'src');
        const outputPath = path.join(dir, '_site');

        writeFixture(srcPath, 'unknown-campaign/index.html', '---\n---\n<p>hi</p>');

        const { built, errors } = await build({ srcPath, outputPath, campaigns: { 'test-campaign': { name: 'Test Campaign' } } });

        assert.equal(built, 0);
        assert.equal(errors, 0);
    });
});

test('build: copies assets directory to output', async () => {
    await withTmpDir(async (dir) => {
        const srcPath = path.join(dir, 'src');
        const outputPath = path.join(dir, '_site');

        writeFixture(srcPath, 'test-campaign/_layouts/base.html', BASE_LAYOUT);
        writeFixture(srcPath, 'test-campaign/index.html', '---\n---\n<p>hi</p>');
        writeFixture(srcPath, 'test-campaign/assets/style.css', 'body { margin: 0; }');

        await build({ srcPath, outputPath, campaigns: { 'test-campaign': { name: 'Test Campaign' } } });

        assert.ok(fs.existsSync(path.join(outputPath, 'test-campaign', 'style.css')));
    });
});

test('build: counts render errors for invalid templates', async () => {
    await withTmpDir(async (dir) => {
        const srcPath = path.join(dir, 'src');
        const outputPath = path.join(dir, '_site');

        writeFixture(srcPath, 'test-campaign/index.html',
            '---\n---\n{% unknowntag %}');

        const { built, errors } = await build({
            srcPath, outputPath,
            campaigns: { 'test-campaign': { name: 'Test Campaign' } },
        });

        assert.equal(built, 0);
        assert.equal(errors, 1);
    });
});

test('build: uses explicit files list instead of discovery', async () => {
    await withTmpDir(async (dir) => {
        const srcPath = path.join(dir, 'src');
        const outputPath = path.join(dir, '_site');

        writeFixture(srcPath, 'test-campaign/_layouts/base.html', BASE_LAYOUT);
        writeFixture(srcPath, 'test-campaign/index.html', '---\n---\n<p>index</p>');
        writeFixture(srcPath, 'test-campaign/other.html', '---\n---\n<p>other</p>');

        const { built } = await build({
            srcPath, outputPath,
            campaigns: { 'test-campaign': { name: 'Test Campaign' } },
            files: ['test-campaign/index.html'],
        });

        assert.equal(built, 1);
        assert.ok(fs.existsSync(path.join(outputPath, 'test-campaign', 'index.html')));
        assert.ok(!fs.existsSync(path.join(outputPath, 'test-campaign', 'other', 'index.html')));
    });
});

test('build: defaults environment to production', async () => {
    await withTmpDir(async (dir) => {
        const srcPath = path.join(dir, 'src');
        const outputPath = path.join(dir, '_site');

        writeFixture(srcPath, 'test-campaign/index.html', '---\n---\n{{ environment }}');

        await build({
            srcPath, outputPath,
            campaigns: { 'test-campaign': { name: 'Test Campaign' } },
        });

        const html = fs.readFileSync(path.join(outputPath, 'test-campaign', 'index.html'), 'utf8');
        assert.equal(html, 'production');
    });
});

test('build: mode option sets environment in templates', async () => {
    await withTmpDir(async (dir) => {
        const srcPath = path.join(dir, 'src');
        const outputPath = path.join(dir, '_site');

        writeFixture(srcPath, 'test-campaign/index.html', '---\n---\n{{ environment }}');

        await build({
            srcPath, outputPath,
            campaigns: { 'test-campaign': { name: 'Test Campaign' } },
            mode: 'development',
        });

        const html = fs.readFileSync(path.join(outputPath, 'test-campaign', 'index.html'), 'utf8');
        assert.equal(html, 'development');
    });
});

test('build: CPK_ENV overrides default environment', async () => {
    await withTmpDir(async (dir) => {
        const srcPath = path.join(dir, 'src');
        const outputPath = path.join(dir, '_site');

        writeFixture(srcPath, 'test-campaign/index.html', '---\n---\n{{ environment }}');

        const original = process.env.CPK_ENV;
        process.env.CPK_ENV = 'staging';
        try {
            await build({
                srcPath, outputPath,
                campaigns: { 'test-campaign': { name: 'Test Campaign' } },
            });

            const html = fs.readFileSync(path.join(outputPath, 'test-campaign', 'index.html'), 'utf8');
            assert.equal(html, 'staging');
        } finally {
            if (original === undefined) delete process.env.CPK_ENV;
            else process.env.CPK_ENV = original;
        }
    });
});

test('build: renders page without layout when none exists', async () => {
    await withTmpDir(async (dir) => {
        const srcPath = path.join(dir, 'src');
        const outputPath = path.join(dir, '_site');

        writeFixture(srcPath, 'test-campaign/index.html', '---\n---\n<p>no layout</p>');

        const { built, errors } = await build({
            srcPath, outputPath,
            campaigns: { 'test-campaign': { name: 'Test Campaign' } },
        });

        assert.equal(built, 1);
        assert.equal(errors, 0);
        const html = fs.readFileSync(path.join(outputPath, 'test-campaign', 'index.html'), 'utf8');
        assert.equal(html, '<p>no layout</p>');
    });
});
