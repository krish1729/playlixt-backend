const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({
  origin: 'http://localhost:3001',
  credentials: true
}))
app.use(bodyParser.json());
app.use(cookieParser());

console.log("client id: ", process.env.SPOTIFY_CLIENT_ID);
console.log("client secret: ", process.env.SPOTIFY_CLIENT_SECRET);
console.log("Redirect URI: ", process.env.REDIRECT_URI);

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const redirectUri = process.env.REDIRECT_URI;
let accessToken = '';
let refreshToken = '';

// Generate a random string for state
const generateRandomString = length => {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};

const stateKey = 'spotify_auth_state';

// Route to start the OAuth flow
app.get('/login', (req, res) => {
    const state = generateRandomString(16);
    const scope = 'user-library-read user-read-private user-read-email playlist-modify-public playlist-read-private playlist-read-collaborative playlist-modify-private';

    res.cookie(stateKey, state);

    console.log("authorization query parameters stringified: ", querystring.stringify({
    response_type: 'code',
    client_id: clientId,
    scope: scope,
    redirect_uri: redirectUri,
    state: state
  }));

    const authUrl = 'https://accounts.spotify.com/authorize?' + querystring.stringify({
        response_type: 'code',
        client_id: clientId,
        scope: scope,
        redirect_uri: redirectUri,
        state: state
    });

    res.redirect(authUrl);
});

// Callback route to handle the redirect from Spotify
app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    const state = req.query.state || null;
    const storedState = req.cookies ? req.cookies[stateKey] : null;

    if (state === null || state !== storedState) {
        res.redirect('/#' + querystring.stringify({ error: 'state_mismatch' }));
    } else {
        res.clearCookie(stateKey);
        try {
            const tokenResponse = await axios.post('https://accounts.spotify.com/api/token', querystring.stringify({
                code: code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            }), {
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            accessToken = tokenResponse.data.access_token;
            refreshToken = tokenResponse.data.refresh_token;

            console.log('Access Token:', accessToken);
            console.log('Refresh Token:', refreshToken);

            res.redirect('http://localhost:3001/test?' + querystring.stringify({ access_token: accessToken, refresh_token: refreshToken }));
        } catch (error) {
            console.error('Error in /callback:', error.response ? error.response.data : error.message);
            res.redirect('/#' + querystring.stringify({ error: 'invalid_token' }));
        }
    }
});

// Function to refresh the access token
const refreshAccessToken = async () => {
    if (!refreshToken) {
        console.error('No refresh token available');
        return;
    }

    try {
        const response = await axios.post('https://accounts.spotify.com/api/token', querystring.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        }), {
            headers: {
                'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        accessToken = response.data.access_token;
        console.log('New Access Token:', accessToken);
    } catch (error) {
        console.error('Error refreshing access token:', error.response.data);
    }
};

// Middleware to check and refresh the token if needed
app.use(async (req, res, next) => {
    try {
      await axios.get('https://api.spotify.com/v1/me', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      next();
    } catch (error) {
      if (error.response && error.response.status == 401) {
        console.log ("Access Token Expired. Refreshing...");
        await refreshAccessToken();
        next();
      } else {
        console.error("Error in middleware: ", error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to authenticate with Spotify' });
      }
    }
});

// Route to handle the root URL
app.get('/', (req, res) => {
    res.send('Welcome to the Spotify API integration!');
});

// Route to create a new playlist
app.post('/playlists', async (req, res) => {
    const { userId, name, description } = req.body;
    console.log(req.body);
    try {
        const response = await axios.post(`https://api.spotify.com/v1/users/${userId}/playlists`, {
            name: name,
            description: description,
            public: false
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error creating playlist:', error.response.data);
        res.status(500).json({ error: 'Failed to create playlist' });
    }
});

// app.get('/users/:user_id/playlists', async (req, res) => {
//   const { user_id } = req.params;
//   const { uris } = req.body;
//   try {
//     const response = await axios.get(`https://api.spotify.com/v1/users/${user_id}/playlists`, {
//       uris: uris
//     }, {
//         headers: {
//           'Authorization': `Bearer ${accessToken}`,
//           'Content-Type': 'application/json'
//         }
//     });
//     res.json (response.data);
//   } catch (error) {
//     console.log('Error getting the users playlist', error.response.data);
//     res.status(500).json({ error: 'Failed to get the users playlist' });
//   }
// })
//
app.get('/me/playlists', async (req, res) => {
  const { uris } = req.body;
  console.log(req.body);
  try {
    const response = await axios.get(`https://api.spotify.com/v1/me/playlists`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })
    res.json(response.data);
  } catch (error) {
    console.log('Error getting your playlist:', error.response.data);
    res.status(500).json({ error: 'Error getting your playlist' });
  }
})

app.get("/api/user-playlists", async (req, res) => {
try {
    const response = await axios({
      method: 'get',
      url: 'https://api.spotify.com/v1/me/playlists',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      params: {
        limit: 50,
        offset: 0,
      },
    });

    res.status(200).json(response.data.items);
  } catch (error) {
    console.error('Error fetching playlists:', error);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
    }
    res.status(error.response ? error.response.status : 500).json({ 
      error: 'An error occurred while fetching playlists.',
      details: error.response ? error.response.data : error.message
    });
  }
});

// Get Tracks in a playlist

app.get("/api/user-playlists-tracks", async (req, res) => {
  try {
    const response = await axios({
      method: 'get',
      url: 'https://api.spotify.com/v1/playlists/35r0ZBvUQ3g4sRGmF0X20z/tracks',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      params: {
        limit: 10,
        offset: 5,
      }
    });

    res.status(200).json(response.data);
  } catch (error) {
    console.error('Error fetching the tracks in your playlist', error);
    res.status(error.response ? error.response.status : 500).json({
      error: 'An error occurred while fetching the tracks in the playlist',
      details: error.response ? error.response.data : error.message
    });
  }
})

// Route to add songs to a playlist
app.post('/playlists/:playlistId/tracks', async (req, res) => {
    const { playlistId } = req.params;
    const { uris } = req.body;
    try {
        const response = await axios.post(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            uris: uris
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error adding tracks to playlist:', error.response.data);
        res.status(500).json({ error: 'Failed to add tracks to playlist' });
    }
});

// Route to fetch liked songs
app.get('/liked-songs', async (req, res) => {
    try {
        const response = await axios.get('https://api.spotify.com/v1/me/tracks', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        res.json(response.data.items);
    } catch (error) {
        console.error('Error fetching liked songs:', error.response.data);
        res.status(500).json({ error: 'Failed to fetch liked songs' });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
