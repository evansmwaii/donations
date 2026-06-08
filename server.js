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
const PASSKEY         = process.env.PASSKEY;      // From Daraja go-live email
const CALLBACK_URL    = process.env.CALLBACK_URL; // e.g. https://yourapp.onrender.com/callback

// ✅ FIX 1: Production URL (not sandbox)
const BASE_URL = "https://api.safaricom.co.ke";

// ── HELPERS ─────────────────────────────────────────────────────────────────

// Get OAuth access token from Safaricom
async function getAccessToken() {
  const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");
  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    method: "GET",
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to get access token: ${errText}`);
  }

  const data = await res.json();
  return data.access_token;
}

// Generate timestamp: YYYYMMDDHHmmss
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

// Generate password: Base64(Shortcode + Passkey + Timestamp)
// For Buy Goods, Shortcode here is your STORE NUMBER (9084674)
function getPassword(timestamp) {
  const raw = `${SHORTCODE}${PASSKEY}${timestamp}`;
  return Buffer.from(raw).toString("base64");
}

// ── ROUTES ───────────────────────────────────────────────────────────────────

// Serve Frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Serve info.md
app.get("/info.md", (req, res) => {
  res.sendFile(path.join(__dirname, "info.md"));
});

// Serve background image
app.get("/istockphoto-1359352103-612x612.jpg", (req, res) => {
  res.sendFile(path.join(__dirname, "istockphoto-1359352103-612x612.jpg"));
});

// ── STK PUSH ─────────────────────────────────────────────────────────────────
app.post("/pay", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    // Validate inputs
    if (!phone || !amount) {
      return res.status(400).json({ error: "Phone number and amount are required." });
    }

    // Normalize Kenyan phone: 07XX / 01XX / +2547XX / 2547XX → 2547XXXXXXXX
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

    // Build STK Push request
    const token     = await getAccessToken();
    const timestamp = getTimestamp();
    const password  = getPassword(timestamp);

    const payload = {
      BusinessShortCode: SHORTCODE,              // Store Number (9084674) — used for password & routing
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   "CustomerBuyGoodsOnline", // ✅ FIX 2: correct type for Buy Goods / Till
      Amount:            parsedAmount,
      PartyA:            normalized,             // Customer's phone
      PartyB:            TILL_NUMBER,            // ✅ FIX 3: Till Number (5961013) receives the money
      PhoneNumber:       normalized,             // Phone that gets the STK prompt
      CallBackURL:       CALLBACK_URL,
      AccountReference:  "Evans Fundraising",
      TransactionDesc:   "Donation for Final Year Project",
    };

    console.log("📤 STK Push payload:", JSON.stringify(payload, null, 2));

    const stkRes = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const stkData = await stkRes.json();
    console.log("📥 STK Push response:", JSON.stringify(stkData, null, 2));

    if (stkData.ResponseCode === "0") {
      return res.json({
        success: true,
        message: "STK Push sent. Check your phone to complete the payment.",
        checkoutRequestId: stkData.CheckoutRequestID,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: stkData.errorMessage || stkData.ResponseDescription || "STK Push failed. Try again.",
      });
    }

  } catch (err) {
    console.error("❌ /pay error:", err.message);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// ── CALLBACK ──────────────────────────────────────────────────────────────────
// Safaricom posts payment result here after customer acts on STK prompt
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

  // Safaricom requires this acknowledgement — always respond with 200
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`   SHORTCODE (Store):  ${SHORTCODE}`);
  console.log(`   TILL_NUMBER:        ${TILL_NUMBER}`);
  console.log(`   CALLBACK_URL:       ${CALLBACK_URL}`);
});
