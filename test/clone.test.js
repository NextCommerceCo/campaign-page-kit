const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildCloneData } = require('../lib/actions/clone');

// ---------------------------------------------------------------------------
// buildCloneData — pure unit tests
// ---------------------------------------------------------------------------

test('buildCloneData: copies all source keys to the clone', () => {
    const source = {
        name: 'Olympus',
        description: 'Original',
        sdk_version: '0.3.7',
        phone_intl: '+18888316810',
        phone_pretty: '1 (888) 831-6810',
    };
    const result = buildCloneData(source, { name: 'Olympus V2', description: 'Copy' });
    assert.equal(result.sdk_version, '0.3.7');
    assert.equal(result.phone_intl, '+18888316810');
    assert.equal(result.phone_pretty, '1 (888) 831-6810');
});

test('buildCloneData: overrides name and description', () => {
    const source = { name: 'Original', description: 'Old desc', sdk_version: '1.0' };
    const result = buildCloneData(source, { name: 'New Name', description: 'New desc' });
    assert.equal(result.name, 'New Name');
    assert.equal(result.description, 'New desc');
    assert.equal(result.sdk_version, '1.0');
});

test('buildCloneData: does not mutate the source', () => {
    const source = { name: 'Original', description: 'Old', extra: 'data' };
    buildCloneData(source, { name: 'Clone', description: 'Copy' });
    assert.equal(source.name, 'Original');
    assert.equal(source.description, 'Old');
});

test('buildCloneData: works with minimal source (name only)', () => {
    const source = { name: 'Simple' };
    const result = buildCloneData(source, { name: 'Simple V2', description: 'Copy of Simple' });
    assert.deepEqual(result, { name: 'Simple V2', description: 'Copy of Simple' });
});
