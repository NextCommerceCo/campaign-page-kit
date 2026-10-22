const fs = require('fs');
const path = require('path');

const PREVIEW_START = '// campaign-page-kit: unconfigured preview';
const PREVIEW_END = '// campaign-page-kit: end preview';
const PREVIEW_OVERRIDE = `${PREVIEW_START}
window.nextConfig = window.nextConfig || {};
window.nextConfig.apiKey = '';
window.nextConfig.analytics = { enabled: false, mode: 'disabled' };
${PREVIEW_END}\n`;

function configError(message) {
    return Object.assign(new Error(message), { code: 'INVALID_INPUT' });
}

function withoutPreviewOverride(source) {
    const start = source.indexOf(PREVIEW_START);
    const end = source.indexOf(PREVIEW_END);
    if (start < 0 && end < 0) return source;
    if (start < 0 || end < start || source.indexOf(PREVIEW_START, start + PREVIEW_START.length) >= 0
        || source.indexOf(PREVIEW_END, end + PREVIEW_END.length) >= 0) {
        throw configError('malformed preview override in assets/config.js; repair its start/end markers before configuring');
    }
    return source.slice(0, start) + source.slice(end + PREVIEW_END.length).replace(/^\r?\n/, '');
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
    const exists = fs.existsSync(configPath);
    if (!exists && apiKey) {
        throw configError('assets/config.js is missing; add a config with an apiKey string literal before configuring commerce');
    }
    // Static templates may have no runtime config to sanitize. Seed an empty
    // binding for that case; an existing unrecognized config must fail closed.
    const source = exists ? withoutPreviewOverride(fs.readFileSync(configPath, 'utf8'))
        : "window.nextConfig = { apiKey: '' };\n";
    const updated = applyApiKey(source, apiKey || '');
    if (updated === null) {
        throw configError('no apiKey field with a string literal found in assets/config.js; runtime configuration was not changed');
    }
    if (apiKey) {
        fs.writeFileSync(configPath, updated, 'utf8');
        return { preview: false, mode: 'configured' };
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${updated}\n${PREVIEW_OVERRIDE}`, 'utf8');
    return { preview: true, mode: 'unconfigured-preview' };
}

module.exports = { applyApiKey, prepareRuntime, withoutPreviewOverride };
