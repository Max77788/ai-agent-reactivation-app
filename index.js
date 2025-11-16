import express from "express";
import axios from "axios";
import qs from "qs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  TOKEN_ENDPOINT,
  N8N_URL,
  N8N_API_KEY,
  GHL_AUTH_URL, // e.g. https://marketplace.gohighlevel.com/oauth/chooselocation
  GHL_SCOPE, // e.g. api
} = process.env;

app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/oauth/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).json({ error: "Missing code parameter" });
    }

    // 1) Exchange code for tokens with HighLevel
    const tokenResponse = await axios.post(
      TOKEN_ENDPOINT,
      qs.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const tokenData = tokenResponse.data;
    const { access_token, refresh_token, expires_in } = tokenData;

    // 2) Create n8n credential of type `highlevelApi`
    const credentialName = `HighLevel – User ${state || "unknown"}`;

    const credentialBody = {
      name: credentialName,
      type: "highlevelApi",
      data: {
        authUrl:
          GHL_AUTH_URL ||
          "https://marketplace.gohighlevel.com/oauth/chooselocation",
        scope: GHL_SCOPE || "api",
        oauthTokenData: tokenData,
      },
    };

    const n8nResponse = await axios.post(
      `${N8N_URL}/api/v1/credentials`,
      credentialBody,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-N8N-API-KEY": N8N_API_KEY,
        },
      }
    );

    const createdCredential = n8nResponse.data;
    const credentialId = createdCredential.id;

    // 3) Notify n8n workflow via webhook BEFORE redirect
    try {
      await axios.post(
        "https://kimcdang.app.n8n.cloud/webhook/on-ghl-connected",
        {
          credentialId,
          clientId: CLIENT_ID,
          credentialName,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    } catch (webhookError) {
      console.error(
        "Failed to notify n8n webhook:",
        webhookError.response?.data || webhookError.message
      );
      // Decide if you want to fail here or still continue to redirect.
      // For now we just log and continue.
    }

    // 4) Redirect user to success page
    return res.redirect("/success.html");
  } catch (error) {
    console.error(
      "OAuth callback / n8n creation error:",
      error.response?.data || error.message
    );
    return res.status(500).json({
      error: "Something failed during OAuth or n8n credential creation",
      details: error.response?.data || error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});