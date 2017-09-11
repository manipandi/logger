/**
 * Logger Module
 * Each logger object is automatically detects the process type 
 * and creates seperate log based on its process type.
 * If any error occurs it is automatically notified using bugsnag,
 * You can set LOGS_EXPIRY = no. of days to get the corresponding logs
 * Create object of class by requiring 'logger' module
 * Disable and Enable logging using enableLogging() and disableLogging()
 * Also we support bugsnag here so you can register your bugsnag by uncommenting 
 * include bugsnagKey : <your API key> in your package.json 
 * by default bugsnag.notify is added to the error method.
 * Example:
 *     logger = new logger({
 *         [fileName: <custom filename>,]
 *         [isWebview = <boolean value stating whether its a webview logs>,]
 *         [domain = <title or info stating its presence>]
 *     });
 *     logger.<level>(<message>);
 *     logger.pruneOldLogs().then(result=>console.log(result)); 
 * Note :
 *       getLogArchive(), clearLogArchive() and pruneOldLogs() return promise.
 */
let winston = require("winston");
let fs = require("fs-extra");
let util = require("util");
let path = require("path");
let jsZip = require("jszip");
let bugsnag = require("bugsnag");
let store = require("electron-store");
store = new store({
  name: "logger"
});
try {
  store.get('fileLogging');
} catch (e) {
  store.set('fileLogging', true);
}
const LOGS_EXPIRY = 7;
const APP_NAME = require("../../package.json").name || "electron-app";
const LOGSDIR = path.join(getAppDataLoc(), `${APP_NAME}-logs`);
const bugsnagKey = require("../../package.json").bugsnagKey || null;
const CUSTOMLEVELS = {
  levels: {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  },
  colors: {
    debug: "blue",
    info: "green",
    warn: "yellow",
    error: "red"
  }
};
if (!util.isNull(bugsnagKey)) {
  bugsnag.register(bugsnagKey);
}
/**
 * Setting up configuration for winston file transport and returns config object
 * @param  {process type}
 * @param  {Boolean}
 * @param  {string}
 * @return {object}
 */
function getConfig(type, isWebview, domain = "webview", fileName) {
  let filename = null;
  let config = {
    name: 'fileTransport',
    prettyPrint: true,
    levels: CUSTOMLEVELS.levels,
    json: false,
    colorize: true,
    filename: null,
    timestamp: function() {
      let now = new Date();
      return `${now.toLocaleString("en-US", {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        })}.${now.getMilliseconds()}`;
    },
    formatter: function(options) {
      return `${options.timestamp()}::${options.level}::${options.message}`;
    }
  };
  switch (type) {
    case "renderer":
      if (isWebview) {
        filename = `${domain}.log`;
      } else {
        filename = `renderer.log`;
      }
      break;
    case "browser":
      createNewSession();
      filename = `main.log`;
      break;
    default:
      filename = `default.log`;
  }
  if (fileName) {
    filename = filename.replace(/^/, `${fileName}-`);
  }
  let sessionFolder = store.get('session');
  if (!fs.existsSync(path.join(LOGSDIR, sessionFolder))) {
    fs.mkdirSync(path.join(LOGSDIR, sessionFolder));
  }
  config.filename = path.join(LOGSDIR, sessionFolder, filename);
  return config;
}
/**
 * appdata location based on platform
 * @return {string}
 */
function getAppDataLoc() {
  return (
    process.env.LOCALAPPDATA ||
    path.join(process.env.HOME, "/Library/Application Support")
  );
}
/**
 * creates and persists latest session in electron-store
 */
function createNewSession() {
  let date = new Date();
  let timestamp = `${date.toLocaleString("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  })}`;
  timestamp = timestamp.replace(/\/|:/g, "-").replace(/, /g, "_");
  store.set('session', timestamp);

}
/**
 * Log expiry time in milliseconds
 * @return {ms}
 */
function getLogExpiry() {
  return new Date().getTime() - 24 * 60 * 60 * 1000 * LOGS_EXPIRY;
}
/**
 * Converts input content to String using util.inspect
 * @param  {array} 
 * @return {string} 
 */
function getMessage(content) {
  let data = "";
  for (let value of content) {
    data += util.inspect(value) + "\n\t";
  }
  return data;
}
/**
 * Finds all log files in the @LOGSDIR and returns log files array
 * @return {array}
 */
async function getContents(path) {
  try {
    let contents = await fs.readdir(path);
    return contents.filter(function(file) {
      return !((/^\./.test(file)) || (/.zip$/.test(file)))
    });
  } catch (e) {
    console.log(e);
    return e;
  }
}
/**
 * Finds file creation time and returns file creation time in ms
 * @param  {file}
 * @return {ms}
 */
async function getLogBirthTime(file) {
  try {
    let stat = await fs.stat(path.join(LOGSDIR, file));
    return stat.birthtime.getTime();
  } catch (e) {
    console.log(e);
    return e;
  }
}
/**
 * Archives recent logs and returns zip path
 * @return {string} 
 */
async function getRecentLogs() {
  try {
    let zip = new jsZip();
    let zipName = `logs-${Date.now()}.zip`;
    let sessions = await getContents(LOGSDIR);
    for (let session of sessions) {
      if ((await getLogBirthTime(session)) >= getLogExpiry()) {
        let logs = await getContents(path.join(LOGSDIR, session));
        for (let log of logs) {
          zip.file(`${session}/${log}`,
            await fs.readFile(path.join(LOGSDIR, session, log)));
        }
      }
    }
    return new Promise(resolve => {
      zip
        .generateNodeStream({
          type: "nodebuffer",
          streamFiles: true,
          compression: "DEFLATE"
        })
        .pipe(fs.createWriteStream(path.join(LOGSDIR, zipName)))
        .on("finish", () => {
          resolve(path.join(LOGSDIR, zipName));
        });
    });
  } catch (e) {
    console.log(e);
    return e;
  }
}
/**
 * Deletes logs Older than @LOGS_EXPIRY
 * @return {promise}
 */
async function pruneOldLogs(time = null) {
  try {
    let sessions = await getContents(LOGSDIR);
    let expiryTime = time || getLogExpiry();
    for (let session of sessions) {
      if ((await getLogBirthTime(session)) < expiryTime) {
        await fs.remove(path.join(LOGSDIR, session));
      }
    }
    return `Logs older than ${LOGS_EXPIRY} day(s) Cleared`;
  } catch (e) {
    console.log(e);
    return e;
  }
}
class Logger {
  constructor({fileName = "", isWebview = false, domain = null, type = process.type}) {
    if (!fs.existsSync(LOGSDIR)) {
      fs.mkdirSync(LOGSDIR);
    }
    pruneOldLogs();
    this.logAPI = new winston.Logger({
      level: "error",
      levels: CUSTOMLEVELS.levels,
      transports: [
        new winston.transports.File(
          getConfig(type, isWebview, domain, fileName)
        )
      ]
    });
    this.isWebview = isWebview;
    winston.addColors(CUSTOMLEVELS.colors);
  }
  debug(...content) {
    if (store.get('fileLogging'))
      this.logAPI.debug(getMessage(content));
  }
  log(...content) {
    if (store.get('fileLogging'))
      this.logAPI.info(getMessage(content));
  }
  info(...content) {
    if (store.get('fileLogging'))
      this.logAPI.info(getMessage(content));
  }
  warn(...content) {
    if (store.get('fileLogging'))
      this.logAPI.warn(getMessage(content));
  }
  error(...content) {
    let data = getMessage(content);
    if (store.get('fileLogging'))
      this.logAPI.error(data);
    if (!util.isNull(bugsnagKey) && !this.isWebview) {
      bugsnag.notify(new Error(data));
    }
  }
  pruneOldLogs(time) {
    return pruneOldLogs(time);
  }
  getLogArchive() {
    return getRecentLogs()
  }
  clearLogArchive(path) {
    return fs.remove(path);
  }
  enableLogging() {
    store.set('fileLogging', true);
    return "Logging Enabled";
  }
  disableLogging() {
    store.set('fileLogging', false);
    return "Logging Disabled";
  }
}
module.exports = Logger;