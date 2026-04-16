const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const {
    getProjectRoot,
    getCampaignsPath,
    getSrcPath,
    getOutputPath,
    getCpkPath,
    parseFlag,
    formatBuildSummary,
    loadCampaigns,
    saveCampaigns,
    campaignsArray,
    getConfig,
} = require('../lib/config');

// ---------------------------------------------------------------------------
// Pure path helpers
// ---------------------------------------------------------------------------

test('getProjectRoot: returns current working directory', () => {
    assert.equal(getProjectRoot(), process.cwd());
});

test('getSrcPath: returns src/ under project root by default', () => {
    assert.equal(getSrcPath(), path.join(process.cwd(), 'src'));
});

test('getSrcPath: returns resolved custom path when provided', () => {
    assert.equal(getSrcPath('/custom/src'), '/custom/src');
});

test('getOutputPath: returns _site/ under project root by default', () => {
    assert.equal(getOutputPath(), path.join(process.cwd(), '_site'));
});

test('getOutputPath: returns resolved custom path when provided', () => {
    assert.equal(getOutputPath('/custom/out'), '/custom/out');
});

test('getCpkPath: returns .cpk/ under project root by default', () => {
    assert.equal(getCpkPath(), path.join(process.cwd(), '.cpk'));
});

test('getCpkPath: returns resolved custom path when provided', () => {
    assert.equal(getCpkPath('/custom/cpk'), '/custom/cpk');
});

// ---------------------------------------------------------------------------
// parseFlag
// ---------------------------------------------------------------------------

test('parseFlag: returns true when flag is present', () => {
    assert.equal(parseFlag(['node', 'build.js', '--lenient'], '--lenient'), true);
});

test('parseFlag: returns false when flag is absent', () => {
    assert.equal(parseFlag(['node', 'build.js'], '--lenient'), false);
});

test('parseFlag: ignores node and script args (argv[0] and argv[1])', () => {
    assert.equal(parseFlag(['--lenient', '--lenient'], '--lenient'), false);
});

test('parseFlag: works for --strict flag', () => {
    assert.equal(parseFlag(['node', 'dev.js', '--strict'], '--strict'), true);
    assert.equal(parseFlag(['node', 'dev.js'], '--strict'), false);
});

// ---------------------------------------------------------------------------
// formatBuildSummary
// ---------------------------------------------------------------------------

test('formatBuildSummary: singular page, no errors', () => {
    assert.equal(formatBuildSummary(1, 0, '42ms'), 'Built 1 page in 42ms');
});

test('formatBuildSummary: plural pages, no errors', () => {
    assert.equal(formatBuildSummary(5, 0, '1.20s'), 'Built 5 pages in 1.20s');
});

test('formatBuildSummary: singular error', () => {
    assert.equal(formatBuildSummary(3, 1, '100ms'), 'Built 3 pages in 100ms (1 error)');
});

test('formatBuildSummary: plural errors', () => {
    assert.equal(formatBuildSummary(10, 4, '2.50s'), 'Built 10 pages in 2.50s (4 errors)');
});

test('formatBuildSummary: zero pages built', () => {
    assert.equal(formatBuildSummary(0, 0, '5ms'), 'Built 0 pages in 5ms');
});

test('getCampaignsPath: returns _data/campaigns.json under project root by default', () => {
    assert.equal(getCampaignsPath(), path.join(process.cwd(), '_data', 'campaigns.json'));
});

test('getCampaignsPath: returns resolved custom path when provided', () => {
    assert.equal(getCampaignsPath('/data/my-campaigns.json'), '/data/my-campaigns.json');
});

// ---------------------------------------------------------------------------
// campaignsArray — pure transformation
// ---------------------------------------------------------------------------

test('campaignsArray: converts key-based object to array with slug injected', () => {
    const campaigns = {
        'test-campaign': { name: 'Test Campaign' },
        'other-campaign': { name: 'Other Campaign' },
    };
    const result = campaignsArray(campaigns);
    assert.deepEqual(result, [
        { slug: 'test-campaign', name: 'Test Campaign' },
        { slug: 'other-campaign', name: 'Other Campaign' },
    ]);
});

test('campaignsArray: returns empty array for empty object', () => {
    assert.deepEqual(campaignsArray({}), []);
});

// ---------------------------------------------------------------------------
// loadCampaigns / saveCampaigns — filesystem
// ---------------------------------------------------------------------------

function withTmpFile(fn) {
    const file = path.join(os.tmpdir(), `campaigns-test-${Date.now()}.json`);
    return Promise.resolve(fn(file)).finally(() => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
    });
}

test('loadCampaigns: reads and parses campaigns.json', async () => {
    await withTmpFile((file) => {
        const data = { 'my-campaign': { name: 'My Campaign' } };
        fs.writeFileSync(file, JSON.stringify(data), 'utf8');
        const result = loadCampaigns(file);
        assert.deepEqual(result, data);
    });
});

test('loadCampaigns: throws when file does not exist', () => {
    assert.throws(
        () => loadCampaigns('/nonexistent/path/campaigns.json'),
        /not found/
    );
});

test('saveCampaigns: writes campaigns to disk as formatted JSON', async () => {
    await withTmpFile((file) => {
        const data = { 'my-campaign': { name: 'My Campaign' } };
        saveCampaigns(data, file);
        const written = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepEqual(written, data);
    });
});

// ---------------------------------------------------------------------------
// getConfig
// ---------------------------------------------------------------------------

test('getConfig: returns object with all default paths', () => {
    const cfg = getConfig();
    assert.equal(cfg.projectRoot, process.cwd());
    assert.equal(cfg.srcPath, path.join(process.cwd(), 'src'));
    assert.equal(cfg.outputPath, path.join(process.cwd(), '_site'));
    assert.equal(cfg.campaignsPath, path.join(process.cwd(), '_data', 'campaigns.json'));
});

test('getConfig: merges custom options', () => {
    const cfg = getConfig({ srcPath: '/custom/src', extra: true });
    assert.equal(cfg.srcPath, '/custom/src');
    assert.equal(cfg.extra, true);
});
