/*
 * File: getCommentArgs.js
 * Project: steam-comment-service-bot
 * Created Date: 28.02.2022 11:55:06
 * Author: 3urobeat
 *
 * Last Modified: 24.09.2023 13:12:52
 * Modified By: 3urobeat
 *
 * Copyright (c) 2022 3urobeat <https://github.com/3urobeat>
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
 */


const CommandHandler = require("../commandHandler.js"); // eslint-disable-line


/**
 * Retrieves arguments from a comment request. If request is invalid (for example too many comments requested) an error message will be sent
 * @param {CommandHandler} commandHandler The commandHandler object
 * @param {Array} args The command arguments
 * @param {string} requesterSteamID64 The steamID64 of the requesting user
 * @param {CommandHandler.resInfo} resInfo Object containing additional information your respondModule might need to process the response (for example the userID who executed the command).
 * @param {function(string): void} respond The shortened respondModule call
 * @returns {Promise.<{ maxRequestAmount: number, commentcmdUsage: string, numberOfComments: number, profileID: string, idType: string, quotesArr: Array.<string> }>} Resolves promise with object containing all relevant data when done
 */
module.exports.getCommentArgs = (commandHandler, args, requesterSteamID64, resInfo, respond) => {
    return new Promise((resolve) => {
        (async () => { // Lets us use await insidea Promise without creating an antipattern

            // Get the correct ownerid array for this request
            let owners = commandHandler.data.cachefile.ownerid;
            if (resInfo.ownerIDs && resInfo.ownerIDs.length > 0) owners = resInfo.ownerIDs;

            let maxRequestAmount = commandHandler.data.config.maxComments; // Set to default value and if the requesting user is an owner it gets changed below
            let numberOfComments = 0;
            let quotesArr        = commandHandler.data.quotes;

            let profileID;
            let idType = "profile"; // Set profile as default because that makes sense (because it can only be a group/sharedfile/discussion when param was provided yk)


            /* --------- Define command usage messages & maxRequestAmount for each user's privileges --------- */
            let commentcmdUsage;

            if (owners.includes(requesterSteamID64)) {
                maxRequestAmount = commandHandler.data.config.maxOwnerComments;

                if (maxRequestAmount > 1) commentcmdUsage = await commandHandler.data.getLang("commentcmdusageowner", { "cmdprefix": resInfo.cmdprefix }, requesterSteamID64);
                    else commentcmdUsage = await commandHandler.data.getLang("commentcmdusageowner2", { "cmdprefix": resInfo.cmdprefix }, requesterSteamID64);
            } else {
                if (maxRequestAmount > 1) commentcmdUsage = await commandHandler.data.getLang("commentcmdusage", { "cmdprefix": resInfo.cmdprefix }, requesterSteamID64);
                    else commentcmdUsage = await commandHandler.data.getLang("commentcmdusage2", { "cmdprefix": resInfo.cmdprefix }, requesterSteamID64);
            }


            /* --------- Check numberOfComments argument if it was provided --------- */
            if (args[0] !== undefined) {
                if (isNaN(args[0])) { // Isn't a number?
                    if (args[0].toLowerCase() == "all" || args[0].toLowerCase() == "max") {
                        args[0] = maxRequestAmount; // Replace the argument with the max amount of comments this user is allowed to request
                    } else {
                        logger("debug", `CommandHandler getCommentArgs(): User provided invalid request amount "${args[0]}". Stopping...`);

                        respond(await commandHandler.data.getLang("invalidnumber", { "cmdusage": commentcmdUsage }, requesterSteamID64));
                        return resolve(false);
                    }
                }

                if (args[0] > maxRequestAmount) { // Number is greater than maxRequestAmount?
                    logger("debug", `CommandHandler getCommentArgs(): User requested ${args[0]} but is only allowed ${maxRequestAmount} comments. Stopping...`);

                    respond(await commandHandler.data.getLang("commentrequesttoohigh", { "maxRequestAmount": maxRequestAmount, "commentcmdusage": commentcmdUsage }, requesterSteamID64));
                    return resolve(false);
                }

                numberOfComments = args[0];


                /* --------- Check profileid argument if it was provided --------- */
                if (args[1]) {
                    if (owners.includes(requesterSteamID64) || args[1] == requesterSteamID64) { // Check if user is a bot owner or if he provided his own profile id
                        let arg = args[1];

                        commandHandler.controller.handleSteamIdResolving(arg, null, async (err, res, type) => {
                            if (err) {
                                respond((await commandHandler.data.getLang("commentinvalidid", { "commentcmdusage": commentcmdUsage }, requesterSteamID64)) + "\n\nError: " + err);
                                return resolve(false);
                            }

                            profileID = res; // Will be null on err
                            idType = type; // Update idType with what handleSteamIdResolving determined
                        });

                    } else {
                        logger("debug", "CommandHandler getCommentArgs(): Non-Owner tried to provide profileid for another profile. Stopping...");

                        profileID = null;
                        respond(await commandHandler.data.getLang("commentprofileidowneronly", null, requesterSteamID64));
                        return resolve(false);
                    }
                } else {
                    logger("debug", "CommandHandler getCommentArgs(): No profileID parameter received, setting profileID to requesterSteamID64...");

                    profileID = requesterSteamID64;
                    idType = "profile";
                }


                /* --------- Check if custom quotes were provided --------- */
                if (args[2] !== undefined) {
                    quotesArr = args.slice(2).join(" ").replace(/^\[|\]$/g, "").split(", "); // Change default quotes to custom quotes
                }

            } // Arg[0] if statement ends here


            /* --------- Check if user did not provide numberOfComments --------- */
            if (numberOfComments == 0) { // No numberOfComments given? Ask again if maxRequestAmount > 1 (numberOfComments default value at the top is 0)
                if (commandHandler.controller.getBots().length == 1 && maxRequestAmount == 1) {
                    logger("debug", "CommandHandler getCommentArgs(): User didn't provide numberOfComments but maxRequestAmount is 1. Accepting request as numberOfComments = 1.");

                    numberOfComments = 1;     // If only one account is active, set 1 automatically
                    profileID = requesterSteamID64; // Define profileID so that the interval below resolves
                } else {
                    logger("debug", `CommandHandler getCommentArgs(): User didn't provide numberOfComments and maxRequestAmount is ${maxRequestAmount} (> 1). Rejecting request.`);

                    respond(await commandHandler.data.getLang("commentmissingnumberofcomments", { "maxRequestAmount": maxRequestAmount, "commentcmdusage": commentcmdUsage }, requesterSteamID64));
                    return resolve(false);
                }
            }


            /* --------- Resolve promise with calculated values when profileID is defined --------- */
            let profileIDDefinedInterval = setInterval(() => { // Check if profileID is defined every 250ms and only then return values
                if (profileID != undefined) {
                    clearInterval(profileIDDefinedInterval);

                    // Log debug values
                    logger("debug", `CommandHandler getCommentArgs() success. maxRequestAmount: ${maxRequestAmount} | numberOfComments: ${numberOfComments} | ID: ${profileID} | idType: ${idType} | quotesArr.length: ${quotesArr.length}`);

                    // Return obj if profileID is not null, otherwise return false as an error has occurred, the user was informed and execution should be stopped
                    if (profileID) resolve({ maxRequestAmount, numberOfComments, profileID, idType, quotesArr });
                        else return resolve(false);
                }
            }, 250);

        })();
    });
};