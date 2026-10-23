// ONE-TIME interactive helper. Run this on your own machine (not in Docker/Portainer)
// to authorize scripts/backup-db.mjs against YOUR Google Drive account and obtain a
// refresh token. You only need to run this once — the refresh token doesn't expire
// under normal use, and is what backup-db.mjs uses afterwards without any browser step.
//
// Prerequisite: an OAuth client of type "Desktop app" in Google Cloud Console
// (APIs & Services > Credentials > + Create Credentials > OAuth client ID >
// Application type: Desktop app). Copy its Client ID and Client Secret.
//
// Usage (run in your own terminal, NOT through Claude — the printed refresh token
// is a live credential and shouldn't land in any chat transcript):
//   GDRIVE_OAUTH_CLIENT_ID=... GDRIVE_OAUTH_CLIENT_SECRET=... node scripts/gdrive-get-refresh-token.mjs
//
// Opens your browser to Google's consent screen. After you approve, prints a refresh
// token here in the terminal — copy it into your .env as GDRIVE_OAUTH_REFRESH_TOKEN.

import { createServer } from "node:http";
import { exec } from "node:child_process";
import { OAuth2Client } from "google-auth-library";

const CLIENT_ID = process.env.GDRIVE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GDRIVE_OAUTH_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error(
    "Set GDRIVE_OAUTH_CLIENT_ID and GDRIVE_OAUTH_CLIENT_SECRET first (from a 'Desktop app' OAuth client in Google Cloud Console)",
  );
}

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // forces a refresh_token even if you've authorized this app before
  scope: ["https://www.googleapis.com/auth/drive"],
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  if (!code) {
    res.end("No authorization code received — check the terminal for errors.");
    return;
  }
  res.end("Authorized. You can close this tab and go back to the terminal.");
  server.close();

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.log(
      "\nNo refresh_token returned. This usually means you've authorized this app before.\n" +
        "Go to https://myaccount.google.com/permissions, remove access for this app, then re-run this script.",
    );
    process.exit(1);
  }
  console.log("\nRefresh token (copy this into your .env as GDRIVE_OAUTH_REFRESH_TOKEN):\n");
  console.log(tokens.refresh_token);
  console.log();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Open this URL in your browser to authorize (attempting to open it for you now):\n\n${authUrl}\n`);
  exec(`open "${authUrl}"`, () => {}); // best-effort auto-open on macOS; safe to ignore if it fails
});
