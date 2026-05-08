#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MIN_SAVINGS_BYTES = 1024;

const D = '\x1b[90m';
const G = '\x1b[32m';
const R = '\x1b[0m';

function collectImages(dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectImages(fullPath));
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (IMAGE_EXTENSIONS.has(ext)) results.push(fullPath);
        }
    }
    return results;
}

async function compressImage(sharp, filePath, preview = false) {
    const ext = path.extname(filePath).toLowerCase();
    const originalSize = fs.statSync(filePath).size;

    let pipeline = sharp(filePath);
    switch (ext) {
        case '.jpg':
        case '.jpeg': pipeline = pipeline.jpeg({ quality: 80, progressive: true }); break;
        case '.png':  pipeline = pipeline.png({ compressionLevel: 9, palette: true }); break;
        case '.webp': pipeline = pipeline.webp({ quality: 80 }); break;
        case '.gif':  pipeline = pipeline.gif(); break;
    }

    const compressedBuffer = await pipeline.toBuffer();
    const compressedSize = compressedBuffer.length;

    if (compressedSize >= originalSize || (originalSize - compressedSize) < MIN_SAVINGS_BYTES) {
        return { skipped: true, originalSize, compressedSize: originalSize, bytesSaved: 0 };
    }

    if (!preview) fs.writeFileSync(filePath, compressedBuffer);
    return { skipped: false, originalSize, compressedSize, bytesSaved: originalSize - compressedSize };
}

function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
}

function formatSaving(bytes) {
    return bytes === 0 ? '-' : '-' + formatSize(bytes);
}

async function runCompress(campaigns, preview = false) {
    const { select, isCancel, spinner, outro } = await import('@clack/prompts');

    let sharp;
    try {
        sharp = require('sharp');
    } catch (e) {
        logger.error('"sharp" package is required. Run: npm install sharp');
        process.exit(1);
    }

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
    const srcPath = config.getSrcPath();
    const campaignDir = path.join(srcPath, selectedCampaign.slug);

    if (!fs.existsSync(campaignDir)) {
        logger.error(`campaign directory not found: ${campaignDir}`);
        process.exit(1);
    }

    const scan = spinner();
    scan.start('Scanning for images…');
    const imagePaths = collectImages(campaignDir);
    scan.stop(`Found ${imagePaths.length} image${imagePaths.length !== 1 ? 's' : ''}`);

    if (imagePaths.length === 0) {
        outro('No images found.');
        return;
    }

    const compress = spinner();
    compress.start(preview ? 'Previewing compression…' : 'Compressing images…');

    const rows = [];
    let totalOriginal = 0;
    let totalCompressed = 0;
    let totalBytesSaved = 0;
    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const filePath of imagePaths) {
        const relativePath = path.relative(process.cwd(), filePath);
        try {
            const result = await compressImage(sharp, filePath, preview);
            totalOriginal += result.originalSize;
            totalCompressed += result.skipped ? result.originalSize : result.compressedSize;
            totalBytesSaved += result.bytesSaved;
            if (result.skipped) {
                skippedCount++;
            } else {
                processedCount++;
                const pct = ((result.bytesSaved / result.originalSize) * 100).toFixed(1) + '%';
                rows.push({
                    file: relativePath,
                    before: formatSize(result.originalSize),
                    after: formatSize(result.compressedSize),
                    saved: formatSaving(result.bytesSaved),
                    pct,
                    status: preview ? `${D}preview${R}` : `${G}saved${R}`,
                    statusPlain: preview ? 'preview' : 'saved',
                });
            }
        } catch (err) {
            errorCount++;
            rows.push({
                file: relativePath,
                before: '-', after: '-', saved: '-', pct: '-',
                status: `\x1b[31merror\x1b[0m`,
                statusPlain: 'error',
                error: err.message,
            });
        }
    }

    compress.stop(
        processedCount > 0
            ? `${processedCount} image${processedCount !== 1 ? 's' : ''} ${preview ? 'ready to compress' : 'compressed'}`
            : 'All images already fully compressed'
    );

    if (rows.length === 0) {
        outro('Nothing to do.');
        return;
    }

    console.log('');

    const colFile   = Math.max(4,  ...rows.map(r => r.file.length));
    const colBefore = Math.max(6,  ...rows.map(r => r.before.length));
    const colAfter  = Math.max(5,  ...rows.map(r => r.after.length));
    const colSaved  = Math.max(5,  ...rows.map(r => r.saved.length));
    const colPct    = Math.max(4,  ...rows.map(r => r.pct.length));
    const colStatus = Math.max(7,  ...rows.map(r => r.statusPlain.length));

    const divider = [
        '-'.repeat(colFile + 2), '-'.repeat(colBefore + 2), '-'.repeat(colAfter + 2),
        '-'.repeat(colSaved + 2), '-'.repeat(colPct + 2), '-'.repeat(colStatus + 2),
    ].join('+');

    const header = [
        ' ' + 'File'.padEnd(colFile) + ' ',
        ' ' + 'Before'.padEnd(colBefore) + ' ',
        ' ' + 'After'.padEnd(colAfter) + ' ',
        ' ' + 'Saved'.padEnd(colSaved) + ' ',
        ' ' + '%'.padEnd(colPct) + ' ',
        ' ' + 'Status'.padEnd(colStatus) + ' ',
    ].join('|');

    console.log(divider);
    console.log(header);
    console.log(divider);

    for (const row of rows) {
        const padding = colStatus - row.statusPlain.length;
        console.log([
            ' ' + row.file.padEnd(colFile) + ' ',
            ' ' + row.before.padEnd(colBefore) + ' ',
            ' ' + row.after.padEnd(colAfter) + ' ',
            ' ' + row.saved.padEnd(colSaved) + ' ',
            ' ' + row.pct.padEnd(colPct) + ' ',
            ' ' + row.status + ' '.repeat(padding) + ' ',
        ].join('|'));
        if (row.error) console.log(`  ${D}${row.error}${R}`);
    }

    console.log(divider);

    const totalPct = totalOriginal > 0
        ? ((totalBytesSaved / totalOriginal) * 100).toFixed(1) + '%' : '-';

    console.log([
        ' ' + 'TOTAL'.padEnd(colFile) + ' ',
        ' ' + formatSize(totalOriginal).padEnd(colBefore) + ' ',
        ' ' + formatSize(totalCompressed).padEnd(colAfter) + ' ',
        ' ' + formatSaving(totalBytesSaved).padEnd(colSaved) + ' ',
        ' ' + totalPct.padEnd(colPct) + ' ',
        ' ' + ''.padEnd(colStatus) + ' ',
    ].join('|'));

    console.log(divider);
    console.log('');

    if (skippedCount > 0) logger.debug(`${skippedCount} image${skippedCount !== 1 ? 's' : ''} already fully compressed, skipped`);

    outro(preview
        ? 'Preview complete — run without --preview to apply changes.'
        : `Done. Saved ${formatSize(totalBytesSaved)} total.`
    );

    if (errorCount > 0) process.exit(1);
}

async function main() {
    const { intro } = await import('@clack/prompts');
    const preview = process.argv.includes('--preview');
    const campaigns = config.loadCampaigns();
    logger.banner();
    intro(`Next Campaign Page Kit — image compressor${preview ? `  ${D}(preview)${R}` : ''}`);
    await runCompress(campaigns, preview);
}

if (require.main === module) {
    main().catch(err => {
        logger.error(err.message);
        process.exit(1);
    });
}

module.exports = { runCompress };
