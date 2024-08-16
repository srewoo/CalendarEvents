const fs = require('fs');
const axios = require('axios');
const config = require('./config.json'); 

// Function to create a bot and return its ID and start time
async function createBot(authHeader, requestBody) {
    try {
        const startTime = new Date().toISOString(); 
        console.log('create bot start time: ' + startTime);

        const response = await axios.post('https://api.recall.ai/api/v1/bot', requestBody, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            }
        });

        console.log(response.data);
        const botId = response.data.id; 
        const botStartTime = new Date(response.headers.date).toISOString(); // Convert to ISO date string

        // Measure API execution time
        const apiExecutionTime = new Date().getTime() - new Date(startTime).getTime();
        console.log('create bot time: ' + botStartTime);
        console.log('API took ' + apiExecutionTime + ' ms to execute');

        // Wait for an additional 15 seconds before returning
        await new Promise(resolve => setTimeout(resolve, 15000));

        return { botId, botStartTime, apiExecutionTime };
    } catch (error) {
        console.error('Error creating bot:', error);
        writeToLog(`Error creating bot: ${error.message}`);
        throw error;
    }
}

// Function to fetch bot details by ID with retries until 'in_waiting_room' is visible
async function getBotDetails(authHeader, botId) {
    const maxRetries = config.maxRetries || 25; 
    let retries = 0;

    while (retries < maxRetries) {
        try {
            const response = await axios.get(`https://api.recall.ai/api/v1/bot/${botId}`, {
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                }
            });

            console.log('Bot details response for ID ' + botId + ':', response.data);

            // Check if 'in_waiting_room' is visible in the response body
            const statusChanges = response.data.status_changes;
            const inWaitingRoom = statusChanges.some(status => status.code === 'in_waiting_room');
            
            if (inWaitingRoom) {
                const botJoinTime = new Date(statusChanges.find(status => status.code === 'in_waiting_room').created_at);
                return { botId, botJoinTime };
            } else {
                // Retry after a delay if 'in_waiting_room' is not visible
                retries++;
                console.log(`'in_waiting_room' not visible in response for bot ID ${botId}. Retrying (${retries}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, 2000)); 
            }
        } catch (error) {
            console.error(`Error fetching bot details for ID ${botId}:`, error);
            writeToLog(`Error fetching bot details for ID ${botId}: ${error.message}`);
            throw error; 
        }
    }

    // Max retries exceeded without success
    throw new Error(`Failed to fetch bot details for ID ${botId} after ${maxRetries} retries.`);
}

// Function to write to log file
function writeToLog(message) {
    fs.appendFileSync('test.log', `${new Date().toISOString()} - ${message}\n`);
}

// Jest test suite for load profiles
describe('Load Testing API to Send Bot to Google Meet Call', () => {
    config.profiles.forEach(profile => {
        test(`Load Profile: ${profile.name}`, async () => {
            try {
                const authHeader = config.authToken;
                const requestBody = config.requestBody;

                for (let i = 0; i < profile.numBots; i++) {
                    const { botId, botStartTime, apiExecutionTime } = await createBot(authHeader, requestBody);

                    // Wait for 2 seconds before fetching bot details
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    const { botJoinTime } = await getBotDetails(authHeader, botId);

                    const timeTakenToJoin = new Date(botJoinTime).getTime() - new Date(botStartTime).getTime();

                    // Log bot ID, start time, join time, and time taken to join
                    writeToLog(`Bot ID: ${botId}, API execution time: ${apiExecutionTime}ms, Start Time: ${botStartTime}, Join Time: ${botJoinTime.toISOString()}, Time Taken to Join: ${timeTakenToJoin}ms`);

                    // Log successful join
                    console.log(`Bot ID: ${botId}, API execution time: ${apiExecutionTime}ms, Start Time: ${botStartTime}, Join Time: ${botJoinTime.toISOString()}, Time Taken to Join: ${timeTakenToJoin}ms`);
                }
            } catch (error) {
                // Handle any errors
                console.error(`Error in ${profile.name} load profile test:`, error);
                writeToLog(`Error in ${profile.name} load profile test: ${error.message}`);
                throw error;
            }
        }, config.timeout); 
    });
});
