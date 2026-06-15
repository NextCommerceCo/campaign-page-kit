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
        assert.match(src.tarball_url_anonymous, /codeload\.github\.com\/NextCommerceCo\/campaign-cart-starter-templates\/tar\.gz\/refs\/heads\/main$/);
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
    assert.match(src.tarball_url_anonymous, /codeload\.github\.com\/example-org\/private-templates\/tar\.gz\/refs\/heads\/release$/);
});

test('resolveTemplateSource: --private marks the source private + exposes the authed tarball', () => {
    const src = resolveTemplateSource({ repo: 'example-org/private-templates', private: true });
    assert.equal(src.private, true);
    // Authenticated tarball uses the api.github.com endpoint (honors a token).
    assert.match(src.tarball_url_authenticated, /api\.github\.com\/repos\/example-org\/private-templates\/tarball\/main$/);
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

test('DEFAULT_SOURCE is frozen', () => {
    assert.equal(Object.isFrozen(DEFAULT_SOURCE), true);
    const before = DEFAULT_SOURCE.repo;
    try { DEFAULT_SOURCE.repo = 'evil/repo'; } catch { /* strict-mode throw is fine too */ }
    assert.equal(DEFAULT_SOURCE.repo, before);
});
