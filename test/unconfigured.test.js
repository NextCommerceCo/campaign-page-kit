const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { execFileSync } = require('child_process');

const fixture = path.join(__dirname, 'fixtures', 'unconfigured-template');
const init = path.join(__dirname, '..', 'lib', 'actions', 'init.js');

function project(t, flags = []) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-unconfigured-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, '_data'));
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.writeFileSync(path.join(root, '_data', 'template-sources.json'), JSON.stringify({ sources: { fixture: { type: 'local', path: fixture } } }));
    const result = JSON.parse(execFileSync(process.execPath, [init, '--source', 'fixture', '--template', 'example', '--slug', 'demo', '--json', ...flags], { cwd: root, encoding: 'utf8' }));
    const source = fs.readFileSync(path.join(root, 'src', 'demo', 'assets', 'config.js'), 'utf8');
    const window = {};
    vm.runInNewContext(source, { window });
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
