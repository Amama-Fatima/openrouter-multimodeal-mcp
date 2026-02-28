# Token Storage Configuration

The OpenRouter MCP server supports two token storage backends:

1. **In-Memory Storage** (default) - Fast but tokens are lost on server restart
2. **SQLite Database** (recommended for production) - Persistent file-based storage

## Current Storage Location

**Tokens are currently stored in-memory** using JavaScript Maps in `server/utils/tokenStorage.js`. This means:
- ✅ Fast access
- ❌ Tokens are lost on server restart
- ❌ Tokens are lost if server crashes
- ❌ Cannot scale horizontally (multiple instances don't share tokens)

## Enabling Database Storage

To use persistent SQLite database storage:

### 1. Set Environment Variable

Add to your Railway environment variables (or `.env` file):

```bash
TOKEN_STORAGE=db
```

### 2. Optional: Configure Database Path

By default, the database is stored at `server/data/tokens.db`. To change this:

```bash
TOKEN_DB_PATH=/path/to/tokens.db
```

### 3. Database File Location

The database file will be created automatically at:
- **Default**: `server/data/tokens.db`
- **Railway**: Use a persistent volume or Railway's filesystem (data persists between deployments)

### 4. Railway Persistent Storage

For Railway, you can:

**Option A: Use Railway's filesystem** (data persists between deployments)
- Just set `TOKEN_STORAGE=db`
- Database file will be created in the project directory
- Note: Data may be lost if you delete the service

**Option B: Use Railway Volume** (recommended for production)
1. Create a Railway volume
2. Mount it to your service
3. Set `TOKEN_DB_PATH=/path/to/volume/tokens.db`

**Option C: Use Railway PostgreSQL** (for larger scale)
- We can add PostgreSQL support if needed
- Contact for implementation

## Database Schema

The SQLite database contains three tables:

### `access_tokens`
- `token` (PRIMARY KEY) - Access token string
- `api_key` - User's OpenRouter API key
- `user_id` - User ID from OpenRouter
- `client_id` - OAuth client ID
- `scopes` - JSON array of scopes
- `refresh_token` - Associated refresh token
- `expires_at` - Expiration timestamp (NULL if no expiration)
- `created_at` - Creation timestamp

### `refresh_tokens`
- `refresh_token` (PRIMARY KEY) - Refresh token string
- `user_id` - User ID
- `client_id` - OAuth client ID
- `scopes` - JSON array of scopes
- `access_token` - Associated access token
- `created_at` - Creation timestamp

### `authorization_codes`
- `code` (PRIMARY KEY) - Authorization code
- `user_id` - User ID
- `api_key` - User's OpenRouter API key
- `client_id` - OAuth client ID
- `redirect_uri` - Redirect URI
- `code_challenge` - PKCE code challenge
- `code_challenge_method` - PKCE method (S256)
- `scopes` - JSON array of scopes
- `expires_at` - Expiration timestamp
- `created_at` - Creation timestamp

## Benefits of Database Storage

✅ **Persistent**: Tokens survive server restarts  
✅ **Reliable**: No data loss on crashes  
✅ **Scalable**: Can be shared across instances (with file locking)  
✅ **Queryable**: Can query tokens by user, expiration, etc.  
✅ **Backupable**: Database file can be backed up easily  

## Migration from In-Memory to Database

1. Set `TOKEN_STORAGE=db` environment variable
2. Restart the server
3. Existing in-memory tokens will be lost (users will need to re-authenticate)
4. New tokens will be stored in the database

## Backup Recommendations

For production, regularly backup the database file:

```bash
# Backup database
cp server/data/tokens.db server/data/tokens.db.backup

# Or use Railway CLI to backup
railway volumes download
```

## Performance

- **In-Memory**: ~0.1ms per operation
- **SQLite**: ~1-5ms per operation
- **Impact**: Negligible for typical usage (< 1000 tokens)

## Security Notes

⚠️ **Important**: The database file contains sensitive data (API keys, tokens)

1. **File Permissions**: Ensure database file is readable only by the server process
2. **Backup Security**: Encrypt backups if storing off-server
3. **Environment Variables**: Never commit database files to git
4. **Railway**: Database file is in the service filesystem (not publicly accessible)

## Troubleshooting

### Database file not created
- Check that the `data/` directory is writable
- Check `TOKEN_DB_PATH` environment variable
- Check server logs for database connection errors

### Tokens not persisting
- Verify `TOKEN_STORAGE=db` is set
- Check database file exists: `ls -la server/data/tokens.db`
- Check server logs for database errors

### Performance issues
- SQLite is very fast for < 10,000 tokens
- For larger scale, consider PostgreSQL
- Check database file size: `du -h server/data/tokens.db`
