/**
 * Shared Configuration for Campaign Builder
 *
 * Provides default paths and configuration resolution for CLI tools and plugins.
 */

const path = require('path');
const fs = require('fs');

/**
 * Get the project root directory (current working directory)
 */
function getProjectRoot() {
    return process.cwd();
}

/**
 * Get the path to campaigns.json
 */
function getCampaignsPath(customPath) {
    if (customPath) return path.resolve(customPath);
    return path.join(getProjectRoot(), '_data', 'campaigns.json');
}

/**
 * Get the source directory path
 */
function getSrcPath(customPath) {
    if (customPath) return path.resolve(customPath);
    return path.join(getProjectRoot(), 'src');
}

/**
 * Get the output directory path
 */
function getOutputPath(customPath) {
    if (customPath) return path.resolve(customPath);
    return path.join(getProjectRoot(), '_site');
}

/**
 * Get the CPK artifacts directory path (developer-only, not deployed).
 * Used for funnel.json, funnel.html, and other build artifacts.
 */
function getCpkPath(customPath) {
    if (customPath) return path.resolve(customPath);
    return path.join(getProjectRoot(), '.cpk');
}

/**
 * Load campaigns data from campaigns.json.
 * Returns a key-based object: { "slug": { name, description, ... } }
 */
function loadCampaigns(customPath) {
    const campaignsPath = getCampaignsPath(customPath);

    if (!fs.existsSync(campaignsPath)) {
        throw new Error(`Campaigns file not found: ${campaignsPath}`);
    }

    const data = JSON.parse(fs.readFileSync(campaignsPath, 'utf8'));
    return data;
}

/**
 * Save campaigns data to campaigns.json.
 * Accepts a key-based object: { "slug": { name, description, ... } }
 */
function saveCampaigns(campaigns, customPath) {
    const campaignsPath = getCampaignsPath(customPath);
    fs.writeFileSync(campaignsPath, JSON.stringify(campaigns, null, 2), 'utf8');
}

/**
 * Convert a key-based campaigns object to an array with slug injected.
 * { "my-campaign": { name: "..." } } → [{ slug: "my-campaign", name: "..." }]
 */
function campaignsArray(campaigns) {
    return Object.entries(campaigns).map(([slug, data]) => ({ slug, ...data }));
}

/**
 * Convert old array-based campaigns.json to key-based format.
 *
 * Input:  { campaigns: [{ slug: "foo", name: "Foo" }, ...] }
 * Output: { foo: { name: "Foo" }, ... }
 *
 * Returns null if the data is already in key-based format.
 * Throws if any entry is missing a "slug" field.
 *
 * @param {object} data - Parsed campaigns.json content
 * @returns {object|null}
 */
function convertCampaignsFormat(data) {
    if (!Array.isArray(data.campaigns)) return null;

    const converted = {};
    for (const campaign of data.campaigns) {
        const { slug, ...rest } = campaign;
        if (!slug) {
            throw new Error(`A campaign entry is missing a "slug" field: ${JSON.stringify(campaign)}`);
        }
        converted[slug] = rest;
    }
    return converted;
}

/**
 * Get full configuration object
 */
function getConfig(options = {}) {
    return {
        projectRoot: getProjectRoot(),
        campaignsPath: getCampaignsPath(options.campaignsPath),
        srcPath: getSrcPath(options.srcPath),
        outputPath: getOutputPath(options.outputPath),
        ...options
    };
}

module.exports = {
    getProjectRoot,
    getCampaignsPath,
    getSrcPath,
    getOutputPath,
    getCpkPath,
    loadCampaigns,
    saveCampaigns,
    campaignsArray,
    convertCampaignsFormat,
    getConfig
};
