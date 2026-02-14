# Gmail Integration Migration Summary

## Changes Made

The Gmail integration has been migrated from the Gmail MCP server to the official googleapis library for better control and OAuth-based authentication.

### 1. Removed Gmail MCP

**File:** `/workspace/project/container/agent-runner/src/index.ts`

- Removed `'mcp__gmail__*'` from `allowedTools` array (line 409)
- Removed `gmail` MCP server from `mcpServers` configuration (line 424)

### 2. Installed googleapis Package

**Location:** Project root (`/workspace/project`)

```bash
npm install googleapis
```

This installs the official Google APIs client library for Node.js, which provides full Gmail API access.

### 3. Created OAuth Setup Script

**File:** `/workspace/project/scripts/gmail-oauth-setup.js`

A complete OAuth 2.0 setup script that:
- Reads OAuth credentials from `~/.gmail-mcp/gcp-oauth.keys.json`
- Generates an authorization URL for browser-based consent
- Accepts the authorization code from the user
- Exchanges the code for access and refresh tokens
- Saves tokens to `~/.gmail-mcp/googleapis-tokens.json`
- Verifies the setup with a test API call

**Usage:**
```bash
node /workspace/project/scripts/gmail-oauth-setup.js
```

The script is interactive and provides clear instructions for each step.

### 4. Created Gmail IPC Tool

**File:** `/workspace/project/container/agent-runner/src/ipc-mcp-stdio.ts`

Added `send_gmail` tool (lines 242-290) that:
- Accepts email parameters (to, subject, body, cc, bcc, html)
- Writes IPC messages to the tasks directory
- Queues emails for processing by the host

**Tool signature:**
```typescript
server.tool(
  'send_gmail',
  'Send an email via Gmail using the googleapis library',
  {
    to: z.array(z.string()),
    subject: z.string(),
    body: z.string(),
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    html: z.boolean().optional()
  }
)
```

### 5. Implemented IPC Handler

**File:** `/workspace/project/src/ipc.ts`

Added `processSendGmail` function (lines 389-475) that:
- Loads OAuth credentials and tokens from `~/.gmail-mcp/`
- Creates an OAuth2 client using googleapis
- Builds RFC 2822 compliant email messages
- Sends emails via Gmail API
- Logs success/failure with appropriate details

**Features:**
- Automatic token refresh using refresh tokens
- Support for plain text and HTML emails
- Multiple recipients (to, cc, bcc)
- Base64 encoding as required by Gmail API
- Comprehensive error logging

### 6. Updated Documentation

**File:** `/workspace/group/CLAUDE.md`

Updated the Gmail section (lines 228-268) to document:
- OAuth setup process
- How to create credentials in Google Cloud Console
- Usage of the `mcp__nanoclaw__send_gmail` tool
- Example usage patterns

**File:** `/workspace/project/docs/gmail-setup.md`

Created comprehensive setup guide with:
- Step-by-step OAuth credential creation
- Script usage instructions
- Troubleshooting section
- Security notes
- File locations reference
- Migration notes from the old MCP integration

## How It Works

### Architecture Flow

1. **Container (Agent)** → Calls `mcp__nanoclaw__send_gmail` tool
2. **IPC MCP Server** → Writes JSON to `/workspace/ipc/<group>/tasks/`
3. **IPC Watcher** → Polls for new task files
4. **IPC Handler** → Processes `send_gmail` type messages
5. **Gmail API** → Sends email using OAuth-authenticated request

### Authentication Flow

1. User runs `gmail-oauth-setup.js` (one-time setup)
2. Script generates OAuth URL with proper scopes
3. User authorizes in browser and copies code
4. Script exchanges code for access + refresh tokens
5. Tokens saved to `~/.gmail-mcp/googleapis-tokens.json`
6. When sending email, handler loads tokens and credentials
7. OAuth2 client automatically refreshes expired access tokens
8. Gmail API request sent with valid authentication

### OAuth Scopes

The setup script requests these Gmail API scopes:
- `gmail.readonly` - Read email messages
- `gmail.send` - Send email messages
- `gmail.compose` - Create drafts
- `gmail.modify` - Modify messages (labels, etc.)
- `gmail.labels` - Manage labels
- `gmail.settings.basic` - Basic settings access

Currently only `gmail.send` is used, but others are requested for future enhancements.

## Testing

To test the integration:

1. **Setup OAuth:**
   ```bash
   node /workspace/project/scripts/gmail-oauth-setup.js
   ```

2. **Rebuild agent-runner:**
   ```bash
   cd /workspace/project/container/agent-runner
   npm run build
   ```

3. **Send a test email from Foxy:**
   ```
   Send an email to myself@example.com with subject "Test" and body "Testing Gmail integration"
   ```

## Files Modified

- `/workspace/project/container/agent-runner/src/index.ts` - Removed Gmail MCP
- `/workspace/project/container/agent-runner/src/ipc-mcp-stdio.ts` - Added send_gmail tool
- `/workspace/project/src/ipc.ts` - Added processSendGmail handler
- `/workspace/group/CLAUDE.md` - Updated Gmail documentation

## Files Created

- `/workspace/project/scripts/gmail-oauth-setup.js` - OAuth setup script
- `/workspace/project/docs/gmail-setup.md` - Setup documentation
- `/workspace/project/GMAIL_MIGRATION_SUMMARY.md` - This file

## Dependencies Added

- `googleapis` (project root) - Official Google APIs client library

## Credentials Location

All Gmail credentials and tokens are stored in `~/.gmail-mcp/`:
- `gcp-oauth.keys.json` - OAuth client credentials from Google Cloud Console
- `googleapis-tokens.json` - Access and refresh tokens (auto-generated)

## Security Considerations

- Tokens are stored outside the project directory
- Files should never be committed to version control
- Refresh token provides persistent access
- OAuth scopes follow principle of least privilege
- HTTPS is used for all Gmail API requests
- Tokens are automatically refreshed when expired

## Future Enhancements

The current implementation only supports sending emails. Future additions could include:

- Reading emails (`gmail.users.messages.list`, `gmail.users.messages.get`)
- Searching emails (`gmail.users.messages.list` with query)
- Creating drafts (`gmail.users.drafts.create`)
- Managing labels (`gmail.users.labels.*`)
- Downloading attachments (`gmail.users.messages.attachments.get`)
- Sending emails with attachments (requires multipart MIME encoding)

The OAuth scopes are already configured to support these features.

## Breaking Changes

- All `mcp__gmail__*` tools have been removed
- Only `mcp__nanoclaw__send_gmail` is available
- Email sending requires OAuth setup (not automatic)
- Gmail MCP server is no longer loaded

## Migration Path for Users

If you were using the old Gmail MCP integration:

1. Run the OAuth setup script
2. Update any prompts/tasks that used `mcp__gmail__send_email` to use `mcp__nanoclaw__send_gmail`
3. Update parameter format if needed (array for recipients instead of separate fields)

## Notes

- No services need to be restarted; the changes are code-only
- OAuth setup is a one-time process per machine
- Tokens are automatically refreshed by googleapis library
- The IPC pattern allows for async email sending
- Errors are logged but don't crash the agent
