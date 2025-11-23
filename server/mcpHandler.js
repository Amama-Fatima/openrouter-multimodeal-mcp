// mcpHandler.js
const config = require("./config");
const { cleanupSession } = require("./sessionManager");

function setupMcpListeners(sessionData, sessionId) {
  if (sessionData.listenersSetup) return;

  const handleResponse = (data) => {
    sessionData.responseBuffer += data.toString();

    let lines = sessionData.responseBuffer.split("\n");
    sessionData.responseBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        try {
          const parsed = JSON.parse(trimmedLine);

          if (parsed.id !== undefined) {
            const pendingRequest = sessionData.pendingRequests.get(parsed.id);
            if (pendingRequest) {
              // Clear progress interval when response received
              if (pendingRequest.progressInterval) {
                clearInterval(pendingRequest.progressInterval);
                console.log(
                  `Cleared progress interval for request ${parsed.id}`
                );
              }

              clearTimeout(pendingRequest.timeout);
              const responseTime = Date.now() - pendingRequest.timestamp;
              console.log(
                `Response received in ${responseTime}ms for ID ${parsed.id}`
              );
              sessionData.pendingRequests.delete(parsed.id);

              // Handle initialize response
              if (pendingRequest.method === "initialize" && !parsed.error) {
                console.log(
                  "🔍 INITIALIZE RESPONSE CAPABILITIES:",
                  JSON.stringify(parsed.result?.capabilities, null, 2)
                );
                sessionData.initialized = true;
                sessionData.initializing = false;
                console.log(`Session ${sessionId} initialized successfully`);

                if (!parsed.result) parsed.result = {};
                parsed.result.sessionId = sessionId;

                if (!parsed.result.protocolVersion) {
                  parsed.result.protocolVersion = config.mcp.protocolVersion;
                }
              }

              console.log("Sending MCP response:", JSON.stringify(parsed));

              if (!pendingRequest.res.headersSent) {
                pendingRequest.res.json(parsed);
              }
              return;
            }
          } else if (parsed.method) {
            // Server-initiated notification
            console.log(
              `Forwarding server notification: ${JSON.stringify(parsed)}`
            );
            if (sessionData.sseRes && !sessionData.sseRes.writableEnded) {
              sessionData.sseRes.write(`data: ${JSON.stringify(parsed)}\n\n`);
            }
          }
        } catch (e) {
          console.log(`Non-JSON MCP output: ${trimmedLine}`);
        }
      }
    }
  };

  sessionData.process.stdout.on("data", handleResponse);

  sessionData.process.stderr.on("data", (data) => {
    const error = data.toString().trim();
    console.error(`MCP Process Error:`, error);
  });

  sessionData.process.on("exit", (code, signal) => {
    console.error(
      `MCP process exited unexpectedly (code: ${code}, signal: ${signal}) for session ${sessionId}`
    );
    cleanupSession(sessionId, "process exited");
  });

  sessionData.listenersSetup = true;
}

function handleNotification(message, sessionData, res) {
  console.log(`Processing notification: ${message.method}`);

  const messageStr = JSON.stringify(message) + "\n";
  console.log("Sending notification to MCP process:", messageStr.trim());
  sessionData.process.stdin.write(messageStr);

  if (message.method === "notifications/initialized") {
    console.log("Session initialized, marking as ready");
    sessionData.initialized = true;
    sessionData.initializing = false;

    // Notify client of available tools
    setTimeout(() => {
      const toolsChangedNotification = {
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
      };

      console.log("Sending tools/list_changed notification via SSE");
      if (sessionData.sseRes && !sessionData.sseRes.writableEnded) {
        sessionData.sseRes.write(
          `data: ${JSON.stringify(toolsChangedNotification)}\n\n`
        );
      }
    }, 500);
  }

  return res.status(202).json({ success: true });
}

function getTimeoutForMethod(method) {
  if (method === "initialize") {
    return config.timeouts.INITIALIZATION_TIMEOUT;
  } else if (method === "tools/call") {
    return config.timeouts.REQUEST_TIMEOUT;
  }
  return config.timeouts.REQUEST_TIMEOUT;
}

function setupProgressInterval(message, sessionData) {
  if (
    message.method !== "tools/call" ||
    !sessionData.sseRes ||
    sessionData.sseRes.writableEnded
  ) {
    return null;
  }

  console.log(`Starting progress keep-alive for tool call ${message.id}`);
  let progressCount = 0;

  return setInterval(() => {
    if (sessionData.sseRes && !sessionData.sseRes.writableEnded) {
      progressCount++;
      sessionData.sseRes.write(`: progress ${progressCount}\n\n`);
      console.log(
        `Sent progress keep-alive ${progressCount} for request ${message.id}`
      );
    }
  }, config.timeouts.PROGRESS_INTERVAL);
}

module.exports = {
  setupMcpListeners,
  handleNotification,
  getTimeoutForMethod,
  setupProgressInterval,
};
