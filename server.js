import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Blob } from 'buffer';
import { initDb, getDb } from './database.js';
import { Client, Environment, OrdersController } from '@paypal/paypal-server-sdk';

dotenv.config();

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:3000,http://localhost:3000,https://spectraconvertonline.netlify.app')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json());

// Temporary upload folder
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const upload = multer({ dest: 'uploads/' });
const appDbPath = path.join(process.cwd(), 'database.json');

const readAppData = async () => {
  try {
    const raw = await fs.promises.readFile(appDbPath, 'utf8');
    const data = JSON.parse(raw);
    return { users: {}, ...data };
  } catch {
    return { users: {} };
  }
};

const writeAppData = async (data) => {
  await fs.promises.writeFile(appDbPath, JSON.stringify(data, null, 2));
};

const publicUser = (user) => ({
  id: user.id,
  name: user.name || user.email?.split('@')[0] || 'User',
  email: user.email || '',
  credits: user.credits || 0,
  provider: user.provider || 'password',
});

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password, storedHash) => {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt] = storedHash.split(':');
  return hashPassword(password, salt) === storedHash;
};

const DEFAULT_GOOGLE_CLIENT_ID = '920941311246-iqe7k55r4lg1959ot6jdhpgtc8im7tmp.apps.googleusercontent.com';
const googleClientId = process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://127.0.0.1:3000/api/auth/google/callback';
const appUrl = process.env.APP_URL || 'http://127.0.0.1:3000';

const upsertGoogleUser = async (profile) => {
  const data = await readAppData();
  const normalizedEmail = String(profile.email || '').trim().toLowerCase();
  let user = Object.values(data.users).find((candidate) => (
    candidate.googleId === profile.sub || candidate.email === normalizedEmail
  ));

  if (!user) {
    const id = `user_${crypto.randomUUID()}`;
    user = {
      id,
      name: profile.name || normalizedEmail.split('@')[0],
      email: normalizedEmail,
      googleId: profile.sub,
      provider: 'google',
      credits: 0,
      createdAt: new Date().toISOString(),
    };
    data.users[id] = user;
  } else {
    user.googleId = profile.sub;
    user.name = user.name || profile.name || normalizedEmail.split('@')[0];
    user.email = normalizedEmail;
    user.provider = user.passwordHash ? 'password_google' : 'google';
    data.users[user.id] = user;
  }

  await writeAppData(data);
  return user;
};

const redirectWithAuthError = (res, message) => {
  const redirectUrl = new URL(appUrl);
  redirectUrl.searchParams.set('authError', message);
  res.redirect(redirectUrl.toString());
};

// Initialize DB
initDb().catch(console.error);

// Initialize PayPal REST settings
const isLive = process.env.VITE_PAYPAL_ENVIRONMENT === 'live';
const paypalBaseUrl = isLive ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const paypalClientId = isLive ? process.env.VITE_PAYPAL_LIVE_CLIENT_ID : process.env.VITE_PAYPAL_SANDBOX_CLIENT_ID;
const paypalClientSecret = isLive ? process.env.PAYPAL_LIVE_CLIENT_SECRET : process.env.PAYPAL_SANDBOX_CLIENT_SECRET;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const paypalRequest = async (path, options = {}) => {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${paypalBaseUrl}${path}`, {
        ...options,
        signal: AbortSignal.timeout(15000),
      });

      const text = await response.text();
      const data = text ? JSON.parse(text) : {};

      if (!response.ok) {
        const message = data.message || data.error_description || data.error || `PayPal request failed with ${response.status}`;
        if (response.status < 500 || attempt === 3) {
          throw new Error(message);
        }
        lastError = new Error(message);
      } else {
        return { statusCode: response.status, data };
      }
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
    }

    await wait(700 * attempt);
  }

  throw new Error(lastError?.message || 'PayPal request failed');
};
const getPayPalAccessToken = async () => {
  if (!paypalClientId || !paypalClientSecret) {
    throw new Error('PayPal sandbox credentials are missing.');
  }

  const credentials = Buffer.from(`${paypalClientId}:${paypalClientSecret}`).toString('base64');
  const { data } = await paypalRequest('/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  return data.access_token;
};
// Helper to get api2convert API Key
const getApiKey = () => {
  const key = process.env.API2CONVERT_KEY || process.env.CLOUDCONVERT_SANDBOX_KEY || process.env.CLOUDCONVERT_API_KEY;
  if (!key || key === 'YOUR_API_KEY_HERE') {
    throw new Error('API2CONVERT_KEY is missing in .env file.');
  }
  return key;
};


app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  res.json({ googleClientId: DEFAULT_GOOGLE_CLIENT_ID });
});

// Auth endpoints
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail || !password || String(password).length < 6) {
      return res.status(400).json({ error: 'Enter a valid email and a password with at least 6 characters.' });
    }

    const data = await readAppData();
    const existingUser = Object.values(data.users).find((user) => user.email === normalizedEmail);
    if (existingUser) {
      return res.status(409).json({ error: 'An account already exists for this email.' });
    }

    const id = `user_${crypto.randomUUID()}`;
    const user = {
      id,
      name: String(name || normalizedEmail.split('@')[0]).trim(),
      email: normalizedEmail,
      passwordHash: hashPassword(password),
      provider: 'password',
      credits: 0,
      createdAt: new Date().toISOString(),
    };

    data.users[id] = user;
    await writeAppData(data);

    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const data = await readAppData();
    const user = Object.values(data.users).find((candidate) => candidate.email === normalizedEmail);

    if (!user || !verifyPassword(password || '', user.passwordHash)) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    res.json({ user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to sign in.' });
  }
});

app.get('/api/auth/me/:id', async (req, res) => {
  try {
    const data = await readAppData();
    const user = data.users[req.params.id];
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load account.' });
  }
});

app.post('/api/auth/google-token', async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!googleClientId) {
      return res.status(500).json({ error: 'Google login is not configured yet.' });
    }
    if (!accessToken) {
      return res.status(400).json({ error: 'Google did not return a login token.' });
    }

    const tokenInfoResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
    const tokenInfo = await tokenInfoResponse.json();
    const tokenAudiences = [
      tokenInfo.audience,
      tokenInfo.aud,
      tokenInfo.issued_to,
      tokenInfo.azp,
    ].flat().filter(Boolean);
    const allowedGoogleClientIds = [googleClientId, DEFAULT_GOOGLE_CLIENT_ID].filter(Boolean);

    if (!tokenInfoResponse.ok || !tokenAudiences.some((audience) => allowedGoogleClientIds.includes(audience))) {
      return res.status(401).json({ error: tokenInfo.error_description || tokenInfo.error || 'Google token is not valid for this app.' });
    }

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.email || !profile.sub) {
      return res.status(401).json({ error: profile.error_description || profile.error || 'Google profile load failed.' });
    }

    const user = await upsertGoogleUser(profile);
    res.json({ user: publicUser(user) });
  } catch (error) {
    console.error('Google token auth failed:', error.message || error);
    res.status(500).json({ error: error.message || 'Google login failed.' });
  }
});

app.get('/api/auth/google', (req, res) => {
  if (!googleClientId || !googleClientSecret) {
    return redirectWithAuthError(res, 'Google login is not configured yet.');
  }

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', googleClientId);
  authUrl.searchParams.set('redirect_uri', googleRedirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('prompt', 'select_account');
  authUrl.searchParams.set('state', crypto.randomBytes(16).toString('hex'));

  res.redirect(authUrl.toString());
});

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) return redirectWithAuthError(res, `Google cancelled: ${error}`);
    if (!code) return redirectWithAuthError(res, 'Google did not return a login code.');
    if (!googleClientId || !googleClientSecret) {
      return redirectWithAuthError(res, 'Google login is not configured yet.');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: googleRedirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Google token exchange failed.');
    }

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.email) {
      throw new Error(profile.error_description || profile.error || 'Google profile load failed.');
    }

    const data = await readAppData();
    const normalizedEmail = String(profile.email).trim().toLowerCase();
    let user = Object.values(data.users).find((candidate) => (
      candidate.googleId === profile.sub || candidate.email === normalizedEmail
    ));

    if (!user) {
      const id = `user_${crypto.randomUUID()}`;
      user = {
        id,
        name: profile.name || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        googleId: profile.sub,
        provider: 'google',
        credits: 0,
        createdAt: new Date().toISOString(),
      };
      data.users[id] = user;
    } else {
      user.googleId = profile.sub;
      user.name = user.name || profile.name || normalizedEmail.split('@')[0];
      user.email = normalizedEmail;
      user.provider = user.passwordHash ? 'password_google' : 'google';
      data.users[user.id] = user;
    }

    await writeAppData(data);

    const redirectUrl = new URL(appUrl);
    redirectUrl.searchParams.set('googleUser', user.id);
    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('Google auth failed:', error.message || error);
    redirectWithAuthError(res, error.message || 'Google login failed.');
  }
});
// 1. Endpoint: Get User Credits
app.get('/api/user/:id', async (req, res) => {
  try {
    const db = getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ credits: user.credits });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// 2. Endpoint: Create PayPal Order
app.post('/api/orders', async (req, res) => {
  try {
    const { amount, returnUrl, cancelUrl } = req.body;
    const accessToken = await getPayPalAccessToken();
    const { statusCode, data } = await paypalRequest('/v2/checkout/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: amount.toString() },
        }],
      }),
    });

    res.status(statusCode).json(data);
  } catch (error) {
    console.error('Failed to create order:', error.message || error);
    res.status(500).json({ error: error.message || 'Failed to create order.' });
  }
});

// 3. Endpoint: Capture PayPal Order
app.post('/api/orders/:orderID/capture', async (req, res) => {
  try {
    const { orderID } = req.params;
    const { userId, creditsPurchased } = req.body;

    if (!userId || !creditsPurchased) {
      return res.status(400).json({ error: 'Missing userId or creditsPurchased' });
    }

    const accessToken = await getPayPalAccessToken();
    const { statusCode, data } = await paypalRequest(`/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
    });

    if (data.status === 'COMPLETED') {
      const db = getDb();
      await db.run('UPDATE users SET credits = credits + ? WHERE id = ?', [creditsPurchased, userId]);
      res.status(statusCode).json(data);
    } else {
      res.status(400).json({ error: 'Payment not completed' });
    }
  } catch (error) {
    console.error('Failed to capture order:', error.message || error);
    res.status(500).json({ error: error.message || 'Failed to process payment' });
  }
});
// 3. Endpoint: Conversion
app.post('/api/convert', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const targetFormat = req.body.targetFormat.toLowerCase();
    const userId = req.body.userId || 'user_1';
    
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const db = getDb();
    
    // Check credits
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user || user.credits <= 0) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(402).json({ error: 'Insufficient credits. Please purchase more to convert files.' });
    }

    const apiKey = getApiKey();
    const apiBase = 'https://api.api2convert.com/v2';

    // A. Create the Job
    const jobConfig = {
      conversion: [
        {
          target: targetFormat
        }
      ]
    };

    let createResponse = await fetch(`${apiBase}/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-oc-api-key': apiKey
      },
      body: JSON.stringify(jobConfig)
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create job: ${errorText}`);
    }

    const jobData = await createResponse.json();
    const jobId = jobData.id;
    const serverUrl = jobData.server;

    // B. Upload the file to the assigned server
    const form = new FormData();
    const fileBuffer = fs.readFileSync(file.path);
    const blob = new Blob([fileBuffer]);
    form.append('file', blob, file.originalname);

    let uploadResponse = await fetch(`${serverUrl}/upload-file/${jobId}`, {
      method: 'POST',
      headers: {
        'x-oc-api-key': apiKey,
        'x-oc-upload-uuid': `upload-${Date.now()}`
      },
      body: form
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload file to api2convert server.');
    }

    // C. Poll until job is completed
    let completedJob = null;
    let attempts = 0;
    while (attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2 seconds
      
      let pollResponse = await fetch(`${apiBase}/jobs/${jobId}`, {
        method: 'GET',
        headers: { 'x-oc-api-key': apiKey }
      });
      let pollData = await pollResponse.json();
      
      if (pollData.status.code === 'completed') {
        completedJob = pollData;
        break;
      } else if (pollData.status.code === 'failed') {
        throw new Error('Conversion job failed on api2convert.');
      }
      attempts++;
    }

    // Clean up local temp file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    if (!completedJob) {
      throw new Error('Conversion timed out waiting for completion.');
    }

    // Find the output file
    if (completedJob.output && completedJob.output.length > 0) {
      const downloadUrl = completedJob.output[0].uri;
      
      // Deduct 1 credit upon success
      await db.run('UPDATE users SET credits = credits - 1 WHERE id = ?', [userId]);

      res.json({ downloadUrl });
    } else {
      res.status(500).json({ error: 'No output URL returned from API.' });
    }

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error(error);
    res.status(500).json({ error: error.message || 'An error occurred during conversion.' });
  }
});

app.use(express.static('dist'));

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) {
    return next();
  }

  const indexPath = path.resolve('dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  next();
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CloudConvert Clone Server running on port ${PORT}`);
});
