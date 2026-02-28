# MCP Inspector OAuth Authentication

This document explains how to test the OAuth authentication with MCP Inspector's auth section.

## Overview

The MCP server now implements **full OAuth 2.1** as an authorization server, which is compatible with:
- **MCP Inspector** - For local testing
- **Claude Desktop** - For production use
- **Any OAuth 2.1 compliant client**

The server acts as its own OAuth provider, while using OpenRouter's OAuth for user identity verification.

## OAuth 2.1 Flow

```
1. Client (MCP Inspector) → GET /oauth/authorize
   ↓
2. Server redirects to OpenRouter OAuth
   ↓
3. User authenticates with OpenRouter
   ↓
4. OpenRouter → GET /oauth/openrouter-callback
   ↓
5. Server issues authorization code
   ↓
6. Server redirects to client with code
   ↓
7. Client → POST /oauth/token (with code + PKCE verifier)
   ↓
8. Server issues access_token + refresh_token
   ↓
9. Client uses access_token for MCP requests
```

## Testing with MCP Inspector

### Step 1: Start the Server

```bash
cd server
npm install
npm start
```

The server will start on `http://localhost:10000` (or your configured PORT).

### Step 2: Configure MCP Inspector

1. Open MCP Inspector
2. Go to the **Authentication Settings** section
3. The inspector will automatically discover OAuth configuration from:
   - `http://localhost:10000/.well-known/oauth-authorization-server`

### Step 3: Client Registration

MCP Inspector can either:
- **Use Dynamic Registration**: Automatically register as a client via `POST /oauth/register`
- **Use Pre-configured Client**: Set environment variables:
  ```bash
  export MCP_CLIENT_ID=your-client-id
  export MCP_CLIENT_SECRET=your-client-secret
  ```

### Step 4: OAuth Flow in MCP Inspector

MCP Inspector will guide you through:

1. **Metadata Discovery** ✅
   - Inspector fetches `/.well-known/oauth-authorization-server`
   - Discovers authorization and token endpoints

2. **Client Registration** ✅
   - Inspector registers itself (or uses pre-configured credentials)

3. **Preparing Authorization** ✅
   - Inspector generates PKCE code challenge
   - Prepares authorization request

4. **Request Authorization** ✅
   - Inspector redirects you to `/oauth/authorize`
   - Server redirects to OpenRouter for authentication
   - You log in with OpenRouter
   - Server issues authorization code
   - Redirects back to Inspector with code

5. **Token Request** ✅
   - Inspector exchanges code for tokens at `/oauth/token`
   - Receives `access_token` and `refresh_token`

6. **Authentication Complete** ✅
   - Inspector uses `access_token` for all MCP requests
   - Token is included in `Authorization: Bearer <token>` header

## Endpoints Reference

### Discovery Endpoints

- `GET /.well-known/oauth-authorization-server` - OAuth server metadata (RFC 8414)
- `GET /.well-known/oauth-protected-resource` - Protected resource metadata (RFC 9728)

### OAuth Endpoints

- `POST /oauth/register` - Dynamic client registration (RFC 7591)
- `GET /oauth/authorize` - Authorization endpoint
- `GET /oauth/openrouter-callback` - OpenRouter OAuth callback (internal)
- `POST /oauth/token` - Token endpoint (issues access/refresh tokens)
- `POST /oauth/introspect` - Token introspection (RFC 7662)
- `GET /oauth/status` - Check authentication status

### MCP Endpoints (Protected)

- `GET /{SECRET_PATH}/mcp` - SSE connection (requires Bearer token)
- `POST /{SECRET_PATH}/mcp` - MCP protocol endpoint (requires Bearer token)

## Configuration for Claude Desktop

When adding this MCP server to Claude Desktop, you can provide:

```json
{
  "mcpServers": {
    "openrouter": {
      "command": "node",
      "args": ["path/to/server/server.js"],
      "env": {
        "PORT": "10000",
        "MCP_CLIENT_ID": "claude-client-id",
        "MCP_CLIENT_SECRET": "claude-client-secret"
      }
    }
  }
}
```

Claude will:
1. Discover OAuth configuration automatically
2. Use the provided client_id/client_secret
3. Handle the OAuth flow automatically
4. Store tokens per user session

## Manual Testing

### 1. Register a Client

```bash
curl -X POST http://localhost:10000/oauth/register \
  -H "Content-Type: application/json" \
  -d '{
    "redirect_uris": ["http://localhost:3000/callback"],
    "grant_types": ["authorization_code"],
    "response_types": ["code"],
    "scope": "mcp:read mcp:write"
  }'
```

Response:
```json
{
  "client_id": "abc123...",
  "client_secret": "xyz789...",
  "redirect_uris": ["http://localhost:3000/callback"],
  ...
}
```

### 2. Authorize (Get Authorization Code)

Open in browser:
```
http://localhost:10000/oauth/authorize?
  client_id=abc123&
  redirect_uri=http://localhost:3000/callback&
  response_type=code&
  scope=mcp:read%20mcp:write&
  code_challenge=...&
  code_challenge_method=S256&
  state=random-state
```

### 3. Exchange Code for Token

```bash
curl -X POST http://localhost:10000/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&
      code=AUTHORIZATION_CODE&
      redirect_uri=http://localhost:3000/callback&
      code_verifier=CODE_VERIFIER"
```

Response:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "abc123...",
  "scope": "mcp:read mcp:write"
}
```

### 4. Use Access Token

```bash
curl -X POST http://localhost:10000/{SECRET_PATH}/mcp \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

## Security Features

- ✅ **PKCE (S256)** - Required for all authorization flows
- ✅ **JWT Access Tokens** - Signed with HS256
- ✅ **Refresh Tokens** - For long-lived sessions
- ✅ **Token Expiration** - Access tokens expire in 1 hour
- ✅ **Client Authentication** - Optional client_secret support
- ✅ **Scope-based Access** - `mcp:read` and `mcp:write` scopes

## Troubleshooting

### "Invalid client_id"
- Ensure client is registered via `/oauth/register`
- Or set `MCP_CLIENT_ID` and `MCP_CLIENT_SECRET` environment variables

### "Invalid redirect_uri"
- Redirect URI must match one of the client's registered redirect URIs
- For localhost testing, use `http://localhost:*` pattern

### "PKCE verification failed"
- Ensure `code_verifier` matches the `code_challenge` used in authorization
- Use S256 method (SHA-256)

### "Token not found"
- Token may have expired
- Check token expiration time
- Use refresh token to get new access token

## Environment Variables

```bash
# OAuth Configuration
JWT_SECRET=your-secret-key  # For JWT signing (auto-generated if not set)
JWT_ISSUER=openrouter-mcp-server  # JWT issuer
ACCESS_TOKEN_EXPIRY=3600  # Access token expiry in seconds
REFRESH_TOKEN_EXPIRY=2592000  # Refresh token expiry in seconds

# Pre-configured Clients
MCP_CLIENT_ID=your-client-id
MCP_CLIENT_SECRET=your-client-secret

# Server Configuration
PORT=10000
MCP_SECRET_PATH=your-secret-path
```

## Next Steps

1. Test with MCP Inspector's auth section
2. Verify all OAuth flow steps complete successfully
3. Test token refresh flow
4. Configure for Claude Desktop integration
