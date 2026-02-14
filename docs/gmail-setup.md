# Gmail OAuth Setup Guide

This guide explains how to configure Gmail access for Foxy using the official googleapis library.

## Overview

The Gmail integration uses OAuth 2.0 for secure authentication. Once configured, Foxy can send emails via the `mcp__nanoclaw__send_gmail` tool.

## Prerequisites

- A Google Cloud Console account
- A Google account with Gmail access

## Step 1: Create OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project or select an existing one
3. Enable the Gmail API:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Gmail API"
   - Click "Enable"
4. Create OAuth 2.0 credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Desktop app" as the application type
   - Give it a name (e.g., "Foxy Gmail")
   - Click "Create"
5. Download the JSON file:
   - Click the download button next to your new OAuth client
   - Save the file as `~/.gmail-mcp/gcp-oauth.keys.json`

## Step 2: Run the Setup Script

From inside a container or with access to the project:

```bash
node /workspace/project/scripts/gmail-oauth-setup.js
```

The script will:

1. Read your OAuth credentials from `~/.gmail-mcp/gcp-oauth.keys.json`
2. Display an authorization URL
3. Ask you to paste the authorization code

Follow these steps:

1. Copy the URL displayed by the script
2. Open it in your browser
3. Sign in with your Google account
4. Grant the requested permissions
5. Copy the authorization code
6. Paste it into the terminal

The script will:
- Exchange the code for access and refresh tokens
- Save tokens to `~/.gmail-mcp/googleapis-tokens.json`
- Verify the setup by making a test API call

## Step 3: Use Gmail Tools

Once configured, you can send emails using the `mcp__nanoclaw__send_gmail` tool:

```typescript
mcp__nanoclaw__send_gmail({
  to: ["recipient@example.com"],
  subject: "Hello from Foxy",
  body: "This is a test email",
  cc: ["cc@example.com"],      // Optional
  bcc: ["bcc@example.com"],    // Optional
  html: false                   // Set to true for HTML emails
})
```

Example prompts:
- "Send an email to john@example.com about tomorrow's meeting"
- "Email the team at team@company.com with the project update"

## Troubleshooting

### Credentials Not Found

If you see "Credentials file not found", ensure:
- The file is saved at `~/.gmail-mcp/gcp-oauth.keys.json`
- The file contains valid JSON from Google Cloud Console

### No Refresh Token

If you see "No refresh token received", this means you've already authorized the app. To fix:
1. Revoke access in your [Google Account](https://myaccount.google.com/permissions)
2. Run the setup script again

### API Not Enabled

If you see "Gmail API has not been used", ensure:
- The Gmail API is enabled in your Google Cloud Console project
- You're using the correct project

### Token Refresh

Tokens are automatically refreshed when they expire. The refresh token provides persistent access, so you only need to run the setup once.

## File Locations

- OAuth credentials: `~/.gmail-mcp/gcp-oauth.keys.json`
- Access/refresh tokens: `~/.gmail-mcp/googleapis-tokens.json`
- Setup script: `/workspace/project/scripts/gmail-oauth-setup.js`

## Security Notes

- Keep your OAuth credentials and tokens secure
- Do not commit these files to version control
- The refresh token provides long-term access to your Gmail account
- Revoke access from your Google Account settings if you no longer need it

## Migration from Gmail MCP

If you were previously using the Gmail MCP integration:

1. The MCP server has been removed from the configuration
2. All `mcp__gmail__*` tools have been replaced with `mcp__nanoclaw__send_gmail`
3. Currently only sending emails is supported (not reading/searching)
4. OAuth credentials location remains the same: `~/.gmail-mcp/`

## Future Enhancements

Potential additions for future versions:
- Read emails
- Search emails
- Create drafts
- Manage labels and filters
- Download attachments
