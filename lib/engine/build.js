/**
 * Campaign build pipeline.
 *
 * Discovers all HTML pages in src/, renders them with LiquidJS, writes output
 * to _site/, and copies campaign assets.
 *
 * Files under src/[slug]/assets/ are assets, never pages: they are copied to
 * _site/[slug]/ as they are. A full build (no explicit file list) then removes
 * every other file under _site/[slug]/ for each campaign it built, so a page
 * whose source was removed or renamed does not stay served from an earlier
 * build. Removal runs after the writes, so an interrupted build leaves the
 * previous output in place rather than an empty directory.
 */

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const matter = require('gray-matter');
const { createEngine, renderPage } = require('./render');
const projectConfig = require('../config');

const logger = require('../logger');

const PAGE_TYPES = ['product', 'checkout', 'upsell', 'receipt'];

/**
 * Build all campaigns.
 *
 * @param {object} opts
 * @param {string}   [opts.srcPath]    - Source directory (defaults to project src/)
 * @param {string}   [opts.outputPath] - Output directory (defaults to _site/)
 * @param {object[]} [opts.campaigns]  - Campaign list (defaults to campaigns.json)
 * @param {Liquid}   [opts.engine]     - Existing LiquidJS engine (created if omitted)
 * @param {string}   [opts.mode]       - Environment mode (defaults to CPK_ENV or "production")
 *
 * @returns {Promise<object>} Build summary:
 *   - built, errors, skipped — page counts by outcome
 *   - warnings — total warning entries across all pages and assetWarnings
 *   - assetWarnings — { code, file, outputFile, message } for asset files the
 *       copy serves as pages (an .html file under assets/)
 *   - ms — elapsed milliseconds
 *   - pages — per-page entries for this invocation's files:
 *       inputFile / outputFile (cwd-relative; outputFile null if resolution failed),
 *       campaignSlug, url (root-relative URL path, e.g. "/my-campaign/checkout/",
 *       same value templates see as page.url; null if resolution failed),
 *       status ("built" | "error" | "skipped"),
 *       warnings / errors (arrays of { code, message })
 */
async function build(opts = {}) {
    const srcPath = opts.srcPath || projectConfig.getSrcPath();
    const outputPath = opts.outputPath || projectConfig.getOutputPath();
    const campaigns = opts.campaigns || projectConfig.loadCampaigns();
    const engine = opts.engine || createEngine(srcPath);
    const environment = opts.mode || process.env.CPK_ENV || 'production';
    const start = Date.now();

    // Discover HTML pages, excluding layouts, includes and assets.
    // opts.files can be an explicit list (partial rebuild) or undefined (full discovery).
    const fullBuild = opts.files === undefined;
    const files = (fullBuild
        ? await fg('**/*.html', {
            cwd: srcPath,
            ignore: ['**/_layouts/**', '**/_includes/**'],
        })
        : opts.files).filter((relFile) => !isAssetFile(relFile, campaigns));

    let built = 0;
    let errors = 0;
    let skipped = 0;
    const pages = [];
    const seenOutputs = new Map(); // resolved outputFile → inputFile that claimed it
    const written = new Set(); // absolute paths this build wrote, for pruning

    for (const relFile of files) {
        const filePath = path.join(srcPath, relFile);
        const page = {
            inputFile: path.relative(process.cwd(), filePath),
            campaignSlug: relFile.split('/')[0],
            url: null,
            outputFile: null,
            status: 'built',
            warnings: [],
            errors: [],
        };
        pages.push(page);

        const pageWarn = (code, message) => {
            page.warnings.push({ code, message });
            logger.warn(`${relFile}: ${message}`);
        };

        // Tracks how far the page got, so a failure is reported with a code
        // naming the failed step (READ_ERROR, FRONTMATTER_ERROR, ...).
        let stage = 'READ';

        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            stage = 'FRONTMATTER';
            const { data: frontmatter, content: body } = matter(raw);

            // Derive campaign slug from path: src/[slug]/page.html
            const campaignSlug = relFile.split('/')[0];
            const campaignData = campaigns[campaignSlug];
            const campaign = campaignData ? { slug: campaignSlug, ...campaignData } : null;

            if (!campaign) {
                page.status = 'skipped';
                page.warnings.push({ code: 'NO_CAMPAIGN', message: `no campaign found for slug "${campaignSlug}"` });
                logger.warn(`Skipping ${relFile} — no campaign found for slug "${campaignSlug}"`);
                skipped++;
                continue;
            }

            stage = 'RESOLVE';
            const { url, outputFile } = resolveOutput(relFile, frontmatter, outputPath);
            page.url = url;
            page.outputFile = path.relative(process.cwd(), outputFile);
            const pageData = { url, inputPath: filePath };

            collectPageWarnings(pageWarn, relFile, frontmatter);

            if (seenOutputs.has(outputFile)) {
                pageWarn('DUPLICATE_OUTPUT', `output file collides with ${seenOutputs.get(outputFile)} — last write wins`);
            } else {
                seenOutputs.set(outputFile, page.inputFile);
            }

            stage = 'RENDER';
            const layoutFile = frontmatter.page_layout || 'base.html';
            const layoutPath = path.join(srcPath, campaignSlug, '_layouts', layoutFile);
            const layoutSrc = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, 'utf8') : null;

            if (frontmatter.page_layout && layoutSrc === null) {
                pageWarn('LAYOUT_NOT_FOUND', `declared page_layout "${frontmatter.page_layout}" not found in ${campaignSlug}/_layouts/ — page renders without a layout`);
            }

            const html = await renderPage(engine, { body, frontmatter, campaign, pageData, layoutSrc, environment });

            stage = 'WRITE';
            fs.mkdirSync(path.dirname(outputFile), { recursive: true });
            fs.writeFileSync(outputFile, html, 'utf8');

            written.add(path.resolve(outputFile));
            const relOut = path.relative(process.cwd(), outputFile);
            logger.debug(`Writing \x1b[90m${relOut}\x1b[0m from \x1b[90m${relFile}\x1b[0m`);
            built++;
        } catch (e) {
            page.status = 'error';
            page.errors.push({ code: `${stage}_ERROR`, message: e.message });
            logger.error(`${relFile}: ${e.message}`);
            errors++;
        }
    }

    // Copy assets: src/[slug]/assets/ → _site/[slug]/
    const assetWarnings = [];
    for (const slug of Object.keys(campaigns)) {
        const assetSrc = path.join(srcPath, slug, 'assets');
        const assetDst = path.join(outputPath, slug);
        if (fs.existsSync(assetSrc)) {
            await fs.promises.cp(assetSrc, assetDst, { recursive: true });
            for (const rel of await fg('**/*', { cwd: assetSrc, dot: true })) {
                written.add(path.resolve(assetDst, rel));
            }
            // An HTML file under assets/ is copied unrendered and served as a
            // page at its path (assets/design/index.html at /[slug]/design/).
            // That is rarely intended: it is usually a design export kept for
            // reference, and it ships with that tool's markup.
            for (const rel of await fg('**/*.html', { cwd: assetSrc })) {
                const file = path.relative(process.cwd(), path.join(assetSrc, rel));
                const outputFile = path.relative(process.cwd(), path.join(assetDst, rel));
                const message = `HTML file under assets/ is copied unrendered and served as ${outputFile} — move it out of src/ if it is a design reference`;
                assetWarnings.push({ code: 'ASSET_HTML', file, outputFile, message });
                logger.warn(`${path.join(slug, 'assets', rel)}: ${message}`);
            }
        }
    }

    // A full build owns _site/[slug]/: remove what this build did not write,
    // so output from an earlier build whose source is gone is not served.
    if (fullBuild) {
        for (const slug of Object.keys(campaigns)) {
            const campaignOut = path.join(outputPath, slug);
            if (isInside(outputPath, campaignOut)) pruneUnwritten(campaignOut, written);
        }
    }

    const ms = Date.now() - start;
    const warnings = pages.reduce((n, p) => n + p.warnings.length, 0) + assetWarnings.length;
    return { built, errors, warnings, skipped, ms, pages, assetWarnings };
}

/**
 * Whether a src/-relative path is an asset of a known campaign
 * (src/[slug]/assets/...). A file under an unknown slug stays in the page
 * list, where it is reported as NO_CAMPAIGN rather than silently dropped.
 */
function isAssetFile(relFile, campaigns) {
    const [slug, dir] = relFile.split(/[\\/]/);
    return dir === 'assets' && Object.prototype.hasOwnProperty.call(campaigns, slug);
}

/**
 * Remove files under dir that are not in keep, then any directories left
 * empty. Returns nothing; a missing dir is a no-op.
 */
function pruneUnwritten(dir, keep) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.resolve(dir, entry.name);
        if (entry.isDirectory()) {
            pruneUnwritten(full, keep);
            if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        } else if (!keep.has(full)) {
            fs.rmSync(full, { force: true });
        }
    }
}

function isInside(parent, child) {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Non-fatal checks on a page's file placement and frontmatter.
 * Each finding is reported through pageWarn(code, message).
 */
function collectPageWarnings(pageWarn, relFile, frontmatter) {
    const parts = relFile.split('/');

    if (parts.length > 2 && !frontmatter.permalink) {
        pageWarn('NESTED_NO_PERMALINK', `nested page file without permalink — routing uses the filename only, intermediate directories are ignored`);
    }

    if (!frontmatter.title) {
        pageWarn('MISSING_FRONTMATTER', 'missing required frontmatter: title');
    }

    if (!frontmatter.page_type) {
        pageWarn('MISSING_FRONTMATTER', 'missing required frontmatter: page_type');
    } else if (!PAGE_TYPES.includes(frontmatter.page_type)) {
        pageWarn('INVALID_PAGE_TYPE', `invalid page_type "${frontmatter.page_type}" — expected one of: ${PAGE_TYPES.join(', ')}`);
    }
}

/**
 * Resolve output URL and file path for a source file.
 *
 * src/my-campaign/presell.html → { url: '/my-campaign/presell/', outputFile: '_site/my-campaign/presell/index.html' }
 * src/my-campaign/index.html  → { url: '/my-campaign/',          outputFile: '_site/my-campaign/index.html' }
 */
function resolveOutput(relFile, frontmatter, outputPath) {
    if (frontmatter.permalink) {
        const permalink = frontmatter.permalink.replace(/^\/|\/$/g, '');
        return {
            url: `/${permalink}/`,
            outputFile: path.join(outputPath, permalink, 'index.html'),
        };
    }

    const parts = relFile.split('/');
    const campaignSlug = parts[0];
    const filename = parts[parts.length - 1].replace(/\.html$/, '');

    if (filename === 'index') {
        return {
            url: `/${campaignSlug}/`,
            outputFile: path.join(outputPath, campaignSlug, 'index.html'),
        };
    }

    return {
        url: `/${campaignSlug}/${filename}/`,
        outputFile: path.join(outputPath, campaignSlug, filename, 'index.html'),
    };
}

module.exports = { build, resolveOutput };
