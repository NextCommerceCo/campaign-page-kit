const { test } = require('node:test');
const assert = require('node:assert/strict');

const { convertCampaignsFormat } = require('../lib/config');

// ---------------------------------------------------------------------------
// convertCampaignsFormat — pure unit tests
// ---------------------------------------------------------------------------

test('convertCampaignsFormat: returns null when already key-based', () => {
    const data = { 'test-campaign': { name: 'Test Campaign' } };
    assert.equal(convertCampaignsFormat(data), null);
});

test('convertCampaignsFormat: converts array format to key-based', () => {
    const data = {
        campaigns: [
            { slug: 'test-campaign', name: 'Test Campaign' },
            { slug: 'other-campaign', name: 'Other Campaign' },
        ],
    };
    const result = convertCampaignsFormat(data);
    assert.deepEqual(result, {
        'test-campaign': { name: 'Test Campaign' },
        'other-campaign': { name: 'Other Campaign' },
    });
});

test('convertCampaignsFormat: strips slug from campaign data', () => {
    const data = { campaigns: [{ slug: 'foo', name: 'Foo', description: 'Bar' }] };
    const result = convertCampaignsFormat(data);
    assert.ok(!('slug' in result['foo']), 'slug should not appear in value');
    assert.equal(result['foo'].name, 'Foo');
    assert.equal(result['foo'].description, 'Bar');
});

test('convertCampaignsFormat: handles empty campaigns array', () => {
    const data = { campaigns: [] };
    const result = convertCampaignsFormat(data);
    assert.deepEqual(result, {});
});

test('convertCampaignsFormat: throws when entry is missing slug', () => {
    const data = { campaigns: [{ name: 'No Slug Here' }] };
    assert.throws(() => convertCampaignsFormat(data), /slug/);
});

test('convertCampaignsFormat: preserves all extra fields', () => {
    const data = {
        campaigns: [{ slug: 'my-campaign', name: 'My Campaign', active: true, order: 3 }],
    };
    const result = convertCampaignsFormat(data);
    assert.deepEqual(result['my-campaign'], { name: 'My Campaign', active: true, order: 3 });
});
