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
