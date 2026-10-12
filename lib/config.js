/**
 * Shared Configuration for Campaign Builder
 *
 * Provides default paths and configuration resolution for CLI tools and plugins.
 */

const path = require('path');
const fs = require('fs');

const PAGE_TYPES = ['product', 'checkout', 'upsell', 'receipt'];
const LAYOUTS_DIR = '_layouts';
const INCLUDES_DIR = '_includes';
const ASSETS_DIR = 'assets';
// Globs under src/ whose .html files are never pages.
const IGNORED_PAGE_GLOBS = [`**/${LAYOUTS_DIR}/**`, `**/${INCLUDES_DIR}/**`, `*/${ASSETS_DIR}/**`];
// File types under assets/ that are never copied to _site/.
const IGNORED_ASSET_EXTENSIONS = new Set(['.html']);
// File types the compress command processes.
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
// Content-Type the dev server sends per file type.
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain',
};

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
    PAGE_TYPES,
    LAYOUTS_DIR,
    INCLUDES_DIR,
    ASSETS_DIR,
    IGNORED_PAGE_GLOBS,
    IGNORED_ASSET_EXTENSIONS,
    IMAGE_EXTENSIONS,
    MIME_TYPES,
    getProjectRoot,
    getCampaignsPath,
    getSrcPath,
    getOutputPath,
    loadCampaigns,
    saveCampaigns,
    campaignsArray,
    convertCampaignsFormat,
    getConfig
};
