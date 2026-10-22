const fs = require('fs');
const path = require('path');
const { parse } = require('acorn');

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

function propertyName(property) {
    if (property.computed) return null;
    return property.key.type === 'Identifier' ? property.key.name : property.key.value;
}

function windowMember(node) {
    if (node?.type !== 'MemberExpression' || node.object.type !== 'Identifier'
        || node.object.name !== 'window' || node.optional) return null;
    if (!node.computed && node.property.type === 'Identifier') return node.property.name;
    return node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string'
        ? node.property.value : null;
}

// Support data, not executable configuration. Calls, getters, computed keys and
// spreads could change the effective binding while its literal appears valid.
function isStaticData(node) {
    if (!node) return false;
    if (node.type === 'Literal') return node.value === null || ['string', 'number', 'boolean'].includes(typeof node.value);
    if (node.type === 'UnaryExpression') {
        return ['+', '-'].includes(node.operator) && node.argument.type === 'Literal'
            && typeof node.argument.value === 'number';
    }
    if (node.type === 'ArrayExpression') return node.elements.every(isStaticData);
    if (node.type === 'ObjectExpression') {
        return node.properties.every(property => property.type === 'Property'
            && property.kind === 'init' && !property.method && !property.shorthand
            && propertyName(property) !== null && isStaticData(property.value));
    }
    return false;
}

function apiKeyLiteral(source) {
    let program;
    try {
        program = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
    } catch { return null; }

    let configObject;
    for (const statement of program.body) {
        if (statement.type === 'EmptyStatement') continue;
        if (statement.type === 'VariableDeclaration') {
            // Allow static documentation/examples without allowing aliases of
            // window or a global declaration that replaces nextConfig.
            if (statement.declarations.every(declaration => declaration.id.type === 'Identifier'
                && !['window', 'nextConfig'].includes(declaration.id.name) && isStaticData(declaration.init))) continue;
            return null;
        }
        if (statement.type !== 'ExpressionStatement') return null;
        const expression = statement.expression;
        if (expression.type === 'Literal' && typeof expression.value === 'string') continue;
        if (expression.type !== 'AssignmentExpression' || expression.operator !== '=') return null;
        const member = windowMember(expression.left);
        if (member === 'nextConfig') {
            if (configObject || expression.right.type !== 'ObjectExpression' || !isStaticData(expression.right)) return null;
            configObject = expression.right;
            continue;
        }
        // Public templates initialize the SDK queues before assigning config.
        const right = expression.right;
        if (['dataLayer', 'nextReady'].includes(member) && right.type === 'LogicalExpression'
            && right.operator === '||' && windowMember(right.left) === member
            && right.right.type === 'ArrayExpression' && right.right.elements.length === 0) continue;
        return null;
    }
    const fields = configObject?.properties.filter(property => propertyName(property) === 'apiKey') || [];
    if (fields.length !== 1 || fields[0].value.type !== 'Literal' || typeof fields[0].value.value !== 'string') return null;
    return fields[0].value;
}

// Replace only the parsed commerce-key literal; preserve comments, spacing and
// unrelated nested apiKey properties. Never execute template JavaScript.
function applyApiKey(source, apiKey) {
    const literal = apiKeyLiteral(source);
    if (!literal) return null;
    const key = String(apiKey).trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'")
        .replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    return source.slice(0, literal.start) + `'${key}'` + source.slice(literal.end);
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
        throw configError('no apiKey field in a supported static window.nextConfig binding found in assets/config.js; use one object assignment with a single apiKey string literal and no dynamic configuration or reassignment; runtime configuration was not changed');
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
