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
  GHL_AUTH_URL, // e.g. https://marketplace.gohighlevel.com/oauth/chooselocation
  GHL_SCOPE, // e.g. api
} = process.env;

app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/oauth/callback", async (req, res) => {
  try {
    const { code, state, n8nClientId, businessName } = req.query;

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

    const credentialName = `HighLevel – User ${n8nClientId || businessName || "unknown"}`;

    // 2) Create n8n credential of type `highlevelOAuth2Api`
    //
    // According to your schema:
    // - REQUIRED: authUrl, scope
    // - OPTIONAL: oauthTokenData, notice
    // - serverUrl, clientId, clientSecret, sendAdditionalBodyProperties,
    //   additionalBodyProperties must NOT be present in the "else" branches.
    //
    // So we only send: authUrl, scope, oauthTokenData
    const credentialBody = {
      name: credentialName,
      type: "highLevelOAuth2Api",
      data: {
        authUrl:
          GHL_AUTH_URL ||
          "https://marketplace.gohighlevel.com/oauth/chooselocation",
        scope: GHL_SCOPE || "api",
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
          clientId: n8nClientId,
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
      // You can decide whether to fail hard here or just log.
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