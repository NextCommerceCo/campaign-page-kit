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
const { generateFunnelMap, writeFunnelJson } = require('./funnel');
const { writeFunnelHtml } = require('./funnel-visual');
const projectConfig = require('../config');

const logger = require('../logger');

/**
 * Build all campaigns.
 *
 * @param {object} opts
 * @param {string}   [opts.srcPath]    - Source directory (defaults to project src/)
 * @param {string}   [opts.outputPath] - Output directory (defaults to _site/)
 * @param {string}   [opts.cpkPath]    - CPK artifacts directory (defaults to .cpk/)
 * @param {object[]} [opts.campaigns]  - Campaign list (defaults to campaigns.json)
 * @param {Liquid}   [opts.engine]     - Existing LiquidJS engine (created if omitted)
 * @param {string}   [opts.mode]       - Environment mode (defaults to CPK_ENV or "production")
 * @param {boolean}  [opts.lenient]    - Downgrade funnel validation errors to warnings
 * @returns {Promise<{built: number, errors: number, funnelErrors: number, ms: number}>}
 */
async function build(opts = {}) {
    const srcPath = opts.srcPath || projectConfig.getSrcPath();
    const outputPath = opts.outputPath || projectConfig.getOutputPath();
    const cpkPath = opts.cpkPath || projectConfig.getCpkPath();
    const campaigns = opts.campaigns || projectConfig.loadCampaigns();
    const engine = opts.engine || createEngine(srcPath);
    const environment = opts.mode || process.env.CPK_ENV || 'production';
    const lenient = opts.lenient ?? false;
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

    // Accumulate page data per campaign for funnel map generation
    const campaignPages = new Map();

    for (const relFile of files) {
        const filePath = path.join(srcPath, relFile);

        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            const { data: frontmatter, content: body } = matter(raw);

            // Derive campaign slug from path: src/[slug]/page.html
            const campaignSlug = relFile.split('/')[0];
            const campaignData = campaigns[campaignSlug];
            const campaign = campaignData ? { slug: campaignSlug, ...campaignData } : null;

            if (!campaign) {
                logger.warn(`Skipping ${relFile} — no campaign found for slug "${campaignSlug}"`);
                continue;
            }

            const { url, outputFile } = resolveOutput(relFile, frontmatter, outputPath);
            const pageData = { url, inputPath: filePath };

            const layoutFile = frontmatter.page_layout || 'base.html';
            const layoutPath = path.join(srcPath, campaignSlug, '_layouts', layoutFile);
            const layoutSrc = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, 'utf8') : null;

            const html = await renderPage(engine, { body, frontmatter, campaign, pageData, layoutSrc, environment });

            fs.mkdirSync(path.dirname(outputFile), { recursive: true });
            fs.writeFileSync(outputFile, html, 'utf8');

            const relOut = path.relative(process.cwd(), outputFile);
            logger.debug(`Writing \x1b[90m${relOut}\x1b[0m from \x1b[90m${relFile}\x1b[0m`);
            built++;

            // Collect page data for funnel map
            if (!campaignPages.has(campaignSlug)) {
                campaignPages.set(campaignSlug, []);
            }
            campaignPages.get(campaignSlug).push({ relFile, frontmatter, url });
        } catch (e) {
            logger.error(`${relFile}: ${e.message}`);
            errors++;
        }
    }

    // Generate funnel.json for each campaign.
    // Skip during partial rebuilds (opts.files set) since only a subset of pages
    // were processed and the graph would be incomplete. Regenerating would produce
    // a wrong funnel.json; deleting would break consumers. The dev server runs a
    // full build on startup, so funnel.json is always current at that point.
    const isPartialRebuild = opts.files !== undefined;
    let funnelErrors = 0;
    for (const [slug, pages] of isPartialRebuild ? [] : campaignPages) {
        const { json, errors: fErrors, warnings: fWarnings } = generateFunnelMap(slug, pages);

        if (lenient) {
            // Downgrade errors to warnings
            json.validation.warnings = [...json.validation.errors, ...json.validation.warnings];
            json.validation.errors = [];
            for (const w of fWarnings) {
                logger.warn(`Funnel [${slug}]: ${w}`);
            }
            for (const w of fErrors) {
                logger.warn(`Funnel [${slug}]: ${w}`);
            }
        } else {
            for (const e of fErrors) {
                logger.error(`Funnel [${slug}]: ${e}`);
            }
            for (const w of fWarnings) {
                logger.warn(`Funnel [${slug}]: ${w}`);
            }
            funnelErrors += fErrors.length;
        }

        writeFunnelJson(json, cpkPath, slug);

        // Generate funnel visual (never fatal, always warning-only)
        try {
            const htmlPath = writeFunnelHtml(json, cpkPath, slug);
            const relHtml = path.relative(process.cwd(), htmlPath);
            logger.info(`Funnel visual: \x1b[36m${relHtml}\x1b[0m`);
        } catch (e) {
            logger.warn(`Funnel visual generation failed for [${slug}]: ${e.message}`);
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
    return { built, errors, funnelErrors, ms };
}

/**
 * Resolve output URL and file path for a source file.
 *
 * src/my-campaign/presale.html → { url: '/my-campaign/presale/', outputFile: '_site/my-campaign/presale/index.html' }
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
