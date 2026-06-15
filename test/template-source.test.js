const { test } = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_SOURCE, resolveTemplateSource } = require('../lib/template-source');

// ---------------------------------------------------------------------------
// resolveTemplateSource — public default (no overrides)
// ---------------------------------------------------------------------------

test('resolveTemplateSource: no overrides resolves to the public default', () => {
    for (const overrides of [undefined, null, {}, { repo: '   ' }]) {
        const src = resolveTemplateSource(overrides);
        assert.equal(src.repo, DEFAULT_SOURCE.repo);
        assert.equal(src.ref, DEFAULT_SOURCE.ref);
        assert.equal(src.source_path, 'src/');
        assert.equal(src.private, false);
        assert.match(src.templates_url, /raw\.githubusercontent\.com\/NextCommerceCo\/campaign-cart-starter-templates\/main\/templates\.json$/);
        assert.match(src.tarball_url_anonymous, /codeload\.github\.com\/NextCommerceCo\/campaign-cart-starter-templates\/tar\.gz\/main$/);
    }
});

// ---------------------------------------------------------------------------
// resolveTemplateSource — caller-supplied overrides (the agnostic mechanism)
// ---------------------------------------------------------------------------

test('resolveTemplateSource: applies repo/ref/path overrides and builds matching URLs', () => {
    const src = resolveTemplateSource({ repo: 'example-org/private-templates', ref: 'release', source_path: 'families/' });
    assert.equal(src.repo, 'example-org/private-templates');
    assert.equal(src.ref, 'release');
    assert.equal(src.source_path, 'families/');
    assert.match(src.templates_url, /example-org\/private-templates\/release\/templates\.json$/);
    assert.match(src.campaigns_url, /example-org\/private-templates\/release\/_data\/campaigns\.json$/);
    assert.match(src.tarball_url_anonymous, /codeload\.github\.com\/example-org\/private-templates\/tar\.gz\/release$/);
});

test('resolveTemplateSource: --private marks the source private + exposes the authed tarball', () => {
    const src = resolveTemplateSource({ repo: 'example-org/private-templates', private: true });
    assert.equal(src.private, true);
    // Authenticated tarball uses the api.github.com endpoint (honors a token).
    assert.match(src.tarball_url_authenticated, /api\.github\.com\/repos\/example-org\/private-templates\/tarball\/main$/);
    // The AI-context doc always points at the PUBLIC default, never the private
    // source (raw.githubusercontent.com would 404 for a private repo).
    assert.match(src.ai_context_doc_url, /raw\.githubusercontent\.com\/NextCommerceCo\/campaign-cart-starter-templates\/main\/docs\//);
});

test('resolveTemplateSource: unset override fields fall back to the public default', () => {
    const src = resolveTemplateSource({ private: true }); // repo/ref/path omitted
    assert.equal(src.repo, DEFAULT_SOURCE.repo);
    assert.equal(src.ref, DEFAULT_SOURCE.ref);
    assert.equal(src.source_path, DEFAULT_SOURCE.source_path);
    assert.equal(src.private, true);
});

test('resolveTemplateSource: holds no per-family knowledge (a bare slug is not a private trigger)', () => {
    // Passing a family-ish object with no `private` resolves PUBLIC — privateness
    // is an explicit caller decision, never inferred from a name.
    const src = resolveTemplateSource({ repo: 'example-org/anything' });
    assert.equal(src.private, false);
});

// ---------------------------------------------------------------------------
// resolveTemplateSource — input validation (trust boundary)
// ---------------------------------------------------------------------------

test('resolveTemplateSource: rejects malformed source repo', () => {
    for (const repo of ['../../etc/passwd', 'owner/repo?token=leak', 'owner', 'a/b/c', 'owner/..', 'own er/repo']) {
        assert.throws(() => resolveTemplateSource({ repo }), /invalid source repo/, `should reject ${repo}`);
    }
});

test('resolveTemplateSource: rejects path-traversal / absolute / backslash source_path', () => {
    for (const source_path of ['../../', '..', '/etc', '~/x', 'a/../../b', 'src\\foo', 'src\\..\\etc']) {
        assert.throws(() => resolveTemplateSource({ source_path }), /invalid source path/, `should reject ${JSON.stringify(source_path)}`);
    }
});

test('resolveTemplateSource: rejects traversal / bad chars in ref', () => {
    for (const ref of ['../evil', '/main', 'main/', 'a b', 'a;b']) {
        assert.throws(() => resolveTemplateSource({ ref }), /invalid source ref/, `should reject ${ref}`);
    }
});

test('resolveTemplateSource: accepts legitimate shapes (branches, tags, SHAs, nested subtrees)', () => {
    assert.doesNotThrow(() => resolveTemplateSource({ repo: 'Some-Org/private-templates.v2', ref: 'feature/foo', source_path: 'families/checkout/' }));
    assert.doesNotThrow(() => resolveTemplateSource({ ref: 'v1.2.3' }));                                  // tag
    assert.doesNotThrow(() => resolveTemplateSource({ ref: '0123456789abcdef0123456789abcdef01234567' })); // SHA
    assert.doesNotThrow(() => resolveTemplateSource()); // defaults must always pass
});

test('resolveTemplateSource: both tarball URLs take a plain ref (no refs/heads/ prefix)', () => {
    const src = resolveTemplateSource({ repo: 'o/r', ref: 'v2.0.0' });
    assert.match(src.tarball_url_anonymous, /\/tar\.gz\/v2\.0\.0$/);
    assert.match(src.tarball_url_authenticated, /\/tarball\/v2\.0\.0$/);
});

test('DEFAULT_SOURCE is frozen', () => {
    assert.equal(Object.isFrozen(DEFAULT_SOURCE), true);
    const before = DEFAULT_SOURCE.repo;
    try { DEFAULT_SOURCE.repo = 'evil/repo'; } catch { /* strict-mode throw is fine too */ }
    assert.equal(DEFAULT_SOURCE.repo, before);
});
