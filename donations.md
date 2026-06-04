# Evans Fundraising Platform — Project Resume File

> Paste this file into a new Claude conversation and say:
> **"Resume my project using this init.md"**

---

## Project Overview

A live fundraising website for **Evans Githinji Mwai**, a Final Year Electrical and Electronic Engineering student at **Mount Kenya University**. The project being funded is a **Microcontroller-based Egg Incubator**.

The platform accepts donations via **M-Pesa STK Push** using the Safaricom Daraja API.

---

## Current Status

| Component | Status |
|---|---|
| Frontend (`index.html`) | ✅ Complete — deployed on Netlify |
| Backend (`server.js`) | ✅ Complete — tested, sandbox payments confirmed |
| Sandbox testing | ✅ Successful — KSh 100 test payment confirmed (receipt: UDSPQ2GDCS) |
| Production deployment | ⏳ Blocked — waiting on Paybill number |
| Daraja Go Live | ❌ Rejected — Till number 5961013 not API-compatible |

---

## The Blocker

Evans has a **Buy Goods Till number: 5961013** but Safaricom's Daraja API rejected it saying the shortcode does not accept the API selected. Retail Till numbers are not directly compatible with the STK Push API.

**Resolution:** Evans needs to register a personal **M-Pesa Paybill number** at a Safaricom Shop (costs ~KSh 1,000–2,000, takes 1–3 days). Once he has the Paybill number, he applies for Daraja Go Live again with that number and receives a Production Passkey by email.

---

## File Structure

```
~/donations/
├── server.js          # Node.js/Express backend — M-Pesa STK Push
├── package.json       # Dependencies: express, cors, dotenv
├── .env               # Secret credentials (never share/commit)
├── .env.example       # Credentials template
├── ui.py              # Original Streamlit frontend (still works locally)
├── index.html         # Netlify-compatible frontend (mirrors ui.py exactly)
├── info.md            # Project content loaded dynamically by index.html
└── istockphoto-1359352103-612x612.jpg  # Hero background image
```

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS — `index.html` deployed on Netlify
- **Backend:** Node.js + Express — `server.js` deployed on Render.com
- **Payment:** Safaricom Daraja API — M-Pesa STK Push
- **Original UI:** Streamlit (`ui.py`) — still runs locally via `streamlit run ui.py`

---

## Design System

| Token | Value |
|---|---|
| Background | `#0D0D0D` |
| Surface | `#161616` |
| Surface 2 | `#1E1E1E` |
| Gold | `#C9A84C` |
| Gold Light | `#E8C97A` |
| Gold Dim | `#8C7035` |
| Text | `#F0EDE6` |
| Muted | `#9A9589` |
| Heading Font | Playfair Display (Google Fonts) |
| Body Font | DM Sans (Google Fonts) |

---

## Backend — `server.js` Key Details

- **Framework:** Express.js
- **Routes:**
  - `GET /` — health check
  - `POST /pay` — validates phone/amount, gets OAuth token, fires STK Push
  - `POST /callback` — receives Safaricom payment confirmation
  - `GET /status/:checkoutId` — frontend polls this for payment confirmation
- **Phone normalization:** accepts `07XX`, `01XX`, `2547XX`, `2541XX`, `+254` formats
- **Current BASE_URL:** `https://sandbox.safaricom.co.ke` ← change to production when ready

---

## `.env` Structure

```bash
CONSUMER_KEY=your_production_consumer_key
CONSUMER_SECRET=your_production_consumer_secret
SHORTCODE=your_paybill_number        # ← still needed
PASSKEY=your_passkey_from_daraja     # ← still needed
CALLBACK_URL=https://your-app.onrender.com/callback
PORT=3000
```

**Sandbox credentials used during testing:**
- Shortcode: `174379`
- Passkey: `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919`
- TransactionType used: `CustomerPayBillOnline`

**Production changes needed in `server.js`:**
```js
// Line 1 — switch URL:
const BASE_URL = "https://api.safaricom.co.ke";

// Line 2 — switch transaction type (for Paybill):
TransactionType: "CustomerPayBillOnline",
// OR for Buy Goods Till (if Till becomes API-compatible):
TransactionType: "CustomerBuyGoodsOnline",
```

---

## Frontend — `index.html` Key Details

- Mirrors `ui.py` exactly — same layout, same gold-on-dark aesthetic
- Fetches `info.md` at runtime and splits at `## Justification of the Study` (same logic as ui.py)
- Has a `FALLBACK_CONTENT` variable inside the script tag for when `info.md` isn't available
- Quick amount buttons: KSh 50, 100, 200, 300, 500, 1,000
- One line to update before deploying:
```js
const BACKEND_URL = "https://YOUR-APP-NAME.onrender.com";
```

---

## Deployment

| Service | Purpose | URL |
|---|---|---|
| Netlify | Frontend hosting | drag-and-drop `index.html` + `info.md` + image |
| Render.com | Backend hosting | free tier, Frankfurt region |
| GitHub | Backend source | upload `server.js` + `package.json` only |

**Render.com settings:**
- Build Command: `npm install`
- Start Command: `node server.js`
- Region: Frankfurt
- Instance: Free

---

## Next Steps (in order)

1. **Evans visits a Safaricom Shop** with National ID and registers a personal Paybill (~KSh 1,000–2,000)
2. **Apply for Daraja Go Live** at developer.safaricom.co.ke with the new Paybill number
3. **Wait for approval email** (1–3 days) containing the Production Passkey
4. **Create Production app** on Daraja → get Production Consumer Key and Secret
5. **Update `.env`** with production credentials
6. **Change two lines in `server.js`** (BASE_URL and TransactionType)
7. **Push updated `server.js` to GitHub** → Render auto-redeploys
8. **Update `BACKEND_URL` in `index.html`** → redeploy to Netlify
9. **Test with KSh 1** to own number — if STK Push fires and money moves, fully live ✅

---

## Contact

- **Name:** Evans Githinji Mwai
- **Phone:** 0724 862 896
- **Institution:** Mount Kenya University
- **Course:** Electrical and Electronic Engineering — Final Year Project
