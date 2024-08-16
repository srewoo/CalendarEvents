const fs = require("fs");
const axios = require("axios");
const config = require("./config.json");

let logBuffer = "";

// Function to create a bot and return its ID and start time
async function createBot(authHeader, requestBody) {
    try {
        const startTime = new Date().toISOString();
        console.log("create bot start time: " + startTime);

        const response = await axios.post(
            "https://api.recall.ai/api/v1/bot",
            requestBody,
            {
                headers: {
                    Authorization: authHeader,
                    "Content-Type": "application/json",
                },
            }
        );

        console.log(response.data);
        const botId = response.data.id;
        const botStartTime = new Date(response.headers.date).toISOString(); // Convert to ISO date string

        const apiExecutionTime =
            new Date().getTime() - new Date(startTime).getTime();
        console.log("create bot time: " + botStartTime);
        console.log("API took " + apiExecutionTime + " ms to execute");

        return { botId, botStartTime, apiExecutionTime };
    } catch (error) {
        console.error("Error creating bot:", error);
        writeToLog(`Error creating bot: ${error.message}`);
        throw error;
    }
}

// Function to fetch bot details by ID with retries until 'in_call_not_recording' is visible
async function getBotDetails(authHeader, botId) {
    const maxRetries = 25;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            const response = await axios.get(
                `https://api.recall.ai/api/v1/bot/${botId}`,
                {
                    headers: {
                        Authorization: authHeader,
                        "Content-Type": "application/json",
                    },
                }
            );

            console.log("Bot details response for ID " + botId + ":", response.data);

            // Check if 'in_call_not_recording' is visible in the response body
            const statusChanges = response.data.status_changes;
            const inWaitingRoom = statusChanges.some(
                (status) => status.code === "in_call_not_recording"
            );

            if (inWaitingRoom) {
                const botJoinTime = new Date(
                    statusChanges.find(
                        (status) => status.code === "in_call_not_recording"
                    ).created_at
                );
                return { botId, botJoinTime };
            } else {
                // Retry after a delay if 'in_call_not_recording' is not visible
                retries++;
                console.log(
                    `'in_call_not_recording' not visible in response for bot ID ${botId}. Retrying (${retries}/${maxRetries})...`
                );
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        } catch (error) {
            console.error(`Error fetching bot details for ID ${botId}:`, error);
            writeToLog(
                `Error fetching bot details for ID ${botId}: ${error.message}`
            );
            throw error;
        }
    }

    // Max retries exceeded without success
    throw new Error(
        `Failed to fetch bot details for ID ${botId} after ${maxRetries} retries.`
    );
}

// Function to make the bot leave the call and return the leave request and actual leave times
async function leaveBotCall(authHeader, botId) {
    try {
        const leaveRequestTime = new Date().toISOString();
        console.log("leave call request time: " + leaveRequestTime);

        await axios.post(
            `https://api.recall.ai/api/v1/bot/${botId}/leave_call`,
            {},
            {
                headers: {
                    Authorization: authHeader,
                    "Content-Type": "application/json",
                },
            }
        );

        const maxRetries = 25;
        let retries = 0;

        while (retries < maxRetries) {
            const response = await axios.get(
                `https://api.recall.ai/api/v1/bot/${botId}`,
                {
                    headers: {
                        Authorization: authHeader,
                        "Content-Type": "application/json",
                    },
                }
            );

            console.log(
                "Bot details response for leave call ID " + botId + ":",
                response.data
            );

            const statusChanges = response.data.status_changes;
            const botReceivedLeaveCall = statusChanges.find(
                (status) => status.sub_code === "bot_received_leave_call"
            );
            const botLeaveDone = statusChanges.find(
                (status) => status.code === "done"
            );

            if (botReceivedLeaveCall && botLeaveDone) {
                const actualBotLeaveTime = new Date(botLeaveDone.created_at);
                const timeToExit =
                    actualBotLeaveTime.getTime() - new Date(leaveRequestTime).getTime();

                return { botId, leaveRequestTime, actualBotLeaveTime, timeToExit };
            } else {
                retries++;
                console.log(
                    `Bot leave call status not complete for bot ID ${botId}. Retrying (${retries}/${maxRetries})...`
                );
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }

        throw new Error(
            `Failed to get leave call status for bot ID ${botId} after ${maxRetries} retries.`
        );
    } catch (error) {
        console.error(`Error making bot leave call for ID ${botId}:`, error);
        writeToLog(`Error making bot leave call for ID ${botId}: ${error.message}`);
        throw error;
    }
}

// Function to fetch bot details until video_url is not null
async function waitForVideoURL(authHeader, botId, leaveRequestTime) {
    const maxRetries = 25;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            const response = await axios.get(
                `https://api.recall.ai/api/v1/bot/${botId}`,
                {
                    headers: {
                        Authorization: authHeader,
                        "Content-Type": "application/json",
                    },
                }
            );

            console.log(
                "Bot details response for video URL check ID " + botId + ":",
                response.data
            );

            if (response.data.video_url) {
                const callEndedTime = new Date(
                    response.data.status_changes.find(
                        (status) => status.code === "call_ended"
                    ).created_at
                );

                const videoURLTime = new Date(
                    response.data.status_changes.find(
                        (status) => status.code === "done"
                    ).created_at
                );

                const videoCreationTime =
                    videoURLTime.getTime() - callEndedTime.getTime();

                return {
                    videoURL: response.data.video_url,
                    videoURLTime,
                    videoCreationTime,
                };
            } else {
                retries++;
                console.log(
                    `video_url not available for bot ID ${botId}. Retrying (${retries}/${maxRetries})...`
                );
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        } catch (error) {
            console.error(
                `Error fetching bot details for video URL check ID ${botId}:`,
                error
            );
            writeToLog(
                `Error fetching bot details for video URL check ID ${botId}: ${error.message}`
            );
            throw error;
        }
    }

    throw new Error(
        `Failed to fetch video URL for bot ID ${botId} after ${maxRetries} retries.`
    );
}

// Function to write to log file
function writeToLog(message) {
    logBuffer += `${new Date().toISOString()} - ${message}\n`;
}


// Write accumulated logs to file
function flushLogsToFile() {
    fs.appendFileSync("test.log", logBuffer);
    logBuffer = "";
}

// Jest test suite for load profiles
describe("Load Testing API to Send Bot to Google Meet Call", () => {
    config.profiles.forEach((profile) => {
        test(
            `Load Profile: ${profile.name}`,
            async () => {
                try {
                    const authHeader = config.authToken;
                    const requestBody = config.requestBody;

                    const promises = [];

                    for (let i = 0; i < profile.numBots; i++) {
                        const promise = (async () => {
                            const { botId, botStartTime, apiExecutionTime } = await createBot(
                                authHeader,
                                requestBody
                            );

                            const { botJoinTime } = await getBotDetails(authHeader, botId);

                            const timeTakenToJoin =
                                new Date(botJoinTime).getTime() -
                                new Date(botStartTime).getTime();

                            // Make bot stay in call for 15 sec
                            await new Promise((resolve) => setTimeout(resolve, 15000));

                            // Make bot leave call
                            const { leaveRequestTime, actualBotLeaveTime, timeToExit } =
                                await leaveBotCall(authHeader, botId);

                            // Wait for video URL and calculate video creation time
                            const { videoURL, videoURLTime, videoCreationTime } =
                                await waitForVideoURL(authHeader, botId, leaveRequestTime);

                            // Write consolidated log entry for this bot
                            writeToLog(
                                `Bot ID: ${botId}, Create bot API execution time: ${apiExecutionTime}ms, Time Taken for bot to Join: ${timeTakenToJoin}ms, Time taken for bot to Exit: ${timeToExit}ms, Video Creation Time: ${videoCreationTime}ms`
                            );

                            console.log(
                                `Bot ID: ${botId}, create bot API execution time: ${apiExecutionTime}ms, Time Taken for bot to Join: ${timeTakenToJoin}ms, Time taken for bot to Exit: ${timeToExit}ms, Video Creation Time: ${videoCreationTime}ms`
                            );
                        })();
                        promises.push(promise);
                    }

                    await Promise.all(promises);

                    // Flush logs to file after completing each profile's tests
                    flushLogsToFile();
                } catch (error) {
                    // Handle any errors
                    console.error(`Error in ${profile.name} load profile test:`, error);
                    writeToLog(
                        `Error in ${profile.name} load profile test: ${error.message}`
                    );
                    throw error;
                }
            },
            config.timeout
        );
    });
});

process.on("exit", () => {
    flushLogsToFile();
});
