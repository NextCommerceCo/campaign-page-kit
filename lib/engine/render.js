/**
 * LiquidJS rendering engine for campaign pages.
 *
 * Creates a configured LiquidJS instance with campaign-aware filters and tags,
 * and provides a renderPage function that handles two-pass rendering:
 * page body first, then injected into the campaign layout.
 */

const { Liquid } = require('liquidjs');
const logger = require('../logger');

/**
 * Create a configured LiquidJS engine for a project's src directory.
 * Filters access campaign context via `this.get()` (LiquidJS Context).
 */
function createEngine(srcPath) {
    const engine = new Liquid({
        root: srcPath,
        extname: '.html',
        cache: false,
    });

    // campaign_asset — resolves asset filenames to campaign-prefixed paths
    engine.registerFilter('campaign_asset', function (filename) {
        if (!filename) return '';
        if (/^https?:\/\//.test(filename)) return filename;
        const campaign = this.context.get(['campaign']);
        if (!campaign) return filename;
        return `/${campaign.slug}/${filename}`;
    });

    // campaign_link — generates clean URLs for inter-page navigation
    engine.registerFilter('campaign_link', function (filename) {
        if (!filename) return '';
        if (filename.startsWith('#')) return filename;
        if (filename.startsWith('/')) return filename;
        if (/^https?:\/\//.test(filename)) return filename;
        const campaign = this.context.get(['campaign']);
        if (!campaign) return filename;
        const clean = filename.replace(/\.html$/, '');
        if (clean === 'index') return `/${campaign.slug}/`;
        return `/${campaign.slug}/${clean}/`;
    });

    // safe — no-op filter for compatibility with templates that use | safe
    engine.registerFilter('safe', (value) => value);

    // campaign_include — renders a partial from the campaign's _includes directory
    engine.registerTag('campaign_include', {
        parse(tagToken) {
            this.args = tagToken.args;
        },

        * render(ctx, emitter) {
            const campaign = ctx.get(['campaign']);
            if (!campaign) return;

            const match = this.args.match(/^\s*(['"])([^'"]+)\1/);
            if (!match) return;
            const filename = match[2];
            const fullPath = `${campaign.slug}/_includes/${filename}`;

            const includeCtx = {};
            const argsRegex = /(\w+)=("[^"]*"|'[^']*'|[^\s]+)/g;
            let argMatch;
            while ((argMatch = argsRegex.exec(this.args)) !== null) {
                const key = argMatch[1];
                const rawValue = argMatch[2];
                let val;
                if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
                    val = rawValue.slice(1, -1);
                } else if (rawValue === 'true') {
                    val = true;
                } else if (rawValue === 'false') {
                    val = false;
                } else {
                    val = yield engine.evalValue(rawValue, ctx);
                }
                includeCtx[key] = val;
            }

            try {
                const templates = yield engine.parseFile(fullPath);
                ctx.push({ ...includeCtx, include: includeCtx });
                yield engine.renderer.renderTemplates(templates, ctx, emitter);
            } catch (e) {
                logger.error(`campaign_include: ${fullPath} — ${e.message}`);
            } finally {
                ctx.pop();
            }
        }
    });

    return engine;
}

/**
 * Render a single page: body first, then wrapped in layout.
 *
 * @param {Liquid} engine
 * @param {object} opts
 * @param {string} opts.body        - Raw template source (after frontmatter)
 * @param {object} opts.frontmatter - Parsed frontmatter data
 * @param {object} opts.campaign    - Campaign data object
 * @param {object} opts.pageData    - Page metadata ({ url, inputPath })
 * @param {string} opts.layoutPath  - Absolute path to layout file
 * @param {string} opts.environment - Environment flag ("development" or "production")
 */
async function renderPage(engine, { body, frontmatter, campaign, pageData, layoutSrc, environment }) {
    const context = {
        ...frontmatter,
        campaign,
        page: pageData,
        environment,
    };

    // Pass 1: render page body
    const renderedBody = await engine.parseAndRender(body, context);

    // Pass 2: wrap in layout
    if (layoutSrc) {
        return engine.parseAndRender(layoutSrc, { ...context, content: renderedBody });
    }

    return renderedBody;
}

module.exports = { createEngine, renderPage };
