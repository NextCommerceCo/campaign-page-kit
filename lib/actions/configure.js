#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');
const { prepareRuntime } = require('../campaign-runtime');

function configureCampaign(campaigns, slug, apiKey, { srcPath = config.getSrcPath(), campaignsPath } = {}) {
    if (!String(apiKey || '').trim()) throw new Error('API key cannot be empty');
    if (!campaigns[slug]) throw new Error(`campaign not found: ${slug}`);
    const next = { ...campaigns, [slug]: { ...campaigns[slug] } };
    delete next[slug].preview_mode;
    const campaignDir = path.join(srcPath, slug);
    const configPath = path.join(campaignDir, 'assets', 'config.js');
    const registryPath = config.getCampaignsPath(campaignsPath);
    let registryStaging;
    let configStaging;
    let runtimeTouched = false;
    let keepBackup = false;
    try {
        // Stage the registry without opening its preview gate. A rename commits
        // it only after the key write succeeds, so a failed save cannot leave a
        // truncated registry. Keep a same-directory backup for atomic rollback.
        registryStaging = fs.mkdtempSync(path.join(path.dirname(registryPath), '.cpk-config-'));
        const stagedRegistry = path.join(registryStaging, 'campaigns.json');
        config.saveCampaigns(next, stagedRegistry);
        if (fs.existsSync(registryPath)) fs.chmodSync(stagedRegistry, fs.statSync(registryPath).mode);
        configStaging = fs.mkdtempSync(path.join(path.dirname(configPath), '.cpk-config-'));
        const backupPath = path.join(configStaging, 'config.js');
        fs.copyFileSync(configPath, backupPath);
        runtimeTouched = true;
        prepareRuntime(campaignDir, { apiKey });
        fs.renameSync(stagedRegistry, registryPath);
    } catch (error) {
        if (runtimeTouched) {
            try {
                fs.renameSync(path.join(configStaging, 'config.js'), configPath);
            } catch (rollbackError) {
                keepBackup = true;
                throw new Error(`Campaign registry was not updated, but assets/config.js could not be restored. Original config retained at ${path.join(configStaging, 'config.js')}; inspect it before retrying.`, { cause: new AggregateError([error, rollbackError]) });
            }
        }
        throw error;
    } finally {
        if (registryStaging) fs.rmSync(registryStaging, { recursive: true, force: true });
        if (configStaging && !keepBackup) fs.rmSync(configStaging, { recursive: true, force: true });
    }
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
