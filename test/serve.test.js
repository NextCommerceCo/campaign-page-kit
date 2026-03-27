const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { serve } = require('../lib/engine/serve');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'serve-test-'));
}

function fetch(port, urlPath) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}${urlPath}`, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        }).on('error', reject);
    });
}

function cleanup(server, watcher, dirs) {
    return new Promise((resolve) => {
        watcher.close();
        server.close(() => {
            for (const dir of dirs) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
            resolve();
        });
    });
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

test('serves static HTML file with livereload script injected', async () => {
    const outputPath = tmpDir();
    const srcPath = tmpDir();
    fs.writeFileSync(path.join(outputPath, 'index.html'), '<html><body></body></html>');

    const { server, watcher } = serve({ outputPath, srcPath, port: 0, onRebuild: async () => {} });
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;

    const res = await fetch(port, '/index.html');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body, /EventSource/);
    assert.match(res.body, /<\/body>/);

    await cleanup(server, watcher, [outputPath, srcPath]);
});

test('serves HTML without </body> by appending livereload script', async () => {
    const outputPath = tmpDir();
    const srcPath = tmpDir();
    fs.writeFileSync(path.join(outputPath, 'partial.html'), '<h1>Hello</h1>');

    const { server, watcher } = serve({ outputPath, srcPath, port: 0, onRebuild: async () => {} });
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;

    const res = await fetch(port, '/partial.html');
    assert.equal(res.status, 200);
    assert.match(res.body, /EventSource/);

    await cleanup(server, watcher, [outputPath, srcPath]);
});

test('serves CSS file with correct mime type', async () => {
    const outputPath = tmpDir();
    const srcPath = tmpDir();
    fs.writeFileSync(path.join(outputPath, 'style.css'), 'body { color: red; }');

    const { server, watcher } = serve({ outputPath, srcPath, port: 0, onRebuild: async () => {} });
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;

    const res = await fetch(port, '/style.css');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/css');
    assert.equal(res.body, 'body { color: red; }');

    await cleanup(server, watcher, [outputPath, srcPath]);
});

test('serves directory index.html when path is a directory', async () => {
    const outputPath = tmpDir();
    const srcPath = tmpDir();
    const subDir = path.join(outputPath, 'campaign');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'index.html'), '<html><body>Campaign</body></html>');

    const { server, watcher } = serve({ outputPath, srcPath, port: 0, onRebuild: async () => {} });
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;

    const res = await fetch(port, '/campaign');
    assert.equal(res.status, 200);
    assert.match(res.body, /Campaign/);

    await cleanup(server, watcher, [outputPath, srcPath]);
});

test('returns 404 for missing files', async () => {
    const outputPath = tmpDir();
    const srcPath = tmpDir();

    const { server, watcher } = serve({ outputPath, srcPath, port: 0, onRebuild: async () => {} });
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;

    const res = await fetch(port, '/nope.html');
    assert.equal(res.status, 404);
    assert.equal(res.body, 'Not found');

    await cleanup(server, watcher, [outputPath, srcPath]);
});

test('returns fallback mime type for unknown extensions', async () => {
    const outputPath = tmpDir();
    const srcPath = tmpDir();
    fs.writeFileSync(path.join(outputPath, 'data.xyz'), 'binary');

    const { server, watcher } = serve({ outputPath, srcPath, port: 0, onRebuild: async () => {} });
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;

    const res = await fetch(port, '/data.xyz');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/octet-stream');

    await cleanup(server, watcher, [outputPath, srcPath]);
});

test('returns 500 when file read fails', async () => {
    const outputPath = tmpDir();
    const srcPath = tmpDir();
    const filePath = path.join(outputPath, 'broken.html');
    fs.writeFileSync(filePath, '<html></html>');
    // Make file unreadable
    fs.chmodSync(filePath, 0o000);

    const { server, watcher } = serve({ outputPath, srcPath, port: 0, onRebuild: async () => {} });
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;

    const res = await fetch(port, '/broken.html');
    assert.equal(res.status, 500);
    assert.equal(res.body, 'Server error');

    // Restore permissions for cleanup
    fs.chmodSync(filePath, 0o644);
    await cleanup(server, watcher, [outputPath, srcPath]);
});

// ---------------------------------------------------------------------------
// handleChange — file watcher rebuild
// ---------------------------------------------------------------------------

test('handleChange triggers rebuild and reload on watcher event', async () => {
    const outputPath = tmpDir();
    const srcPath = tmpDir();
    let rebuildCalledWith = null;
    const onRebuild = async (p) => { rebuildCalledWith = p; };

    const { server, watcher } = serve({ outputPath, srcPath, port: 0, onRebuild });
    await new Promise((r) => server.once('listening', r));

    // Emit a change event directly on the watcher to avoid chokidar timing issues
    watcher.emit('change', '/fake/src/test.html');
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(rebuildCalledWith, '/fake/src/test.html');

    await cleanup(server, watcher, [outputPath, srcPath]);
});

test('handleChange logs error when rebuild throws', async () => {
    const outputPath = tmpDir();
    const srcPath = tmpDir();
    const onRebuild = async () => { throw new Error('build broke'); };

    const logger = require('../lib/logger');
    const origError = logger.error;
    const origInfo = logger.info;
    let errorMsg = '';
    logger.error = (msg) => { errorMsg = msg; };
    logger.info = () => {};

    const { server, watcher } = serve({ outputPath, srcPath, port: 0, onRebuild });
    await new Promise((r) => server.once('listening', r));

    // Emit change directly to avoid chokidar timing issues
    watcher.emit('change', '/fake/src/fail.html');
    await new Promise((r) => setTimeout(r, 50));

    assert.match(errorMsg, /build broke/);

    logger.error = origError;
    logger.info = origInfo;
    await cleanup(server, watcher, [outputPath, srcPath]);
});

// ---------------------------------------------------------------------------
// SSE live reload endpoint
// ---------------------------------------------------------------------------

test('/_lr returns SSE stream', async () => {
    const outputPath = tmpDir();
    const srcPath = tmpDir();

    const { server, watcher } = serve({ outputPath, srcPath, port: 0, onRebuild: async () => {} });
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;

    const res = await new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}/_lr`, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
                // Got the initial connected message, that's enough
                res.destroy();
                resolve({ status: res.statusCode, headers: res.headers, body });
            });
        }).on('error', reject);
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/event-stream');
    assert.match(res.body, /: connected/);

    await cleanup(server, watcher, [outputPath, srcPath]);
});

// ---------------------------------------------------------------------------
// reload() pushes to SSE clients
// ---------------------------------------------------------------------------

test('reload() sends data to connected SSE clients', async () => {
    const outputPath = tmpDir();
    const srcPath = tmpDir();

    const { server, watcher, reload } = serve({ outputPath, srcPath, port: 0, onRebuild: async () => {} });
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;

    const message = await new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}/_lr`, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
                // After initial connection message, trigger a reload
                if (body.includes(': connected') && !body.includes('data:')) {
                    reload();
                }
                if (body.includes('data: reload')) {
                    res.destroy();
                    resolve(body);
                }
            });
        }).on('error', reject);
    });

    assert.match(message, /data: reload/);

    await cleanup(server, watcher, [outputPath, srcPath]);
});

// ---------------------------------------------------------------------------
// Port in use error
// ---------------------------------------------------------------------------

test('emits nice error when port is already in use', async () => {
    const outputPath = tmpDir();
    const srcPath = tmpDir();

    // Occupy a port
    const blocker = http.createServer();
    await new Promise((r) => blocker.listen(0, r));
    const port = blocker.address().port;

    // Capture logger.error and prevent process.exit
    const logger = require('../lib/logger');
    const origError = logger.error;
    const origExit = process.exit;
    let errorMsg = '';
    logger.error = (msg) => { errorMsg = msg; };
    process.exit = () => {};

    const { server, watcher } = serve({ outputPath, srcPath, port, onRebuild: async () => {} });

    // Wait for the error event to fire
    await new Promise((r) => setTimeout(r, 200));

    assert.match(errorMsg, /already in use/);
    assert.match(errorMsg, /--port/);

    // Restore
    logger.error = origError;
    process.exit = origExit;

    watcher.close();
    server.close();
    await new Promise((r) => blocker.close(r));
    fs.rmSync(outputPath, { recursive: true, force: true });
    fs.rmSync(srcPath, { recursive: true, force: true });
});

test('emits generic error message for non-EADDRINUSE server errors', async () => {
    const outputPath = tmpDir();
    const srcPath = tmpDir();

    const logger = require('../lib/logger');
    const origError = logger.error;
    const origExit = process.exit;
    let errorMsg = '';
    logger.error = (msg) => { errorMsg = msg; };
    process.exit = () => {};

    const { server, watcher } = serve({ outputPath, srcPath, port: 0, onRebuild: async () => {} });
    await new Promise((r) => server.once('listening', r));

    // Emit a generic error
    server.emit('error', new Error('something unexpected'));

    assert.match(errorMsg, /Server error: something unexpected/);

    logger.error = origError;
    process.exit = origExit;

    watcher.close();
    server.close();
    fs.rmSync(outputPath, { recursive: true, force: true });
    fs.rmSync(srcPath, { recursive: true, force: true });
});
