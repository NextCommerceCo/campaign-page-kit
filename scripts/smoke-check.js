#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../lib/config');

const root = config.getProjectRoot();
const srcPath = config.getSrcPath();

// Load campaigns.json
let campaigns;
try {
    campaigns = config.loadCampaigns();
} catch (e) {
    console.error(`smoke-check: ${e.message}`);
    process.exit(1);
}

const slugs = Object.keys(campaigns);

if (slugs.length === 0) {
    const folder = path.relative(root, srcPath) || 'src';
    console.error(`No campaigns found. Expected {folder}/src/{slug}/ directories under repo root.`);
    process.exit(1);
}

let ok = true;

for (const slug of slugs) {
    const dir = path.join(srcPath, slug);
    if (!fs.existsSync(dir)) {
        console.error(`smoke-check: missing source directory for campaign "${slug}": ${path.relative(root, dir)}`);
        ok = false;
    }
}

if (!ok) process.exit(1);

console.log(`smoke-check: ${slugs.length} campaign${slugs.length !== 1 ? 's' : ''} found (${slugs.join(', ')})`);
