/**
 * Campaign build pipeline.
 *
 * Discovers all HTML pages in src/, renders them with LiquidJS, writes output
 * to _site/, and copies campaign assets.
 */

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const { parseFrontmatter } = require('../frontmatter');
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
 * @param {boolean}  [opts.verbose]    - Print debug diagnostics to stderr.
 *
 * @returns {Promise<object>} Build summary:
 *   - built, errors, skipped — page counts by outcome
 *   - warnings — total warning entries across all pages
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
    const verbose = Boolean(opts.verbose);
    const start = Date.now();

    // Discover HTML pages, excluding layouts and includes.
    // opts.files can be an explicit list (partial rebuild) or undefined (full discovery).
    const files = opts.files !== undefined
        ? opts.files
        : await fg('**/*.html', {
            cwd: srcPath,
            ignore: ['**/_layouts/**', '**/_includes/**'],
        });

    let built = 0;
    let errors = 0;
    let skipped = 0;
    const pages = [];
    const seenOutputs = new Map(); // resolved outputFile → inputFile that claimed it

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
            const { data: frontmatter, content: body } = parseFrontmatter(raw);

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

            const relOut = path.relative(process.cwd(), outputFile);
            logger.debug(`Writing \x1b[90m${relOut}\x1b[0m from \x1b[90m${relFile}\x1b[0m`, { enabled: verbose });
            built++;
        } catch (e) {
            page.status = 'error';
            page.errors.push({ code: `${stage}_ERROR`, message: e.message });
            logger.error(`${relFile}: ${e.message}`);
            errors++;
        }
    }

    // Copy assets: src/[slug]/assets/ → _site/[slug]/
    for (const slug of Object.keys(campaigns)) {
        const assetSrc = path.join(srcPath, slug, 'assets');
        const assetDst = path.join(outputPath, slug);
        if (fs.existsSync(assetSrc)) {
            await fs.promises.cp(assetSrc, assetDst, { recursive: true });
        }
    }

    const ms = Date.now() - start;
    const warnings = pages.reduce((n, p) => n + p.warnings.length, 0);
    return { built, errors, warnings, skipped, ms, pages };
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
