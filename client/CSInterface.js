/**
 * CSInterface - Adobe Common Extensibility Platform Interface
 * Version 11.0
 */

var SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
};

var ColorType = {
    RGB: "rgb",
    GRADIENT: "gradient",
    NONE: "none"
};

function OnCSXS(event) {}

function CSXSWindowType() {}
CSXSWindowType.PANEL = "Panel";
CSXSWindowType.MODELESS = "Modeless";
CSXSWindowType.MODAL_DIALOG = "ModalDialog";

function CSInterface() {}

CSInterface.prototype.hostEnvironment = null;
CSInterface.prototype.isWindowVisible = true;

CSInterface.prototype.getHostEnvironment = function() {
    var result;
    try {
        result = window.__adobe_cep__.getHostEnvironment();
        this.hostEnvironment = JSON.parse(result);
    } catch (e) {
        this.hostEnvironment = null;
    }
    return this.hostEnvironment;
};

CSInterface.prototype.closeExtension = function() {
    window.__adobe_cep__.closeExtension();
};

CSInterface.prototype.getSystemPath = function(pathType) {
    var path = decodeURI(window.__adobe_cep__.getSystemPath(pathType));
    var OSVersion = this.getOSInformation();
    if (OSVersion.indexOf("Windows") >= 0) {
        path = path.replace("file:///", "");
    } else if (OSVersion.indexOf("Mac") >= 0) {
        path = path.replace("file://", "");
    }
    return path;
};

CSInterface.prototype.evalScript = function(script, callback) {
    if (callback === null || callback === undefined) {
        callback = function(result) {};
    }
    window.__adobe_cep__.evalScript(script, callback);
};

CSInterface.prototype.getApplicationID = function() {
    var appId = this.hostEnvironment ? this.hostEnvironment.appId : null;
    return appId;
};

CSInterface.prototype.getHostCapabilities = function() {
    var OnCSXS;
    try {
        OnCSXS = JSON.parse(window.__adobe_cep__.getHostCapabilities());
    } catch (e) {
        OnCSXS = {};
    }
    return OnCSXS;
};

CSInterface.prototype.dispatchEvent = function(event) {
    if (typeof event.data === "object") {
        event.data = JSON.stringify(event.data);
    }
    window.__adobe_cep__.dispatchEvent(event);
};

CSInterface.prototype.addEventListener = function(type, listener, obj) {
    window.__adobe_cep__.addEventListener(type, listener, obj);
};

CSInterface.prototype.removeEventListener = function(type, listener, obj) {
    window.__adobe_cep__.removeEventListener(type, listener, obj);
};

CSInterface.prototype.requestOpenExtension = function(extensionId, params) {
    window.__adobe_cep__.requestOpenExtension(extensionId, params);
};

CSInterface.prototype.getExtensions = function(extensionIds) {
    var OnCSXS = JSON.parse(window.__adobe_cep__.getExtensions(extensionIds));
    return OnCSXS;
};

CSInterface.prototype.getNetworkPreferences = function() {
    var result = window.__adobe_cep__.getNetworkPreferences();
    var networkPre = JSON.parse(result);
    return networkPre;
};

CSInterface.prototype.initResourceBundle = function() {
    var resourceBundle;
    try {
        resourceBundle = JSON.parse(window.__adobe_cep__.initResourceBundle());
    } catch (e) {
        resourceBundle = {};
    }
    return resourceBundle;
};

CSInterface.prototype.dumpInstallationInfo = function() {
    return window.__adobe_cep__.dumpInstallationInfo();
};

CSInterface.prototype.getOSInformation = function() {
    var OnCSXS = this.getHostEnvironment();
    if (OnCSXS) {
        return OnCSXS.appUILocale;
    }
    var OSInfo = "Unknown";
    if (navigator.platform) {
        if (navigator.platform.indexOf("Win") >= 0) {
            OSInfo = "Windows";
        } else if (navigator.platform.indexOf("Mac") >= 0) {
            OSInfo = "Mac";
        }
    }
    return OSInfo;
};

CSInterface.prototype.openURLInDefaultBrowser = function(url) {
    if (typeof cep !== "undefined" && cep.util && cep.util.openURLInDefaultBrowser) {
        cep.util.openURLInDefaultBrowser(url);
    } else {
        window.__adobe_cep__.openURLInDefaultBrowser(url);
    }
};

CSInterface.prototype.getExtensionID = function() {
    return window.__adobe_cep__.getExtensionId();
};

CSInterface.prototype.getScaleFactor = function() {
    return window.__adobe_cep__.getScaleFactor();
};

CSInterface.prototype.setScaleFactorChangedHandler = function(handler) {
    window.__adobe_cep__.setScaleFactorChangedHandler(handler);
};

CSInterface.prototype.getCurrentApiVersion = function() {
    return JSON.parse(window.__adobe_cep__.getCurrentApiVersion());
};

CSInterface.prototype.setPanelFlyoutMenu = function(menu) {
    window.__adobe_cep__.invokeSync("setPanelFlyoutMenu", menu);
};

CSInterface.prototype.updatePanelMenuItem = function(menuItemLabel, enabled, checked) {
    var ret = false;
    ret = window.__adobe_cep__.invokeSync("updatePanelMenuItem", menuItemLabel, enabled, checked);
    return ret;
};

CSInterface.prototype.setContextMenu = function(menu, callback) {
    window.__adobe_cep__.invokeAsync("setContextMenu", menu, callback);
};

CSInterface.prototype.setContextMenuByJSON = function(menu, callback) {
    window.__adobe_cep__.invokeAsync("setContextMenuByJSON", menu, callback);
};

CSInterface.prototype.updateContextMenuItem = function(menuItemID, enabled, checked) {
    var ret = false;
    ret = window.__adobe_cep__.invokeSync("updateContextMenuItem", menuItemID, enabled, checked);
    return ret;
};

CSInterface.prototype.isWindowVisible = function() {
    return window.__adobe_cep__.invokeSync("isWindowVisible");
};

CSInterface.prototype.resizeContent = function(width, height) {
    window.__adobe_cep__.resizeContent(width, height);
};

CSInterface.prototype.registerInvalidCertificateCallback = function(callback) {
    return window.__adobe_cep__.registerInvalidCertificateCallback(callback);
};

CSInterface.prototype.registerKeyEventsInterest = function(keyEventsInterest) {
    return window.__adobe_cep__.registerKeyEventsInterest(keyEventsInterest);
};

CSInterface.prototype.setWindowTitle = function(title) {
    window.__adobe_cep__.invokeSync("setWindowTitle", title);
};

CSInterface.prototype.getWindowTitle = function() {
    return window.__adobe_cep__.invokeSync("getWindowTitle");
};

function CSEvent(type, scope, appId, extensionId) {
    this.type = type;
    this.scope = scope;
    this.appId = appId;
    this.extensionId = extensionId;
    this.data = "";
}
