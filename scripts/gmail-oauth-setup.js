#!/usr/bin/env node
/**
 * Gmail OAuth Setup Script
 *
 * This script helps you set up OAuth authentication for Gmail API access.
 * It reads OAuth credentials from ~/.gmail-mcp/gcp-oauth.keys.json,
 * generates an OAuth URL for manual authorization, and saves tokens.
 *
 * Usage:
 *   node gmail-oauth-setup.js
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths
const CREDENTIALS_DIR = path.join(homedir(), '.gmail-mcp');
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, 'gcp-oauth.keys.json');
const TOKEN_PATH = path.join(CREDENTIALS_DIR, 'googleapis-tokens.json');

// OAuth2 scopes - Full access to Gmail and Calendar
const SCOPES = [
  // Gmail scopes
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  // Calendar scopes
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

/**
 * Read OAuth credentials from file
 */
function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`❌ Credentials file not found at: ${CREDENTIALS_PATH}`);
    console.error('\nPlease create OAuth credentials in Google Cloud Console:');
    console.error('1. Go to https://console.cloud.google.com/apis/credentials');
    console.error('2. Create OAuth 2.0 Client ID (Desktop application)');
    console.error('3. Download the JSON file');
    console.error(`4. Save it as: ${CREDENTIALS_PATH}`);
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    const credentials = JSON.parse(content);

    // Support both formats: web and installed
    const creds = credentials.installed || credentials.web;
    if (!creds || !creds.client_id || !creds.client_secret) {
      throw new Error('Invalid credentials format');
    }

    return creds;
  } catch (error) {
    console.error(`❌ Failed to read credentials: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Create OAuth2 client
 */
function createOAuthClient(credentials) {
  const { client_id, client_secret, redirect_uris } = credentials;
  const redirectUri = redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';

  return new google.auth.OAuth2(client_id, client_secret, redirectUri);
}

/**
 * Generate authorization URL
 */
function generateAuthUrl(oAuth2Client) {
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to get refresh token
  });
}

/**
 * Get authorization code from user
 */
function getAuthorizationCode(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Exchange authorization code for tokens
 */
async function getTokens(oAuth2Client, code) {
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    return tokens;
  } catch (error) {
    console.error(`❌ Failed to get tokens: ${error.message}`);
    throw error;
  }
}

/**
 * Save tokens to file
 */
function saveTokens(tokens) {
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`✅ Tokens saved to: ${TOKEN_PATH}`);
}

/**
 * Verify tokens by making a test API call
 */
async function verifyTokens(oAuth2Client, tokens) {
  oAuth2Client.setCredentials(tokens);

  try {
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const response = await gmail.users.getProfile({ userId: 'me' });
    console.log(`\n✅ Successfully authenticated as: ${response.data.emailAddress}`);
    return true;
  } catch (error) {
    console.error(`\n❌ Failed to verify tokens: ${error.message}`);
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Gmail OAuth Setup for googleapis');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check if tokens already exist
  if (fs.existsSync(TOKEN_PATH)) {
    console.log('⚠️  Tokens already exist at:', TOKEN_PATH);
    const answer = await getAuthorizationCode('\nDo you want to re-authenticate? (y/N): ');
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('Exiting.');
      process.exit(0);
    }
    console.log('');
  }

  // Load credentials
  console.log('📂 Loading OAuth credentials...');
  const credentials = loadCredentials();
  console.log('✅ Credentials loaded\n');

  // Create OAuth client
  const oAuth2Client = createOAuthClient(credentials);

  // Generate authorization URL
  const authUrl = generateAuthUrl(oAuth2Client);

  console.log('📋 Step 1: Open the following URL in your browser:\n');
  console.log('─────────────────────────────────────────────────────────');
  console.log(authUrl);
  console.log('─────────────────────────────────────────────────────────\n');

  console.log('📝 Step 2: Authorize the application and copy the code\n');

  // Get authorization code from user
  const code = await getAuthorizationCode('Paste the authorization code here: ');

  if (!code) {
    console.error('\n❌ No authorization code provided');
    process.exit(1);
  }

  console.log('\n🔄 Exchanging code for tokens...');

  // Exchange code for tokens
  const tokens = await getTokens(oAuth2Client, code);

  if (!tokens.refresh_token) {
    console.warn('\n⚠️  Warning: No refresh token received.');
    console.warn('This may happen if you\'ve already authorized this app.');
    console.warn('Tokens will expire and need manual re-authentication.');
  } else {
    console.log('✅ Refresh token received (for persistent access)');
  }

  // Save tokens
  saveTokens(tokens);

  // Verify tokens
  console.log('\n🔍 Verifying tokens...');
  const verified = await verifyTokens(oAuth2Client, tokens);

  if (verified) {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  Setup Complete!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\nYou can now use Gmail API tools in your agent.');
    console.log('Tokens are automatically refreshed when needed.\n');
  } else {
    console.log('\n⚠️  Tokens saved but verification failed.');
    console.log('You may need to check your API permissions or try again.\n');
  }
}

// Run the script
main().catch((error) => {
  console.error('\n❌ Setup failed:', error.message);
  process.exit(1);
});
