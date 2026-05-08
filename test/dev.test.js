const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parsePort, normalizeEntryUrl, buildDevUrl, validateEntryUrl } = require('../lib/actions/dev');

// ---------------------------------------------------------------------------
// Helpers — stub logger.error and process.exit for validation tests
// ---------------------------------------------------------------------------

function withValidationStubs(fn) {
    const logger = require('../lib/logger');
    const origError = logger.error;
    const origExit = process.exit;
    let errorMsg = '';
    let exited = false;
    logger.error = (msg) => { errorMsg = msg; };
    process.exit = () => { exited = true; };
    try {
        fn({ getError: () => errorMsg, didExit: () => exited });
    } finally {
        logger.error = origError;
        process.exit = origExit;
    }
}

// ---------------------------------------------------------------------------
// parsePort — CLI flags
// ---------------------------------------------------------------------------

test('parsePort: returns 3000 by default when no args or env', () => {
    const original = process.env.PORT;
    delete process.env.PORT;
    assert.equal(parsePort(['node', 'dev.js']), 3000);
    if (original !== undefined) process.env.PORT = original;
});

test('parsePort: parses -p flag', () => {
    assert.equal(parsePort(['node', 'dev.js', '-p', '8080']), 8080);
});

test('parsePort: parses --port flag', () => {
    assert.equal(parsePort(['node', 'dev.js', '--port', '9090']), 9090);
});

test('parsePort: parses --port=VALUE syntax', () => {
    assert.equal(parsePort(['node', 'dev.js', '--port=4000']), 4000);
});

test('parsePort: -p flag takes precedence over PORT env var', () => {
    const original = process.env.PORT;
    process.env.PORT = '5555';
    assert.equal(parsePort(['node', 'dev.js', '-p', '7777']), 7777);
    if (original !== undefined) process.env.PORT = original;
    else delete process.env.PORT;
});

test('parsePort: --port flag takes precedence over PORT env var', () => {
    const original = process.env.PORT;
    process.env.PORT = '5555';
    assert.equal(parsePort(['node', 'dev.js', '--port', '7777']), 7777);
    if (original !== undefined) process.env.PORT = original;
    else delete process.env.PORT;
});

// ---------------------------------------------------------------------------
// parsePort — PORT environment variable
// ---------------------------------------------------------------------------

test('parsePort: reads PORT env var when no flags provided', () => {
    const original = process.env.PORT;
    process.env.PORT = '4200';
    assert.equal(parsePort(['node', 'dev.js']), 4200);
    if (original !== undefined) process.env.PORT = original;
    else delete process.env.PORT;
});

// ---------------------------------------------------------------------------
// parsePort — bare positional number (e.g. `npm run dev 3333`)
// ---------------------------------------------------------------------------

test('parsePort: parses bare number as positional arg', () => {
    assert.equal(parsePort(['node', 'dev.js', '3333']), 3333);
});

test('parsePort: -p flag takes precedence over positional number', () => {
    assert.equal(parsePort(['node', 'dev.js', '-p', '8080']), 8080);
});

test('parsePort: ignores bare number that is not the first positional arg', () => {
    const original = process.env.PORT;
    delete process.env.PORT;
    assert.equal(parsePort(['node', 'dev.js', '--verbose', '3333']), 3000);
    if (original !== undefined) process.env.PORT = original;
});

test('parsePort: positional number takes precedence over PORT env var', () => {
    const original = process.env.PORT;
    process.env.PORT = '5555';
    assert.equal(parsePort(['node', 'dev.js', '3333']), 3333);
    if (original !== undefined) process.env.PORT = original;
    else delete process.env.PORT;
});

// ---------------------------------------------------------------------------
// parsePort — validation errors
// ---------------------------------------------------------------------------

test('parsePort: exits with error for -p without a value', () => {
    withValidationStubs(({ getError, didExit }) => {
        parsePort(['node', 'dev.js', '-p']);
        assert.ok(didExit());
        assert.match(getError(), /Invalid port value/);
        assert.match(getError(), /1 and 65535/);
    });
});

test('parsePort: exits with error for non-numeric -p value', () => {
    withValidationStubs(({ getError, didExit }) => {
        parsePort(['node', 'dev.js', '-p', 'abc']);
        assert.ok(didExit());
        assert.match(getError(), /Invalid port value "abc"/);
    });
});

test('parsePort: exits with error for non-numeric --port= value', () => {
    withValidationStubs(({ getError, didExit }) => {
        parsePort(['node', 'dev.js', '--port=abc']);
        assert.ok(didExit());
        assert.match(getError(), /Invalid port value "abc"/);
    });
});

test('parsePort: exits with error for port out of range (0)', () => {
    withValidationStubs(({ getError, didExit }) => {
        parsePort(['node', 'dev.js', '-p', '0']);
        assert.ok(didExit());
        assert.match(getError(), /Invalid port value/);
    });
});

test('parsePort: exits with error for port out of range (99999)', () => {
    withValidationStubs(({ getError, didExit }) => {
        parsePort(['node', 'dev.js', '-p', '99999']);
        assert.ok(didExit());
        assert.match(getError(), /Invalid port value/);
    });
});

test('parsePort: exits with error for out-of-range positional arg', () => {
    withValidationStubs(({ getError, didExit }) => {
        parsePort(['node', 'dev.js', '99999']);
        assert.ok(didExit());
        assert.match(getError(), /Invalid port value/);
    });
});

test('parsePort: exits with error for non-numeric PORT env var', () => {
    const original = process.env.PORT;
    process.env.PORT = 'notanumber';
    withValidationStubs(({ getError, didExit }) => {
        parsePort(['node', 'dev.js']);
        assert.ok(didExit());
        assert.match(getError(), /Invalid PORT environment variable/);
    });
    if (original !== undefined) process.env.PORT = original;
    else delete process.env.PORT;
});

test('parsePort: exits with error for out-of-range PORT env var', () => {
    const original = process.env.PORT;
    process.env.PORT = '99999';
    withValidationStubs(({ getError, didExit }) => {
        parsePort(['node', 'dev.js']);
        assert.ok(didExit());
        assert.match(getError(), /Invalid PORT environment variable/);
    });
    if (original !== undefined) process.env.PORT = original;
    else delete process.env.PORT;
});

// ---------------------------------------------------------------------------
// parsePort — edge cases (valid boundaries)
// ---------------------------------------------------------------------------

test('parsePort: accepts port 1 (minimum valid)', () => {
    assert.equal(parsePort(['node', 'dev.js', '-p', '1']), 1);
});

test('parsePort: accepts port 65535 (maximum valid)', () => {
    assert.equal(parsePort(['node', 'dev.js', '-p', '65535']), 65535);
});

// ---------------------------------------------------------------------------
// normalizeEntryUrl — campaign entry_url normalization
// ---------------------------------------------------------------------------

test('normalizeEntryUrl: returns empty string for undefined', () => {
    assert.equal(normalizeEntryUrl(undefined), '');
});

test('normalizeEntryUrl: returns empty string for null', () => {
    assert.equal(normalizeEntryUrl(null), '');
});

test('normalizeEntryUrl: returns empty string for empty string', () => {
    assert.equal(normalizeEntryUrl(''), '');
});

test('normalizeEntryUrl: returns empty string for whitespace', () => {
    assert.equal(normalizeEntryUrl('   '), '');
});

test('normalizeEntryUrl: returns empty string for non-string input', () => {
    assert.equal(normalizeEntryUrl(42), '');
    assert.equal(normalizeEntryUrl({}), '');
});

test('normalizeEntryUrl: appends trailing slash to bare page name', () => {
    assert.equal(normalizeEntryUrl('presell'), 'presell/');
});

test('normalizeEntryUrl: strips .html extension', () => {
    assert.equal(normalizeEntryUrl('presell.html'), 'presell/');
});

test('normalizeEntryUrl: strips .HTML extension case-insensitively', () => {
    assert.equal(normalizeEntryUrl('Presell.HTML'), 'Presell/');
});

test('normalizeEntryUrl: strips leading slash', () => {
    assert.equal(normalizeEntryUrl('/presell'), 'presell/');
});

test('normalizeEntryUrl: strips trailing slash', () => {
    assert.equal(normalizeEntryUrl('presell/'), 'presell/');
});

test('normalizeEntryUrl: strips both leading and trailing slashes', () => {
    assert.equal(normalizeEntryUrl('/presell/'), 'presell/');
});

test('normalizeEntryUrl: preserves nested path segments', () => {
    assert.equal(normalizeEntryUrl('checkout/step-1'), 'checkout/step-1/');
});

// ---------------------------------------------------------------------------
// buildDevUrl — combines port, slug, and entry_url
// ---------------------------------------------------------------------------

test('buildDevUrl: returns campaign root when entry_url is missing', () => {
    assert.equal(buildDevUrl(3000, 'my-campaign'), 'http://localhost:3000/my-campaign/?debugger=true');
});

test('buildDevUrl: appends entry_url page', () => {
    assert.equal(buildDevUrl(3000, 'my-campaign', 'presell'), 'http://localhost:3000/my-campaign/presell/?debugger=true');
});

test('buildDevUrl: appends entry_url with .html extension stripped', () => {
    assert.equal(buildDevUrl(8080, 'drift-v1', 'landing.html'), 'http://localhost:8080/drift-v1/landing/?debugger=true');
});

test('buildDevUrl: always appends ?debugger=true so the campaign cart SDK debug toolbar shows locally', () => {
    assert.match(buildDevUrl(3000, 'my-campaign'), /\?debugger=true$/);
    assert.match(buildDevUrl(3000, 'my-campaign', 'presell'), /\?debugger=true$/);
    assert.match(buildDevUrl(3000, 'my-campaign', 'checkout/step-1'), /\?debugger=true$/);
});

test('buildDevUrl: merges existing query string in entry_url with debugger flag', () => {
    assert.equal(
        buildDevUrl(3000, 'my-campaign', 'presell?utm_source=google'),
        'http://localhost:3000/my-campaign/presell/?utm_source=google&debugger=true'
    );
});

test('buildDevUrl: handles entry_url with multiple query params', () => {
    assert.equal(
        buildDevUrl(3000, 'my-campaign', '/presell/?utm_source=google&utm_medium=cpc'),
        'http://localhost:3000/my-campaign/presell/?utm_source=google&utm_medium=cpc&debugger=true'
    );
});

test('buildDevUrl: trailing ? on entry_url does not produce empty query segment', () => {
    assert.equal(
        buildDevUrl(3000, 'my-campaign', 'presell?'),
        'http://localhost:3000/my-campaign/presell/?debugger=true'
    );
});

// ---------------------------------------------------------------------------
// validateEntryUrl — checks entry_url resolves to a real source page
// ---------------------------------------------------------------------------

function makeFixtureSrc(pages) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-dev-test-'));
    const srcPath = path.join(root, 'src');
    for (const rel of pages) {
        const full = path.join(srcPath, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, '<!doctype html>');
    }
    return { srcPath, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('validateEntryUrl: returns null when entry_url is undefined', () => {
    const { srcPath, cleanup } = makeFixtureSrc(['my-campaign/presell.html']);
    try { assert.equal(validateEntryUrl(srcPath, 'my-campaign', undefined), null); }
    finally { cleanup(); }
});

test('validateEntryUrl: returns null when entry_url is empty', () => {
    const { srcPath, cleanup } = makeFixtureSrc(['my-campaign/presell.html']);
    try { assert.equal(validateEntryUrl(srcPath, 'my-campaign', ''), null); }
    finally { cleanup(); }
});

test('validateEntryUrl: returns null when target page exists', () => {
    const { srcPath, cleanup } = makeFixtureSrc(['my-campaign/presell.html']);
    try { assert.equal(validateEntryUrl(srcPath, 'my-campaign', 'presell'), null); }
    finally { cleanup(); }
});

test('validateEntryUrl: returns null when target page exists with .html', () => {
    const { srcPath, cleanup } = makeFixtureSrc(['my-campaign/landing.html']);
    try { assert.equal(validateEntryUrl(srcPath, 'my-campaign', 'landing.html'), null); }
    finally { cleanup(); }
});

test('validateEntryUrl: returns null for nested page that exists', () => {
    const { srcPath, cleanup } = makeFixtureSrc(['my-campaign/checkout/step-1.html']);
    try { assert.equal(validateEntryUrl(srcPath, 'my-campaign', 'checkout/step-1'), null); }
    finally { cleanup(); }
});

test('validateEntryUrl: strips query string before matching the source page', () => {
    const { srcPath, cleanup } = makeFixtureSrc(['my-campaign/presell.html']);
    try { assert.equal(validateEntryUrl(srcPath, 'my-campaign', 'presell?test=value'), null); }
    finally { cleanup(); }
});

test('validateEntryUrl: returns error when target page is missing', () => {
    const { srcPath, cleanup } = makeFixtureSrc(['my-campaign/presell.html']);
    try {
        const err = validateEntryUrl(srcPath, 'my-campaign', 'landing');
        assert.match(err, /entry_url "landing"/);
        assert.match(err, /my-campaign/);
        assert.match(err, /landing\.html/);
    } finally { cleanup(); }
});

test('validateEntryUrl: returns error when slug directory does not exist', () => {
    const { srcPath, cleanup } = makeFixtureSrc(['other/presell.html']);
    try {
        const err = validateEntryUrl(srcPath, 'my-campaign', 'presell');
        assert.match(err, /entry_url "presell"/);
    } finally { cleanup(); }
});
