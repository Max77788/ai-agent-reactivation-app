const express = require("express");
const axios = require("axios");
const qs = require("qs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  TOKEN_ENDPOINT,
  N8N_URL,
  N8N_API_KEY,
  GHL_AUTH_URL, // must be one of the enum values in the schema
  GHL_SCOPE, // e.g. "api" or the full HighLevel scopes string
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

    console.log(`Code: ${code}`);

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
    console.log("Received token data from GHL:", tokenData);

    const credentialName = `HighLevel – User ${state || "unknown"}`;

    // 2) Create n8n credential of type `highLevelOAuth2Api`
    //
    // IMPORTANT: match the schema exactly:
    // - DO send:  authUrl, scope, oauthTokenData
    // - DO NOT send: useDynamicClientRegistration, grantType,
    //                serverUrl, clientId, clientSecret,
    //                sendAdditionalBodyProperties, additionalBodyProperties
    //
    // authUrl must be one of the enum values in the schema.
    const authUrl =
      GHL_AUTH_URL ||
      "https://marketplace.gohighlevel.com/oauth/chooselocation";

    const scope =
      GHL_SCOPE ||
      tokenData.scope || // you can reuse GHL's scope string if you like
      "api";

    const credentialBody = {
      name: credentialName,
      type: "highLevelOAuth2Api",
      data: {
        authUrl,
        scope,
        oauthTokenData: tokenData,
      },
    };

    console.log("Creating n8n credential with body:", credentialBody);

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

    console.log("Created n8n credential:", createdCredential);

    // 3) Notify n8n via webhook
    try {
      await axios.post(
        "https://kimcdang.app.n8n.cloud/webhook/on-ghl-connected",
        {
          ghlCredentialId: credentialId,
          clientId: CLIENT_ID,
          ghlCredentialName: credentialName,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      console.log("Successfully notified n8n webhook");
    } catch (webhookError) {
      console.error(
        "Failed to notify n8n webhook:",
        webhookError.response?.data || webhookError.message
      );
      // You can choose whether to treat this as fatal or not.
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

// If you’re using @vercel/node and want to export the app instead of listen():
// module.exports = app;