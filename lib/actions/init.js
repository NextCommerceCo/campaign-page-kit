#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const D = '\x1b[90m';
const R = '\x1b[0m';

const CAMPAIGNS_JSON = JSON.stringify({}, null, 2) + '\n';

const SCRIPTS = {
    'setup': 'campaign-init',
    'start': 'campaign-start',
    'dev': 'campaign-dev',
    'build': 'campaign-build',
    'clone': 'campaign-clone',
    'config': 'campaign-config',
    'compress': 'campaign-compress',
    'compress:preview': 'campaign-compress --preview',
    'migrate': 'campaign-migrate',
};

async function main() {
    const { intro, log, outro } = await import('@clack/prompts');

    intro('Next Campaign Page Kit — init');

    // package.json scripts
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        pkg.scripts = pkg.scripts || {};
        const missing = Object.entries(SCRIPTS).filter(([k]) => !pkg.scripts[k]);
        if (missing.length > 0) {
            missing.forEach(([k, v]) => { pkg.scripts[k] = v; });
            fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
            log.success(`added package.json scripts: ${D}${missing.map(([k]) => k).join(', ')}${R}`);
        } else {
            log.step('package.json scripts already present');
        }
    } else {
        log.warn(`no package.json found — run ${D}npm init -y${R} first`);
    }

    // _data/campaigns.json
    const campaignsDataPath = path.join(process.cwd(), '_data', 'campaigns.json');
    if (!fs.existsSync(campaignsDataPath)) {
        fs.mkdirSync(path.dirname(campaignsDataPath), { recursive: true });
        fs.writeFileSync(campaignsDataPath, CAMPAIGNS_JSON, 'utf8');
        log.success('created _data/campaigns.json');
    } else {
        log.step('_data/campaigns.json already exists');
    }

    outro(`Next steps:\n  1. Add campaigns to ${D}_data/campaigns.json${R}\n  2. Create ${D}src/{campaign-slug}/${R} with your campaign files\n  3. Run ${D}npm run dev${R} to start the dev server`);
}

main().catch(err => {
    logger.error(err.message);
    process.exit(1);
});
