const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { execFileSync } = require('child_process');

const fixture = path.join(__dirname, 'fixtures', 'unconfigured-template');
const init = path.join(__dirname, '..', 'lib', 'actions', 'init.js');

function project(t, flags = [], configSource) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-unconfigured-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, '_data'));
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    // A dry run reads the registry without seeding it, so give it an empty one.
    if (flags.includes('--dry-run')) fs.writeFileSync(path.join(root, '_data', 'campaigns.json'), '{}');
    let templateRoot = fixture;
    if (configSource !== undefined) {
        templateRoot = path.join(root, 'template');
        fs.cpSync(fixture, templateRoot, { recursive: true });
        fs.writeFileSync(path.join(templateRoot, 'src', 'example', 'assets', 'config.js'), configSource);
    }
    fs.writeFileSync(path.join(root, '_data', 'template-sources.json'), JSON.stringify({ sources: { fixture: { type: 'local', path: templateRoot } } }));
    const result = JSON.parse(execFileSync(process.execPath, [init, '--source', 'fixture', '--template', 'example', '--slug', 'demo', '--json', ...flags], { cwd: root, encoding: 'utf8' }));
    if (flags.includes('--dry-run')) return { result };
    const source = fs.readFileSync(path.join(root, 'src', 'demo', 'assets', 'config.js'), 'utf8');
    const window = {};
    vm.runInNewContext(source, { window, process: { env: {} } });
    return { result, source, config: window.nextConfig };
}

test('init without a key clears the template demo key and reports unconfigured', t => {
    const { result, source, config } = project(t);
    assert.equal(result.campaign.runtime_mode, 'unconfigured');
    assert.equal(result.writes.api_key_applied, false);
    assert.equal(config.apiKey, '');
    assert.equal(config.googleMaps.apiKey, '', 'only the commerce key field is touched');
    assert.doesNotMatch(source, /UPSTREAM_DEMO_KEY/);
    assert.equal(result.warnings.filter(w => w.includes('No Campaign API key')).length, 1);
});

test('init with a key writes it and reports configured', t => {
    const { result, config } = project(t, ['--api-key', 'EXPLICIT_TEST_KEY']);
    assert.equal(result.campaign.runtime_mode, 'configured');
    assert.equal(result.writes.api_key_applied, true);
    assert.equal(config.apiKey, 'EXPLICIT_TEST_KEY');
    assert.ok(!result.warnings.some(w => w.includes('No Campaign API key')));
});

const nestedFirst = "window.nextConfig = {\n  googleMaps: { apiKey: 'MAPS_KEY' },\n  apiKey: 'UPSTREAM_DEMO_KEY',\n  analytics: { enabled: true }\n};\n";

test('a nested apiKey ahead of the commerce key is left alone', t => {
    const cleared = project(t, [], nestedFirst);
    assert.equal(cleared.config.apiKey, '');
    assert.equal(cleared.config.googleMaps.apiKey, 'MAPS_KEY');
    assert.doesNotMatch(cleared.source, /UPSTREAM_DEMO_KEY/);
    const bound = project(t, ['--api-key', 'EXPLICIT_TEST_KEY'], nestedFirst);
    assert.equal(bound.config.apiKey, 'EXPLICIT_TEST_KEY');
    assert.equal(bound.config.googleMaps.apiKey, 'MAPS_KEY');
    assert.equal(bound.result.campaign.runtime_mode, 'configured');
});

test('a config without a string apiKey field is reported, not claimed cleared or configured', t => {
    const dynamic = "window.nextConfig = { apiKey: process.env.KEY };\n";
    const noKey = project(t, [], dynamic);
    assert.equal(noKey.result.campaign.runtime_mode, 'unconfigured');
    assert.ok(noKey.result.warnings.some(w => w.includes('no apiKey string field found')));
    assert.ok(!noKey.result.warnings.some(w => w.includes('demo key was cleared')));
    assert.equal(noKey.source, dynamic);
    const withKey = project(t, ['--api-key', 'EXPLICIT_TEST_KEY'], dynamic);
    assert.equal(withKey.result.campaign.runtime_mode, 'unconfigured');
    assert.equal(withKey.result.writes.api_key_applied, false);
    assert.ok(withKey.result.warnings.some(w => w.includes('no apiKey string field found')));
    assert.equal(withKey.source, dynamic);
});

test('dry runs report runtime_mode from the supplied flags', t => {
    assert.equal(project(t, ['--dry-run']).result.campaign.runtime_mode, 'unconfigured');
    assert.equal(project(t, ['--dry-run', '--api-key', 'EXPLICIT_TEST_KEY']).result.campaign.runtime_mode, 'configured');
});
