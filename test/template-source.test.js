const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const {
    BUILTIN_PUBLIC,
    countFiles,
    copySubtree,
    extractTemplate,
    selectableTemplates,
    PublicProvider,
    LocalRootProvider,
    createProvider,
    resolveLocalRoot,
    cloneToTemp,
    readSourcesFile,
    loadSources,
    resolveSource,
    validateSource,
    validateSourceInput,
    buildSourceEntry,
    addSourceEntry,
    removeSourceEntry,
    writeSources,
    validateSourceHasTemplates,
} = require('../lib/template-source');

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

// A working-copy style source root: templates.json at root + src/<slug>/ trees.
function makeSourceDir(opts = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-src-'));
    const templates = opts.templates !== undefined
        ? opts.templates
        : { templates: [{ slug: 'olympus', name: 'Olympus', priority: 10 }, { slug: 'limos', name: 'Limos' }] };
    if (templates !== null) {
        fs.writeFileSync(path.join(root, 'templates.json'), JSON.stringify(templates));
    }
    const olympus = path.join(root, 'src', 'olympus', '_includes', 'landing');
    fs.mkdirSync(olympus, { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'olympus', 'page.html'), '<h1>olympus</h1>');
    fs.writeFileSync(path.join(olympus, 'hero.html'), 'hero');
    fs.mkdirSync(path.join(root, 'src', 'limos'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'limos', 'page.html'), '<h1>limos</h1>');
    fs.mkdirSync(path.join(root, '_data'), { recursive: true });
    fs.writeFileSync(path.join(root, '_data', 'campaigns.json'), JSON.stringify({ olympus: { sdk_version: '0.4.18' } }));
    return root;
}

function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }

// A tarball whose top-level dir mirrors a github codeload archive.
function buildFixtureTarball() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-tar-'));
    const repo = path.join(root, 'repo-main', 'src', 'olympus');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, 'page.html'), '<h1>olympus</h1>');
    const tarball = execSync('tar -czf - repo-main', { cwd: root });
    rm(root);
    return tarball;
}

// ---------------------------------------------------------------------------
// copySubtree / countFiles / extractTemplate
// ---------------------------------------------------------------------------

test('copySubtree: copies only the requested slug subtree and counts files', () => {
    const src = makeSourceDir();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-out-'));
    const dest = path.join(out, 'olympus');

    const n = copySubtree(src, 'olympus', dest);

    assert.equal(n, 2);
    assert.equal(fs.readFileSync(path.join(dest, 'page.html'), 'utf8'), '<h1>olympus</h1>');
    assert.equal(fs.readFileSync(path.join(dest, '_includes/landing/hero.html'), 'utf8'), 'hero');
    assert.equal(fs.existsSync(path.join(out, 'limos')), false);
    rm(src); rm(out);
});

test('copySubtree: throws coded error when slug missing', () => {
    const src = makeSourceDir();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-out-'));
    assert.throws(
        () => copySubtree(src, 'nope', path.join(out, 'nope')),
        (err) => err.code === 'UPSTREAM_FETCH_FAILED' && /no src\/nope/.test(err.message)
    );
    rm(src); rm(out);
});

test('extractTemplate: extracts slug from a tarball', () => {
    const tarball = buildFixtureTarball();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-out-'));
    const dest = path.join(out, 'src', 'olympus');
    const n = extractTemplate(tarball, 'olympus', dest);
    assert.equal(n, 1);
    assert.equal(fs.readFileSync(path.join(dest, 'page.html'), 'utf8'), '<h1>olympus</h1>');
    rm(out);
});

// ---------------------------------------------------------------------------
// readSourcesFile / loadSources / resolveSource
// ---------------------------------------------------------------------------

test('readSourcesFile: returns empty sources when file is absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-brand-'));
    assert.deepEqual(readSourcesFile(root), { sources: {} });
    rm(root);
});

test('readSourcesFile: throws INVALID_INPUT on malformed JSON', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-brand-'));
    fs.mkdirSync(path.join(root, '_data'));
    fs.writeFileSync(path.join(root, '_data', 'template-sources.json'), '{ not json');
    assert.throws(() => readSourcesFile(root), (e) => e.code === 'INVALID_INPUT');
    rm(root);
});

test('readSourcesFile: throws INVALID_INPUT when sources is not a map', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-brand-'));
    fs.mkdirSync(path.join(root, '_data'));
    fs.writeFileSync(path.join(root, '_data', 'template-sources.json'), '{"sources": 5}');
    assert.throws(() => readSourcesFile(root), (e) => e.code === 'INVALID_INPUT' && /sources/.test(e.message));
    rm(root);
});

test('loadSources: file absent → only built-in public, default public', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-brand-'));
    const { default: def, sources } = loadSources(root);
    assert.equal(def, 'public');
    assert.deepEqual(Object.keys(sources), ['public']);
    assert.deepEqual(sources.public, BUILTIN_PUBLIC);
    rm(root);
});

test('loadSources: merges file entries and keeps built-in public authoritative', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-brand-'));
    fs.mkdirSync(path.join(root, '_data'));
    fs.writeFileSync(path.join(root, '_data', 'template-sources.json'), JSON.stringify({
        sources: {
            acme: { type: 'git', label: 'Acme', url: 'git@github.com:acme/t.git' },
            public: { type: 'local', label: 'hijack', path: '/tmp/evil' }, // reserved — must be ignored
        },
    }));
    const { sources } = loadSources(root);
    assert.deepEqual(sources.public, BUILTIN_PUBLIC); // file cannot shadow public
    assert.equal(sources.acme.url, 'git@github.com:acme/t.git');
    rm(root);
});

test('loadSources: honors a valid default, falls back to public for an invalid one', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-brand-'));
    fs.mkdirSync(path.join(root, '_data'));
    fs.writeFileSync(path.join(root, '_data', 'template-sources.json'), JSON.stringify({
        default: 'acme',
        sources: { acme: { type: 'local', label: 'A', path: '.' } },
    }));
    assert.equal(loadSources(root).default, 'acme');

    fs.writeFileSync(path.join(root, '_data', 'template-sources.json'), JSON.stringify({
        default: 'ghost', sources: {},
    }));
    assert.equal(loadSources(root).default, 'public');
    rm(root);
});

test('resolveSource: returns the entry or throws INVALID_INPUT', () => {
    const sources = { public: BUILTIN_PUBLIC };
    assert.equal(resolveSource(sources, 'public'), BUILTIN_PUBLIC);
    assert.throws(() => resolveSource(sources, 'nope'), (e) => e.code === 'INVALID_INPUT');
});

// ---------------------------------------------------------------------------
// validateSource / validateSourceInput / buildSourceEntry
// ---------------------------------------------------------------------------

test('validateSource: accepts well-formed entries, rejects missing fields + unknown types', () => {
    assert.equal(validateSource({ type: 'github', repo: 'a/b' }), null);
    assert.equal(validateSource({ type: 'local', path: '/x' }), null);
    assert.equal(validateSource({ type: 'git', url: 'git@h:o/r.git' }), null);
    assert.match(validateSource({ type: 'github' }), /repo/);
    assert.match(validateSource({ type: 'local' }), /path/);
    assert.match(validateSource({ type: 'git' }), /url/);
    assert.match(validateSource({ type: 'bogus' }), /unknown source type/);
    assert.match(validateSource(null), /must be an object/);
});

test('validateSourceInput: local needs path, git needs url', () => {
    assert.equal(validateSourceInput('local', { path: '/x' }), null);
    assert.match(validateSourceInput('local', {}), /path/);
    assert.equal(validateSourceInput('git', { url: 'g' }), null);
    assert.match(validateSourceInput('git', {}), /url/);
    assert.match(validateSourceInput('github', {}), /unsupported/);
});

test('buildSourceEntry: builds local and git entries; git ref omitted when blank', () => {
    assert.deepEqual(buildSourceEntry('local', { label: 'L', path: '../x' }),
        { type: 'local', label: 'L', path: '../x' });
    assert.deepEqual(buildSourceEntry('git', { label: 'G', url: 'git@h:o/r.git' }),
        { type: 'git', label: 'G', url: 'git@h:o/r.git' });
    assert.deepEqual(buildSourceEntry('git', { label: 'G', url: 'git@h:o/r.git', ref: 'v2' }),
        { type: 'git', label: 'G', url: 'git@h:o/r.git', ref: 'v2' });
    assert.throws(() => buildSourceEntry('github', { label: 'X' }), (e) => e.code === 'INVALID_INPUT');
});

// ---------------------------------------------------------------------------
// addSourceEntry / removeSourceEntry / writeSources
// ---------------------------------------------------------------------------

test('addSourceEntry: adds immutably, rejects reserved key and duplicates', () => {
    const doc = { sources: { a: { type: 'local', path: '/a' } } };
    const next = addSourceEntry(doc, 'b', { type: 'local', path: '/b' });
    assert.deepEqual(Object.keys(next.sources), ['a', 'b']);
    assert.deepEqual(doc.sources, { a: { type: 'local', path: '/a' } }); // unchanged
    assert.throws(() => addSourceEntry(doc, 'public', {}), (e) => e.code === 'INVALID_INPUT');
    assert.throws(() => addSourceEntry(doc, 'a', {}), (e) => e.code === 'CONFLICT');
});

test('removeSourceEntry: removes immutably and no-ops when absent', () => {
    const doc = { sources: { a: { type: 'local', path: '/a' }, b: { type: 'local', path: '/b' } } };
    const next = removeSourceEntry(doc, 'a');
    assert.deepEqual(Object.keys(next.sources), ['b']);
    assert.deepEqual(Object.keys(doc.sources), ['a', 'b']); // unchanged
    assert.deepEqual(removeSourceEntry(doc, 'ghost').sources, doc.sources);
});

test('writeSources + readSourcesFile: round-trip', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-brand-'));
    writeSources(root, { sources: { acme: { type: 'git', url: 'g' } }, default: 'acme' });
    const back = readSourcesFile(root);
    assert.equal(back.default, 'acme');
    assert.equal(back.sources.acme.url, 'g');
    rm(root);
});

// ---------------------------------------------------------------------------
// createProvider + LocalRootProvider (local)
// ---------------------------------------------------------------------------

test('createProvider: throws INVALID_INPUT on unknown type', () => {
    assert.throws(() => createProvider({ type: 'nope' }), (e) => e.code === 'INVALID_INPUT');
});

test('LocalRootProvider (local): reads json/text and materializes from disk', async () => {
    const src = makeSourceDir();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-out-'));
    const provider = createProvider({ type: 'local', path: src }, { brandRoot: '/ignored' });

    const manifest = await provider.readJson('templates.json');
    assert.equal(selectableTemplates(manifest)[0].slug, 'olympus');
    assert.equal(await provider.readText('src/olympus/page.html'), '<h1>olympus</h1>');

    const dest = path.join(out, 'olympus');
    assert.equal(await provider.materialize('olympus', dest), 2);
    provider.dispose(); // no-op for local
    assert.equal(fs.existsSync(src), true); // local root not deleted
    rm(src); rm(out);
});

test('LocalRootProvider: rethrows non-ENOENT read errors as-is', async () => {
    // templates.json is a directory → reading it as a file yields EISDIR, which
    // must propagate unchanged (only ENOENT is translated).
    const src = makeSourceDir();
    fs.rmSync(path.join(src, 'templates.json'));
    fs.mkdirSync(path.join(src, 'templates.json'));
    const provider = createProvider({ type: 'local', path: src }, {});
    await assert.rejects(provider.readJson('templates.json'), (e) => e.code === 'EISDIR');
    provider.dispose();
    rm(src);
});

test('resolveLocalRoot: expands ~, resolves against brandRoot, throws on missing', () => {
    const home = os.homedir();
    assert.equal(resolveLocalRoot({ path: '~' }, {}), home);
    const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-brand-'));
    fs.mkdirSync(path.join(brand, 'tpl'));
    assert.equal(resolveLocalRoot({ path: 'tpl' }, { brandRoot: brand }), path.join(brand, 'tpl'));
    assert.throws(() => resolveLocalRoot({ path: 'missing' }, { brandRoot: brand }),
        (e) => e.code === 'UPSTREAM_FETCH_FAILED');
    rm(brand);
});

// ---------------------------------------------------------------------------
// cloneToTemp + git provider (injected exec — no real network)
// ---------------------------------------------------------------------------

test('cloneToTemp: builds shallow-clone args, omitting --branch when no ref', async () => {
    let captured;
    const tmp = await cloneToTemp({ url: 'git@h:o/r.git' }, { exec: (args) => { captured = args; } });
    assert.deepEqual(captured.slice(0, 3), ['clone', '--depth', '1']);
    assert.ok(captured.includes('--single-branch'));
    assert.ok(!captured.includes('--branch'));
    assert.equal(captured[captured.length - 2], 'git@h:o/r.git');
    assert.equal(captured[captured.length - 1], tmp);
    rm(tmp);
});

test('cloneToTemp: adds --branch when ref is set', async () => {
    let captured;
    const tmp = await cloneToTemp({ url: 'g', ref: 'v1.2.0' }, { exec: (args) => { captured = args; } });
    const i = captured.indexOf('--branch');
    assert.ok(i >= 0);
    assert.equal(captured[i + 1], 'v1.2.0');
    rm(tmp);
});

test('cloneToTemp: maps ENOENT to a "git not installed" error and cleans up', async () => {
    await assert.rejects(
        cloneToTemp({ url: 'g' }, { exec: () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; } }),
        (e) => e.code === 'UPSTREAM_FETCH_FAILED' && /git is not installed/.test(e.message)
    );
});

test('git provider: clones via injected exec, reads + materializes, dispose removes clone', async () => {
    // exec populates the temp clone dir like a real clone would.
    const exec = (args) => {
        const dir = args[args.length - 1];
        const olympus = path.join(dir, 'src', 'olympus');
        fs.mkdirSync(olympus, { recursive: true });
        fs.writeFileSync(path.join(dir, 'templates.json'), JSON.stringify({ templates: [{ slug: 'olympus', name: 'O' }] }));
        fs.writeFileSync(path.join(olympus, 'page.html'), 'cl, ');
    };
    const provider = createProvider({ type: 'git', url: 'git@h:o/r.git' }, { exec });
    const manifest = await provider.readJson('templates.json');
    assert.equal(manifest.templates[0].slug, 'olympus');

    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-out-'));
    const n = await provider.materialize('olympus', path.join(out, 'olympus'));
    assert.equal(n, 1);

    // The clone is acquired once and cached: a second read does not re-clone.
    let calls = 0;
    const p2 = createProvider({ type: 'git', url: 'g' }, { exec: (a) => { calls++; exec(a); } });
    await p2.readJson('templates.json');
    await p2.readJson('templates.json');
    assert.equal(calls, 1);
    p2.dispose();

    provider.dispose();
    rm(out);
});

// ---------------------------------------------------------------------------
// PublicProvider (injected fetchBuffer — no real network)
// ---------------------------------------------------------------------------

test('PublicProvider: builds raw/codeload URLs and reads/materializes', async () => {
    const tarball = buildFixtureTarball();
    const seen = [];
    const fetchBuffer = async (url) => {
        seen.push(url);
        if (url.endsWith('templates.json')) return Buffer.from(JSON.stringify({ templates: [{ slug: 'olympus', name: 'O' }] }));
        if (url.endsWith('notes.md')) return Buffer.from('# notes');
        if (url.includes('codeload') && url.includes('tar.gz')) return tarball;
        throw new Error(`unexpected url ${url}`);
    };
    const provider = createProvider({ ...BUILTIN_PUBLIC }, { fetchBuffer });

    const manifest = await provider.readJson('templates.json');
    assert.equal(manifest.templates[0].slug, 'olympus');
    assert.match(seen[0], /^https:\/\/raw\.githubusercontent\.com\/NextCommerceCo\/.+\/main\/templates\.json$/);

    assert.equal(await provider.readText('notes.md'), '# notes');

    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-out-'));
    assert.equal(await provider.materialize('olympus', path.join(out, 'olympus')), 1);
    assert.ok(seen.some(u => u.includes('codeload') && u.includes('/main')));
    provider.dispose();
    rm(out);
});

// ---------------------------------------------------------------------------
// validateSourceHasTemplates (one path for every type)
// ---------------------------------------------------------------------------

test('validateSourceHasTemplates: ok for a local source with a usable catalog', async () => {
    const src = makeSourceDir();
    const res = await validateSourceHasTemplates({ type: 'local', path: src }, {});
    assert.deepEqual(res, { ok: true, count: 2 });
    rm(src);
});

test('validateSourceHasTemplates: not ok when catalog is empty', async () => {
    const src = makeSourceDir({ templates: { templates: [] } });
    const res = await validateSourceHasTemplates({ type: 'local', path: src }, {});
    assert.equal(res.ok, false);
    assert.match(res.reason, /no selectable templates/);
    rm(src);
});

test('validateSourceHasTemplates: not ok when templates.json is missing', async () => {
    const src = makeSourceDir({ templates: null });
    const res = await validateSourceHasTemplates({ type: 'local', path: src }, {});
    assert.equal(res.ok, false);
    rm(src);
});
