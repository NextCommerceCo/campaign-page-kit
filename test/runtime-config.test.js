const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const config = require('../lib/config');
const { prepareRuntime } = require('../lib/campaign-runtime');
const { configureCampaign } = require('../lib/actions/configure');
const { build } = require('../lib/engine/build');

const START = '// campaign-page-kit: unconfigured preview';
const END = '// campaign-page-kit: end preview';
const SOURCE = "window.nextConfig = { apiKey: 'SYNTHETIC_DEMO_KEY', analytics: { enabled: true } };\n";

function campaign(t, source = SOURCE) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-runtime-config-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const srcPath = path.join(root, 'src');
    const campaignDir = path.join(srcPath, 'preview');
    const configPath = path.join(campaignDir, 'assets', 'config.js');
    const campaignsPath = path.join(root, '_data', 'campaigns.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.mkdirSync(path.dirname(campaignsPath), { recursive: true });
    const campaigns = { preview: { name: 'Synthetic preview', preview_mode: true } };
    fs.writeFileSync(configPath, source);
    fs.writeFileSync(campaignsPath, JSON.stringify(campaigns));
    return { root, srcPath, campaignDir, configPath, campaignsPath, campaigns };
}

test('runtime preparation refuses an unrecognized key binding instead of retaining it in a preview', t => {
    for (const source of [
        'window.nextConfig = { apiKey: process.env.KEY };',
        "window.nextConfig['apiKey'] = 'SYNTHETIC_DEMO_KEY';",
        'window.nextConfig = {};',
    ]) {
        const p = campaign(t, source);
        assert.throws(() => prepareRuntime(p.campaignDir), error => error.code === 'INVALID_INPUT' && /no apiKey field/.test(error.message));
        assert.equal(fs.readFileSync(p.configPath, 'utf8'), source);
    }
});

test('a template without config gets an empty preview config, while direct key binding still requires one', t => {
    const missing = campaign(t);
    fs.unlinkSync(missing.configPath);
    assert.throws(() => prepareRuntime(missing.campaignDir, { apiKey: 'SYNTHETIC_BOUND_KEY' }), error => error.code === 'INVALID_INPUT' && /assets\/config.js is missing/.test(error.message));
    const registryBefore = fs.readFileSync(missing.campaignsPath);
    assert.throws(() => configureCampaign(missing.campaigns, 'preview', 'SYNTHETIC_BOUND_KEY', missing), error => error.code === 'INVALID_INPUT' && /assets\/config.js is missing/.test(error.message));
    assert.deepEqual(fs.readFileSync(missing.campaignsPath), registryBefore);
    assert.equal(fs.existsSync(missing.configPath), false);
    assert.deepEqual(prepareRuntime(missing.campaignDir), { preview: true, mode: 'unconfigured-preview' });
    const source = fs.readFileSync(missing.configPath, 'utf8');
    assert.match(source, /apiKey: ''/);
    assert.match(source, /analytics = \{ enabled: false/);
});

test('malformed preview markers fail before a key write', t => {
    for (const block of [START, END, `${END}\n${START}`, `${START}\n${START}\n${END}`, `${START}\n${END}\n${END}`]) {
        for (const options of [{}, { apiKey: 'SYNTHETIC_BOUND_KEY' }]) {
            const source = `${SOURCE}${block}\nwindow.nextConfig.apiKey = '';\n`;
            const p = campaign(t, source);
            assert.throws(() => prepareRuntime(p.campaignDir, options), error => error.code === 'INVALID_INPUT' && /malformed preview override/.test(error.message));
            assert.equal(fs.readFileSync(p.configPath, 'utf8'), source);
        }
    }
});

test('init classifies template config failures as invalid input and cleans its staged campaign', t => {
    for (const flags of [[], ['--api-key', 'SYNTHETIC_BOUND_KEY']]) {
        const p = campaign(t);
        const sourceRoot = path.join(p.root, 'template');
        fs.cpSync(path.join(__dirname, 'fixtures', 'preview-template'), sourceRoot, { recursive: true });
        fs.writeFileSync(path.join(sourceRoot, 'src', 'example', 'assets', 'config.js'), 'window.nextConfig = { apiKey: process.env.KEY };');
        fs.writeFileSync(path.join(p.root, '_data', 'template-sources.json'), JSON.stringify({ sources: { fixture: { type: 'local', path: sourceRoot } } }));
        const registryBefore = fs.readFileSync(p.campaignsPath);
        const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'lib', 'actions', 'init.js'), '--source', 'fixture', '--template', 'example', '--slug', 'new-preview', '--json', ...flags], { cwd: p.root, encoding: 'utf8' });
        const result = JSON.parse(run.stdout);
        assert.equal(run.status, 6, run.stderr);
        assert.equal(result.errors[0].code, 'INVALID_INPUT');
        assert.match(result.errors[0].message, /template configuration invalid: no apiKey field/);
        assert.deepEqual(fs.readFileSync(p.campaignsPath), registryBefore);
        assert.equal(fs.existsSync(path.join(p.srcPath, 'new-preview')), false);
        assert.equal(fs.readdirSync(p.srcPath).some(name => name.startsWith('.cpk-install-')), false);
    }
});

test('failed registry staging leaves both runtime config and preview gate unchanged', t => {
    const p = campaign(t);
    prepareRuntime(p.campaignDir);
    const before = fs.readFileSync(p.configPath);
    const registryBefore = fs.readFileSync(p.campaignsPath);
    t.mock.method(config, 'saveCampaigns', () => { throw new Error('synthetic registry save failure'); });
    assert.throws(() => configureCampaign(p.campaigns, 'preview', 'SYNTHETIC_BOUND_KEY', p), /synthetic registry save failure/);
    assert.deepEqual(fs.readFileSync(p.configPath), before);
    assert.deepEqual(fs.readFileSync(p.campaignsPath), registryBefore);
    assert.deepEqual(fs.readdirSync(path.dirname(p.campaignsPath)), ['campaigns.json']);
});

test('failed registry commit atomically restores config and retains the preview gate', t => {
    const p = campaign(t);
    prepareRuntime(p.campaignDir);
    fs.chmodSync(p.configPath, 0o600);
    fs.chmodSync(p.campaignsPath, 0o640);
    const before = fs.readFileSync(p.configPath);
    const registryBefore = fs.readFileSync(p.campaignsPath);
    const rename = fs.renameSync;
    let attemptedCommit = false;
    t.mock.method(fs, 'renameSync', (source, target) => {
        if (target === p.campaignsPath) {
            attemptedCommit = true;
            assert.equal(fs.statSync(source).mode & 0o7777, 0o640, 'staged registry preserves original permissions');
            assert.deepEqual(fs.readFileSync(p.campaignsPath), registryBefore, 'gate stays closed until registry commit');
            assert.match(fs.readFileSync(p.configPath, 'utf8'), /SYNTHETIC_BOUND_KEY/);
            throw new Error('synthetic registry rename failure');
        }
        return rename(source, target);
    });
    assert.throws(() => configureCampaign(p.campaigns, 'preview', 'SYNTHETIC_BOUND_KEY', p), /synthetic registry rename failure/);
    assert.equal(attemptedCommit, true);
    assert.deepEqual(fs.readFileSync(p.configPath), before);
    assert.equal(fs.statSync(p.configPath).mode & 0o7777, 0o600, 'rollback preserves private config permissions');
    assert.deepEqual(fs.readFileSync(p.campaignsPath), registryBefore);
    assert.equal(fs.statSync(p.campaignsPath).mode & 0o7777, 0o640);
    assert.equal(p.campaigns.preview.preview_mode, true);
    assert.deepEqual(fs.readdirSync(path.dirname(p.configPath)), ['config.js']);
    assert.deepEqual(fs.readdirSync(path.dirname(p.campaignsPath)), ['campaigns.json']);
});

test('a failed rollback retains recovery config outside published assets', async t => {
    const p = campaign(t);
    fs.chmodSync(p.configPath, 0o600);
    fs.writeFileSync(path.join(p.campaignDir, 'index.html'), '---\ntitle: Preview\npage_type: presell\n---\n<p>Preview</p>');
    const before = fs.readFileSync(p.configPath);
    const registryBefore = fs.readFileSync(p.campaignsPath);
    t.mock.method(fs, 'renameSync', () => { throw new Error('synthetic rename failure'); });
    assert.throws(() => configureCampaign(p.campaigns, 'preview', 'SYNTHETIC_BOUND_KEY', p), /registry was not updated, but assets\/config.js could not be restored.*Original config retained/);
    assert.deepEqual(fs.readFileSync(p.campaignsPath), registryBefore);
    const backup = fs.readdirSync(p.campaignDir).find(name => name.startsWith('.cpk-config-'));
    assert.ok(backup);
    const backupPath = path.join(p.campaignDir, backup, 'config.js');
    assert.deepEqual(fs.readFileSync(backupPath), before);
    assert.equal(fs.statSync(backupPath).mode & 0o7777, 0o600);
    const outputPath = path.join(p.root, '_site');
    const summary = await build({ srcPath: p.srcPath, outputPath, campaigns: p.campaigns, mode: 'production' });
    assert.equal(summary.errors, 0);
    assert.equal(summary.built, 1);
    assert.deepEqual(fs.readdirSync(path.join(outputPath, 'preview')).sort(), ['config.js', 'index.html']);
    const publishedConfig = fs.readFileSync(path.join(outputPath, 'preview', 'config.js'), 'utf8');
    assert.match(publishedConfig, /SYNTHETIC_BOUND_KEY/);
    assert.doesNotMatch(publishedConfig, /SYNTHETIC_DEMO_KEY/);
    assert.deepEqual(fs.readFileSync(backupPath), before, 'build leaves the unpublished recovery copy intact');
});
