const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// ── CONFIG ──────────────────────────────────────────────────────────────────
const CONSUMER_KEY    = process.env.CONSUMER_KEY;
const CONSUMER_SECRET = process.env.CONSUMER_SECRET;
const SHORTCODE       = process.env.SHORTCODE;    // Store Number: 9084674
const TILL_NUMBER     = process.env.TILL_NUMBER;  // Till Number:  5961013
const PASSKEY         = process.env.PASSKEY;
const CALLBACK_URL    = process.env.CALLBACK_URL;

const BASE_URL = "https://api.safaricom.co.ke";

// ── TOKEN CACHE ──────────────────────────────────────────────────────────────
// Safaricom tokens last 3600 seconds (1 hour).
// We cache it and only fetch a new one when it's about to expire.
// This prevents rate-limit errors from hitting OAuth too frequently.
let cachedToken     = null;
let tokenExpiresAt  = 0; // Unix ms timestamp

async function getAccessToken() {
  const now = Date.now();

  // Return cached token if it still has >60 seconds left
  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");

  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    method: "GET",
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OAuth failed (${res.status}): ${errText}`);
  }

  const data = await res.json();

  if (!data.access_token) {
    throw new Error(`No access_token in response: ${JSON.stringify(data)}`);
  }

  cachedToken    = data.access_token;
  // expires_in is in seconds, default 3600
  tokenExpiresAt = now + (parseInt(data.expires_in) || 3600) * 1000;

  console.log("🔑 New access token fetched, expires in", data.expires_in, "seconds");
  return cachedToken;
}

// ── HELPERS ─────────────────────────────────────────────────────────────────
function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

function getPassword(timestamp) {
  const raw = `${SHORTCODE}${PASSKEY}${timestamp}`;
  return Buffer.from(raw).toString("base64");
}

// ── STK PUSH with retry ──────────────────────────────────────────────────────
// If we get an Invalid Access Token error, clear the cache and retry once.
async function doStkPush(phone, amount, attempt = 1) {
  const token     = await getAccessToken();
  const timestamp = getTimestamp();
  const password  = getPassword(timestamp);

  const payload = {
    BusinessShortCode: SHORTCODE,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   "CustomerBuyGoodsOnline",
    Amount:            amount,
    PartyA:            phone,
    PartyB:            TILL_NUMBER,
    PhoneNumber:       phone,
    CallBackURL:       CALLBACK_URL,
    AccountReference:  "Evans Fundraising",
    TransactionDesc:   "Donation for Final Year Project",
  };

  console.log(`📤 STK Push attempt ${attempt}:`, JSON.stringify(payload, null, 2));

  const stkRes = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const stkData = await stkRes.json();
  console.log(`📥 STK Response (attempt ${attempt}):`, JSON.stringify(stkData, null, 2));

  // If token was rejected and this is our first attempt, clear cache and retry
  if (
    attempt === 1 &&
    (stkData.errorCode === "404.001.03" || stkData.errorMessage === "Invalid Access Token")
  ) {
    console.log("⚠️  Invalid token detected — clearing cache and retrying...");
    cachedToken    = null;
    tokenExpiresAt = 0;
    return doStkPush(phone, amount, 2);
  }

  return stkData;
}

// ── ROUTES ───────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/info.md", (req, res) => res.sendFile(path.join(__dirname, "info.md")));
app.get("/thankyou", (req, res) => res.sendFile(path.join(__dirname, "thankyou.html")));
app.get("/istockphoto-1359352103-612x612.jpg", (req, res) =>
  res.sendFile(path.join(__dirname, "istockphoto-1359352103-612x612.jpg"))
);

// ── /pay ─────────────────────────────────────────────────────────────────────
app.post("/pay", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: "Phone number and amount are required." });
    }

    // Normalize phone
    let normalized = String(phone).replace(/\s+/g, "");
    if (normalized.startsWith("+")) normalized = normalized.slice(1);
    if (normalized.startsWith("0"))  normalized = "254" + normalized.slice(1);
    if (!/^254(7|1)\d{8}$/.test(normalized)) {
      return res.status(400).json({ error: "Invalid Kenyan phone number." });
    }

    const parsedAmount = Math.ceil(Number(amount));
    if (isNaN(parsedAmount) || parsedAmount < 1) {
      return res.status(400).json({ error: "Invalid amount." });
    }

    const stkData = await doStkPush(normalized, parsedAmount);

    if (stkData.ResponseCode === "0") {
      return res.json({
        success:           true,
        message:           "STK Push sent. Check your phone to complete the payment.",
        checkoutRequestId: stkData.CheckoutRequestID,
      });
    } else {
      return res.status(400).json({
        success: false,
        error:   stkData.errorMessage || stkData.ResponseDescription || "STK Push failed. Try again.",
      });
    }

  } catch (err) {
    console.error("❌ /pay error:", err.message);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// ── /callback ────────────────────────────────────────────────────────────────
app.post("/callback", (req, res) => {
  const body = req.body;
  console.log("📲 M-Pesa Callback received:", JSON.stringify(body, null, 2));

  const result = body?.Body?.stkCallback;
  if (result?.ResultCode === 0) {
    const items = result.CallbackMetadata?.Item || [];
    const get   = (name) => items.find((i) => i.Name === name)?.Value;
    console.log("✅ Payment successful:", {
      amount:  get("Amount"),
      receipt: get("MpesaReceiptNumber"),
      phone:   get("PhoneNumber"),
      date:    get("TransactionDate"),
    });
  } else {
    console.log("❌ Payment failed or cancelled:", result?.ResultDesc);
  }

  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`   SHORTCODE (Store):  ${SHORTCODE}`);
  console.log(`   TILL_NUMBER:        ${TILL_NUMBER}`);
  console.log(`   CALLBACK_URL:       ${CALLBACK_URL}`);

  // Pre-warm the token on startup so the first request is instant
  getAccessToken()
    .then(() => console.log("🔑 Access token pre-warmed successfully"))
    .catch((err) => console.warn("⚠️  Could not pre-warm token:", err.message));
});
