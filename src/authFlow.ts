// Import necessary modules
import axios from 'axios'; // For making HTTP requests
import express from 'express'; // Web application framework
import https from 'https'; // For creating HTTPS server
import fs from 'fs'; // For reading SSL certificate files
import qs from 'querystring'; // For parsing and stringifying URL query strings
import dotenv from 'dotenv'; // For loading environment variables

// Load environment variables from a .env file
dotenv.config();

// Create an Express application
const app = express();
const port = process.env.PORT || 3000; // The port our server will run on, from env or default to 3000

// Yahoo API credentials (Now loaded from environment variables for security)
const clientId = process.env.YAHOO_CLIENT_ID;
const clientSecret = process.env.YAHOO_CLIENT_SECRET;
const redirectUri = `https://localhost:${port}/callback`;

// Check if the required environment variables are set
if (!clientId || !clientSecret) {
  console.error('YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET must be set in environment variables');
  process.exit(1);
}

// Yahoo OAuth URLs
const authorizationUrl = 'https://api.login.yahoo.com/oauth2/request_auth';
const tokenUrl = 'https://api.login.yahoo.com/oauth2/get_token';

// Variable to store the access token
let accessToken: string | null = null;

// Route to start the authentication process
app.get('/auth', (req, res) => {
  const authUrl = `${authorizationUrl}?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code`;
  res.redirect(authUrl); // Redirect the user to Yahoo's login page
});

// Callback route that Yahoo will redirect to after user logs in
app.get('/callback', async (req, res) => {
  const code = req.query.code; // Get the authorization code from the query parameters

  if (typeof code !== 'string') {
    res.status(400).send('Invalid authorization code');
    return;
  }

  try {
    // Exchange the authorization code for an access token
    const { data } = await axios.post(tokenUrl, qs.stringify({
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }), {
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    accessToken = data.access_token; // Store the access token
    res.send('Authentication successful! You can close this window.');
  } catch (error) {
    console.error('Error getting token:', error);
    res.status(500).send('Authentication failed');
  }
});

// Function to make authenticated requests to Yahoo's API
async function makeAuthenticatedRequest(url: string) {
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  try {
    const { data } = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    return data;
  } catch (error) {
    console.error('Error making authenticated request:', error);
    throw error;
  }
}

// Route to test the API connection
app.get('/test', async (req, res) => {
  if (!accessToken) {
    res.status(401).send('Not authenticated. Please authenticate first.');
    return;
  }
  try {
    // This API call gets the user's games
    const data = await makeAuthenticatedRequest('https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games?format=json');
    res.json(data);
  } catch (error) {
    console.error('Error in /test route:', error);
    res.status(500).send('Error making authenticated request');
  }
});

// Route to get NHL league information
app.get('/nhl-leagues', async (req, res) => {
  if (!accessToken) {
    res.status(401).send('Not authenticated. Please authenticate first.');
    return;
  }
  try {
    // This API call gets the user's leagues for the current NHL season
    const data = await makeAuthenticatedRequest('https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nhl/leagues?format=json');
    res.json(data);
  } catch (error) {
    console.error('Error in /nhl-leagues route:', error);
    res.status(500).send('Error fetching NHL league information');
  }
});

// Route to get NHL matchup information
app.get('/nhl-matchups', async (req, res) => {
  if (!accessToken) {
    res.status(401).send('Not authenticated. Please authenticate first.');
    return;
  }

  // Get the week number from query parameters, default to current week if not provided
  const week = req.query.week || 'current';

  try {
    // First, get the user's NHL leagues
    const leaguesData = await makeAuthenticatedRequest('https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nhl/leagues?format=json');
    
    // Extract the first NHL league key (you might want to handle multiple leagues differently)
    const leagueKey = leaguesData.fantasy_content.users[0].user[1].games[0].game[1].leagues[0].league[0].league_key;
    
    // Now get the matchups for this league and week
    const matchupsData = await makeAuthenticatedRequest(`https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/scoreboard;week=${week}?format=json`);
    
    res.json(matchupsData);
  } catch (error) {
    console.error('Error in /nhl-matchups route:', error);
    res.status(500).send('Error fetching NHL matchup information');
  }
});

// Route to get NHL team information
app.get('/nhl-teams', async (req, res) => {
  if (!accessToken) {
    res.status(401).send('Not authenticated. Please authenticate first.');
    return;
  }
  try {
    // First, get the user's NHL leagues
    const leaguesData = await makeAuthenticatedRequest('https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nhl/leagues?format=json');
    
    // Extract the first NHL league key (you might want to handle multiple leagues differently)
    const leagueKey = leaguesData.fantasy_content.users[0].user[1].games[0].game[1].leagues[0].league[0].league_key;
    
    // Now get the teams for this league
    const teamsData = await makeAuthenticatedRequest(`https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/teams?format=json`);
    
    res.json(teamsData);
  } catch (error) {
    console.error('Error in /nhl-teams route:', error);
    res.status(500).send('Error fetching NHL team information');
  }
});

// Set up HTTPS options (for secure local development)
const httpsOptions = {
  key: fs.readFileSync(process.env.SSL_KEY_PATH || 'key.pem'),
  cert: fs.readFileSync(process.env.SSL_CERT_PATH || 'cert.pem')
};

// Create and start the HTTPS server
https.createServer(httpsOptions, app).listen(port, async () => {
  console.log(`Server running at https://localhost:${port}`);
  console.log(`Please open https://localhost:${port}/auth in your browser to start the authentication process.`);
  
  try {
    // Attempt to open the auth URL in the default browser
    const open = (await import('open')).default;
    await open(`https://localhost:${port}/auth`);
  } catch (error) {
    console.error('Failed to open browser automatically. Please open the URL manually.');
  }
});

export {}; // This line is needed to make TypeScript treat this file as a module