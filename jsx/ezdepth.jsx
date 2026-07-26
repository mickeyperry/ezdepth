// Auto-loaded by the CEP panel via manifest <ScriptPath>.
// Defines EZDEPTH.* — called by client/main.js via evalScript.

var EZDEPTH = (function () {

    function parse(json) { return eval("(" + json + ")"); }

    function activeComp() {
        var it = app.project.activeItem;
        return (it && it instanceof CompItem) ? it : null;
    }

    function tempFile(name) {
        var dir = new Folder(Folder.temp.fsName + "/ae-mcp-depth");
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

        if (!waitForStableFile(file, 4000)) {
            return JSON.stringify({ error: "saveFrameToPng did not produce a readable file: " + file.fsName });
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
        importResult: importResult
    };
})();
