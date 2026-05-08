#!/usr/bin/env node

const config = require('./config');
const logger = require('./logger');
const { runDevServer } = require('./actions/dev');
const { runCompress } = require('./actions/compress');
const { runClone } = require('./actions/clone');
const { runConfigure } = require('./actions/configure');

async function main() {
    const { intro, select, isCancel } = await import('@clack/prompts');

    const campaigns = config.loadCampaigns();

    logger.banner();
    intro('Next Campaign Page Kit');

    const action = await select({
        message: 'What would you like to do?',
        options: [
            { value: 'start',     label: 'Start campaign',     hint: 'local dev server' },
            { value: 'compress',  label: 'Compress assets',     hint: 'optimise images' },
            { value: 'clone',     label: 'Clone campaign',      hint: 'copy an existing campaign' },
            { value: 'configure', label: 'Configure campaign',  hint: 'set API key' },
        ],
    });

    if (isCancel(action)) process.exit(0);

    if (action === 'start') {
        await runDevServer(campaigns);
    } else if (action === 'compress') {
        await runCompress(campaigns, false);
    } else if (action === 'clone') {
        await runClone(campaigns);
    } else if (action === 'configure') {
        await runConfigure(campaigns);
    }
}

main().catch(err => {
    logger.error(err.message);
    process.exit(1);
});
