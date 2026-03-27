const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parsePort } = require('../lib/actions/dev');

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
// parsePort — invalid input falls back to 3000
// ---------------------------------------------------------------------------

test('parsePort: falls back to 3000 for non-numeric -p value', () => {
    assert.equal(parsePort(['node', 'dev.js', '-p', 'abc']), 3000);
});

test('parsePort: falls back to 3000 for non-numeric --port= value', () => {
    assert.equal(parsePort(['node', 'dev.js', '--port=abc']), 3000);
});

test('parsePort: falls back to 3000 for non-numeric PORT env var', () => {
    const original = process.env.PORT;
    process.env.PORT = 'notanumber';
    assert.equal(parsePort(['node', 'dev.js']), 3000);
    if (original !== undefined) process.env.PORT = original;
    else delete process.env.PORT;
});
