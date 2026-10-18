AMORA BET v0.24.12.1 — GOOGLE AI STUDIO / CLOUD RUN
====================================================

TARGET
------
Import into Google AI Studio Build mode and deploy from AI Studio to Cloud Run.

IMPORTANT ARCHITECTURE
----------------------
Google AI Studio is the development/build environment.
The production hosting created from AI Studio is Cloud Run.

This package is prepared for:
- React + Vite frontend
- Node/Express backend
- relative /api/* calls
- PORT provided by Cloud Run (default 8080)
- HOST 0.0.0.0
- Firebase project amorabet-f4405
- Firebase Admin through Application Default Credentials on Cloud Run
- secrets stored server-side, not in VITE_*

DO NOT UPLOAD AS CODE
---------------------
.env.local
firebase-service-account.json
secrets/
private API keys/tokens

AI STUDIO SECRETS / CLOUD RUN ENV
---------------------------------
Configure server-side secrets for:
- IGAMEWIN_AGENT_CODE
- IGAMEWIN_AGENT_TOKEN
- PAYONPAG_API_SECRET
- PAYONPAG_RECIPIENT_ID
- any other payment/provider secret

PUBLIC FIREBASE WEB CONFIG
--------------------------
The VITE_FIREBASE_* values are client configuration and may be present in the build.

FIREBASE ADMIN ON CLOUD RUN
---------------------------
Preferred mode:
1. deploy Cloud Run with a dedicated service account;
2. grant that service account the Firebase/Firestore/Storage roles required;
3. backend uses applicationDefault().
No JSON key file is required in the deployed container.

ADMIN
-----
ADMIN_EMAILS=admin.eduh@gmail.com

DATABASE
--------
Firestore project: amorabet-f4405
Realtime Database: https://amorabet-f4405-default-rtdb.firebaseio.com
Storage: amorabet-f4405.firebasestorage.app

IMPORT INTO AI STUDIO
---------------------
1. Put this code in GitHub.
2. AI Studio > Build > Add files (+) > Import from GitHub.
3. Let AI Studio install dependencies.
4. Add server-side secrets in Settings > Secrets.
5. Verify preview.
6. Deploy to Cloud Run from AI Studio.
7. Configure a custom domain on Cloud Run if desired.
