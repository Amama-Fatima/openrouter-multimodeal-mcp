# OAuth Authentication for OpenRouter MCP Server

This MCP server now supports **multi-user authentication** via OpenRouter's native OAuth PKCE flow. Each user authenticates with OpenRouter and receives their own API key, allowing a single MCP instance to serve multiple users securely.

## Overview

### Architecture

1. **User Authentication**: Users authenticate directly with OpenRouter via OAuth PKCE
2. **Token Exchange**: After authentication, users receive a Bearer token from this server
3. **Per-User API Keys**: Each user's OpenRouter API key is stored securely and used for their MCP sessions
4. **MCP Discovery**: Standard OAuth discovery endpoints enable Claude and other MCP clients to auto-discover authentication requirements

### Flow

```
1. User → GET /oauth/login
   ↓
2. Redirect to OpenRouter OAuth
   ↓
3. User authenticates with OpenRouter
   ↓
4. OpenRouter → GET /oauth/callback?code=...&state=...
   ↓
5. Server exchanges code for user API key
   ↓
6. Server generates Bearer token
   ↓
7. User receives Bearer token
   ↓
8. User → POST /mcp (with Bearer token)
   ↓
9. Server validates token and uses user's API key
```

## Endpoints

### OAuth Endpoints

#### `GET /oauth/login`
Initiates the OAuth flow. Redirects user to OpenRouter for authentication.

**Query Parameters:**
- `callback_url` (optional): URL to redirect after successful authentication. If not provided, returns JSON with token.

**Example:**
```bash
curl http://localhost:10000/oauth/login
# Redirects to OpenRouter OAuth page
```

#### `GET /oauth/callback`
Handles OAuth callback from OpenRouter. This is called automatically by OpenRouter after user authentication.

**Query Parameters:**
- `code`: Authorization code from OpenRouter
- `state`: CSRF protection token

**Response:**
```json
{
  "success": true,
  "token": "abc123...",
  "token_type": "Bearer",
  "user_id": "user_123",
  "expires_at": null,
  "message": "Authentication successful. Use this token in Authorization header as: Bearer <token>"
}
```

#### `GET /oauth/status`
Check authentication status (requires Bearer token).

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "authenticated": true,
  "user_id": "user_123"
}
```

### MCP Discovery Endpoints

#### `GET /.well-known/oauth-protected-resource`
OAuth Protected Resource Metadata (RFC 9728). Allows MCP clients like Claude to auto-discover OAuth configuration.

**Response:**
```json
{
  "resource": "http://localhost:10000",
  "authorization_servers": [...],
  "scopes_supported": ["mcp:read", "mcp:write"],
  "bearer_methods_supported": ["header"]
}
```

#### `GET /.well-known/oauth-authorization-server`
OAuth Authorization Server Metadata (RFC 8414).

### MCP Endpoints

#### `POST /<SECRET_PATH>/mcp`
Main MCP endpoint. **Requires Bearer token authentication.**

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {...}
}
```

## Usage Examples

### 1. Authenticate and Get Token

```bash
# Step 1: Initiate OAuth flow
# Open in browser or use redirect:
curl -L http://localhost:10000/oauth/login

# After authentication, you'll receive a token in the callback response
```

### 2. Use Token for MCP Requests

```bash
# Set your token
TOKEN="your-bearer-token-here"

# Make MCP request
curl -X POST http://localhost:10000/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

### 3. Check Authentication Status

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:10000/oauth/status
```

## Integration with Claude Desktop

When configuring Claude Desktop to use this MCP server:

1. **Discovery**: Claude will automatically discover OAuth requirements from `/.well-known/oauth-protected-resource`

2. **Configuration**: Add to your Claude Desktop MCP settings:

```json
{
  "mcpServers": {
    "openrouter": {
      "command": "node",
      "args": ["path/to/server/server.js"],
      "env": {
        "PORT": "10000"
      }
    }
  }
}
```

3. **Authentication**: Claude will prompt you to authenticate via OAuth when first connecting.

## Security Features

- **PKCE (S256)**: Uses SHA-256 code challenge for maximum security
- **CSRF Protection**: State parameter prevents CSRF attacks
- **Token Expiration**: Tokens can be configured to expire (optional)
- **Per-User Isolation**: Each user's API key is isolated and never shared
- **Bearer Token Validation**: All MCP endpoints require valid Bearer tokens

## Environment Variables

The following environment variables are now **optional** (OAuth is the primary authentication method):

- `OPENROUTER_API_KEY`: Optional - kept for backward compatibility or admin operations
- `OPENROUTER_DEFAULT_MODEL`: Default model to use (defaults to `qwen/qwen2.5-vl-32b-instruct:free`)
- `OAUTH_TOKEN_EXPIRATION`: Token expiration time in milliseconds (null = no expiration)
- `MCP_SECRET_PATH`: Secret path for MCP endpoints (required for security)

## Token Storage

Tokens are currently stored in-memory. For production deployments, consider:

- **Redis**: For distributed token storage
- **Database**: For persistent token storage
- **JWT**: For stateless token validation

## Troubleshooting

### "Authentication required" error
- Ensure you've completed the OAuth flow and received a Bearer token
- Check that the `Authorization: Bearer <token>` header is included
- Verify the token hasn't expired

### "Session belongs to a different user"
- Each session is tied to a specific user
- Use the correct Bearer token for your user

### OAuth callback fails
- Ensure your server is accessible from the internet (for OpenRouter callback)
- Check that the callback URL matches what's registered
- Verify PKCE code verifier is being stored correctly

## Migration from Single-User Mode

If you were previously using a shared `OPENROUTER_API_KEY`:

1. **No breaking changes**: The server still works with a shared API key for backward compatibility
2. **Enable OAuth**: Users can now authenticate individually via OAuth
3. **Gradual migration**: You can run both modes simultaneously during migration

## API Reference

For detailed API documentation, see:
- OpenRouter OAuth: https://openrouter.ai/docs/oauth
- MCP Protocol: https://modelcontextprotocol.io
- OAuth 2.1 RFC: https://www.rfc-editor.org/rfc/rfc8414
