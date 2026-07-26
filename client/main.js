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

    var engineDot     = document.getElementById('engineDot');
    var statusBar     = document.getElementById('statusBar');
    var generateBtn   = document.getElementById('generateBtn');
    var rangeBtn      = document.getElementById('rangeBtn');
    var invertToggle  = document.getElementById('invertToggle');
    var outputFolder  = document.getElementById('outputFolder');
    var browseBtn     = document.getElementById('browseBtn');
    var progressWrap  = document.getElementById('progressWrap');
    var progressFill  = document.getElementById('progressFill');
    var progressLabel = document.getElementById('progressLabel');
    var cancelBtn     = document.getElementById('cancelBtn');

    var engineReady = false;
    var pollTimer = null;
    var busy = false;
    var cancelRequested = false;

    function pad5(n) { return ('00000' + n).slice(-5); }

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

    function showProgress(current, total) {
        progressWrap.style.display = 'block';
        var pct = total > 0 ? Math.round((current / total) * 100) : 0;
        progressFill.style.width = pct + '%';
        progressLabel.textContent = 'Frame ' + current + ' / ' + total;
    }

    function hideProgress() {
        progressWrap.style.display = 'none';
    }

    function setBusy(isBusy) {
        busy = isBusy;
        generateBtn.disabled = isBusy;
        rangeBtn.disabled = isBusy;
    }

    function fail(msg) {
        setStatus(msg, 'error');
        hideProgress();
        setBusy(false);
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

    function requireReady() {
        if (!engineReady) {
            setStatus('Engine not ready yet - please wait.', 'error');
            return false;
        }
        if (busy) return false;
        var destFolder = outputFolder.value.trim();
        if (!destFolder) {
            setStatus('Choose an output folder first.', 'error');
            return false;
        }
        try { localStorage.setItem(OUTPUT_FOLDER_KEY, destFolder); } catch (e) {}
        return true;
    }

    function generateDepth() {
        if (!requireReady()) return;
        var destFolder = outputFolder.value.trim();

        setBusy(true);
        setStatus('Capturing current frame...', 'working');

        evalEx('EZDEPTH.saveCurrentFrame()', function (res) {
            var frame = safeParse(res);
            if (!frame || frame.error) {
                var msg = frame ? frame.error : 'No response from AE.';
                if (frame && frame.diagnostics) {
                    console.log('[ezdepth] saveCurrentFrame diagnostics:', frame.diagnostics);
                    msg += ' (' + JSON.stringify(frame.diagnostics) + ')';
                }
                fail(msg);
                return;
            }

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
                    setBusy(false);
                    if (!imported || imported.error) { fail(imported ? imported.error : 'Import failed.'); return; }
                    setStatus('Depth layer added: ' + imported.layer, 'success');
                });
            });
        });
    }

    // Full-range mode: captures every frame in the comp's work area (which
    // is the whole comp duration unless the user has narrowed it), converts
    // each one, then imports the result as a single depth PNG sequence layer.
    function cancelDepthRange() {
        if (!busy) return;
        cancelRequested = true;
        setStatus('Cancelling after the current frame...', 'working');
    }

    function generateDepthRange() {
        if (!requireReady()) return;
        var destFolder = outputFolder.value.trim();

        cancelRequested = false;
        setBusy(true);
        setStatus('Preparing render...', 'working');

        evalEx('EZDEPTH.prepareRangeRender()', function (pres) {
            var prep = safeParse(pres);
            if (!prep || prep.error) { fail(prep ? prep.error : 'No response from AE.'); return; }

            var expected = prep.expectedCount;
            showProgress(0, expected);
            setStatus('Rendering frame 0 / ' + expected + ' via AE render queue...', 'working');

            // renderQueue.render() is one long blocking ExtendScript call with
            // no way to get progress out of it directly - but it runs async
            // from the panel's own JS, so we can just watch the output folder
            // fill up with plain Node fs while it's in flight.
            var renderPoll = setInterval(function () {
                fs.readdir(prep.srcFolder, function (err, files) {
                    if (err || !files) return;
                    var count = files.filter(function (f) { return /^frame_\d+\.png$/i.test(f); }).length;
                    if (count > expected) count = expected;
                    showProgress(count, expected);
                    setStatus('Rendering frame ' + count + ' / ' + expected + ' via AE render queue...', 'working');
                });
            }, 700);

            var startArgs = JSON.stringify({
                compId: prep.compId,
                compName: prep.compName,
                sessionDir: prep.sessionDir,
                srcFolder: prep.srcFolder,
                workAreaStart: prep.workAreaStart,
                workAreaDuration: prep.workAreaDuration
            });

            evalEx("EZDEPTH.startRangeRender('" + escapeForEval(startArgs) + "')", function (res) {
                clearInterval(renderPoll);
                var range = safeParse(res);
                if (!range || range.error) { fail(range ? range.error : 'No response from AE.'); return; }

                var total = range.frameCount;
                var framePaths = range.framePaths;
                showProgress(0, total);
                setStatus('Converting frame 1 / ' + total + ' in the background (AE is free)...', 'working');

                // Depth conversion: pure Node <-> Python HTTP calls from here
                // on - no AE round trips at all, so AE stays completely free.
                function convertFrame(i) {
                    if (cancelRequested) {
                        cancelRequested = false;
                        hideProgress();
                        setBusy(false);
                        setStatus('Cancelled after converting ' + i + ' / ' + total + ' frames.', 'error');
                        return;
                    }
                    if (i >= total) {
                        finishRange();
                        return;
                    }
                    var depthPath = range.sessionDir + '/depth/frame_' + pad5(i) + '.png';
                    postDepth({ in: framePaths[i], out: depthPath, invert: invertToggle.checked }, function (err) {
                        if (err) { fail('Frame ' + i + ': ' + err); return; }
                        showProgress(i + 1, total);
                        setStatus('Converting frame ' + (i + 2 <= total ? i + 2 : total) + ' / ' + total + ' in the background (AE is free)...', 'working');
                        convertFrame(i + 1);
                    });
                }

                function finishRange() {
                    setStatus('Importing depth sequence (' + total + ' frames)...', 'working');
                    var importArgs = JSON.stringify({
                        sessionDir: range.sessionDir,
                        frameCount: total,
                        compName: range.compName,
                        compId: range.compId,
                        outputFolder: destFolder,
                        workAreaStart: range.workAreaStart,
                        frameRate: range.frameRate
                    });
                    evalEx("EZDEPTH.importSequenceResult('" + escapeForEval(importArgs) + "')", function (ires) {
                        var imported = safeParse(ires);
                        hideProgress();
                        setBusy(false);
                        if (!imported || imported.error) { fail(imported ? imported.error : 'Sequence import failed.'); return; }
                        setStatus('Depth sequence added: ' + imported.layer + ' (' + total + ' frames)', 'success');
                    });
                }

                convertFrame(0);
            });
        });
    }

    generateBtn.addEventListener('click', generateDepth);
    rangeBtn.addEventListener('click', generateDepthRange);
    cancelBtn.addEventListener('click', cancelDepthRange);
    browseBtn.addEventListener('click', browseOutputFolder);
    window.addEventListener('unload', function () {
        if (pollTimer) clearTimeout(pollTimer);
    });

    initOutputFolder();
    ensureEngine();
})();
