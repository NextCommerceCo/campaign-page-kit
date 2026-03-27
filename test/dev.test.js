const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parsePort } = require('../lib/actions/dev');

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
