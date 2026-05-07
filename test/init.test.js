const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const {
    SCRIPTS,
    AI_CONTEXT_TARGETS,
    AI_CONTEXT_SENTINEL,
    FLAG_SCHEMA,
    slugify,
    selectableTemplates,
    mergeCampaignEntry,
    mergeScripts,
    applyApiKey,
    extractTemplate,
    countFiles,
    replaceDirectoryWithRollback,
    parseArgs,
    kebabToCamel,
    validateSlug,
    aiContextTarget,
    buildAiContextContent,
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
// kebabToCamel
// ---------------------------------------------------------------------------

test('kebabToCamel: leaves a single word unchanged', () => {
    assert.equal(kebabToCamel('slug'), 'slug');
});

test('kebabToCamel: camelCases multi-word keys', () => {
    assert.equal(kebabToCamel('ai-context'), 'aiContext');
    assert.equal(kebabToCamel('non-interactive'), 'nonInteractive');
    assert.equal(kebabToCamel('keep-ai-context'), 'keepAiContext');
});

test('kebabToCamel: leaves digits and trailing hyphens alone', () => {
    assert.equal(kebabToCamel('a-1-b'), 'a1B');
});

// ---------------------------------------------------------------------------
// validateSlug
// ---------------------------------------------------------------------------

test('validateSlug: accepts kebab-case slugs', () => {
    assert.equal(validateSlug('grounding-mat-v2'), null);
    assert.equal(validateSlug('a'), null);
    assert.equal(validateSlug('123-x'), null);
});

test('validateSlug: rejects empty/whitespace', () => {
    assert.match(validateSlug(''),    /empty/);
    assert.match(validateSlug('   '), /empty/);
    assert.match(validateSlug(null),  /empty/);
});

test('validateSlug: rejects uppercase, underscores, leading hyphens', () => {
    assert.match(validateSlug('My-Slug'),  /lowercase/);
    assert.match(validateSlug('my_slug'),  /lowercase/);
    assert.match(validateSlug('-leading'), /lowercase/);
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test('parseArgs: handles --key value and --key=value forms', () => {
    const a = parseArgs(['--template', 'olympus'], FLAG_SCHEMA);
    assert.deepEqual(a.errors, []);
    assert.equal(a.values.template, 'olympus');

    const b = parseArgs(['--template=olympus'], FLAG_SCHEMA);
    assert.deepEqual(b.errors, []);
    assert.equal(b.values.template, 'olympus');
});

test('parseArgs: boolean flags default to true and accept =false', () => {
    const a = parseArgs(['--non-interactive'], FLAG_SCHEMA);
    assert.equal(a.values.nonInteractive, true);

    const b = parseArgs(['--non-interactive=false'], FLAG_SCHEMA);
    assert.equal(b.values.nonInteractive, false);
});

test('parseArgs: -h is an alias for --help', () => {
    const a = parseArgs(['-h'], FLAG_SCHEMA);
    assert.equal(a.values.help, true);
});

test('parseArgs: kebab keys map to camelCase result keys', () => {
    const a = parseArgs(['--api-key', 'k', '--ai-context', 'claude', '--keep-ai-context'], FLAG_SCHEMA);
    assert.deepEqual(a.errors, []);
    assert.equal(a.values.apiKey, 'k');
    assert.equal(a.values.aiContext, 'claude');
    assert.equal(a.values.keepAiContext, true);
});

test('parseArgs: rejects unknown flags', () => {
    const a = parseArgs(['--bogus'], FLAG_SCHEMA);
    assert.equal(a.errors.length, 1);
    assert.equal(a.errors[0].code, 'INVALID_INPUT');
    assert.match(a.errors[0].message, /unknown flag: --bogus/);
});

test('parseArgs: enum-typed flags reject invalid values', () => {
    const a = parseArgs(['--ai-context', 'vim'], FLAG_SCHEMA);
    assert.equal(a.errors.length, 1);
    assert.match(a.errors[0].message, /must be one of/);
});

test('parseArgs: string flags require a value', () => {
    const a = parseArgs(['--template'], FLAG_SCHEMA);
    assert.equal(a.errors.length, 1);
    assert.match(a.errors[0].message, /requires a value/);
});

test('parseArgs: a string flag followed by another flag reports missing value', () => {
    const a = parseArgs(['--template', '--slug', 'x'], FLAG_SCHEMA);
    assert.ok(a.errors.some(e => /--template requires a value/.test(e.message)));
    assert.equal(a.values.slug, 'x');
});

test('parseArgs: rejects positional args', () => {
    const a = parseArgs(['olympus'], FLAG_SCHEMA);
    assert.equal(a.errors.length, 1);
    assert.match(a.errors[0].message, /unexpected positional/);
});

// ---------------------------------------------------------------------------
// aiContextTarget
// ---------------------------------------------------------------------------

test('aiContextTarget: returns destination spec for known tools', () => {
    assert.equal(aiContextTarget('claude').path, 'CLAUDE.md');
    assert.equal(aiContextTarget('codex').path, 'AGENTS.md');
    assert.equal(aiContextTarget('cursor').path, '.cursor/rules/campaign-page-kit.mdc');
    assert.equal(aiContextTarget('copilot').path, '.github/copilot-instructions.md');
});

test('aiContextTarget: returns null for "none" and unknown tools', () => {
    assert.equal(aiContextTarget('none'), null);
    assert.equal(aiContextTarget('vim'), null);
    assert.equal(aiContextTarget(''), null);
});

test('aiContextTarget: only cursor has frontmatter', () => {
    assert.equal(aiContextTarget('claude').frontmatter, null);
    assert.equal(aiContextTarget('codex').frontmatter, null);
    assert.equal(aiContextTarget('copilot').frontmatter, null);
    assert.match(aiContextTarget('cursor').frontmatter, /alwaysApply: true/);
});

// ---------------------------------------------------------------------------
// buildAiContextContent
// ---------------------------------------------------------------------------

test('buildAiContextContent: prepends sentinel, then upstream body', () => {
    const out = buildAiContextContent('# upstream body\n', AI_CONTEXT_TARGETS.claude);
    assert.ok(out.startsWith(AI_CONTEXT_SENTINEL), 'sentinel at top');
    assert.ok(out.includes('# upstream body'), 'body preserved');
    assert.ok(out.indexOf(AI_CONTEXT_SENTINEL) < out.indexOf('# upstream body'), 'sentinel before body');
});

test('buildAiContextContent: prepends frontmatter above sentinel for cursor', () => {
    const out = buildAiContextContent('# body\n', AI_CONTEXT_TARGETS.cursor);
    assert.ok(out.startsWith('---'), 'frontmatter at top');
    assert.match(out, /alwaysApply: true/);
    assert.ok(out.indexOf('---') < out.indexOf(AI_CONTEXT_SENTINEL), 'frontmatter before sentinel');
    assert.ok(out.indexOf(AI_CONTEXT_SENTINEL) < out.indexOf('# body'), 'sentinel before body');
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
