const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { execFileSync, spawnSync } = require('child_process');
const { parse } = require('parse5');
const { build } = require('../lib/engine/build');
const { makeStaticPreview, PREVIEW_POLICY } = require('../lib/engine/preview');
const { configureCampaign } = require('../lib/actions/configure');

const fixture = path.join(__dirname, 'fixtures', 'preview-template');
const init = path.join(__dirname, '..', 'lib', 'actions', 'init.js');
function project(t, flags = []) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-preview-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, '_data'));
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.writeFileSync(path.join(root, '_data', 'template-sources.json'), JSON.stringify({ sources: { fixture: { type: 'local', path: fixture } } }));
    const result = JSON.parse(execFileSync(process.execPath, [init, '--source', 'fixture', '--template', 'example', '--slug', 'preview', '--json', ...flags], { cwd: root, encoding: 'utf8' }));
    return { root, result, srcPath: path.join(root, 'src'), outputPath: path.join(root, '_site'), campaignsPath: path.join(root, '_data', 'campaigns.json') };
}
function readCampaigns(p) { return JSON.parse(fs.readFileSync(p.campaignsPath)); }
function readConfig(p) {
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(p.srcPath, 'preview', 'assets', 'config.js'), 'utf8'), { window });
    return window.nextConfig;
}
async function builtHtml(p) {
    const summary = await build({ ...p, campaigns: readCampaigns(p), mode: 'production' });
    assert.equal(summary.errors, 0);
    return { summary, html: fs.readFileSync(path.join(p.outputPath, 'preview', 'index.html'), 'utf8') };
}

test('no-key init produces an unbound static preview in production builds', async t => {
    const p = project(t);
    assert.equal(p.result.campaign.runtime_mode, 'unconfigured-preview');
    assert.equal(p.result.writes.api_key_applied, false);
    assert.ok(p.result.warnings.some(w => w.includes('Commerce unconfigured')));
    assert.equal(readCampaigns(p).preview.preview_mode, true);
    const config = readConfig(p);
    assert.equal(config.apiKey, '');
    assert.equal(config.analytics.enabled, false);
    assert.equal(config.analytics.mode, 'disabled');
    assert.doesNotMatch(fs.readFileSync(path.join(p.srcPath, 'preview', 'assets', 'config.js'), 'utf8'), /UPSTREAM_DEMO_KEY/);
    const { html, summary } = await builtHtml(p);
    const head = parse(html).childNodes.find(n => n.tagName === 'html').childNodes.find(n => n.tagName === 'head');
    assert.equal(head.childNodes[0].tagName, 'meta');
    assert.equal(head.childNodes[0].attrs.find(a => a.name === 'content').value, PREVIEW_POLICY);
    assert.match(html, /This is not a functional checkout/);
    assert.doesNotMatch(html, /<script|<iframe|preconnect|dns-prefetch|prefetch|onload=|ping=/);
    assert.match(html, /href="\/preview\/thank-you\/"/);
    assert.match(html, /<button disabled/);
    assert.ok(summary.pages.every(page => page.warnings.some(w => w.code === 'UNCONFIGURED_PREVIEW')));
});

test('explicit key and deliberate demo preserve the connected runtime', async t => {
    for (const [flags, mode, key] of [[['--api-key', 'EXPLICIT_TEST_KEY'], 'configured', 'EXPLICIT_TEST_KEY'], [['--demo'], 'demo', 'UPSTREAM_DEMO_KEY']]) {
        const p = project(t, flags);
        assert.equal(p.result.campaign.runtime_mode, mode);
        assert.equal(p.result.writes.api_key_applied, mode === 'configured');
        assert.equal(readCampaigns(p).preview.preview_mode, undefined);
        assert.equal(readConfig(p).apiKey, key);
        assert.equal(readConfig(p).analytics.enabled, true);
        const { html } = await builtHtml(p);
        assert.match(html, /<script src="https:\/\/commerce.invalid\/sdk.js"/);
        assert.doesNotMatch(html, /Content-Security-Policy|data-cpk-preview/);
    }
});

test('configuration removes the preview gate only after a valid key is written', async t => {
    const p = project(t);
    configureCampaign(readCampaigns(p), 'preview', 'BOUND_TEST_KEY', p);
    assert.equal(readCampaigns(p).preview.preview_mode, undefined);
    assert.equal(readConfig(p).apiKey, 'BOUND_TEST_KEY');
    assert.equal(readConfig(p).analytics.enabled, true);
    assert.equal(readConfig(p).paymentConfig.expressCheckout.enabled, true);
    const { html } = await builtHtml(p);
    assert.doesNotMatch(html, /Content-Security-Policy|data-cpk-preview/);

    const failed = project(t);
    fs.writeFileSync(path.join(failed.srcPath, 'preview', 'assets', 'config.js'), 'window.nextConfig = {};');
    assert.throws(() => configureCampaign(readCampaigns(failed), 'preview', 'TEST_KEY', failed), /no apiKey field/);
    assert.equal(readCampaigns(failed).preview.preview_mode, true);
});

test('existing campaigns without the preview marker render unchanged', async t => {
    const p = project(t, ['--demo']);
    const { html } = await builtHtml(p);
    assert.match(html, /window.previewScriptRan/);
    assert.match(html, /https:\/\/vendor.invalid\/pixel.gif/);
    assert.doesNotMatch(html, /data-cpk-preview/);
});

test('preview navigation reaches only rendered pages in its own campaign', async t => {
    const p = project(t);
    const source = path.join(p.srcPath, 'preview');
    fs.writeFileSync(path.join(source, 'assets', 'diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>window.assetScriptRan = true</script></svg>');
    const links = {
        fragment: '#details',
        relative: 'thank-you/',
        pretty: '/preview/thank-you/',
        bare: '/preview/thank-you',
        html: '/preview/thank-you.html?choice=1#details',
        index: '/preview/thank-you/index.html',
        permalink: '/custom/preview-finish/',
        'permalink-html': '/custom/preview-finish.html',
        svg: '/preview/diagram.svg',
        'svg-relative': 'diagram.svg',
        sibling: '/connected/',
        'other-preview': '/another-preview/',
        missing: '/preview/missing/',
        failed: '/preview/failed/',
        collision: '/preview/collision/',
        external: 'https://commerce.invalid/checkout',
    };
    const markup = Object.entries(links).map(([id, href]) => `<a id="${id}" href="${href}">${id}</a>`).join('\n');
    fs.writeFileSync(path.join(source, 'index.html'), `---\ntitle: Preview\npage_type: product\n---\n${markup}
        <map><area id="area" href="/preview/diagram.svg"></map>
        <svg><a id="svg-link" xlink:href="/preview/diagram.svg">asset</a>
          <a href="#details"><set attributeName="href" to="/preview/diagram.svg" /></a></svg>`);
    fs.writeFileSync(path.join(source, 'finish.html'), '---\ntitle: Finish\npage_type: receipt\npermalink: /custom/preview-finish/\n---\n<p>Finish</p>');
    fs.writeFileSync(path.join(source, 'failed.html'), '---\ntitle: Broken\npage_type: product\n---\n{% unknown_tag %}');
    fs.writeFileSync(path.join(source, 'collision.html'), '---\ntitle: Collision\npage_type: product\n---\n<p>Preview</p>');
    fs.mkdirSync(path.join(p.srcPath, 'connected'));
    fs.writeFileSync(path.join(p.srcPath, 'connected', 'index.html'), '<script>window.connectedScriptRan = true</script>');
    fs.writeFileSync(path.join(p.srcPath, 'connected', 'collision.html'), '---\npermalink: /preview/collision/\n---\n<script>window.connectedScriptRan = true</script>');
    fs.mkdirSync(path.join(p.srcPath, 'another-preview'));
    fs.writeFileSync(path.join(p.srcPath, 'another-preview', 'index.html'), '<p>Another preview</p>');
    const campaigns = { ...readCampaigns(p), connected: { name: 'Connected' }, 'another-preview': { name: 'Other', preview_mode: true } };
    const summary = await build({ ...p, campaigns, mode: 'production', files: [
        'preview/index.html', 'preview/thank-you.html', 'preview/finish.html',
        'preview/failed.html', 'preview/collision.html',
        'connected/index.html', 'connected/collision.html', 'another-preview/index.html',
    ] });
    assert.equal(summary.errors, 1, 'failed render is excluded from navigable destinations');
    const html = fs.readFileSync(path.join(p.outputPath, 'preview', 'index.html'), 'utf8');
    const nodes = new Map();
    function visit(node) {
        const id = node.attrs?.find(a => a.name === 'id')?.value;
        if (id) nodes.set(id, node);
        for (const child of node.childNodes || []) visit(child);
    }
    visit(parse(html));
    const href = id => nodes.get(id).attrs.find(a => a.name === 'href')?.value;
    assert.equal(href('fragment'), '#details');
    for (const id of ['relative', 'pretty', 'bare', 'index']) assert.equal(href(id), '/preview/thank-you/');
    assert.equal(href('html'), '/preview/thank-you/?choice=1#details');
    for (const id of ['permalink', 'permalink-html']) assert.equal(href(id), '/custom/preview-finish/');
    for (const id of ['svg', 'svg-relative', 'sibling', 'other-preview', 'missing', 'failed', 'collision', 'external', 'area', 'svg-link']) {
        assert.equal(href(id), undefined, `${id} must not leave the current preview campaign`);
    }
    assert.doesNotMatch(html, /<set\b/);
    // Assets and configured siblings are not rewritten; blocking their links is
    // what keeps top-level navigation under the preview document's policy.
    assert.match(fs.readFileSync(path.join(p.outputPath, 'preview', 'diagram.svg'), 'utf8'), /assetScriptRan/);
    assert.match(fs.readFileSync(path.join(p.outputPath, 'connected', 'index.html'), 'utf8'), /connectedScriptRan/);
});

test('partial preview rebuilds retain navigation between newly rendered campaign pages', async t => {
    const p = project(t);
    const campaigns = readCampaigns(p);
    const summary = await build({ ...p, campaigns, files: ['preview/index.html'] });
    assert.equal(summary.errors, 0);
    assert.equal(summary.built, 2);
    const html = fs.readFileSync(path.join(p.outputPath, 'preview', 'index.html'), 'utf8');
    assert.match(html, /href="\/preview\/thank-you\/"/);
    assert.match(fs.readFileSync(path.join(p.outputPath, 'preview', 'thank-you', 'index.html'), 'utf8'), /data-cpk-preview/);
});

test('malformed preview markers fail closed while explicit boolean false retains normal output', async t => {
    const p = project(t, ['--demo']);
    for (const marker of ['true', 1, 'false', 0, null, '', {}, []]) {
        const campaigns = readCampaigns(p);
        campaigns.preview.preview_mode = marker;
        fs.writeFileSync(p.campaignsPath, JSON.stringify(campaigns));
        const { html, summary } = await builtHtml(p);
        assert.match(html, /data-cpk-preview/, `marker ${JSON.stringify(marker)} must stay static`);
        assert.doesNotMatch(html, /<script|<iframe|onload=/);
        assert.ok(summary.pages.every(page => page.warnings.some(w => w.code === 'INVALID_PREVIEW_MODE')));
    }
    const campaigns = readCampaigns(p);
    campaigns.preview.preview_mode = false;
    fs.writeFileSync(p.campaignsPath, JSON.stringify(campaigns));
    const { html, summary } = await builtHtml(p);
    assert.match(html, /window.previewScriptRan/);
    assert.doesNotMatch(html, /data-cpk-preview/);
    assert.ok(summary.pages.every(page => !page.warnings.some(w => w.code === 'INVALID_PREVIEW_MODE')));
});

test('preview disables controls without duplicating existing disabled attributes', () => {
    const html = makeStaticPreview('<input disabled="disabled"><button disabled aria-disabled="true">Disabled</button><select disabled><option>One</option></select><textarea aria-disabled="true"></textarea>');
    const controls = html.match(/<(?:input|button|select|textarea)\b[^>]*>/g);
    assert.equal(controls.length, 4);
    for (const control of controls) {
        assert.equal((control.match(/\sdisabled(?:[=\s>])/g) || []).length, 1, control);
    }
});

test('preview preserves authored CSP policies alongside its first restrictive policy', () => {
    const restrictive = "img-src 'none'; style-src 'none'";
    const permissive = "script-src 'unsafe-inline'; connect-src *";
    const html = makeStaticPreview(`<head><meta http-equiv="Content-Security-Policy" content="${restrictive}"><meta http-equiv="content-security-policy" content="${permissive}"></head><body><img src="local.png"></body>`);
    const head = parse(html).childNodes.find(n => n.tagName === 'html').childNodes.find(n => n.tagName === 'head');
    const policies = head.childNodes.filter(node => node.tagName === 'meta' && node.attrs.some(a => a.name === 'http-equiv' && a.value.toLowerCase() === 'content-security-policy'));
    assert.equal(head.childNodes[0], policies[0]);
    assert.deepEqual(policies.map(node => node.attrs.find(a => a.name === 'content').value), [PREVIEW_POLICY, restrictive, permissive]);
    assert.doesNotMatch(PREVIEW_POLICY, /frame-ancestors|sandbox/);
});

test('preview removes CSP telemetry while preserving authored enforcement directives', () => {
    const html = makeStaticPreview(`<head>
        <meta http-equiv="Content-Security-Policy" content="report-uri https://reports.invalid/csp; img-src 'none'; REPORT-TO telemetry; style-src 'none'; report-uri /report">
        <meta http-equiv="Content-Security-Policy-Report-Only" content="default-src 'none'; report-to telemetry">
        <meta http-equiv="content-security-policy-report-only" content="report-uri https://reports.invalid/only">
    </head>`);
    const head = parse(html).childNodes.find(n => n.tagName === 'html').childNodes.find(n => n.tagName === 'head');
    const policies = head.childNodes.filter(node => node.tagName === 'meta' && node.attrs.some(a => a.name === 'http-equiv' && a.value.toLowerCase() === 'content-security-policy'));
    assert.deepEqual(policies.map(node => node.attrs.find(a => a.name === 'content').value), [PREVIEW_POLICY, "img-src 'none'; style-src 'none'"]);
    assert.doesNotMatch(html, /report-uri|report-to|report-only|reports\.invalid|telemetry/i);
});

test('preview handles fragments, refresh, event handlers and nested templates', () => {
    const html = makeStaticPreview('<meta http-equiv="refresh" content="0; url=https://vendor.invalid"><template><script>fetch("https://vendor.invalid")</script></template><img src="local.png" onerror="fetch(1)"><a href="javascript:fetch(1)">Link</a>');
    assert.match(html, /<head><meta http-equiv="Content-Security-Policy"/);
    assert.doesNotMatch(html, /<script|onerror=|javascript:|http-equiv="refresh"/);
});

test('demo and explicit key are mutually exclusive before writes', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-preview-invalid-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, [init, '--json', '--demo', '--api-key', 'TEST_KEY'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 6);
    assert.deepEqual(fs.readdirSync(root), []);
});
