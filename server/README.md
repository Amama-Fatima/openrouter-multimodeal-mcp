# OpenRouter MCP Remote Server

Express wrapper for the OpenRouter MCP Server to enable remote access via HTTP.

## Setup

1. Install dependencies:

```bash
cd server
npm install
```

2. Create `.env` file:

```bash
cp .env.example .env
```

3. Configure environment variables in `.env`:

- `OPENROUTER_API_KEY`: Your OpenRouter API key
- `MCP_SECRET_PATH`: Secret path for securing the MCP endpoint
- `PORT`: Server port (default: 10000)

4. Build the main MCP server (from root directory):

```bash
cd ..
npm run build
```

5. Start the remote server:

```bash
cd server
npm start
```

## Endpoints

- `GET /health` - Health check
- `GET /` - Service information
- `GET /{SECRET_PATH}/mcp` - SSE connection for server-to-client messages
- `POST /{SECRET_PATH}/mcp` - Main MCP endpoint
- `GET /debug/sessions` - View active sessions (debug)
- `POST /debug/tools` - Test tools list (debug)

## Configuration

### Timeouts

- `REQUEST_TIMEOUT`: 3 minutes (180000ms)
- `SESSION_IDLE_TIMEOUT`: 30 minutes (1800000ms)
- `SESSION_MAX_LIFETIME`: 1 hour (3600000ms)
- `INITIALIZATION_TIMEOUT`: 30 seconds (30000ms)

### Features

- Session management with automatic cleanup
- Request timeout handling with progress intervals
- SSE (Server-Sent Events) for server-initiated notifications
- CORS enabled for cross-origin requests
- Graceful shutdown handling

## Development

Run with auto-reload:

```bash
npm run dev
```

## Production Deployment

Set environment variables:

```bash
export OPENROUTER_API_KEY=your_key
export MCP_SECRET_PATH=your_secret
export PORT=10000
```

Run:

```bash
npm start
```

## Testing

1. Check health:

```bash
curl http://localhost:10000/health
```

2. Test MCP connection:

```bash
curl -X POST http://localhost:10000/{SECRET_PATH}/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0.0"}
    }
  }'
```

## Architecture

- `server.js` - Express app setup and lifecycle
- `config.js` - Configuration management
- `sessionManager.js` - Session lifecycle and MCP process management
- `mcpHandler.js` - MCP protocol message handling
- `routes/health.js` - Health and info endpoints
- `routes/mcp.js` - Main MCP endpoints
- `routes/debug.js` - Debug and testing endpoints
