/* global CSInterface, SystemPath */
(function () {
    'use strict';

    // Node is enabled for this panel (see manifest CEFCommandLine).
    var http = require('http');
    var path = require('path');
    var fs = require('fs');
    var childProcess = require('child_process');

    var cs = new CSInterface();

    // Resolve this extension's own install location so the panel works
    // wherever it was installed, instead of a hardcoded dev-machine path.
    var extensionPath = cs.getSystemPath(SystemPath.EXTENSION);
    var SERVER_PY = path.join(extensionPath, 'python', 'server.py');
    var PYTHON_DIR = path.join(extensionPath, 'python');

    var ENGINE_HOST = '127.0.0.1';
    var ENGINE_PORT = 8787;
    var OUTPUT_FOLDER_KEY = 'ezdepth.outputFolder';

    var engineDot    = document.getElementById('engineDot');
    var statusBar    = document.getElementById('statusBar');
    var generateBtn  = document.getElementById('generateBtn');
    var invertToggle = document.getElementById('invertToggle');
    var outputFolder = document.getElementById('outputFolder');
    var browseBtn    = document.getElementById('browseBtn');

    var engineReady = false;
    var pollTimer = null;

    // Find a Python interpreter to run the engine with. Prefers the
    // extension-local venv created by install.bat; falls back to a few
    // common install locations, then bare "python" on PATH.
    function findPython() {
        var localAppData = process.env.LOCALAPPDATA || '';
        var candidates = [
            path.join(PYTHON_DIR, '.venv', 'Scripts', 'python.exe'), // preferred: install.bat-created venv
            process.env.EZDEPTH_PYTHON || '',
            path.join(localAppData, 'Programs', 'Python', 'Python313', 'python.exe'),
            path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
            path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe'),
            path.join(localAppData, 'Programs', 'Python', 'Python310', 'python.exe'),
            'C:\\Python313\\python.exe',
            'C:\\Python312\\python.exe',
            'C:\\Python311\\python.exe'
        ];
        for (var i = 0; i < candidates.length; i++) {
            try {
                if (candidates[i] && fs.existsSync(candidates[i])) return candidates[i];
            } catch (e) { /* skip */ }
        }
        return 'python'; // last resort: whatever is on PATH
    }

    var PYTHON_EXE = findPython();

    function evalEx(script, cb) {
        cb = cb || function () {};
        cs.evalScript(script, cb);
    }

    function safeParse(str) {
        try { return JSON.parse(str); } catch (e) { return null; }
    }

    function escapeForEval(json) {
        return json.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    function setStatus(text, kind) {
        statusBar.textContent = text;
        statusBar.className = 'status-bar' + (kind ? ' ' + kind : '');
    }

    function setEngineStatus(state) {
        engineDot.className = 'engine-dot ' + state;
        engineDot.title = 'Engine: ' + state;
        engineReady = (state === 'ready');
    }

    function checkHealth(cb) {
        var req = http.get({ host: ENGINE_HOST, port: ENGINE_PORT, path: '/health', timeout: 1500 }, function (res) {
            var body = '';
            res.on('data', function (d) { body += d; });
            res.on('end', function () {
                var json = safeParse(body);
                cb(res.statusCode === 200 && json && json.ready === true);
            });
        });
        req.on('timeout', function () { req.destroy(); cb(false); });
        req.on('error', function () { cb(false); });
    }

    function spawnEngine() {
        try {
            var child = childProcess.spawn(PYTHON_EXE, [SERVER_PY], {
                cwd: PYTHON_DIR,
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            child.unref();
        } catch (e) {
            console.log('[ezdepth] failed to spawn engine:', e);
        }
    }

    function pollUntilReady(attemptsLeft) {
        checkHealth(function (ok) {
            if (ok) {
                setEngineStatus('ready');
                setStatus('Engine ready.', 'success');
                return;
            }
            if (attemptsLeft <= 0) {
                setEngineStatus('error');
                setStatus('Engine failed to start. Run install.bat, then check python/server.py manually.', 'error');
                return;
            }
            pollTimer = setTimeout(function () { pollUntilReady(attemptsLeft - 1); }, 1500);
        });
    }

    function ensureEngine() {
        setEngineStatus('starting');
        setStatus('Checking engine...', 'working');
        checkHealth(function (ok) {
            if (ok) {
                setEngineStatus('ready');
                setStatus('Engine ready.', 'success');
                return;
            }
            if (!fs.existsSync(SERVER_PY)) {
                setEngineStatus('error');
                setStatus('python/server.py not found - re-run install.bat.', 'error');
                return;
            }
            setStatus('Starting engine (loading model)...', 'working');
            spawnEngine();
            pollUntilReady(40); // ~60s window for model load
        });
    }

    function postDepth(payload, cb) {
        var body = JSON.stringify(payload);
        var req = http.request({
            host: ENGINE_HOST,
            port: ENGINE_PORT,
            path: '/depth',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, function (res) {
            var resBody = '';
            res.on('data', function (d) { resBody += d; });
            res.on('end', function () {
                var json = safeParse(resBody);
                if (!json || json.ok !== true) {
                    cb((json && json.error) || 'Depth engine returned an error.');
                    return;
                }
                cb(null, json);
            });
        });
        req.on('error', function (e) { cb('Could not reach depth engine: ' + e.message); });
        req.write(body);
        req.end();
    }

    function fail(msg) {
        setStatus(msg, 'error');
        generateBtn.disabled = false;
    }

    function initOutputFolder() {
        var stored = null;
        try { stored = localStorage.getItem(OUTPUT_FOLDER_KEY); } catch (e) {}
        if (stored) {
            outputFolder.value = stored;
            return;
        }
        evalEx('EZDEPTH.defaultOutputFolder()', function (res) {
            var data = safeParse(res);
            if (data && data.folder) outputFolder.value = data.folder;
        });
    }

    function browseOutputFolder() {
        evalEx('EZDEPTH.chooseOutputFolder()', function (res) {
            var data = safeParse(res);
            if (!data || data.error || !data.folder) return; // cancelled
            outputFolder.value = data.folder;
            try { localStorage.setItem(OUTPUT_FOLDER_KEY, data.folder); } catch (e) {}
        });
    }

    function generateDepth() {
        if (!engineReady) {
            setStatus('Engine not ready yet - please wait.', 'error');
            return;
        }
        var destFolder = outputFolder.value.trim();
        if (!destFolder) {
            setStatus('Choose an output folder first.', 'error');
            return;
        }
        try { localStorage.setItem(OUTPUT_FOLDER_KEY, destFolder); } catch (e) {}

        generateBtn.disabled = true;
        setStatus('Capturing current frame...', 'working');

        evalEx('EZDEPTH.saveCurrentFrame()', function (res) {
            var frame = safeParse(res);
            if (!frame || frame.error) { fail(frame ? frame.error : 'No response from AE.'); return; }

            var depthPath = frame.framePath.replace(/\.png$/i, '_depth.png');
            setStatus('Running Depth Anything V2...', 'working');

            postDepth({ in: frame.framePath, out: depthPath, invert: invertToggle.checked }, function (err, result) {
                if (err) { fail(err); return; }

                setStatus('Importing depth layer...', 'working');
                var importArgs = JSON.stringify({
                    depthPath: depthPath,
                    compName: frame.compName,
                    compId: frame.compId,
                    outputFolder: destFolder
                });
                evalEx("EZDEPTH.importResult('" + escapeForEval(importArgs) + "')", function (res2) {
                    var imported = safeParse(res2);
                    generateBtn.disabled = false;
                    if (!imported || imported.error) { fail(imported ? imported.error : 'Import failed.'); return; }
                    setStatus('Depth layer added: ' + imported.layer, 'success');
                });
            });
        });
    }

    generateBtn.addEventListener('click', generateDepth);
    browseBtn.addEventListener('click', browseOutputFolder);
    window.addEventListener('unload', function () {
        if (pollTimer) clearTimeout(pollTimer);
    });

    initOutputFolder();
    ensureEngine();
})();
