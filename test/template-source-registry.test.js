const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_SOURCE,
    FAMILY_SOURCES,
    resolveTemplateSource,
    isPrivateFamily,
} = require('../lib/template-source-registry');

// ---------------------------------------------------------------------------
// resolveTemplateSource — public default
// ---------------------------------------------------------------------------

test('resolveTemplateSource: empty/unknown family resolves to the public default', () => {
    for (const family of ['', undefined, null, 'olympus', 'demeter', 'totally-unknown']) {
        const src = resolveTemplateSource(family);
        assert.equal(src.repo, DEFAULT_SOURCE.repo);
        assert.equal(src.ref, DEFAULT_SOURCE.ref);
        assert.equal(src.private, false);
        assert.match(src.templates_url, /raw\.githubusercontent\.com\/NextCommerceCo\/campaign-cart-starter-templates\/main\/templates\.json$/);
        assert.match(src.tarball_url_anonymous, /codeload\.github\.com\/NextCommerceCo\/campaign-cart-starter-templates\/tar\.gz\/refs\/heads\/main$/);
    }
});

test('resolveTemplateSource: trims whitespace around the family key', () => {
    assert.equal(resolveTemplateSource('  arjuna  ').repo, FAMILY_SOURCES.arjuna.repo);
});

// ---------------------------------------------------------------------------
// resolveTemplateSource — private arjuna override
// ---------------------------------------------------------------------------

test('resolveTemplateSource: arjuna resolves to the private adsbranded repo', () => {
    const src = resolveTemplateSource('arjuna');
    assert.equal(src.repo, 'Sellmore-Co/adsbranded-templates');
    assert.equal(src.ref, 'main');
    assert.equal(src.private, true);
    // Private tarball uses the authenticated api.github.com endpoint.
    assert.match(src.tarball_url, /api\.github\.com\/repos\/Sellmore-Co\/adsbranded-templates\/tarball\/main$/);
    assert.match(src.campaigns_url, /Sellmore-Co\/adsbranded-templates\/main\/_data\/campaigns\.json$/);
});

test('isPrivateFamily: only flags registered private families', () => {
    assert.equal(isPrivateFamily('arjuna'), true);
    assert.equal(isPrivateFamily('olympus'), false);
    assert.equal(isPrivateFamily(''), false);
});

test('FAMILY_SOURCES is frozen (single source of truth, not mutable at runtime)', () => {
    assert.equal(Object.isFrozen(FAMILY_SOURCES), true);
    assert.equal(Object.isFrozen(FAMILY_SOURCES.arjuna), true);
    const before = FAMILY_SOURCES.arjuna.repo;
    try { FAMILY_SOURCES.arjuna = { repo: 'evil/repo' }; } catch { /* strict-mode throw is fine too */ }
    assert.equal(FAMILY_SOURCES.arjuna.repo, before);
});
