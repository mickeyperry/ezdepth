// Auto-loaded by the CEP panel via manifest <ScriptPath>.
// Defines EZDEPTH.* — called by client/main.js via evalScript.

var EZDEPTH = (function () {

    // How long to wait for a captured frame's PNG to finish writing before
    // giving up. Generous on purpose: saveFrameToPng can return before the
    // encode is flushed to disk, and the very first frame of a session on a
    // heavy production comp (many layers/effects/precomps) can take well
    // over a few seconds just to render, let alone write out.
    var FRAME_WAIT_MS = 20000;

    // Name of the Output Module Template used for full-range PNG sequence
    // renders. Format can't be set directly via scripting in current AE
    // builds (setSettings() rejects it as read-only), only by applying a
    // named template - so this one has to be created once, by hand, in
    // After Effects: Edit > Templates > Output Module... > New..., Format
    // set to "PNG Sequence", saved with this exact name.
    var OUTPUT_TEMPLATE_NAME = "EzDepth PNG Sequence";

    function parse(json) { return eval("(" + json + ")"); }

    function activeComp() {
        var it = app.project.activeItem;
        return (it && it instanceof CompItem) ? it : null;
    }

    function tempFile(name) {
        var dir = new Folder(Folder.temp.fsName + "/EzDepth-temp");
        if (!dir.exists) dir.create();
        return dir.fsName + "/" + name;
    }

    // Waits for a just-written file to stop growing before handing it off.
    // saveFrameToPng can return before the PNG encode has fully flushed to
    // disk, which otherwise hands the depth engine a truncated/empty file.
    function waitForStableFile(file, maxWaitMs) {
        var waited = 0, lastLen = -1, stableHits = 0;
        while (waited < maxWaitMs) {
            if (file.exists) {
                var len = file.length;
                if (len > 0 && len === lastLen) {
                    stableHits++;
                    if (stableHits >= 2) return true;
                } else {
                    stableHits = 0;
                }
                lastLen = len;
            }
            $.sleep(50);
            waited += 50;
        }
        return file.exists && file.length > 0;
    }

    // Grabs the comp as currently rendered at the playhead (whole composite,
    // not an isolated layer) and writes it to a temp PNG for the depth engine.
    function saveCurrentFrame() {
        var comp = activeComp();
        if (!comp) return JSON.stringify({ error: "No active composition." });
        var t = comp.time;
        var stamp = Math.round(t * 1000) + "_" + Math.round(Math.random() * 1e6);
        var file = new File(tempFile("frame_" + stamp + ".png"));

        // Force full resolution for the capture regardless of the comp
        // viewer's current Resolution/Down Sample Factor (Full/Half/Third/
        // Quarter), then restore whatever the user had set.
        var origResFactor = comp.resolutionFactor;
        try {
            comp.resolutionFactor = [1, 1];
            comp.saveFrameToPng(t, file);
        } catch (e) {
            comp.resolutionFactor = origResFactor;
            return JSON.stringify({ error: "saveFrameToPng failed: " + e.toString() });
        }
        comp.resolutionFactor = origResFactor;

        if (!waitForStableFile(file, FRAME_WAIT_MS)) {
            return JSON.stringify({
                error: "saveFrameToPng did not produce a readable file: " + file.fsName,
                diagnostics: {
                    fileExists: file.exists,
                    fileLength: file.exists ? file.length : -1,
                    time: t,
                    compName: comp.name,
                    compDuration: comp.duration
                }
            });
        }

        return JSON.stringify({
            framePath: file.fsName,
            compName: comp.name,
            compId: comp.id,
            width: comp.width,
            height: comp.height,
            time: t
        });
    }

    function pad5(n) { return ("00000" + n).slice(-5); }

    // Renders every frame in the comp's work area to a PNG sequence using
    // AE's own Render Queue - a real render through AE's native pipeline,
    // not a scripted per-frame viewer grab. This sidesteps the whole class
    // of problems the old saveFrameToPng loop hit (viewer resolution/render
    // cache state, frames silently coming back empty partway through a long
    // run) since the render queue has its own independent render settings
    // and AE shows its own native render progress/cancel UI while it runs.
    // Work area defaults to the whole comp duration unless the user has
    // narrowed it, so "range" naturally means "full comp" by default.
    function renderRangeToSequence() {
        var comp = activeComp();
        if (!comp) return JSON.stringify({ error: "No active composition." });

        var stamp = Math.round(new Date().getTime()) + "_" + Math.round(Math.random() * 1e6);
        var sessionDir = new Folder(Folder.temp.fsName + "/EzDepth-temp/range_" + stamp);
        sessionDir.create();
        var srcFolder = new Folder(sessionDir.fsName + "/src");
        srcFolder.create();
        new Folder(sessionDir.fsName + "/depth").create();

        var frameRate = comp.frameRate;
        var workAreaStart = comp.workAreaStart;
        var workAreaDuration = comp.workAreaDuration;
        var expectedCount = Math.max(1, Math.round(workAreaDuration * frameRate));

        var rqItem = null;
        try {
            rqItem = app.project.renderQueue.items.add(comp);
            rqItem.timeSpanStart = workAreaStart;
            rqItem.timeSpanDuration = workAreaDuration;

            var om = rqItem.outputModule(1);
            // Format/Channels are read-only via setSettings() in current AE
            // builds - the output format can only be switched by applying a
            // named Output Module Template, which has to exist already (AE
            // doesn't ship one called this by default). See OUTPUT_TEMPLATE_NAME.
            try {
                om.applyTemplate(OUTPUT_TEMPLATE_NAME);
            } catch (eTemplate) {
                rqItem.remove();
                return JSON.stringify({
                    error: "Output Module template \"" + OUTPUT_TEMPLATE_NAME + "\" not found - one-time setup needed. " +
                        "In After Effects: Edit menu > Templates > Output Module... > New..., set Format to \"PNG Sequence\", " +
                        "name it exactly \"" + OUTPUT_TEMPLATE_NAME + "\", click OK, then OK again. Then try Full Range again."
                });
            }
            om.file = new File(srcFolder.fsName + "/frame_[#####].png");

            app.project.renderQueue.render();
        } catch (e) {
            try { if (rqItem) rqItem.remove(); } catch (e2) {}
            return JSON.stringify({ error: "Render failed: " + e.toString() });
        }
        try { rqItem.remove(); } catch (e) {}

        var rendered = srcFolder.getFiles("frame_*.png");
        rendered.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });

        if (!rendered || rendered.length === 0) {
            return JSON.stringify({
                error: "Render queue produced no frames in " + srcFolder.fsName,
                diagnostics: { expectedCount: expectedCount, srcFolderExists: srcFolder.exists }
            });
        }

        var framePaths = [];
        for (var i = 0; i < rendered.length; i++) framePaths.push(rendered[i].fsName);

        return JSON.stringify({
            compName: comp.name,
            compId: comp.id,
            width: comp.width,
            height: comp.height,
            frameRate: frameRate,
            workAreaStart: workAreaStart,
            workAreaDuration: workAreaDuration,
            frameCount: framePaths.length,
            expectedCount: expectedCount,
            sessionDir: sessionDir.fsName,
            framePaths: framePaths
        });
    }

    // Imports the completed <sessionDir>/depth/ PNG sequence, moves it into
    // the chosen output folder, and drops it into the comp as a guide layer
    // spanning the captured work area. Replaces a previous range result for
    // the same comp instead of stacking.
    function importSequenceResult(argsJson) {
        var args = parse(argsJson); // { sessionDir, frameCount, compName, compId, outputFolder, workAreaStart, frameRate }
        var depthDir = new Folder(args.sessionDir + "/depth");
        if (!depthDir.exists) return JSON.stringify({ error: "Depth sequence folder not found: " + depthDir.fsName });

        app.beginUndoGroup("Import Depth Sequence");
        try {
            var comp = findComp(args.compId, args.compName);
            if (!comp) {
                app.endUndoGroup();
                return JSON.stringify({ error: "Comp not found: " + args.compName });
            }

            var outRoot = new Folder(args.outputFolder);
            if (!outRoot.exists) outRoot.create();
            var seqName = comp.name.replace(/[\\\/:*?"<>|]/g, "_") + "_Depth_Sequence";
            var destFolder = new Folder(outRoot.fsName + "/" + seqName);
            if (destFolder.exists) destFolder.remove();
            destFolder.create();

            for (var i = 0; i < args.frameCount; i++) {
                var src = new File(depthDir.fsName + "/frame_" + pad5(i) + ".png");
                if (!src.exists) {
                    app.endUndoGroup();
                    return JSON.stringify({ error: "Missing depth frame " + i + ": " + src.fsName });
                }
                src.copy(destFolder.fsName + "/frame_" + pad5(i) + ".png");
            }

            var firstFile = new File(destFolder.fsName + "/frame_00000.png");
            var io = new ImportOptions(firstFile);
            io.sequence = true;
            var item = app.project.importFile(io);
            try { item.mainSource.conformFrameRate = args.frameRate; } catch (e) {}

            var layerName = comp.name + "_DepthSeq";
            for (var li = comp.numLayers; li >= 1; li--) {
                if (comp.layer(li).name === layerName) comp.layer(li).remove();
            }

            var layer = comp.layers.add(item);
            layer.name = layerName;
            layer.startTime = args.workAreaStart;
            layer.moveToBeginning();
            layer.property("Transform").property("Position").setValue([comp.width / 2, comp.height / 2]);
            layer.property("Transform").property("Scale").setValue([
                (comp.width / item.width) * 100,
                (comp.height / item.height) * 100
            ]);
            layer.guideLayer = true;

            app.endUndoGroup();
            return JSON.stringify({
                imported: item.name,
                comp: comp.name,
                layer: layer.name,
                path: destFolder.fsName
            });
        } catch (e) {
            app.endUndoGroup();
            return JSON.stringify({ error: e.toString() });
        }
    }

    // Default output folder: an "EzDepth" folder next to the open .aep file.
    // Falls back to the OS temp dir if the project hasn't been saved yet.
    function defaultOutputFolder() {
        try {
            if (app.project.file) {
                return JSON.stringify({ folder: app.project.file.parent.fsName + "/EzDepth" });
            }
        } catch (e) {}
        return JSON.stringify({ folder: Folder.temp.fsName + "/EzDepth" });
    }

    // Native OS folder picker so the panel's "Browse" button can let the
    // user override the output folder.
    function chooseOutputFolder() {
        var picked = Folder.selectDialog("Choose EzDepth output folder");
        if (!picked) return JSON.stringify({ error: "cancelled" });
        return JSON.stringify({ folder: picked.fsName });
    }

    function findComp(compId, compName) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem) {
                if (compId && it.id === compId) return it;
                if (!compId && it.name === compName) return it;
            }
        }
        return null;
    }

    // Copies the finished depth PNG into the chosen output folder, imports
    // it, and drops it into the source comp as a guide layer (visible in the
    // viewer, excluded from renders) sized to fill the comp. Re-running
    // replaces the previous "<Comp>_Depth" layer instead of stacking.
    function importResult(argsJson) {
        var args = parse(argsJson); // { depthPath, compName, compId, outputFolder }
        var srcFile = new File(args.depthPath);
        if (!srcFile.exists) return JSON.stringify({ error: "Depth file not found: " + args.depthPath });

        app.beginUndoGroup("Import Depth Map");
        try {
            var comp = findComp(args.compId, args.compName);
            if (!comp) {
                app.endUndoGroup();
                return JSON.stringify({ error: "Comp not found: " + args.compName });
            }

            var destFolder = new Folder(args.outputFolder);
            if (!destFolder.exists) destFolder.create();
            var destName = comp.name.replace(/[\\\/:*?"<>|]/g, "_") + "_Depth.png";
            var destPath = destFolder.fsName + "/" + destName;
            srcFile.copy(destPath);
            var destFile = new File(destPath);

            var io = new ImportOptions(destFile);
            var item = app.project.importFile(io);

            var layerName = comp.name + "_Depth";
            for (var li = comp.numLayers; li >= 1; li--) {
                if (comp.layer(li).name === layerName) comp.layer(li).remove();
            }

            var layer = comp.layers.add(item, comp.duration);
            layer.name = layerName;
            layer.moveToBeginning();
            layer.property("Transform").property("Position").setValue([comp.width / 2, comp.height / 2]);
            layer.property("Transform").property("Scale").setValue([
                (comp.width / item.width) * 100,
                (comp.height / item.height) * 100
            ]);
            layer.guideLayer = true;

            app.endUndoGroup();
            return JSON.stringify({
                imported: item.name,
                comp: comp.name,
                layer: layer.name,
                path: destPath
            });
        } catch (e) {
            app.endUndoGroup();
            return JSON.stringify({ error: e.toString() });
        }
    }

    return {
        saveCurrentFrame: saveCurrentFrame,
        defaultOutputFolder: defaultOutputFolder,
        chooseOutputFolder: chooseOutputFolder,
        importResult: importResult,
        renderRangeToSequence: renderRangeToSequence,
        importSequenceResult: importSequenceResult
    };
})();
