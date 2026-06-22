const yaml = require('js-yaml');

function parseFrontmatter(raw) {
    const text = raw.replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);

    if (lines[0].trim() !== '---') {
        return { data: {}, content: text };
    }

    const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (closingIndex === -1) {
        return { data: {}, content: text };
    }

    const source = lines.slice(1, closingIndex).join('\n');
    const data = source.trim() ? yaml.load(source) : {};

    if (typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('frontmatter must be a YAML object');
    }

    return {
        data,
        content: lines.slice(closingIndex + 1).join('\n'),
    };
}

module.exports = { parseFrontmatter };
