#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');
const { prepareRuntime } = require('../campaign-runtime');

function configureCampaign(campaigns, slug, apiKey, { srcPath = config.getSrcPath(), campaignsPath } = {}) {
    if (!String(apiKey || '').trim()) throw new Error('API key cannot be empty');
    if (!campaigns[slug]) throw new Error(`campaign not found: ${slug}`);
    // A failed key write must leave the static-preview gate in place.
    prepareRuntime(path.join(srcPath, slug), { apiKey });
    const next = { ...campaigns, [slug]: { ...campaigns[slug] } };
    delete next[slug].preview_mode;
    config.saveCampaigns(next, campaignsPath);
    return next;
}

async function runConfigure(campaigns) {
    const { select, text, isCancel, log, outro } = await import('@clack/prompts');
    const list = config.campaignsArray(campaigns);

    const slug = await select({
        message: 'Select a campaign',
        options: list.map(c => ({
            value: c.slug,
            label: c.name,
            hint: `/${c.slug}/`,
        })),
    });
    if (isCancel(slug)) process.exit(0);

    const selectedCampaign = { slug, ...campaigns[slug] };

    const apiKey = await text({
        message: 'API key',
        placeholder: 'your-api-key',
        validate: (v) => {
            if (!v.trim()) return 'API key cannot be empty';
        },
    });
    if (isCancel(apiKey)) process.exit(0);

    const srcPath = config.getSrcPath();
    const configPath = path.join(srcPath, selectedCampaign.slug, 'assets', 'config.js');

    if (!fs.existsSync(configPath)) {
        logger.error(`config file not found: ${configPath}`);
        process.exit(1);
    }

    configureCampaign(campaigns, slug, apiKey);

    log.success('API key updated; connected runtime enabled on the next build');
    outro(`Updated src/${selectedCampaign.slug}/assets/config.js`);
}

async function main() {
    const { intro } = await import('@clack/prompts');
    const campaigns = config.loadCampaigns();
    logger.banner();
    intro('Next Campaign Page Kit — configure campaign');
    await runConfigure(campaigns);
}

if (require.main === module) {
    main().catch(err => {
        logger.error(err.message);
        process.exit(1);
    });
}

module.exports = { runConfigure, configureCampaign };
