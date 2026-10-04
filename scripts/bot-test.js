const http = require("http");

const BOT_COUNT = 10;
const REQUESTS_PER_BOT = 5;

function sendRequest(botId, requestId) {
    const req = http.request(
        {
            hostname: "localhost",
            port: 3000,
            path: "/queue/status",
            method: "GET",
            headers: {
                "User-Agent": `FairDrop-TestBot/${botId}`,
                "X-Bot-Test": "true"
            }
        },
        (res) => {
            console.log(
                `Bot ${botId} | Request ${requestId} | Status ${res.statusCode}`
            );

            res.resume();
        }
    );

    req.on("error", (err) => {
        console.log(`Bot ${botId} | ERROR: ${err.message}`);
    });

    req.end();
}

for (let bot = 1; bot <= BOT_COUNT; bot++) {
    for (let request = 1; request <= REQUESTS_PER_BOT; request++) {
        setTimeout(() => {
            sendRequest(bot, request);
        }, bot * 200 + request * 100);
    }
}
