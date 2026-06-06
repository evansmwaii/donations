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
const SHORTCODE       = process.env.SHORTCODE;       // Your Till/Paybill number
const PASSKEY         = process.env.PASSKEY;          // From Daraja go-live email
const CALLBACK_URL    = process.env.CALLBACK_URL;     // e.g. https://yourapp.onrender.com/callback

const BASE_URL = "https://api.safaricom.co.ke";

// ── HELPERS ─────────────────────────────────────────────────────────────────

// Step 1: Get OAuth access token from Safaricom
async function getAccessToken() {
  const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");
  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    method: "GET",
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) throw new Error("Failed to get access token");
  const data = await res.json();
  return data.access_token;
}

// Step 2: Generate timestamp (YYYYMMDDHHmmss)
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

// Step 3: Generate password (Base64 of Shortcode + Passkey + Timestamp)
function getPassword(timestamp) {
  const raw = `${SHORTCODE}${PASSKEY}${timestamp}`;
  return Buffer.from(raw).toString("base64");
}

// ── ROUTES ───────────────────────────────────────────────────────────────────

// Serve Frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Serve info.md for the frontend to fetch
app.get("/info.md", (req, res) => {
  res.sendFile(path.join(__dirname, "info.md"));
});

// Serve the background image
app.get("/istockphoto-1359352103-612x612.jpg", (req, res) => {
  res.sendFile(path.join(__dirname, "istockphoto-1359352103-612x612.jpg"));
});

// Initiate STK Push
app.post("/pay", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    // Basic validation
    if (!phone || !amount) {
      return res.status(400).json({ error: "Phone number and amount are required." });
    }

    // Normalize phone: handle 07XX, 01XX, 2547XX, 2541XX, +2547XX, +2541XX
    let normalized = String(phone).replace(/\s+/g, "");
    if (normalized.startsWith("+")) {
      normalized = normalized.slice(1);
    }
    if (normalized.startsWith("0")) {
      normalized = "254" + normalized.slice(1);
    }
    if (!/^254(7|1)\d{8}$/.test(normalized)) {
      return res.status(400).json({ error: "Invalid Kenyan phone number." });
    }

    const parsedAmount = Math.ceil(Number(amount));
    if (isNaN(parsedAmount) || parsedAmount < 1) {
      return res.status(400).json({ error: "Invalid amount." });
    }

    // Get token and build request
    const token     = await getAccessToken();
    const timestamp = getTimestamp();
    const password  = getPassword(timestamp);

    const payload = {
      BusinessShortCode: SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   "CustomerPayBillOnline",
      Amount:            parsedAmount,
      PartyA:            normalized,
      PartyB:            SHORTCODE,
      PhoneNumber:       normalized,
      CallBackURL:       CALLBACK_URL,
      AccountReference:  "Evans Fundraising",
      TransactionDesc:   "Donation for Final Year Project",
    };

    const stkRes = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const stkData = await stkRes.json();

    if (stkData.ResponseCode === "0") {
      res.json({
        success: true,
        message: "STK Push sent. Check your phone to complete the payment.",
        checkoutRequestId: stkData.CheckoutRequestID,
      });
    } else {
      res.status(400).json({
        success: false,
        error: stkData.errorMessage || "STK Push failed. Try again.",
      });
    }
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// Safaricom callback — receives payment confirmation
app.post("/callback", (req, res) => {
  const body = req.body;
  console.log("M-Pesa Callback:", JSON.stringify(body, null, 2));

  const result = body?.Body?.stkCallback;
  if (result?.ResultCode === 0) {
    const items = result.CallbackMetadata?.Item || [];
    const get   = (name) => items.find((i) => i.Name === name)?.Value;
    console.log("✅ Payment received:", {
      amount: get("Amount"),
      receipt: get("MpesaReceiptNumber"),
      phone:   get("PhoneNumber"),
    });
  } else {
    console.log("❌ Payment failed or cancelled:", result?.ResultDesc);
  }

  // Always acknowledge Safaricom's callback
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

// ── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
