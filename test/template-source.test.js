const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { EventEmitter } = require('events');

const {
    BUILTIN_PUBLIC,
    fetchBuffer,
    countFiles,
    copySubtree,
    extractTemplate,
    selectableTemplates,
    GithubProvider,
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
// GithubProvider (injected fetchBuffer — no real network)
// ---------------------------------------------------------------------------

test('GithubProvider: builds raw/codeload URLs and reads/materializes', async () => {
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

// ---------------------------------------------------------------------------
// fetchBuffer (injected `get` — exercises redirect/status/error branches
// without real network)
// ---------------------------------------------------------------------------

// Build a fake https.get: maps url -> { status, headers, chunks } or a request
// error. Synthesizes a response EventEmitter and a request EventEmitter.
function fakeGet(plans) {
    return (url, cb) => {
        const plan = plans[url];
        const req = new EventEmitter();
        if (!plan) { process.nextTick(() => req.emit('error', new Error(`no plan for ${url}`))); return req; }
        if (plan.requestError) { process.nextTick(() => req.emit('error', plan.requestError)); return req; }
        const res = new EventEmitter();
        res.statusCode = plan.status;
        res.headers = plan.headers || {};
        res.resume = () => {};
        process.nextTick(() => {
            cb(res);
            if (plan.status === 200) {
                for (const c of (plan.chunks || [])) res.emit('data', Buffer.from(c));
                res.emit('end');
            }
        });
        return req;
    };
}

test('fetchBuffer: resolves a 200 body as a Buffer', async () => {
    const get = fakeGet({ 'https://x/t': { status: 200, chunks: ['he', 'llo'] } });
    const buf = await fetchBuffer('https://x/t', 5, get);
    assert.equal(buf.toString(), 'hello');
});

test('fetchBuffer: follows a redirect to the location, then 200', async () => {
    const get = fakeGet({
        'https://x/a': { status: 302, headers: { location: 'https://x/b' } },
        'https://x/b': { status: 200, chunks: ['final'] },
    });
    const buf = await fetchBuffer('https://x/a', 5, get);
    assert.equal(buf.toString(), 'final');
});

test('fetchBuffer: rejects "too many redirects" when the budget is exhausted', async () => {
    const get = fakeGet({ 'https://x/loop': { status: 302, headers: { location: 'https://x/loop' } } });
    await assert.rejects(fetchBuffer('https://x/loop', 0, get), /too many redirects/);
});

test('fetchBuffer: rejects on a non-200 status', async () => {
    const get = fakeGet({ 'https://x/missing': { status: 404 } });
    await assert.rejects(fetchBuffer('https://x/missing', 5, get), /HTTP 404/);
});

test('fetchBuffer: rejects on a request error', async () => {
    const get = fakeGet({ 'https://x/boom': { requestError: new Error('socket hang up') } });
    await assert.rejects(fetchBuffer('https://x/boom', 5, get), /socket hang up/);
});

// ---------------------------------------------------------------------------
// defaultGitExec — real `git clone` of a local repo (no injection), covering
// the production git path end to end.
// ---------------------------------------------------------------------------

function makeGitRepo() {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-gitrepo-'));
    execSync('git init -q', { cwd: repo });
    fs.mkdirSync(path.join(repo, 'src', 'olympus'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'templates.json'), JSON.stringify({ templates: [{ slug: 'olympus', name: 'O' }] }));
    fs.writeFileSync(path.join(repo, 'src', 'olympus', 'page.html'), '<h1>o</h1>');
    execSync('git add -A && git -c user.email=a@b.c -c user.name=x commit -qm init', { cwd: repo });
    return repo;
}

test('cloneToTemp: really clones a local repo via the default git exec', async () => {
    const repo = makeGitRepo();
    const tmp = await cloneToTemp({ url: `file://${repo}` }, {}); // no ctx.exec → real git
    assert.equal(fs.existsSync(path.join(tmp, 'templates.json')), true);
    assert.equal(fs.existsSync(path.join(tmp, 'src', 'olympus', 'page.html')), true);
    rm(tmp); rm(repo);
});

test('cloneToTemp: rejects UPSTREAM_FETCH_FAILED when the real clone fails', async () => {
    await assert.rejects(
        cloneToTemp({ url: 'file:///cpk/definitely/not/a/repo' }, {}),
        (e) => e.code === 'UPSTREAM_FETCH_FAILED' && /git clone failed/.test(e.message)
    );
});

// ---------------------------------------------------------------------------
// Defensive-branch coverage (guards / fallbacks)
// ---------------------------------------------------------------------------

test('extractTemplate: throws when the tarball has no top-level directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-tar-'));
    fs.writeFileSync(path.join(root, 'loose.txt'), 'x');
    const tarball = execSync('tar -czf - loose.txt', { cwd: root });
    rm(root);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-out-'));
    assert.throws(() => extractTemplate(tarball, 'olympus', path.join(out, 'x')), /no top-level directory/);
    rm(out);
});

test('selectableTemplates: falls back to slug when name is missing', () => {
    const r = selectableTemplates({ templates: [{ slug: 'zeta' }, { slug: 'alpha' }] });
    assert.deepEqual(r.map(t => t.slug), ['alpha', 'zeta']);
});

test('resolveLocalRoot: empty path resolves to brandRoot', () => {
    const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-brand-'));
    assert.equal(resolveLocalRoot({}, { brandRoot: brand }), brand);
    rm(brand);
});

test('cloneToTemp: surfaces err.message when the failure has no stderr', async () => {
    await assert.rejects(
        cloneToTemp({ url: 'g' }, { exec: () => { throw new Error('boom'); } }),
        (e) => e.code === 'UPSTREAM_FETCH_FAILED' && /git clone failed: boom/.test(e.message)
    );
});

test('createProvider(github): defaults fetchBuffer when none is injected', () => {
    const p = createProvider({ ...BUILTIN_PUBLIC });
    assert.ok(p instanceof GithubProvider);
});

test('LocalRootProvider.dispose: swallows a throwing cleanup', async () => {
    const src = makeSourceDir();
    const p = new LocalRootProvider(() => ({ root: src, cleanup: () => { throw new Error('boom'); } }));
    await p.readJson('templates.json'); // acquire
    assert.doesNotThrow(() => p.dispose());
    rm(src);
});

test('readSourcesFile: tolerates a file with no sources key', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-brand-'));
    fs.mkdirSync(path.join(root, '_data'));
    fs.writeFileSync(path.join(root, '_data', 'template-sources.json'), '{"default":"public"}');
    assert.deepEqual(readSourcesFile(root), { default: 'public', sources: {} });
    rm(root);
});

test('validateSourceInput: tolerates missing fields object', () => {
    assert.match(validateSourceInput('local'), /path/);
});

test('buildSourceEntry: defaults label to empty when omitted', () => {
    assert.deepEqual(buildSourceEntry('local', { path: '/x' }), { type: 'local', label: '', path: '/x' });
});

test('addSourceEntry/removeSourceEntry/writeSources: tolerate a doc without a sources map', () => {
    assert.deepEqual(Object.keys(addSourceEntry({}, 'k', { type: 'local', label: 'L', path: '/x' }).sources), ['k']);
    assert.deepEqual(removeSourceEntry({}, 'k').sources, {});
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-brand-'));
    writeSources(root, {});
    assert.deepEqual(readSourcesFile(root).sources, {});
    rm(root);
});
