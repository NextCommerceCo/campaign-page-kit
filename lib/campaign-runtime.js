const fs = require('fs');
const path = require('path');

const PREVIEW_START = '// campaign-page-kit: unconfigured preview';
const PREVIEW_END = '// campaign-page-kit: end preview';
const PREVIEW_OVERRIDE = `${PREVIEW_START}
window.nextConfig = window.nextConfig || {};
window.nextConfig.apiKey = '';
window.nextConfig.analytics = { enabled: false, mode: 'disabled' };
${PREVIEW_END}\n`;

function withoutPreviewOverride(source) {
    const start = source.indexOf(PREVIEW_START);
    const end = source.indexOf(PREVIEW_END, start);
    return start >= 0 && end >= start
        ? source.slice(0, start) + source.slice(end + PREVIEW_END.length).replace(/^\r?\n/, '')
        : source;
}

// Keep the existing config intact apart from its commerce binding. Do not
// evaluate template JavaScript during init or configuration.
function applyApiKey(source, apiKey) {
    const field = /\bapiKey:\s*(['"])(?:\\.|(?!\1)[^\\])*?\1/;
    if (!field.test(source)) return null;
    const key = String(apiKey).trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'")
        .replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    return source.replace(field, () => `apiKey: '${key}'`);
}

// Called while the template is staged, before it becomes a runnable campaign.
function prepareRuntime(campaignDir, { apiKey, demo = false } = {}) {
    if (demo) return { preview: false, mode: 'demo' };
    const configPath = path.join(campaignDir, 'assets', 'config.js');
    const source = fs.existsSync(configPath) ? withoutPreviewOverride(fs.readFileSync(configPath, 'utf8')) : '';
    if (apiKey) {
        const updated = applyApiKey(source, apiKey);
        if (updated === null) throw new Error('no apiKey field found in assets/config.js; campaign remains unconfigured');
        fs.writeFileSync(configPath, updated, 'utf8');
        return { preview: false, mode: 'configured' };
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${applyApiKey(source, '') ?? source}\n${PREVIEW_OVERRIDE}`, 'utf8');
    return { preview: true, mode: 'unconfigured-preview' };
}

module.exports = { applyApiKey, prepareRuntime, withoutPreviewOverride };
