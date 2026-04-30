const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const {
    SCRIPTS,
    slugify,
    selectableTemplates,
    mergeCampaignEntry,
    mergeScripts,
    applyApiKey,
    extractTemplate,
    countFiles,
    replaceDirectoryWithRollback,
} = require('../lib/actions/init');

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

test('slugify: lowercases and replaces non-alphanumerics with hyphens', () => {
    assert.equal(slugify('My Campaign'), 'my-campaign');
    assert.equal(slugify('Olympus MV — Two-step'), 'olympus-mv-two-step');
});

test('slugify: collapses repeats and trims leading/trailing hyphens', () => {
    assert.equal(slugify('  -- Hello   World!! --'), 'hello-world');
});

test('slugify: returns empty string for empty/whitespace/non-alphanumeric input', () => {
    assert.equal(slugify(''), '');
    assert.equal(slugify('!!!'), '');
    assert.equal(slugify(null), '');
});

// ---------------------------------------------------------------------------
// selectableTemplates
// ---------------------------------------------------------------------------

test('selectableTemplates: filters out hidden entries', () => {
    const result = selectableTemplates({
        templates: [
            { slug: 'a', name: 'A', priority: 50 },
            { slug: 'b', name: 'B', priority: 50, hidden: true },
        ],
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].slug, 'a');
});

test('selectableTemplates: sorts by priority desc, then name asc', () => {
    const result = selectableTemplates({
        templates: [
            { slug: 'low',  name: 'Low',  priority: 10 },
            { slug: 'top',  name: 'Top',  priority: 100 },
            { slug: 'mid1', name: 'Mid B', priority: 50 },
            { slug: 'mid2', name: 'Mid A', priority: 50 },
        ],
    });
    assert.deepEqual(result.map(t => t.slug), ['top', 'mid2', 'mid1', 'low']);
});

test('selectableTemplates: treats missing priority as 0', () => {
    const result = selectableTemplates({
        templates: [
            { slug: 'a', name: 'A', priority: 5 },
            { slug: 'b', name: 'B' },
        ],
    });
    assert.equal(result[0].slug, 'a');
});

test('selectableTemplates: tolerates missing manifest / templates', () => {
    assert.deepEqual(selectableTemplates(null), []);
    assert.deepEqual(selectableTemplates({}), []);
    assert.deepEqual(selectableTemplates({ templates: [] }), []);
});

// ---------------------------------------------------------------------------
// mergeCampaignEntry
// ---------------------------------------------------------------------------

test('mergeCampaignEntry: adds a slug while preserving existing entries', () => {
    const next = mergeCampaignEntry(
        { existing: { name: 'Existing' } },
        'olympus',
        { name: 'Olympus', sdk_version: '0.4.18', store_phone: '...' },
        'My Olympus'
    );
    assert.deepEqual(next.existing, { name: 'Existing' });
    assert.equal(next.olympus.name, 'My Olympus');
    assert.equal(next.olympus.sdk_version, '0.4.18');
    assert.equal(next.olympus.store_phone, '...');
});

test('mergeCampaignEntry: user-supplied name overrides upstream name', () => {
    const next = mergeCampaignEntry({}, 'x', { name: 'Upstream', description: 'd' }, 'Custom');
    assert.equal(next.x.name, 'Custom');
    assert.equal(next.x.description, 'd');
});

test('mergeCampaignEntry: tolerates a null upstream entry', () => {
    const next = mergeCampaignEntry({}, 'x', null, 'Custom');
    assert.equal(next.x.name, 'Custom');
    assert.equal(next.x.description, '');
});

test('mergeCampaignEntry: does not mutate the input', () => {
    const local = { a: { name: 'A' } };
    mergeCampaignEntry(local, 'b', { name: 'B' }, 'B!');
    assert.deepEqual(local, { a: { name: 'A' } });
});

// ---------------------------------------------------------------------------
// mergeScripts
// ---------------------------------------------------------------------------

test('mergeScripts: adds all CLI scripts to a fresh package.json', () => {
    const { pkg, added } = mergeScripts({ name: 'demo' });
    assert.equal(added.length, Object.keys(SCRIPTS).length);
    for (const k of Object.keys(SCRIPTS)) {
        assert.equal(pkg.scripts[k], SCRIPTS[k]);
    }
});

test('mergeScripts: returns no additions when scripts are already present', () => {
    const { added } = mergeScripts({ scripts: { ...SCRIPTS } });
    assert.deepEqual(added, []);
});

test('mergeScripts: preserves user-customized scripts', () => {
    const { pkg } = mergeScripts({ scripts: { dev: 'custom' } });
    assert.equal(pkg.scripts.dev, 'custom');
    assert.equal(pkg.scripts.build, SCRIPTS.build);
});

test('mergeScripts: does not mutate the input', () => {
    const input = { scripts: { dev: 'custom' } };
    mergeScripts(input);
    assert.deepEqual(input, { scripts: { dev: 'custom' } });
});

// ---------------------------------------------------------------------------
// applyApiKey
// ---------------------------------------------------------------------------

test('applyApiKey: replaces a single-quoted apiKey field', () => {
    const out = applyApiKey("module.exports = { apiKey: '' };", 'abc');
    assert.match(out, /apiKey: 'abc'/);
});

test('applyApiKey: replaces a double-quoted apiKey field', () => {
    const out = applyApiKey('module.exports = { apiKey: "old" };', 'new');
    assert.match(out, /apiKey: 'new'/);
});

test('applyApiKey: trims whitespace from the key', () => {
    const out = applyApiKey("apiKey: ''", '  spaced  ');
    assert.match(out, /apiKey: 'spaced'/);
});

test('applyApiKey: returns null when no apiKey field is present', () => {
    assert.equal(applyApiKey('module.exports = { other: true };', 'k'), null);
});

// ---------------------------------------------------------------------------
// extractTemplate (integration: real fixture tarball via system `tar`)
// ---------------------------------------------------------------------------

function buildFixtureTarball() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-fixture-'));
    const repoDir = path.join(root, 'fixture-repo-main');
    const olympusDir = path.join(repoDir, 'src', 'olympus');
    const limosDir = path.join(repoDir, 'src', 'limos');
    fs.mkdirSync(path.join(olympusDir, '_layouts'), { recursive: true });
    fs.mkdirSync(path.join(olympusDir, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(olympusDir, '_includes', 'landing'), { recursive: true });
    fs.mkdirSync(limosDir, { recursive: true });
    fs.writeFileSync(path.join(olympusDir, 'page.html'), '<h1>olympus</h1>');
    fs.writeFileSync(path.join(olympusDir, '_layouts', 'base.html'), 'layout');
    fs.writeFileSync(path.join(olympusDir, 'assets', 'config.js'), "apiKey: ''");
    fs.writeFileSync(path.join(olympusDir, '_includes', 'landing', 'hero.html'), 'hero');
    fs.writeFileSync(path.join(limosDir, 'page.html'), '<h1>limos</h1>');
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'readme');

    const tarball = execSync('tar -czf - fixture-repo-main', { cwd: root });
    fs.rmSync(root, { recursive: true, force: true });
    return tarball;
}

test('extractTemplate: extracts only the requested slug, including deep _includes', () => {
    const tarball = buildFixtureTarball();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-extract-test-'));
    const dest = path.join(root, 'src', 'olympus');

    const written = extractTemplate(tarball, 'olympus', dest);

    assert.equal(written, 4);
    assert.equal(fs.readFileSync(path.join(dest, 'page.html'), 'utf8'), '<h1>olympus</h1>');
    assert.equal(fs.readFileSync(path.join(dest, '_layouts/base.html'), 'utf8'), 'layout');
    assert.equal(fs.readFileSync(path.join(dest, '_includes/landing/hero.html'), 'utf8'), 'hero');
    assert.equal(fs.existsSync(path.join(root, 'src', 'limos')), false);
    assert.equal(fs.existsSync(path.join(dest, 'README.md')), false);

    fs.rmSync(root, { recursive: true, force: true });
});

test('extractTemplate: throws when the slug is missing from the tarball', () => {
    const tarball = buildFixtureTarball();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-extract-test-'));

    assert.throws(
        () => extractTemplate(tarball, 'does-not-exist', path.join(root, 'src', 'x')),
        /no src\/does-not-exist/
    );

    fs.rmSync(root, { recursive: true, force: true });
});

test('extractTemplate: cleans up its temp dir on success', () => {
    const tarball = buildFixtureTarball();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-extract-test-'));
    const dest = path.join(root, 'src', 'olympus');

    extractTemplate(tarball, 'olympus', dest);

    const stragglers = fs.readdirSync(path.join(root, 'src')).filter(n => n.startsWith('.cpk-extract-'));
    assert.deepEqual(stragglers, []);

    fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// replaceDirectoryWithRollback
// ---------------------------------------------------------------------------

test('replaceDirectoryWithRollback: replaces the destination and runs commit', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-replace-test-'));
    const dest = path.join(root, 'src', 'olympus');
    const staged = path.join(root, 'src', '.cpk-install-abc', 'olympus');
    const marker = path.join(root, 'committed');

    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'old.html'), 'old');
    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, 'new.html'), 'new');

    replaceDirectoryWithRollback(staged, dest, () => {
        fs.writeFileSync(marker, 'yes');
    });

    assert.equal(fs.existsSync(path.join(dest, 'old.html')), false);
    assert.equal(fs.readFileSync(path.join(dest, 'new.html'), 'utf8'), 'new');
    assert.equal(fs.readFileSync(marker, 'utf8'), 'yes');
    assert.deepEqual(fs.readdirSync(path.dirname(dest)).filter(n => n.startsWith('.cpk-backup-')), []);

    fs.rmSync(root, { recursive: true, force: true });
});

test('replaceDirectoryWithRollback: restores an existing destination when commit fails', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-replace-test-'));
    const dest = path.join(root, 'src', 'olympus');
    const staged = path.join(root, 'src', '.cpk-install-abc', 'olympus');

    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'old.html'), 'old');
    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, 'new.html'), 'new');

    assert.throws(
        () => replaceDirectoryWithRollback(staged, dest, () => {
            throw new Error('registry write failed');
        }),
        /registry write failed/
    );

    assert.equal(fs.readFileSync(path.join(dest, 'old.html'), 'utf8'), 'old');
    assert.equal(fs.existsSync(path.join(dest, 'new.html')), false);
    assert.deepEqual(fs.readdirSync(path.dirname(dest)).filter(n => n.startsWith('.cpk-backup-')), []);

    fs.rmSync(root, { recursive: true, force: true });
});

test('replaceDirectoryWithRollback: removes a new destination when commit fails', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-replace-test-'));
    const dest = path.join(root, 'src', 'olympus');
    const staged = path.join(root, 'src', '.cpk-install-abc', 'olympus');

    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, 'new.html'), 'new');

    assert.throws(
        () => replaceDirectoryWithRollback(staged, dest, () => {
            throw new Error('registry write failed');
        }),
        /registry write failed/
    );

    assert.equal(fs.existsSync(dest), false);

    fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// countFiles
// ---------------------------------------------------------------------------

test('countFiles: counts files recursively, ignoring directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-count-test-'));
    fs.mkdirSync(path.join(root, 'a'), { recursive: true });
    fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(root, 'top.txt'), '1');
    fs.writeFileSync(path.join(root, 'a', 'mid.txt'), '2');
    fs.writeFileSync(path.join(root, 'a', 'b', 'deep.txt'), '3');

    assert.equal(countFiles(root), 3);

    fs.rmSync(root, { recursive: true, force: true });
});
