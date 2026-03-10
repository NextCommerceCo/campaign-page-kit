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
const projectConfig = require('../config');

const logger = require('../logger');

/**
 * Build all campaigns.
 *
 * @param {object} opts
 * @param {string}   [opts.srcPath]    - Source directory (defaults to project src/)
 * @param {string}   [opts.outputPath] - Output directory (defaults to _site/)
 * @param {object[]} [opts.campaigns]  - Campaign list (defaults to campaigns.json)
 * @param {Liquid}   [opts.engine]     - Existing LiquidJS engine (created if omitted)
 */
async function build(opts = {}) {
    const srcPath = opts.srcPath || projectConfig.getSrcPath();
    const outputPath = opts.outputPath || projectConfig.getOutputPath();
    const campaigns = opts.campaigns || projectConfig.loadCampaigns();
    const engine = opts.engine || createEngine(srcPath);
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

            const html = await renderPage(engine, { body, frontmatter, campaign, pageData, layoutSrc });

            fs.mkdirSync(path.dirname(outputFile), { recursive: true });
            fs.writeFileSync(outputFile, html, 'utf8');

            const relOut = path.relative(process.cwd(), outputFile);
            logger.debug(`Writing \x1b[90m${relOut}\x1b[0m from \x1b[90m${relFile}\x1b[0m`);
            built++;
        } catch (e) {
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
    return { built, errors, ms };
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
