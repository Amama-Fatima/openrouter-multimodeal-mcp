# OpenRouter MCP Remote Server

Express wrapper for the OpenRouter MCP Server to enable remote access via HTTP.

## Setup

1. Install dependencies:

```bash
cd server
npm install
```

2. Create `.env` file (optional):

```bash
cp .env.example .env
```

3. Configure environment variables in `.env`:

- `OPENROUTER_API_KEY`: (Optional) Your OpenRouter API key for backward compatibility. **OAuth is now the primary authentication method.**
- `MCP_SECRET_PATH`: Secret path for securing the MCP endpoint (required)
- `PORT`: Server port (default: 10000)
- `OAUTH_TOKEN_EXPIRATION`: Token expiration in milliseconds (optional, null = no expiration)

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

### Public Endpoints
- `GET /health` - Health check
- `GET /` - Service information
- `GET /oauth/login` - Initiate OAuth authentication flow
- `GET /oauth/callback` - OAuth callback handler
- `GET /oauth/status` - Check authentication status (requires Bearer token)
- `GET /.well-known/oauth-protected-resource` - OAuth discovery endpoint (RFC 9728)
- `GET /.well-known/oauth-authorization-server` - OAuth server metadata (RFC 8414)

### Protected MCP Endpoints (Require Bearer Token)
- `GET /{SECRET_PATH}/mcp` - SSE connection for server-to-client messages
- `POST /{SECRET_PATH}/mcp` - Main MCP endpoint

### Debug Endpoints
- `GET /debug/sessions` - View active sessions (debug)
- `POST /debug/tools` - Test tools list (debug)

## Authentication

This server now supports **multi-user authentication** via OpenRouter's OAuth PKCE flow. See [OAUTH.md](./OAUTH.md) for detailed documentation.

**Quick Start:**
1. Visit `http://localhost:10000/oauth/login` to authenticate
2. After authentication, you'll receive a Bearer token
3. Use the token in the `Authorization: Bearer <token>` header for all MCP requests

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

2. Authenticate and get token:

```bash
# Step 1: Initiate OAuth (open in browser or follow redirect)
curl -L http://localhost:10000/oauth/login

# Step 2: After authentication, you'll receive a Bearer token
# Use it in subsequent requests:
TOKEN="your-bearer-token-here"
```

3. Test MCP connection (with authentication):

```bash
curl -X POST http://localhost:10000/{SECRET_PATH}/mcp \
  -H "Authorization: Bearer $TOKEN" \
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
- `sessionManager.js` - Session lifecycle and MCP process management (now user-aware)
- `mcpHandler.js` - MCP protocol message handling
- `middleware/auth.js` - Bearer token verification middleware
- `utils/oauth.js` - OAuth PKCE utilities
- `utils/tokenStorage.js` - Token storage and management
- `routes/health.js` - Health and info endpoints
- `routes/mcp.js` - Main MCP endpoints (protected)
- `routes/oauth.js` - OAuth authentication endpoints
- `routes/well-known.js` - OAuth discovery endpoints
- `routes/debug.js` - Debug and testing endpoints

## Multi-User Support

This server now supports multiple users, each with their own OpenRouter API key obtained via OAuth. Each user's requests are isolated and use their own credentials. See [OAUTH.md](./OAUTH.md) for complete documentation.
