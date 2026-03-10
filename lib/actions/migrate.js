#!/usr/bin/env node

const fs = require('fs');
const config = require('../config');
const logger = require('../logger');
const { convertCampaignsFormat } = config;

const yes = process.argv.includes('--yes') || process.argv.includes('-y');

async function main() {
    const { intro, log, confirm, isCancel, outro } = await import('@clack/prompts');

    intro('Next Campaign Page Kit — migrate');

    const campaignsPath = config.getCampaignsPath();

    if (!fs.existsSync(campaignsPath)) {
        log.error(`campaigns.json not found at ${campaignsPath}`);
        process.exit(1);
    }

    const raw = JSON.parse(fs.readFileSync(campaignsPath, 'utf8'));

    // Already in new format
    const converted = convertCampaignsFormat(raw);
    if (converted === null) {
        log.success('campaigns.json is already in the key-based format. Nothing to migrate.');
        outro('Done.');
        return;
    }

    if (Object.keys(converted).length === 0) {
        log.warn('campaigns.json has an empty array. Converting to empty key-based format.');
        fs.writeFileSync(campaignsPath, JSON.stringify({}, null, 2), 'utf8');
        outro('Done.');
        return;
    }

    log.info(`Found ${Object.keys(converted).length} campaign(s) to migrate:`);
    for (const slug of Object.keys(converted)) {
        log.step(`  ${slug}: ${JSON.stringify(converted[slug])}`);
    }

    if (!yes) {
        const ok = await confirm({ message: 'Migrate campaigns.json to key-based format? (a backup will be saved)' });
        if (isCancel(ok) || !ok) {
            outro('Migration cancelled.');
            return;
        }
    }

    // Write backup
    const backupPath = campaignsPath.replace('.json', '.backup.json');
    fs.copyFileSync(campaignsPath, backupPath);
    log.success(`Backup saved to ${backupPath}`);

    // Write migrated file
    fs.writeFileSync(campaignsPath, JSON.stringify(converted, null, 2), 'utf8');
    log.success('campaigns.json migrated to key-based format.');

    outro('Migration complete. You can delete the backup file once you\'ve verified everything works.');
}

main().catch(err => {
    logger.error(err.message);
    process.exit(1);
});
