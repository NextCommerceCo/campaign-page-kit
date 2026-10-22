/**
 * Campaign build pipeline.
 *
 * Discovers all HTML pages in src/, renders them with LiquidJS, writes output
 * to _site/, and copies campaign assets.
 */

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const matter = require('gray-matter');
const { createEngine, renderPage } = require('./render');
const { makeStaticPreview, PREVIEW_MESSAGE } = require('./preview');
const projectConfig = require('../config');

const logger = require('../logger');

const { PAGE_TYPES, LAYOUTS_DIR, ASSETS_DIR, IGNORED_PAGE_GLOBS, IGNORED_ASSET_EXTENSIONS } = projectConfig;

/**
 * Build all campaigns.
 *
 * @param {object} opts
 * @param {string}   [opts.srcPath]    - Source directory (defaults to project src/)
 * @param {string}   [opts.outputPath] - Output directory (defaults to _site/)
 * @param {object[]} [opts.campaigns]  - Campaign list (defaults to campaigns.json)
 * @param {Liquid}   [opts.engine]     - Existing LiquidJS engine (created if omitted)
 * @param {string}   [opts.mode]       - Environment mode (defaults to CPK_ENV or "production")
 * @param {boolean}  [opts.clean]      - Clean each campaign's output directory before building
 *
 * @returns {Promise<object>} Build summary:
 *   - built, errors, skipped — page counts by outcome
 *   - warnings — total warning entries across all pages and assetWarnings
 *   - assetWarnings — { code, file, message } for files under assets/ that were not copied
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

    // Clean _site/[slug]/ so output from an earlier build is not served.
    if (opts.clean) {
        for (const slug of Object.keys(campaigns)) {
            const campaignOut = path.resolve(outputPath, slug);
            if (path.dirname(campaignOut) === path.resolve(outputPath)) fs.rmSync(campaignOut, { recursive: true, force: true });
        }
    }

    // Discover HTML pages, excluding layouts, includes and assets.
    // opts.files can be an explicit list (partial rebuild) or undefined (full discovery).
    let files = opts.files !== undefined
        ? opts.files
        : await fg('**/*.html', {
            cwd: srcPath,
            ignore: IGNORED_PAGE_GLOBS,
        });

    // Preview navigation depends on the other pages in its campaign. Refresh
    // them together on a partial HTML rebuild instead of trusting stale output.
    const previewSlugs = new Set(files.map(file => file.split('/')[0]).filter(slug =>
        campaigns[slug] && Object.hasOwn(campaigns[slug], 'preview_mode') && campaigns[slug].preview_mode !== false));
    if (opts.files !== undefined && previewSlugs.size) {
        const discovered = await fg('**/*.html', { cwd: srcPath, ignore: IGNORED_PAGE_GLOBS });
        files = [...new Set([...files, ...discovered.filter(file => previewSlugs.has(file.split('/')[0]))])];
    }

    let built = 0;
    let errors = 0;
    let skipped = 0;
    const pages = [];
    const seenOutputs = new Map(); // resolved outputFile → inputFile that claimed it
    const writtenOutputs = new Map(); // final successful writer, including configured campaigns
    const previewPages = [];

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
            const layoutPath = path.join(srcPath, campaignSlug, LAYOUTS_DIR, layoutFile);
            const layoutSrc = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, 'utf8') : null;

            if (frontmatter.page_layout && layoutSrc === null) {
                pageWarn('LAYOUT_NOT_FOUND', `declared page_layout "${frontmatter.page_layout}" not found in ${campaignSlug}/${LAYOUTS_DIR}/ — page renders without a layout`);
            }

            let html = await renderPage(engine, { body, frontmatter, campaign, pageData, layoutSrc, environment });
            // A malformed marker in hand-edited registry data must not turn an
            // unconfigured preview into an active checkout. Only absent/false
            // opts out; retained non-boolean markers stay static with a warning.
            const preview = Object.hasOwn(campaign, 'preview_mode') && campaign.preview_mode !== false;
            const renderedHtml = html;
            if (preview) {
                if (campaign.preview_mode !== true) {
                    pageWarn('INVALID_PREVIEW_MODE', 'preview_mode must be a boolean; retaining the static preview because the marker is present.');
                }
                // Start with fragment-only navigation. Cross-page links are
                // enabled below only after their destinations were written inert.
                html = makeStaticPreview(html, { pageUrl: url });
                pageWarn('UNCONFIGURED_PREVIEW', PREVIEW_MESSAGE);
            }

            stage = 'WRITE';
            fs.mkdirSync(path.dirname(outputFile), { recursive: true });
            fs.writeFileSync(outputFile, html, 'utf8');
            writtenOutputs.set(outputFile, page);
            if (preview) previewPages.push({ page, outputFile, html: renderedHtml });

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

    const previewRoutes = new Map();
    for (const { page, outputFile } of previewPages) {
        if (writtenOutputs.get(outputFile) !== page) continue;
        let routes = previewRoutes.get(page.campaignSlug);
        if (!routes) previewRoutes.set(page.campaignSlug, routes = new Map());
        // Canonical URLs and their on-disk HTML form. Normalize familiar .html
        // links to these routes so they work on hosts without rewrite rules.
        for (const alias of [page.url, page.url.slice(0, -1), `${page.url}index.html`]) routes.set(alias, page.url);
    }
    for (const routes of previewRoutes.values()) {
        for (const url of new Set(routes.values())) {
            const alias = `${url.slice(0, -1)}.html`;
            if (!routes.has(alias)) routes.set(alias, url);
        }
    }
    for (const { page, outputFile, html } of previewPages) {
        if (writtenOutputs.get(outputFile) !== page) continue;
        try {
            fs.writeFileSync(outputFile, makeStaticPreview(html, {
                pageUrl: page.url, pageRoutes: previewRoutes.get(page.campaignSlug),
            }), 'utf8');
        } catch (error) {
            page.status = 'error';
            page.errors.push({ code: 'WRITE_ERROR', message: error.message });
            logger.error(`${page.inputFile}: ${error.message}`);
            built--;
            errors++;
        }
    }

    // Copy assets: src/[slug]/assets/ → _site/[slug]/
    const assetWarnings = [];
    for (const slug of Object.keys(campaigns)) {
        const assetSrc = path.join(srcPath, slug, ASSETS_DIR);
        const assetDst = path.join(outputPath, slug);
        if (fs.existsSync(assetSrc)) {
            await fs.promises.cp(assetSrc, assetDst, {
                recursive: true,
                filter: (file) => {
                    const ignored = IGNORED_ASSET_EXTENSIONS.has(path.extname(file).toLowerCase());
                    if (ignored) {
                        const message = `ignored, ${path.extname(file)} files under assets/ are not copied to _site/`;
                        assetWarnings.push({ code: 'ASSET_IGNORED', file: path.relative(process.cwd(), file), message });
                        logger.warn(`${path.relative(srcPath, file)}: ${message}`);
                    }
                    return !ignored;
                },
            });
        }
    }

    const ms = Date.now() - start;
    const warnings = pages.reduce((n, p) => n + p.warnings.length, 0) + assetWarnings.length;
    return { built, errors, warnings, skipped, ms, pages, assetWarnings };
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
