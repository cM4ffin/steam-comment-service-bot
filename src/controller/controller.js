/*
 * File: controller.js
 * Project: steam-comment-service-bot
 * Created Date: 09.07.2021 16:26:00
 * Author: 3urobeat
 *
 * Last Modified: 13.04.2023 16:35:47
 * Modified By: 3urobeat
 *
 * Copyright (c) 2021 3urobeat <https://github.com/HerrEurobeat>
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
 */


const { EventEmitter } = require("events");


/**
 * Constructor - Initializes the controller and starts all bot accounts
 * @extends EventEmitter
 */
const Controller = function() {
    this.srcdir = srcdir; // Let users see the global var srcdir more easily

    // Create eventEmitter
    this.events = new EventEmitter();

    /**
     * The commandHandler object
     * @type {CommandHandler}
     */
    this.commandHandler = {};

    /**
     * The pluginSystem handler
     * @type {PluginSystem}
     */
    this.pluginSystem = {};

    /* ------------ Store various stuff: ------------ */
    this.bots = {}; // Store references to all bot account objects here

    /**
     * The main bot account
     * @type {Bot}
     */
    this.main = {}; // Store short-hand reference to the main acc (populated later)

    this.info = {
        bootStartTimestamp: Date.now(), // Save timestamp to be able to calculate startup time in ready event
        lastLoginTimestamp: 0,  // Save timestamp of last login attempted by any account to calculate wait time for next account
        steamGuardInputTime: 0,
        readyAfter: 0, // Length of last startup in seconds
        activeRelog: false, // Allows to block new comment requests when waiting for the last request to finish
        commentCounter: 0
    };

    this.activeRequests = {}; // Stores active comment etc. requests

    this.relogQueue = [];

    // TODO: Legacy stuff, filter out what is not needed
    this.skippednow            = [];    // Array to track which accounts have been skipped
    this.relogAfterDisconnect  = true;  // Allows to prevent accounts from relogging when calling bot.logOff()
    this.failedcomments        = [];    // Array saving failedcomments so the user can access them via the !failedcomments command
    this.activecommentprocess  = {};    // Object storing active comment processes so that a user can only request one process at a time, used accounts can only be used in one session, have a cooldown (not the user! that is handled by lastcomment) and the updater is blocked
    this.lastcommentrequestmsg = [];    // Array saving the last comment cmd request to apply higher cooldown to the comment cmd usage compared to normal cmd usage cooldown

};


/**
 * Internal: Inits the DataManager system, runs the updater and starts all bot accounts
 */
Controller.prototype._start = async function() {
    let checkAndGetFile = require("../starter.js").checkAndGetFile; // Temp var to use checkAndGetFile() before it is referenced in DataManager

    /* ------------ Init error handler: ------------ */
    if (!checkAndGetFile("./src/controller/helpers/handleErrors.js", logger, false, false)) return;
    this._handleErrors();


    /* ------------ Introduce logger function: ------------ */
    if (!checkAndGetFile("./src/controller/helpers/logger.js", logger, false, false)) return;
    logger = this.logger; // Update "fake" logger with "real" logger

    // Log held back messages from before this start
    if (logafterrestart.length > 0) {
        logger("", "\n\n", true);

        logafterrestart.forEach((e) => { // Log messages to output.txt carried through restart
            e.split("\n").forEach((f) => { // Split string on line breaks to make output cleaner when using remove
                logger("", "[logafterrestart] " + f, true, true);
            });
        });
    }

    logafterrestart = []; // Clear array // TODO: Export logafterrestart or smth


    /* ------------ Mark new execution in output: ------------ */
    logger("", "\n\nBootup sequence started...", true, true);
    logger("", "---------------------------------------------------------", true, true);


    /* ------------ Init dataManager system and import: ------------ */
    if (!checkAndGetFile("./src/dataManager/dataManager.js", logger, false, false)) return;
    let DataManager = require("../dataManager/dataManager.js");

    this.data = new DataManager(this); // All functions provided by the DataManager, as well as all imported file data will be accessible here

    await this.data._importFromDisk();

    // Call optionsUpdateAfterConfigLoad() to set previously inaccessible options
    this._loggerOptionsUpdateAfterConfigLoad(this.data.advancedconfig);


    /* ------------ Print startup messages to log and set terminal title: ------------ */
    logger("info", `steam-comment-service-bot made by ${this.data.datafile.mestr} version ${this.data.datafile.versionstr} (branch ${this.data.datafile.branch})`, false, true, logger.animation("loading"));
    logger("info", `This is start number ${this.data.datafile.timesloggedin + 1} (firststart ${this.data.datafile.firststart}) on ${process.platform} with node.js ${process.version}...`, false, true, logger.animation("loading"));

    if (process.platform == "win32") { // Set node process name to find it in task manager etc.
        process.title = `${this.data.datafile.mestr}'s Steam Comment Service Bot v${this.data.datafile.versionstr} | ${process.platform}`; // Windows allows long terminal/process names
    } else {
        process.stdout.write(`${String.fromCharCode(27)}]0;${this.data.datafile.mestr}'s Steam Comment Service Bot v${this.data.datafile.versionstr} | ${process.platform}${String.fromCharCode(7)}`); // Sets terminal title (thanks: https://stackoverflow.com/a/30360821/12934162)
        process.title = "CommentBot"; // Sets process title in task manager etc.
    }


    // Check for unsupported node.js version (<14.15.0)
    let versionarr = process.version.replace("v", "").split(".");

    versionarr.forEach((e, i) => { if (e.length == 1 && parseInt(e) < 10) versionarr[i] = `0${e}`; }); // Put 0 in front of single digits

    if (parseInt(versionarr.join("")) < 141500) {
        logger("", "\n************************************************************************************\n", true);
        logger("error", `This application requires at least node.js ${logger.colors.reset}v14.15.0${logger.colors.fgred} but you have ${logger.colors.reset}${process.version}${logger.colors.fgred} installed!\n        Please update your node.js installation: ${logger.colors.reset} https://nodejs.org/`, true);
        logger("", "\n************************************************************************************\n", true);
        return this.stop();
    }


    /* ------------ Check imported data : ------------ */

    // TODO: Remove, exists for compatibility
    global.cachefile      = this.data.cachefile;
    global.extdata        = this.data.datafile;
    global.config         = this.data.config;
    global.advancedconfig = this.data.advancedconfig;
    module.exports.lastcomment = this.data.lastCommentDB;

    // Process imported owner & group ids and update cachefile
    await this.data.processData();

    // Check imported data
    await this.data.checkData().catch(() => this.stop()); // Terminate the bot if some critical check failed


    /* ------------ Run updater or start logging in: ------------ */
    let updater = await checkAndGetFile("./src/updater/updater.js", logger, false, false);
    if (!updater) return;

    updater.compatibility(async () => { // Continue startup on any callback

        if (updateFailed) { // Skip checking for update if last update failed
            logger("info", `It looks like the last update failed so let's skip the updater for now and hope ${this.data.datafile.mestr} fixes the issue.\n       If you haven't reported the error yet please do so as I'm only then able to fix it!`, true);

            require("./login.js"); // Load helper
            this._preLogin(); // Run one-time pre-login tasks
            this.login(); // Start logging in

        } else {

            require("../updater/updater.js").run(false, null, false, (foundanddone2, updateFailed) => {
                if (!foundanddone2) {
                    require("./login.js"); // Load helper
                    this._preLogin(); // Run one-time pre-login tasks
                    this.login(); // Start logging in
                } else {
                    this.restart(JSON.stringify({ skippedaccounts: this.skippedaccounts, updatefailed: updateFailed == true })); // Send request to parent process (checking updateFailed == true so that undefined will result in false instead of undefined)
                }
            });
        }

    });
};

module.exports = Controller;


/* ------------ Handle restart data: ------------ */

/**
 * Process data that should be kept over restarts
 */
function restartdata(data) {
    data = JSON.parse(data); // Convert the stringified object back to an object

    if (data.oldconfig) oldconfig = data.oldconfig //eslint-disable-line
    if (data.logafterrestart) logafterrestart = data.logafterrestart; // We can't print now since the logger function isn't imported yet.
    if (data.skippedaccounts) module.exports.skippedaccounts = data.skippedaccounts;
    if (data.updatefailed) updateFailed = data.updatefailed;
}

// Make a "fake" logger backup function to use when no npm packages were installed
let logger = function(type, str) {
    logafterrestart.push(`${type} | ${str}`); // Push message to array that will be carried through restart
    console.log(`${type} | ${str}`);
};
logger.animation = () => {}; // Just to be sure that no error occurs when trying to call this function without the real logger being present


/* ------------ Start the bot: ------------ */ // TODO: Not rewritten yet

if (parseInt(process.argv[3]) + 2500 > Date.now()) { // Check if this process just got started in the last 2.5 seconds or just required by itself by checking the timestamp attached by starter.js

    // Obj that can get populated by restart data to keep config through restarts
    var oldconfig = {} //eslint-disable-line
    var logafterrestart = []; // Create array to log these error messages after restart
    var updateFailed = false;

    // Yes, I know, global variables are bad. But I need a few multiple times in different files and it would be a pain in the ass to import them every time and ensure that I don't create a circular dependency and what not.
    global.botisloggedin = false;
    global.srcdir        = process.argv[2];

    module.exports.skippedaccounts = []; // Array to save which accounts have been skipped to skip them automatically when restarting

    // Start the bot through the restartdata function if this is a restart to keep some data or start the bot directly
    if (process.argv[4]) restartdata(process.argv[4]);

    // Start the bot
    let controller = new Controller();
    controller._start();
}


/* -------- Register functions to let the IntelliSense know what's going on in helper files -------- */

/**
 * Restarts the whole application
 * @param {String} data Stringified restartdata object that will be kept through restarts
 */
Controller.prototype.restart = function(data) { process.send(`restart(${data})`); };

/**
 * Stops the whole application
 */
Controller.prototype.stop = function() { process.send("stop()"); };

/**
 * Internal: Performs certain checks before logging in for the first time and then calls login()
 */
Controller.prototype._preLogin = async function() {};

/**
 * Attempts to log in all bot accounts which are currently offline one after another
 * Creates a new bot object for every new account and reuses existing one if possible
 */
Controller.prototype.login = function() {};

/**
 * Runs internal ready event code and emits ready event for plugins
 */
Controller.prototype._readyEvent = function() {};

/**
 * Runs internal statusUpdate event code and emits statusUpdate event for plugins
 * @param {Bot} bot Bot instance
 * @param {String} newStatus The new status
 */
Controller.prototype._statusUpdateEvent = function(bot, newStatus) {}; // eslint-disable-line

/**
 * Finds all needed and currently available bot accounts for a comment request.
 * @param {Number} numberOfComments Number of requested comments
 * @param {Boolean} canBeLimited If the accounts are allowed to be limited
 * @param {String} receiverSteamID Optional: steamID64 of the receiving user. If set, accounts that are friend with the user will be prioritized and accsToAdd will be calculated.
 * @returns {Object} Object containing `accsNeeded` (Number), `availableAccounts` (Array of account names from bot object), `accsToAdd` (Array of account names from bot object which are limited and not friend) and `whenAvailable` (Timestamp representing how long to wait until accsNeeded amount of accounts will be available)
 */
Controller.prototype.getAvailableAccountsForCommenting = function(numberOfComments, canBeLimited, receiverSteamID = null) {}; // eslint-disable-line

/**
 * Logs text to the terminal and appends it to the output.txt file.
 * @param {String} type String that determines the type of the log message. Can be info, warn, error, debug or an empty string to not use the field.
 * @param {String} str The text to log into the terminal
 * @param {Boolean} nodate Setting to true will hide date and time in the message
 * @param {Boolean} remove Setting to true will remove this message with the next one
 * @param {Boolean} printNow Ignores the readyafterlogs check and force prints the message now
 */
Controller.prototype.logger = function(type, str, nodate, remove, animation, printNow) {}; // eslint-disable-line