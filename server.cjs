var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs2 = __toESM(require("fs"), 1);
var import_multer = __toESM(require("multer"), 1);
var import_vite = require("vite");
var import_dotenv = __toESM(require("dotenv"), 1);
var import_genai = require("@google/genai");

// server/paymentProvider.ts
var import_stripe = __toESM(require("stripe"), 1);
var StripeProvider = class {
  constructor() {
    this.name = "stripe";
    this.client = null;
  }
  getClient() {
    if (!this.client) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new Error("STRIPE_SECRET_KEY \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637.");
      this.client = new import_stripe.default(key);
    }
    return this.client;
  }
  isConfigured() {
    return !!process.env.STRIPE_SECRET_KEY;
  }
  async createDepositCheckout(params) {
    const stripe = this.getClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: params.currency,
            product_data: { name: "\u0634\u062D\u0646 \u0645\u062D\u0641\u0638\u0629 \u0644\u064A\u062A\u064A\u0631\u064A\u0648\u0645" },
            unit_amount: Math.round(params.amount * 100)
          },
          quantity: 1
        }
      ],
      metadata: { uid: params.uid, kind: "wallet_deposit" },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl
    });
    if (!session.url) throw new Error("\u062A\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u062C\u0644\u0633\u0629 \u0627\u0644\u062F\u0641\u0639.");
    return { checkoutUrl: session.url, providerRef: session.id };
  }
  parseWebhookEvent(rawBody, signatureHeader) {
    const stripe = this.getClient();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637.");
    if (!signatureHeader) throw new Error("missing_signature");
    const event = stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.metadata?.uid;
      if (!uid || session.metadata?.kind !== "wallet_deposit") {
        return { kind: "ignored", eventId: event.id };
      }
      const amount = (session.amount_total || 0) / 100;
      if (amount <= 0) return { kind: "ignored", eventId: event.id };
      return {
        kind: "deposit_completed",
        uid,
        amount,
        currency: (session.currency || "usd").toUpperCase(),
        providerRef: session.id,
        eventId: event.id
      };
    }
    if (event.type === "account.updated") {
      const account = event.data.object;
      return {
        kind: "payout_account_updated",
        accountId: account.id,
        payoutsEnabled: !!account.payouts_enabled,
        eventId: event.id
      };
    }
    return { kind: "ignored", eventId: event.id };
  }
  async ensurePayoutAccount(params) {
    const stripe = this.getClient();
    let accountId = params.existingAccountId;
    if (!accountId) {
      const account2 = await stripe.accounts.create({
        type: "express",
        email: params.email || void 0,
        metadata: { uid: params.uid },
        capabilities: { transfers: { requested: true } }
      });
      accountId = account2.id;
    }
    const account = await stripe.accounts.retrieve(accountId);
    let onboardingUrl;
    if (!account.payouts_enabled || !account.details_submitted) {
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: params.refreshUrl,
        return_url: params.returnUrl,
        type: "account_onboarding"
      });
      onboardingUrl = link.url;
    }
    return {
      accountId,
      status: {
        connected: true,
        payoutsEnabled: !!account.payouts_enabled,
        onboardingUrl
      }
    };
  }
  async getPayoutAccountStatus(accountId) {
    const stripe = this.getClient();
    const account = await stripe.accounts.retrieve(accountId);
    return { connected: true, payoutsEnabled: !!account.payouts_enabled };
  }
  async createPayout(params) {
    const stripe = this.getClient();
    try {
      const transfer = await stripe.transfers.create({
        amount: Math.round(params.amount * 100),
        currency: params.currency,
        destination: params.accountId,
        metadata: { uid: params.uid }
      });
      return { ok: true, providerRef: transfer.id };
    } catch (err) {
      return { ok: false, reason: err?.message || "\u0641\u0634\u0644 \u062A\u062D\u0648\u064A\u0644 \u0645\u0633\u062A\u062D\u0642\u0627\u062A \u0627\u0644\u0633\u062D\u0628." };
    }
  }
};
var stripeProvider = new StripeProvider();
var activeProvider = stripeProvider;

// server/firebaseAdmin.ts
var import_app = require("firebase-admin/app");
var import_firestore = require("firebase-admin/firestore");
var import_auth = require("firebase-admin/auth");
var import_fs = require("fs");
var app = null;
var initAttempted = false;
var initError = null;
function tryInit() {
  if (initAttempted) return;
  initAttempted = true;
  try {
    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const jsonPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    let credential = null;
    if (rawJson && rawJson.trim()) {
      credential = (0, import_app.cert)(JSON.parse(rawJson));
    } else if (jsonPath && jsonPath.trim()) {
      credential = (0, import_app.cert)(JSON.parse((0, import_fs.readFileSync)(jsonPath, "utf8")));
    } else if (projectId && clientEmail && privateKey) {
      privateKey = privateKey.replace(/\\n/g, "\n");
      credential = (0, import_app.cert)({ projectId, clientEmail, privateKey });
    }
    if (!credential) {
      initError = "\u0644\u0645 \u064A\u062A\u0645 \u0636\u0628\u0637 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0639\u062A\u0645\u0627\u062F Firebase Admin (FIREBASE_SERVICE_ACCOUNT_JSON \u0623\u0648 \u0627\u0644\u062B\u0644\u0627\u062B\u064A\u0629 FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY).";
      return;
    }
    app = (0, import_app.initializeApp)({ credential });
  } catch (err) {
    initError = `\u0641\u0634\u0644 \u062A\u0647\u064A\u0626\u0629 Firebase Admin: ${err?.message || err}`;
    console.error(initError);
  }
}
function isAdminConfigured() {
  tryInit();
  return app !== null;
}
function getAdminInitError() {
  tryInit();
  return initError;
}
function getAdminDb() {
  tryInit();
  if (!app) {
    throw new Error(initError || "Firebase Admin \u063A\u064A\u0631 \u0645\u064F\u0647\u064A\u064E\u0651\u0623.");
  }
  return (0, import_firestore.getFirestore)(app);
}
function getAdminAuth() {
  tryInit();
  if (!app) {
    throw new Error(initError || "Firebase Admin \u063A\u064A\u0631 \u0645\u064F\u0647\u064A\u064E\u0651\u0623.");
  }
  return (0, import_auth.getAuth)(app);
}
var FieldValue = import_firestore.FieldValue;
async function verifyRequestAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("missing_auth_token");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new Error("missing_auth_token");
  }
  const decoded = await getAdminAuth().verifyIdToken(token);
  return {
    uid: decoded.uid,
    email: decoded.email || null,
    isAnonymous: decoded.firebase?.sign_in_provider === "anonymous"
  };
}

// server/mediaUpload.ts
var import_cloudinary = require("cloudinary");
var configured = false;
var configAttempted = false;
function tryConfigure() {
  if (configAttempted) return;
  configAttempted = true;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return;
  import_cloudinary.v2.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
  });
  configured = true;
}
function isMediaUploadConfigured() {
  tryConfigure();
  return configured;
}
var MAX_IMAGE_BYTES = 8 * 1024 * 1024;
var MAX_VIDEO_BYTES = 50 * 1024 * 1024;
var MAX_VIDEO_DURATION_SECONDS = 61;
function uploadMediaBuffer(buffer, opts) {
  tryConfigure();
  if (!configured) {
    return Promise.reject(new Error("media_upload_not_configured"));
  }
  return new Promise((resolve, reject) => {
    const stream = import_cloudinary.v2.uploader.upload_stream(
      {
        folder: opts.folder,
        resource_type: opts.resourceType,
        type: opts.type || "upload"
      },
      async (err, result) => {
        if (err || !result) {
          reject(err || new Error("upload_failed"));
          return;
        }
        if (opts.resourceType === "video") {
          const durationLimit = opts.maxDurationSeconds ?? MAX_VIDEO_DURATION_SECONDS;
          const duration = result.duration;
          if (typeof duration === "number" && duration > durationLimit) {
            try {
              await import_cloudinary.v2.uploader.destroy(result.public_id, { resource_type: "video" });
            } catch {
            }
            reject(new Error("video_too_long"));
            return;
          }
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            resourceType: "video",
            durationSeconds: duration
          });
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          resourceType: "image"
        });
      }
    );
    stream.end(buffer);
  });
}
function getSignedKycImageUrl(publicId) {
  tryConfigure();
  if (!configured) return null;
  return import_cloudinary.v2.url(publicId, {
    type: "authenticated",
    resource_type: "image",
    sign_url: true,
    secure: true
  });
}

// server/socialVerify.ts
var import_crypto = require("crypto");

// src/constants/socialPromoRewards.ts
var SOCIAL_VERIFIED_ACTION_REWARD_USD = 0.01;

// server/socialVerify.ts
async function recordVerificationAndReward(campaignId, viewerId, platform, extraFields = {}) {
  const db = getAdminDb();
  const verificationRef = db.collection("socialVerifications").doc(`${campaignId}_${viewerId}`);
  const campaignRef = db.collection("campaigns").doc(campaignId);
  const userRef = db.collection("users").doc(viewerId);
  let rewarded = false;
  await db.runTransaction(async (tx) => {
    const verSnap = await tx.get(verificationRef);
    if (verSnap.exists) {
      rewarded = Boolean(verSnap.data()?.rewarded);
      return;
    }
    const campSnap = await tx.get(campaignRef);
    const campData = campSnap.exists ? campSnap.data() || {} : {};
    const remaining = Number(campData.totalBudget || 0) - Number(campData.totalSpent || 0);
    rewarded = remaining >= SOCIAL_VERIFIED_ACTION_REWARD_USD;
    tx.set(verificationRef, {
      campaignId,
      viewerId,
      platform,
      verifiedAt: (/* @__PURE__ */ new Date()).toISOString(),
      rewarded,
      rewardAmount: rewarded ? SOCIAL_VERIFIED_ACTION_REWARD_USD : 0,
      ...extraFields
    });
    if (rewarded) {
      tx.update(campaignRef, {
        totalSpent: FieldValue.increment(SOCIAL_VERIFIED_ACTION_REWARD_USD),
        verifiedActionsCount: FieldValue.increment(1)
      });
      tx.update(userRef, {
        pendingEarnings: FieldValue.increment(SOCIAL_VERIFIED_ACTION_REWARD_USD)
      });
    }
  });
  return { rewarded, rewardAmount: rewarded ? SOCIAL_VERIFIED_ACTION_REWARD_USD : 0 };
}
function isTelegramVerificationConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}
function isYoutubeVerificationConfigured() {
  return true;
}
function verifyTelegramWidgetSignature(data, botToken) {
  const { hash, ...rest } = data;
  const checkString = Object.keys(rest).sort().filter((k) => rest[k] !== void 0 && rest[k] !== null).map((k) => `${k}=${rest[k]}`).join("\n");
  const secretKey = (0, import_crypto.createHash)("sha256").update(botToken).digest();
  const computedHash = (0, import_crypto.createHmac)("sha256", secretKey).update(checkString).digest("hex");
  if (computedHash !== hash) return false;
  const ageSeconds = Date.now() / 1e3 - data.auth_date;
  if (ageSeconds > 24 * 60 * 60) return false;
  return true;
}
function extractTelegramChannelHandle(url) {
  try {
    const clean = url.trim();
    const m = clean.match(/t(?:elegram)?\.me\/(?:s\/)?([A-Za-z0-9_]{4,})/i) || clean.match(/^@?([A-Za-z0-9_]{4,})$/);
    return m ? `@${m[1].replace(/^@/, "")}` : null;
  } catch {
    return null;
  }
}
async function verifyTelegramMembership(widgetData, channelUrl) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("telegram_not_configured");
  if (!verifyTelegramWidgetSignature(widgetData, botToken)) {
    throw new Error("invalid_telegram_signature");
  }
  const handle = extractTelegramChannelHandle(channelUrl);
  if (!handle) throw new Error("invalid_channel_url");
  const apiUrl = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(
    handle
  )}&user_id=${widgetData.id}`;
  const res = await fetch(apiUrl);
  const body = await res.json();
  if (!body.ok) {
    throw new Error(body.description || "telegram_check_failed");
  }
  const status = body.result?.status;
  const verified = ["creator", "administrator", "member"].includes(status);
  return { verified, telegramUserId: widgetData.id, telegramUsername: widgetData.username };
}
function extractYoutubeChannelRef(url) {
  const clean = url.trim();
  let m = clean.match(/youtube\.com\/channel\/([A-Za-z0-9_-]{10,})/);
  if (m) return { type: "id", value: m[1] };
  m = clean.match(/youtube\.com\/@([A-Za-z0-9_.-]{2,})/) || clean.match(/^@([A-Za-z0-9_.-]{2,})$/);
  if (m) return { type: "handle", value: `@${m[1]}` };
  return null;
}
async function resolveYoutubeChannelId(ref, accessToken) {
  if (ref.type === "id") return ref.value;
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(ref.value)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const body = await res.json();
  return body.items?.[0]?.id || null;
}
async function verifyYoutubeSubscription(accessToken, channelUrl) {
  if (!accessToken) throw new Error("missing_access_token");
  const ref = extractYoutubeChannelRef(channelUrl);
  if (!ref) throw new Error("invalid_channel_url");
  const channelId = await resolveYoutubeChannelId(ref, accessToken);
  if (!channelId) throw new Error("channel_not_found");
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/subscriptions?part=id&forChannelId=${encodeURIComponent(channelId)}&mine=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (res.status === 401) throw new Error("invalid_or_expired_token");
  const body = await res.json();
  if (body.error) throw new Error(body.error?.message || "youtube_check_failed");
  return { verified: Array.isArray(body.items) && body.items.length > 0 };
}

// server/nowPayments.ts
var import_crypto2 = require("crypto");
var NOWPAYMENTS_API_BASE = "https://api.nowpayments.io/v1";
function isNowPaymentsConfigured() {
  return Boolean(process.env.NOWPAYMENTS_API_KEY);
}
function isNowPaymentsIpnConfigured() {
  return Boolean(process.env.NOWPAYMENTS_IPN_SECRET);
}
async function createNowPaymentsInvoice(params) {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) throw new Error("nowpayments_not_configured");
  const requestBody = {
    price_amount: params.amount,
    price_currency: "usd",
    order_id: `${params.uid}_${Date.now()}`,
    order_description: "\u0634\u062D\u0646 \u0645\u062D\u0641\u0638\u0629 \u0644\u064A\u062A\u064A\u0631\u064A\u0648\u0645",
    success_url: params.successUrl,
    cancel_url: params.cancelUrl
  };
  if (params.ipnCallbackUrl) requestBody.ipn_callback_url = params.ipnCallbackUrl;
  const res = await fetch(`${NOWPAYMENTS_API_BASE}/invoice`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  const body = await res.json();
  if (!res.ok || !body.invoice_url) {
    throw new Error(body?.message || "\u062A\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u0641\u0627\u062A\u0648\u0631\u0629 \u0627\u0644\u062F\u0641\u0639 \u0628\u0627\u0644\u0639\u0645\u0644\u0629 \u0627\u0644\u0631\u0642\u0645\u064A\u0629.");
  }
  return { invoiceUrl: body.invoice_url, invoiceId: String(body.id) };
}
async function createNowPaymentsDirectPayment(params) {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) throw new Error("nowpayments_not_configured");
  const requestBody = {
    price_amount: params.amount,
    price_currency: "usd",
    pay_currency: "usdttrc20",
    order_id: `${params.uid}_${Date.now()}`,
    order_description: "\u0634\u062D\u0646 \u0645\u062D\u0641\u0638\u0629 \u0644\u064A\u062A\u064A\u0631\u064A\u0648\u0645 - \u062F\u0641\u0639 \u0628\u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0639\u0628\u0631 \u0648\u0633\u064A\u0637 \u062E\u0627\u0631\u062C\u064A"
  };
  if (params.ipnCallbackUrl) requestBody.ipn_callback_url = params.ipnCallbackUrl;
  const res = await fetch(`${NOWPAYMENTS_API_BASE}/payment`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  const body = await res.json();
  if (!res.ok || !body.pay_address) {
    throw new Error(body?.message || "\u062A\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u0639\u0646\u0648\u0627\u0646 \u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u062F\u0641\u0639.");
  }
  return {
    paymentId: String(body.payment_id),
    payAddress: String(body.pay_address),
    payCurrency: String(body.pay_currency || "usdttrc20"),
    payAmount: Number(body.pay_amount)
  };
}
function verifyNowPaymentsIpnSignature(rawBody, signatureHeader) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || !signatureHeader) return false;
  const sortedBody = sortObjectKeys(rawBody);
  const computed = (0, import_crypto2.createHmac)("sha512", secret).update(JSON.stringify(sortedBody)).digest("hex");
  return computed === signatureHeader;
}
function sortObjectKeys(obj) {
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj).sort().reduce((acc, key) => {
      acc[key] = sortObjectKeys(obj[key]);
      return acc;
    }, {});
  }
  return obj;
}

// server/pushNotifications.ts
var import_messaging = require("firebase-admin/messaging");
async function sendPushToUser(targetUserId, category, title, body, data) {
  if (!isAdminConfigured()) {
    return { sent: 0, pruned: 0, skippedReason: "not_configured" };
  }
  const db = getAdminDb();
  const userRef = db.collection("users").doc(targetUserId);
  const snap = await userRef.get();
  if (!snap.exists) {
    return { sent: 0, pruned: 0, skippedReason: "user_not_found" };
  }
  const user = snap.data() || {};
  const prefs = user.notificationPrefs || {};
  if (prefs.mutedAll === true || prefs[category] === false) {
    return { sent: 0, pruned: 0, skippedReason: "muted" };
  }
  const tokens = Array.isArray(user.fcmTokens) ? user.fcmTokens.filter((t) => typeof t === "string" && t.trim()) : [];
  if (tokens.length === 0) {
    return { sent: 0, pruned: 0, skippedReason: "no_tokens" };
  }
  const response = await (0, import_messaging.getMessaging)().sendEachForMulticast({
    notification: { title, body },
    data: data || {},
    tokens,
    android: { priority: "high" }
  });
  const invalidTokens = [];
  response.responses.forEach((r, idx) => {
    if (!r.success) {
      const code = r.error?.code || "";
      if (code.includes("registration-token-not-registered") || code.includes("invalid-argument") || code.includes("invalid-registration-token")) {
        invalidTokens.push(tokens[idx]);
      }
    }
  });
  if (invalidTokens.length > 0) {
    await userRef.update({ fcmTokens: FieldValue.arrayRemove(...invalidTokens) });
  }
  return { sent: response.successCount, pruned: invalidTokens.length };
}

// src/utils/creatorEligibility.ts
var CREATOR_ELIGIBILITY_THRESHOLDS = {
  MIN_FOLLOWERS: 100,
  MIN_VALID_VIEWS: 1e3,
  MIN_ACCOUNT_AGE_DAYS: 14,
  MIN_PUBLISHED_ARTICLES: 3
};
function getAccountAgeDays(createdAt) {
  if (!createdAt) return 0;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / (1e3 * 60 * 60 * 24)));
}
function getCreatorEligibility(user, articles, followersCountOverride) {
  const followersCount = followersCountOverride ?? (user.followersCount || 0);
  const ownPublished = articles.filter((a) => a.writerId === user.id && a.status === "published");
  const validViewsCount = ownPublished.reduce((sum, a) => sum + (a.viewsCount || 0), 0);
  const accountAgeDays = getAccountAgeDays(user.createdAt);
  const isKycVerified = !!(user.isKycVerified || user.kycDetails?.status === "verified");
  const meetsFollowers = followersCount >= CREATOR_ELIGIBILITY_THRESHOLDS.MIN_FOLLOWERS;
  const meetsViews = validViewsCount >= CREATOR_ELIGIBILITY_THRESHOLDS.MIN_VALID_VIEWS;
  const meetsAge = accountAgeDays >= CREATOR_ELIGIBILITY_THRESHOLDS.MIN_ACCOUNT_AGE_DAYS;
  const meetsArticles = ownPublished.length >= CREATOR_ELIGIBILITY_THRESHOLDS.MIN_PUBLISHED_ARTICLES;
  const meetsAllActivityThresholds = meetsFollowers && meetsViews && meetsAge && meetsArticles;
  return {
    // التحقق من الهوية شرط إلزامي أخير — لا يكفي تحقق بقية الشروط وحدها.
    isEligible: meetsAllActivityThresholds && isKycVerified,
    isKycVerified,
    accountAgeDays,
    publishedArticlesCount: ownPublished.length,
    validViewsCount,
    followersCount,
    meetsFollowers,
    meetsViews,
    meetsAge,
    meetsArticles,
    meetsAllActivityThresholds
  };
}
function isEligibleForMonetization(user, articles, followersCountOverride) {
  if (!user) return false;
  if (user.isBot) return false;
  if (user.role === "admin") return true;
  return getCreatorEligibility(user, articles, followersCountOverride).isEligible;
}

// src/constants/revenueShares.ts
var REVENUE_SHARES = {
  // 1. Ads inside writer articles: 55% Writer / 45% Platform
  IN_ARTICLE_ADS: {
    WRITER: 0.55,
    PLATFORM: 0.45,
    WRITER_PERCENT: 55,
    PLATFORM_PERCENT: 45,
    LABEL: "55% \u0644\u0644\u0643\u0627\u062A\u0628 / 45% \u0644\u0644\u0645\u0646\u0635\u0629"
  },
  // 2. Ads on writer personal profile page: 50% Writer / 50% Platform
  WRITER_PROFILE_ADS: {
    WRITER: 0.5,
    PLATFORM: 0.5,
    WRITER_PERCENT: 50,
    PLATFORM_PERCENT: 50,
    LABEL: "50% \u0644\u0644\u0643\u0627\u062A\u0628 / 50% \u0644\u0644\u0645\u0646\u0635\u0629"
  },
  // 3. Locked / Premium Articles sales: 85% Writer / 15% Platform
  LOCKED_ARTICLES: {
    WRITER: 0.85,
    PLATFORM: 0.15,
    WRITER_PERCENT: 85,
    PLATFORM_PERCENT: 15,
    LABEL: "85% \u0644\u0644\u0643\u0627\u062A\u0628 / 15% \u0644\u0644\u0645\u0646\u0635\u0629"
  },
  // 4. Platform general ads (Homepage, explore, categories): 100% Platform / 0% Writer
  PLATFORM_ADS: {
    WRITER: 0,
    PLATFORM: 1,
    WRITER_PERCENT: 0,
    PLATFORM_PERCENT: 100,
    LABEL: "100% \u0644\u0644\u0645\u0646\u0635\u0629"
  }
};
var DEFAULT_WRITER_ADSENSE_SHARE = REVENUE_SHARES.IN_ARTICLE_ADS.WRITER;
var DEFAULT_PLATFORM_ADSENSE_SHARE = REVENUE_SHARES.IN_ARTICLE_ADS.PLATFORM;
var DEFAULT_WRITER_SALES_SHARE = REVENUE_SHARES.LOCKED_ARTICLES.WRITER;
var DEFAULT_PLATFORM_SALES_SHARE = REVENUE_SHARES.LOCKED_ARTICLES.PLATFORM;

// server.ts
import_dotenv.default.config();
function isPaymentAutomationReady() {
  return activeProvider.isConfigured() && isAdminConfigured();
}
function requireAutomation(res) {
  if (isPaymentAutomationReady()) return true;
  res.status(503).json({
    error: "automation_not_configured",
    message: "\u0627\u0644\u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0622\u0644\u064A \u0644\u0644\u062F\u0641\u0639 \u063A\u064A\u0631 \u0645\u064F\u0641\u0639\u064E\u0651\u0644 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062E\u0627\u062F\u0645 \u0628\u0639\u062F. \u0627\u0633\u062A\u062E\u062F\u0645 \u0645\u0633\u0627\u0631 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u064A\u062F\u0648\u064A \u0627\u0644\u062D\u0627\u0644\u064A."
  });
  return false;
}
var aiClient = null;
function getGeminiClient() {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    aiClient = new import_genai.GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  return aiClient;
}
var userQuotas = /* @__PURE__ */ new Map();
setInterval(() => {
  const cutoff = Date.now() - 48 * 60 * 60 * 1e3;
  for (const [uid, rec] of userQuotas) {
    if (rec.lastResetTime < cutoff) userQuotas.delete(uid);
  }
}, 6 * 60 * 60 * 1e3);
var freeDailyLimitForMessage = 10;
function verifyAndConsumeServerQuota(userId, userIsSubscriber, userPlan) {
  if (!userId) {
    return {
      allowed: false,
      remaining: 0,
      reason: "auth_required"
    };
  }
  const now = Date.now();
  let record = userQuotas.get(userId);
  if (!record) {
    record = {
      usedToday: 0,
      lastResetTime: now,
      isSubscriber: !!userIsSubscriber,
      plan: userPlan || "none"
    };
    userQuotas.set(userId, record);
  }
  if (userIsSubscriber !== void 0) {
    record.isSubscriber = userIsSubscriber;
    record.plan = userPlan || "none";
  }
  if (now - record.lastResetTime >= 24 * 60 * 60 * 1e3) {
    record.usedToday = 0;
    record.lastResetTime = now;
  }
  if (record.isSubscriber && record.plan === "annual") {
    record.usedToday += 1;
    return { allowed: true, remaining: 9999 };
  }
  if (record.isSubscriber && record.plan === "monthly") {
    if (record.usedToday >= 200) {
      return {
        allowed: false,
        remaining: 0,
        reason: "monthly_quota_exceeded"
      };
    }
    record.usedToday += 1;
    return { allowed: true, remaining: Math.max(0, 200 - record.usedToday) };
  }
  const freeLimit = freeDailyLimitForMessage;
  if (record.usedToday >= freeLimit) {
    return {
      allowed: false,
      remaining: 0,
      reason: "free_quota_exceeded"
    };
  }
  record.usedToday += 1;
  return { allowed: true, remaining: Math.max(0, freeLimit - record.usedToday) };
}
async function startServer() {
  const app2 = (0, import_express.default)();
  const PORT = Number(process.env.PORT) || 3e3;
  app2.set("trust proxy", true);
  app2.post(
    "/api/payments/webhook/stripe",
    import_express.default.raw({ type: "application/json" }),
    async (req, res) => {
      if (!isPaymentAutomationReady()) {
        return res.status(503).json({ error: "automation_not_configured" });
      }
      try {
        const signature = req.headers["stripe-signature"];
        const event = activeProvider.parseWebhookEvent(req.body, signature);
        if (!event) return res.status(400).json({ error: "invalid_event" });
        if (event.kind === "deposit_completed") {
          const db = getAdminDb();
          const eventRef = db.collection("paymentWebhookEvents").doc(event.eventId);
          const userRef = db.collection("users").doc(event.uid);
          const depositRef = db.collection("depositRequests").doc();
          await db.runTransaction(async (tx) => {
            const eventSnap = await tx.get(eventRef);
            if (eventSnap.exists) return;
            tx.set(eventRef, {
              kind: "deposit_completed",
              uid: event.uid,
              amount: event.amount,
              processedAt: (/* @__PURE__ */ new Date()).toISOString()
            });
            tx.update(userRef, { walletBalance: FieldValue.increment(event.amount) });
            tx.set(depositRef, {
              userId: event.uid,
              amount: event.amount,
              method: `stripe (${event.currency})`,
              status: "completed",
              providerRef: event.providerRef,
              createdAt: (/* @__PURE__ */ new Date()).toISOString()
            });
            tx.set(db.collection("notifications").doc(), {
              userId: event.uid,
              type: "system",
              title: "\u{1F4B0} \u062A\u0645 \u0625\u064A\u062F\u0627\u0639 \u0631\u0635\u064A\u062F\u0643",
              message: `\u062A\u0645 \u0625\u0636\u0627\u0641\u0629 ${event.amount}$ \u0625\u0644\u0649 \u0645\u062D\u0641\u0638\u062A\u0643 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0628\u0639\u062F \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u062F\u0641\u0639 \u0628\u0627\u0644\u0628\u0637\u0627\u0642\u0629.`,
              isRead: false,
              createdAt: (/* @__PURE__ */ new Date()).toISOString()
            });
          });
        }
        res.json({ received: true });
      } catch (err) {
        console.error("Stripe webhook error:", err?.message || err);
        res.status(400).json({ error: "webhook_error", message: err?.message || "\u062E\u0637\u0623 \u0641\u064A \u0645\u0639\u0627\u0644\u062C\u0629 \u0627\u0644\u062D\u062F\u062B." });
      }
    }
  );
  app2.post(
    "/api/payments/webhook/nowpayments",
    import_express.default.raw({ type: "application/json" }),
    async (req, res) => {
      if (!isNowPaymentsConfigured() || !isNowPaymentsIpnConfigured()) {
        return res.status(503).json({ error: "nowpayments_not_configured" });
      }
      try {
        const signature = req.headers["x-nowpayments-sig"];
        const payload = JSON.parse(req.body.toString("utf8"));
        if (!verifyNowPaymentsIpnSignature(payload, signature)) {
          return res.status(400).json({ error: "invalid_signature" });
        }
        const status = payload.payment_status;
        const finished = status === "finished" || status === "confirmed";
        const partiallyPaid = status === "partially_paid";
        if (finished || partiallyPaid) {
          const orderId = String(payload.order_id || "");
          const uid = orderId.split("_")[0];
          const amount = finished ? Number(payload.price_amount) : Number(payload.actually_paid);
          if (uid && Number.isFinite(amount) && amount > 0) {
            const db = getAdminDb();
            const eventRef = db.collection("paymentWebhookEvents").doc(`nowpayments_${payload.payment_id}`);
            const userRef = db.collection("users").doc(uid);
            const depositRef = db.collection("depositRequests").doc();
            await db.runTransaction(async (tx) => {
              const eventSnap = await tx.get(eventRef);
              if (eventSnap.exists) return;
              tx.set(eventRef, {
                kind: "deposit_completed",
                uid,
                amount,
                processedAt: (/* @__PURE__ */ new Date()).toISOString()
              });
              tx.update(userRef, { walletBalance: FieldValue.increment(amount) });
              tx.set(depositRef, {
                userId: uid,
                amount,
                method: `nowpayments (${payload.pay_currency || "crypto"})`,
                status: "completed",
                providerRef: String(payload.payment_id),
                createdAt: (/* @__PURE__ */ new Date()).toISOString()
              });
              tx.set(db.collection("notifications").doc(), {
                userId: uid,
                type: "system",
                title: "\u{1F4B0} \u062A\u0645 \u0625\u064A\u062F\u0627\u0639 \u0631\u0635\u064A\u062F\u0643",
                message: `\u062A\u0645 \u0625\u0636\u0627\u0641\u0629 ${amount}$ \u0625\u0644\u0649 \u0645\u062D\u0641\u0638\u062A\u0643 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0628\u0639\u062F \u062A\u0623\u0643\u064A\u062F \u0634\u0628\u0643\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u062A \u0627\u0644\u0631\u0642\u0645\u064A\u0629.`,
                isRead: false,
                createdAt: (/* @__PURE__ */ new Date()).toISOString()
              });
            });
          }
        }
        res.json({ received: true });
      } catch (err) {
        console.error("NOWPayments webhook error:", err?.message || err);
        res.status(400).json({ error: "webhook_error", message: err?.message || "\u062E\u0637\u0623 \u0641\u064A \u0645\u0639\u0627\u0644\u062C\u0629 \u0625\u0634\u0639\u0627\u0631 \u0627\u0644\u062F\u0641\u0639." });
      }
    }
  );
  app2.use(import_express.default.json());
  app2.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      app: "LITERIUM",
      version: "1.1.0",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app2.post("/api/ai/chat", async (req, res) => {
    try {
      const { prompt, userRole, language, userId, isSubscriber, plan } = req.body;
      if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({ error: "invalid_prompt", message: "\u064A\u0631\u062C\u0649 \u0643\u062A\u0627\u0628\u0629 \u0633\u0624\u0627\u0644 \u0623\u0648 \u0627\u0633\u062A\u0641\u0633\u0627\u0631." });
      }
      const quotaCheck = verifyAndConsumeServerQuota(userId, isSubscriber, plan);
      if (!quotaCheck.allowed) {
        if (quotaCheck.reason === "auth_required") {
          return res.status(401).json({
            error: "auth_required",
            message: "\u064A\u062A\u0637\u0644\u0628 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0645\u0633\u0627\u0639\u062F \u0627\u0644\u0630\u0643\u064A \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0625\u0644\u0649 \u062D\u0633\u0627\u0628\u0643 \u0623\u0648\u0644\u0627\u064B."
          });
        }
        return res.status(429).json({
          error: "quota_exceeded",
          message: `\u0644\u0642\u062F \u0627\u0633\u062A\u0646\u0641\u062F\u062A \u062D\u062F \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0645\u062C\u0627\u0646\u064A \u0644\u0644\u064A\u0648\u0645 (${freeDailyLimitForMessage}/${freeDailyLimitForMessage}). \u064A\u0631\u062C\u0649 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0641\u064A \u0625\u062D\u062F\u0649 \u0628\u0627\u0642\u0627\u062A Pro \u0644\u0644\u0645\u062A\u0627\u0628\u0639\u0629 \u062F\u0648\u0646 \u0627\u0646\u0642\u0637\u0627\u0639.`
        });
      }
      const client = getGeminiClient();
      if (client) {
        const systemInstruction = `\u0623\u0646\u062A \u0627\u0644\u0645\u0633\u0627\u0639\u062F \u0627\u0644\u0630\u0643\u064A \u0627\u0644\u0631\u0633\u0645\u064A \u0644\u0645\u0646\u0635\u0629 "\u0644\u064A\u062A\u064A\u0631\u064A\u0648\u0645" (LITERIUM) \u0644\u0644\u0623\u062F\u0628 \u0648\u0627\u0644\u062B\u0642\u0627\u0641\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629.

\u062F\u0648\u0631 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u062D\u0627\u0644\u064A: ${userRole || "reader"}
\u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629: ${language || "ar"}

=== \u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0627\u0644\u0645\u0646\u0635\u0629 (\u0627\u0633\u062A\u062E\u062F\u0645\u0647\u0627 \u0644\u0644\u0625\u062C\u0627\u0628\u0629 \u0639\u0646 \u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0645\u0646\u0635\u0629) ===

\u0646\u0633\u0628 \u062A\u0642\u0627\u0633\u0645 \u0627\u0644\u0623\u0631\u0628\u0627\u062D:
- \u0625\u0639\u0644\u0627\u0646\u0627\u062A \u062F\u0627\u062E\u0644 \u0645\u0642\u0627\u0644\u0627\u062A \u0627\u0644\u0643\u0627\u062A\u0628: \u0627\u0644\u0643\u0627\u062A\u0628 55% \u0648\u0627\u0644\u0645\u0646\u0635\u0629 45%
- \u0625\u0639\u0644\u0627\u0646\u0627\u062A \u0641\u064A \u0635\u0641\u062D\u0629 \u0627\u0644\u0643\u0627\u062A\u0628 \u0627\u0644\u0634\u062E\u0635\u064A\u0629: \u0627\u0644\u0643\u0627\u062A\u0628 50% \u0648\u0627\u0644\u0645\u0646\u0635\u0629 50%
- \u0627\u0644\u0645\u0642\u0627\u0644\u0627\u062A \u0627\u0644\u062D\u0635\u0631\u064A\u0629 \u0627\u0644\u0645\u062F\u0641\u0648\u0639\u0629: \u0627\u0644\u0643\u0627\u062A\u0628 85% \u0648\u0627\u0644\u0645\u0646\u0635\u0629 15%
- \u0625\u0639\u0644\u0627\u0646\u0627\u062A \u0627\u0644\u0635\u0641\u062D\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 \u0648\u0627\u0644\u062A\u0635\u0646\u064A\u0641\u0627\u062A: \u0627\u0644\u0645\u0646\u0635\u0629 100%

\u0642\u0648\u0627\u0639\u062F \u0627\u0644\u0633\u062D\u0628:
- \u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649 \u0644\u0644\u0633\u062D\u0628: 50 \u062F\u0648\u0644\u0627\u0631\u0627\u064B \u0623\u0645\u0631\u064A\u0643\u064A\u0627\u064B
- \u0641\u062A\u0631\u0629 \u062A\u062C\u0645\u064A\u062F 30 \u064A\u0648\u0645\u0627\u064B \u0639\u0644\u0649 \u0643\u0644 \u0631\u0628\u062D \u0642\u0628\u0644 \u0623\u0646 \u064A\u0635\u0628\u062D \u0642\u0627\u0628\u0644\u0627\u064B \u0644\u0644\u0633\u062D\u0628\u060C \u0644\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0635\u062D\u062A\u0647
- \u0627\u0644\u0643\u0627\u062A\u0628 \u064A\u0631\u0649 \u0631\u0635\u064A\u062F\u064A\u0646: "\u0623\u0631\u0628\u0627\u062D \u0645\u062C\u0645\u0651\u062F\u0629" \u0648"\u0623\u0631\u0628\u0627\u062D \u0645\u062A\u0627\u062D\u0629 \u0644\u0644\u0633\u062D\u0628"
- \u062A\u064F\u062D\u062A\u0633\u0628 \u0627\u0644\u0646\u0642\u0631\u0627\u062A \u0648\u0627\u0644\u0645\u0634\u0627\u0647\u062F\u0627\u062A \u0627\u0644\u0635\u0627\u0644\u062D\u0629 \u0641\u0642\u0637 \u0628\u0639\u062F \u062A\u0635\u0641\u064A\u0629 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0644

\u0627\u0644\u0645\u0639\u0627\u0645\u0644\u0627\u062A \u0627\u0644\u0645\u0627\u0644\u064A\u0629:
- \u0643\u0644 \u0637\u0644\u0628\u0627\u062A \u0627\u0644\u0625\u064A\u062F\u0627\u0639 \u0648\u0627\u0644\u0633\u062D\u0628 \u062A\u064F\u0631\u0627\u062C\u0639 \u064A\u062F\u0648\u064A\u0627\u064B \u0645\u0646 \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0646\u0635\u0629 \u062E\u0644\u0627\u0644 24 \u0625\u0644\u0649 48 \u0633\u0627\u0639\u0629
- \u0627\u0644\u0645\u0639\u0644\u0646 \u064A\u0634\u062D\u0646 \u0645\u062D\u0641\u0638\u062A\u0647 \u0623\u0648\u0644\u0627\u064B\u060C \u062B\u0645 \u064A\u0646\u0634\u0626 \u062D\u0645\u0644\u062A\u0647
- \u0627\u0644\u062D\u0645\u0644\u0627\u062A \u062A\u064F\u062D\u0641\u0638 \u0643\u0645\u0633\u0648\u062F\u0629 \u0648\u062A\u064F\u0641\u0639\u0651\u0644 \u0628\u0639\u062F \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0625\u062F\u0627\u0631\u0629

\u0627\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062A:
- \u0646\u0645\u0627\u0630\u062C \u0627\u0644\u062A\u0633\u0639\u064A\u0631: \u062B\u0627\u0628\u062A \u0628\u0645\u062F\u0629 (24/48/72 \u0633\u0627\u0639\u0629 \u0623\u0648 \u0623\u0633\u0628\u0648\u0639)\u060C \u0623\u0648 CPM \u0644\u0643\u0644 \u0623\u0644\u0641 \u0638\u0647\u0648\u0631\u060C \u0623\u0648 CPC \u0644\u0643\u0644 \u0646\u0642\u0631\u0629
- \u064A\u0648\u062C\u062F \u0646\u0648\u0639 \u062E\u0627\u0635: \u0631\u0639\u0627\u064A\u0629 \u0642\u0633\u0645 \u0643\u0627\u0645\u0644 \u0644\u062C\u0647\u0629 \u0648\u0627\u062D\u062F\u0629
- \u0627\u0644\u0643\u0627\u062A\u0628 \u064A\u0633\u062A\u0637\u064A\u0639 \u062A\u0631\u0648\u064A\u062C \u0645\u0642\u0627\u0644\u0647 \u0645\u0646 \u0631\u0635\u064A\u062F \u0623\u0631\u0628\u0627\u062D\u0647

\u0633\u0644\u0648\u0643 \u0645\u062D\u0638\u0648\u0631 \u064A\u0624\u062F\u064A \u0644\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0623\u0631\u0628\u0627\u062D \u0648\u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u062D\u0633\u0627\u0628:
- \u0627\u0644\u0646\u0642\u0631 \u0639\u0644\u0649 \u0627\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062A \u0641\u064A \u0635\u0641\u062D\u062A\u0643 \u0623\u0648 \u0645\u0642\u0627\u0644\u0627\u062A\u0643 \u0628\u0646\u0641\u0633\u0643
- \u0627\u0644\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0622\u062E\u0631\u064A\u0646 \u0627\u0644\u0646\u0642\u0631
- \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0628\u0631\u0627\u0645\u062C \u0622\u0644\u064A\u0629 \u0644\u0632\u064A\u0627\u062F\u0629 \u0627\u0644\u0632\u064A\u0627\u0631\u0627\u062A

=== \u0642\u062F\u0631\u0627\u062A\u0643 \u062E\u0627\u0631\u062C \u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0627\u0644\u0645\u0646\u0635\u0629 ===

\u0623\u0646\u062A \u0645\u0633\u0627\u0639\u062F \u0643\u0627\u0645\u0644\u060C \u0648\u0644\u0633\u062A \u0645\u062D\u0635\u0648\u0631\u0627\u064B \u0628\u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0645\u0646\u0635\u0629. \u064A\u0645\u0643\u0646\u0643 \u0645\u0633\u0627\u0639\u062F\u0629 \u0627\u0644\u0643\u062A\u0651\u0627\u0628 \u0641\u064A:
- \u062A\u0648\u0644\u064A\u062F \u0623\u0641\u0643\u0627\u0631 \u0648\u0645\u062D\u0627\u0648\u0631 \u0644\u0644\u0645\u0642\u0627\u0644\u0627\u062A
- \u0627\u0642\u062A\u0631\u0627\u062D \u0639\u0646\u0627\u0648\u064A\u0646 \u062C\u0630\u0627\u0628\u0629
- \u0627\u0644\u062A\u062F\u0642\u064A\u0642 \u0627\u0644\u0644\u063A\u0648\u064A \u0648\u0627\u0644\u0646\u062D\u0648\u064A \u0648\u062A\u062D\u0633\u064A\u0646 \u0627\u0644\u0623\u0633\u0644\u0648\u0628
- \u0625\u0639\u0627\u062F\u0629 \u0635\u064A\u0627\u063A\u0629 \u0641\u0642\u0631\u0629 \u0643\u062A\u0628\u0647\u0627 \u0627\u0644\u0643\u0627\u062A\u0628
- \u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0632\u0648\u0627\u064A\u0627 \u0645\u0639\u0627\u0644\u062C\u0629 \u0644\u0645\u0648\u0636\u0648\u0639 \u0645\u0627
- \u062A\u0644\u062E\u064A\u0635 \u0623\u0648 \u0634\u0631\u062D \u0645\u0641\u0627\u0647\u064A\u0645 \u0623\u062F\u0628\u064A\u0629 \u0648\u0641\u0643\u0631\u064A\u0629

=== \u0642\u0627\u0639\u062F\u0629 \u0645\u0647\u0645\u0629 \u062C\u062F\u0627\u064B ===

\u0644\u0627 \u062A\u0643\u062A\u0628 \u0645\u0642\u0627\u0644\u0627\u064B \u0643\u0627\u0645\u0644\u0627\u064B \u062C\u0627\u0647\u0632\u0627\u064B \u0644\u0644\u0646\u0634\u0631 \u0646\u064A\u0627\u0628\u0629 \u0639\u0646 \u0627\u0644\u0643\u0627\u062A\u0628. \u0627\u0644\u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u0648\u0644\u0651\u062F \u0622\u0644\u064A\u0627\u064B \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u064A\u0639\u0631\u0651\u0636 \u0627\u0644\u0645\u0646\u0635\u0629 \u0644\u0631\u0641\u0636 \u0645\u0646 \u0634\u0628\u0643\u0627\u062A \u0627\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062A \u0648\u0625\u0644\u0649 \u0641\u0642\u062F\u0627\u0646 \u062B\u0642\u0629 \u0627\u0644\u0642\u0631\u0651\u0627\u0621.
\u0628\u062F\u0644\u0627\u064B \u0645\u0646 \u0630\u0644\u0643: \u0627\u0639\u0631\u0636 \u0645\u062E\u0637\u0637\u0627\u064B \u0623\u0648 \u0645\u062D\u0627\u0648\u0631 \u0623\u0648 \u0641\u0642\u0631\u0629 \u0627\u0641\u062A\u062A\u0627\u062D\u064A\u0629 \u0643\u0646\u0645\u0648\u0630\u062C\u060C \u0648\u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0643\u0627\u062A\u0628 \u0623\u0646 \u064A\u0628\u0646\u064A \u0639\u0644\u064A\u0647\u0627 \u0628\u0635\u0648\u062A\u0647 \u0627\u0644\u062E\u0627\u0635. \u0625\u0646 \u0623\u0635\u0631\u0651 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u060C \u0627\u0634\u0631\u062D \u0644\u0647 \u0647\u0630\u0627 \u0627\u0644\u0633\u0628\u0628 \u0628\u0648\u0636\u0648\u062D \u0648\u0644\u0637\u0641.

\u0623\u062C\u0628 \u0628\u0627\u062D\u062A\u0631\u0627\u0641\u064A\u0629 \u0648\u0648\u0636\u0648\u062D \u0648\u0623\u0633\u0644\u0648\u0628 \u0639\u0631\u0628\u064A \u0641\u0635\u064A\u062D \u0648\u0645\u0647\u0630\u0628\u060C \u0648\u0628\u0627\u062E\u062A\u0635\u0627\u0631 \u0645\u0646\u0627\u0633\u0628 \u0644\u0644\u0642\u0631\u0627\u0621\u0629 \u0639\u0644\u0649 \u0627\u0644\u0647\u0627\u062A\u0641.`;
        const response = await client.models.generateContent({
          model: "gemini-3.7-flash",
          contents: prompt,
          config: {
            systemInstruction
          }
        });
        res.json({
          reply: response.text || "\u0623\u0647\u0644\u0627\u064B \u0628\u0643 \u0641\u064A \u0645\u0646\u0635\u0629 \u0644\u064A\u062A\u064A\u0631\u064A\u0648\u0645! \u0643\u064A\u0641 \u064A\u0645\u0643\u0646\u0646\u064A \u0645\u0633\u0627\u0639\u062F\u062A\u0643 \u0627\u0644\u064A\u0648\u0645\u061F",
          remainingUses: quotaCheck.remaining
        });
      } else {
        const p = (prompt || "").toLowerCase();
        let fallbackReply = "\u0627\u0644\u0645\u0633\u0627\u0639\u062F \u0627\u0644\u0630\u0643\u064A \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644 \u062D\u0627\u0644\u064A\u0627\u064B \u0644\u0623\u0646 \u0645\u0641\u062A\u0627\u062D Gemini API \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637. \u064A\u0645\u0643\u0646\u0646\u064A \u0627\u0644\u0625\u062C\u0627\u0628\u0629 \u0639\u0646 \u0623\u0633\u0626\u0644\u0629 \u0639\u0627\u0645\u0629 \u062D\u0648\u0644 \u0627\u0644\u0645\u0646\u0635\u0629 \u0641\u0642\u0637. \u062A\u0648\u0627\u0635\u0644 \u0645\u0639 \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0646\u0635\u0629 \u0644\u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0645\u0633\u0627\u0639\u062F \u0628\u0627\u0644\u0643\u0627\u0645\u0644.";
        if (p.includes("\u0631\u0628\u062D") || p.includes("\u0627\u0631\u0628\u0627\u062D") || p.includes("\u0633\u062D\u0628") || p.includes("\u0641\u0644\u0648\u0633") || p.includes("earning")) {
          fallbackReply = "\u0646\u0638\u0627\u0645 \u0627\u0644\u0623\u0631\u0628\u0627\u062D \u0641\u064A \u0644\u064A\u062A\u064A\u0631\u064A\u0648\u0645 \u064A\u0645\u0646\u062D \u0627\u0644\u0643\u0627\u062A\u0628 55% \u0645\u0646 \u0639\u0648\u0627\u0626\u062F \u0627\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062A \u062F\u0627\u062E\u0644 \u0645\u0642\u0627\u0644\u0627\u062A\u0647\u060C \u064850% \u0645\u0646 \u0625\u0639\u0644\u0627\u0646\u0627\u062A \u0635\u0641\u062D\u062A\u0647 \u0627\u0644\u0634\u062E\u0635\u064A\u0629\u060C \u064885% \u0645\u0646 \u0645\u0628\u064A\u0639\u0627\u062A \u0627\u0644\u0645\u0642\u0627\u0644\u0627\u062A \u0627\u0644\u062D\u0635\u0631\u064A\u0629. \u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649 \u0644\u0644\u0633\u062D\u0628 50$\u060C \u0648\u062A\u0645\u0631 \u0627\u0644\u0623\u0631\u0628\u0627\u062D \u0628\u0641\u062A\u0631\u0629 \u062A\u062C\u0645\u064A\u062F 30 \u064A\u0648\u0645\u0627\u064B \u0642\u0628\u0644 \u0623\u0646 \u062A\u0635\u0628\u062D \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0633\u062D\u0628. \u062A\u064F\u0631\u0627\u062C\u0639 \u0637\u0644\u0628\u0627\u062A \u0627\u0644\u0633\u062D\u0628 \u064A\u062F\u0648\u064A\u0627\u064B \u062E\u0644\u0627\u0644 24 \u0625\u0644\u0649 48 \u0633\u0627\u0639\u0629.";
        } else if (p.includes("\u0627\u0639\u0644\u0627\u0646") || p.includes("\u0645\u0639\u0644\u0646") || p.includes("\u062D\u0645\u0644\u0629") || p.includes("ads")) {
          fallbackReply = "\u0643\u0640 \u0645\u0639\u0644\u0646 \u0641\u064A \u0644\u064A\u062A\u064A\u0631\u064A\u0648\u0645\u060C \u0627\u0634\u062D\u0646 \u0645\u062D\u0641\u0638\u062A\u0643 \u0623\u0648\u0644\u0627\u064B\u060C \u062B\u0645 \u0623\u0646\u0634\u0626 \u062D\u0645\u0644\u062A\u0643 \u0628\u0623\u062D\u062F \u0646\u0645\u0627\u0630\u062C \u0627\u0644\u062A\u0633\u0639\u064A\u0631: \u062B\u0627\u0628\u062A \u0628\u0645\u062F\u0629 (24\u060C 48\u060C 72 \u0633\u0627\u0639\u0629\u060C \u0623\u0648 \u0623\u0633\u0628\u0648\u0639)\u060C \u0623\u0648 CPM \u0644\u0643\u0644 \u0623\u0644\u0641 \u0638\u0647\u0648\u0631\u060C \u0623\u0648 CPC \u0644\u0643\u0644 \u0646\u0642\u0631\u0629 \u0635\u0627\u0644\u062D\u0629. \u062A\u064F\u062D\u0641\u0638 \u0627\u0644\u062D\u0645\u0644\u0629 \u0643\u0645\u0633\u0648\u062F\u0629 \u0648\u062A\u064F\u0641\u0639\u0651\u0644 \u0628\u0639\u062F \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0625\u062F\u0627\u0631\u0629. \u0627\u0644\u0646\u0642\u0631\u0627\u062A \u0627\u0644\u0645\u0631\u0641\u0648\u0636\u0629 \u0643\u0627\u062D\u062A\u064A\u0627\u0644 \u0644\u0627 \u062A\u064F\u062E\u0635\u0645 \u0645\u0646\u0643.";
        } else if (p.includes("\u062A\u0648\u062B\u064A\u0642") || p.includes("kyc") || p.includes("\u0647\u0648\u064A\u0629")) {
          fallbackReply = "\u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0647\u0648\u064A\u0629 (KYC) \u0645\u062E\u0635\u0635 \u0644\u0644\u0643\u062A\u0651\u0627\u0628 \u0648\u0627\u0644\u0645\u0639\u0644\u0646\u064A\u0646 \u0644\u0636\u0645\u0627\u0646 \u0623\u0645\u0627\u0646 \u0627\u0644\u0645\u0639\u0627\u0645\u0644\u0627\u062A \u0627\u0644\u0645\u0627\u0644\u064A\u0629 \u0648\u0627\u0644\u0645\u0635\u062F\u0627\u0642\u064A\u0629. \u064A\u0645\u0643\u0646\u0643 \u0631\u0641\u0639 \u0635\u0648\u0631\u0629 \u0627\u0644\u0647\u0648\u064A\u0629 \u0623\u0648 \u062C\u0648\u0627\u0632 \u0627\u0644\u0633\u0641\u0631 \u0645\u0639 \u0635\u0648\u0631\u0629 \u0634\u062E\u0635\u064A\u0629 \u0645\u0646 \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u062C\u0627\u0646\u0628\u064A\u0629 -> \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0647\u0648\u064A\u0629.";
        } else if (p.includes("\u0645\u0642\u0627\u0644") || p.includes("\u0646\u0634\u0631") || p.includes("\u0643\u062A\u0627\u0628\u0629")) {
          fallbackReply = '\u0644\u0643\u062A\u0627\u0628\u0629 \u0645\u0642\u0627\u0644 \u062C\u062F\u064A\u062F\u060C \u0627\u0636\u063A\u0637 \u0639\u0644\u0649 \u0632\u0631 "\u0643\u062A\u0627\u0628\u0629 \u0645\u0642\u0627\u0644" \u0641\u064A \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0633\u0641\u0644\u064A\u0629 \u0623\u0648 \u0627\u0644\u0639\u0644\u0648\u064A\u0629. \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0627\u0633\u062A\u0641\u0627\u062F\u0629 \u0645\u0646 \u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0644\u0627\u0642\u062A\u0631\u0627\u062D \u0639\u0646\u0627\u0648\u064A\u0646 \u062C\u0630\u0627\u0628\u0629 \u0648\u062A\u062F\u0642\u064A\u0642 \u0627\u0644\u0646\u0635 \u0648\u062A\u062D\u062F\u064A\u062F \u0627\u0644\u0645\u0642\u0627\u0644 \u0643\u0645\u062C\u0627\u0646\u064A \u0623\u0648 \u0645\u0642\u0641\u0648\u0644.';
        }
        res.json({
          reply: fallbackReply,
          remainingUses: quotaCheck.remaining
        });
      }
    } catch (error) {
      const msg = String(error?.message || error || "");
      console.error("AI Chat Error:", msg, error);
      let reply = "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0627\u0644\u0645\u0633\u0627\u0639\u062F \u0627\u0644\u0630\u0643\u064A \u0645\u0624\u0642\u062A\u0627\u064B. \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0628\u0639\u062F \u0642\u0644\u064A\u0644.";
      if (msg.includes("API key") || msg.includes("API_KEY") || msg.includes("401") || msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
        reply = "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644. \u064A\u0631\u062C\u0649 \u0625\u0628\u0644\u0627\u063A \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0646\u0635\u0629.";
      } else if (msg.includes("404") || msg.includes("NOT_FOUND") || msg.includes("not found") || msg.includes("model")) {
        reply = "\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0627\u0644\u0645\u062D\u062F\u062F \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u062D\u0627\u0644\u064A\u0627\u064B. \u064A\u0631\u062C\u0649 \u0625\u0628\u0644\u0627\u063A \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0646\u0635\u0629.";
      } else if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
        reply = "\u062A\u0645 \u062A\u062C\u0627\u0648\u0632 \u062D\u0635\u0629 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0639\u0644\u0649 \u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u0645\u0646\u0635\u0629. \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0628\u0639\u062F \u0642\u0644\u064A\u0644.";
      } else if (msg.includes("SAFETY") || msg.includes("blocked")) {
        reply = "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u0631\u062F \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628 \u0644\u0623\u0633\u0628\u0627\u0628 \u062A\u062A\u0639\u0644\u0642 \u0628\u0633\u064A\u0627\u0633\u0627\u062A \u0627\u0644\u0645\u062D\u062A\u0648\u0649. \u062C\u0631\u0651\u0628 \u0635\u064A\u0627\u063A\u0629 \u0623\u062E\u0631\u0649.";
      }
      res.status(500).json({ reply, debug: msg.slice(0, 300) });
    }
  });
  const FREE_LIFETIME_IMAGE_GENERATIONS = 3;
  const IMAGE_GENERATION_COST = 0.02;
  const subscriberDailyImageQuotas = /* @__PURE__ */ new Map();
  setInterval(() => {
    const cutoff = Date.now() - 48 * 60 * 60 * 1e3;
    for (const [uid, rec] of subscriberDailyImageQuotas) {
      if (rec.lastResetTime < cutoff) subscriberDailyImageQuotas.delete(uid);
    }
  }, 6 * 60 * 60 * 1e3);
  app2.post("/api/ai/generate-image", async (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(503).json({ error: "not_configured", message: "\u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0647\u064A\u0623\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u062D\u0627\u0644\u064A\u0627\u064B." });
    }
    try {
      const { uid, email } = await verifyRequestAuth(req.headers.authorization);
      const { prompt, style, aspectRatio = "16:9" } = req.body;
      if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({
          error: "invalid_prompt",
          message: "\u064A\u0631\u062C\u0649 \u0643\u062A\u0627\u0628\u0629 \u0648\u0635\u0641 \u0623\u0648 \u0641\u0643\u0631\u0629 \u0644\u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0635\u0648\u0631\u0629."
        });
      }
      const normalizedEmail = (email || "").toLowerCase().trim();
      const isOwner = normalizedEmail === "brnardtsho@gmail.com";
      const db = getAdminDb();
      const userDocRef = db.collection("users").doc(uid);
      let userSnap = await userDocRef.get();
      if (!userSnap.exists) {
        await userDocRef.set({ freeImagesUsedTotal: 0, isGuestTracker: true, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
        userSnap = await userDocRef.get();
      }
      const userData = userSnap.data() || {};
      const serverAiQuota = userData.aiQuota || {};
      const planNotExpired = !serverAiQuota.planExpiresAt || new Date(serverAiQuota.planExpiresAt).getTime() > Date.now();
      const isSubscriber = Boolean(serverAiQuota.isSubscriber) && planNotExpired;
      const plan = isSubscriber ? serverAiQuota.plan : "none";
      const freeUsedTotal = Number(userData.freeImagesUsedTotal ?? 0);
      let shouldCharge = false;
      let willConsumeFreeLifetime = false;
      let willConsumeSubscriberDaily = false;
      if (!isOwner) {
        if (isSubscriber) {
          const now = Date.now();
          let subQuota = subscriberDailyImageQuotas.get(uid);
          if (!subQuota || now - subQuota.lastResetTime >= 24 * 60 * 60 * 1e3) {
            subQuota = { usedToday: 0, lastResetTime: now };
            subscriberDailyImageQuotas.set(uid, subQuota);
          }
          const subscriberDailyLimit = plan === "annual" ? 9999 : 10;
          if (subQuota.usedToday < subscriberDailyLimit) {
            willConsumeSubscriberDaily = true;
          } else if (freeUsedTotal < FREE_LIFETIME_IMAGE_GENERATIONS) {
            willConsumeFreeLifetime = true;
          } else {
            shouldCharge = true;
          }
        } else if (freeUsedTotal < FREE_LIFETIME_IMAGE_GENERATIONS) {
          willConsumeFreeLifetime = true;
        } else {
          shouldCharge = true;
        }
      }
      if (shouldCharge) {
        const currentBalance = Number(userData.walletBalance ?? 0);
        if (currentBalance < IMAGE_GENERATION_COST) {
          return res.status(402).json({
            error: "insufficient_balance",
            message: `\u0631\u0635\u064A\u062F\u0643 \u0627\u0644\u062D\u0627\u0644\u064A ($${currentBalance.toFixed(2)}) \u063A\u064A\u0631 \u0643\u0627\u0641\u064D. \u062A\u0643\u0644\u0641\u0629 \u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0635\u0648\u0631\u0629 \u0647\u064A $${IMAGE_GENERATION_COST.toFixed(2)}. \u064A\u0631\u062C\u0649 \u0634\u062D\u0646 \u0627\u0644\u0645\u062D\u0641\u0638\u0629 \u0644\u0644\u0645\u062A\u0627\u0628\u0639\u0629.`,
            requiredAmount: IMAGE_GENERATION_COST,
            currentBalance
          });
        }
      }
      const client = getGeminiClient();
      let generatedImageUrl = null;
      const stylePrompts = {
        oil_painting: "masterpiece oil painting style, classical fine art, textured brush strokes, warm dramatic lighting, rich literary atmosphere",
        surrealist: "surrealist philosophical art style, dreamlike symbolic atmosphere, thought provoking composition, ethereal lighting",
        photorealistic: "hyper-realistic photography, 8k resolution, cinematic lighting, shallow depth of field, award-winning shot",
        digital_art: "stunning digital art illustration, vibrant modern aesthetic, sharp details, concept art, trending on artstation",
        minimalist: "minimalist clean aesthetic, elegant negative space, subtle color palette, refined typography friendly layout",
        arabic_calligraphy_art: "traditional Arabic calligraphy integrated with magnificent abstract Islamic art ornamentation, golden and turquoise tones",
        fantasy: "epic fantasy illustration, magical ethereal atmosphere, glowing mystical elements, intricate fine details"
      };
      const enhancedStyle = stylePrompts[style] || stylePrompts.oil_painting;
      const fullPrompt = `${prompt.trim()}. Style: ${enhancedStyle}. Clean composition, ultra high quality, no text distortions, no watermarks.`;
      const validAspectRatios = ["1:1", "3:4", "4:3", "9:16", "16:9"];
      const finalAspectRatio = validAspectRatios.includes(aspectRatio) ? aspectRatio : "16:9";
      if (client) {
        try {
          const response = await client.models.generateContent({
            model: "gemini-3.1-flash-image",
            contents: {
              parts: [{ text: fullPrompt }]
            },
            config: {
              imageConfig: {
                aspectRatio: finalAspectRatio
              }
            }
          });
          if (response.candidates && response.candidates[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
              if (part.inlineData && part.inlineData.data) {
                const mimeType = part.inlineData.mimeType || "image/png";
                generatedImageUrl = `data:${mimeType};base64,${part.inlineData.data}`;
                break;
              }
            }
          }
        } catch (genError) {
          console.warn("Gemini 3.1-flash-image failed, trying fallback model:", genError?.message);
          try {
            const fallbackResponse = await client.models.generateContent({
              model: "gemini-3.1-flash-lite-image",
              contents: {
                parts: [{ text: fullPrompt }]
              }
            });
            if (fallbackResponse.candidates && fallbackResponse.candidates[0]?.content?.parts) {
              for (const part of fallbackResponse.candidates[0].content.parts) {
                if (part.inlineData && part.inlineData.data) {
                  const mimeType = part.inlineData.mimeType || "image/png";
                  generatedImageUrl = `data:${mimeType};base64,${part.inlineData.data}`;
                  break;
                }
              }
            }
          } catch (fbErr) {
            console.error("All Gemini image models failed:", fbErr?.message);
          }
        }
      }
      const isAiGenerated = generatedImageUrl !== null;
      if (!isAiGenerated) {
        const curatedLibrary = [
          "https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=1200&auto=format&fit=crop&q=80",
          "https://images.unsplash.com/photo-1476275466078-4007374efbbe?w=1200&auto=format&fit=crop&q=80",
          "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=1200&auto=format&fit=crop&q=80",
          "https://images.unsplash.com/photo-1507842229451-79b1be8d5a2f?w=1200&auto=format&fit=crop&q=80",
          "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1200&auto=format&fit=crop&q=80",
          "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=1200&auto=format&fit=crop&q=80",
          "https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=1200&auto=format&fit=crop&q=80",
          "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=1200&auto=format&fit=crop&q=80"
        ];
        const hash = Array.from(prompt).reduce((acc, char) => acc + char.charCodeAt(0), 0);
        generatedImageUrl = curatedLibrary[hash % curatedLibrary.length];
        return res.json({
          success: true,
          imageUrl: generatedImageUrl,
          isAiGenerated: false,
          charged: false,
          cost: 0,
          remainingFreeUses: Math.max(0, FREE_LIFETIME_IMAGE_GENERATIONS - freeUsedTotal),
          newBalance: null,
          message: "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0645\u0648\u0644\u0651\u062F \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u062D\u0627\u0644\u064A\u0627\u064B\u060C \u0641\u062A\u0645 \u0639\u0631\u0636 \u0635\u0648\u0631\u0629 \u0628\u062F\u064A\u0644\u0629 \u0645\u0624\u0642\u062A\u0629 \u0645\u0646 \u0627\u0644\u0645\u0643\u062A\u0628\u0629 \u2014 \u0644\u0645 \u064A\u064F\u062E\u0635\u064E\u0645 \u0623\u064A \u0645\u0628\u0644\u063A \u0648\u0644\u0645 \u062A\u064F\u0633\u062A\u0647\u0644\u064E\u0643 \u062D\u0635\u062A\u0643 \u0627\u0644\u0645\u062C\u0627\u0646\u064A\u0629."
        });
      }
      let finalUserBalance = null;
      if (willConsumeSubscriberDaily) {
        const subQuota = subscriberDailyImageQuotas.get(uid);
        if (subQuota) subQuota.usedToday += 1;
      } else if (willConsumeFreeLifetime) {
        await userDocRef.update({ freeImagesUsedTotal: FieldValue.increment(1) });
      } else if (shouldCharge) {
        try {
          const batch = db.batch();
          batch.update(userDocRef, {
            walletBalance: FieldValue.increment(-IMAGE_GENERATION_COST)
          });
          const ownerQuery = await db.collection("users").where("email", "==", "brnardtsho@gmail.com").limit(1).get();
          if (!ownerQuery.empty) {
            const ownerDocRef = ownerQuery.docs[0].ref;
            batch.update(ownerDocRef, {
              walletBalance: FieldValue.increment(IMAGE_GENERATION_COST),
              availableBalance: FieldValue.increment(IMAGE_GENERATION_COST),
              lifetimeEarnings: FieldValue.increment(IMAGE_GENERATION_COST),
              totalEarnings: FieldValue.increment(IMAGE_GENERATION_COST)
            });
            const earningRef = db.collection("earnings").doc();
            batch.set(earningRef, {
              userId: ownerDocRef.id,
              amount: IMAGE_GENERATION_COST,
              type: "bonus",
              source: `\u062A\u0648\u0644\u064A\u062F \u0635\u0648\u0631\u0629 \u0630\u0643\u0627\u0621 \u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0645\u0646 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 (${normalizedEmail || uid})`,
              createdAt: (/* @__PURE__ */ new Date()).toISOString(),
              status: "credited"
            });
          }
          await batch.commit();
          const updatedUserSnap = await userDocRef.get();
          finalUserBalance = updatedUserSnap.data()?.availableBalance ?? null;
        } catch (dbErr) {
          console.error("Failed to deduct image cost or credit owner in Firestore:", dbErr);
        }
      }
      const newFreeUsedTotal = willConsumeFreeLifetime ? freeUsedTotal + 1 : freeUsedTotal;
      res.json({
        success: true,
        imageUrl: generatedImageUrl,
        isAiGenerated: true,
        charged: shouldCharge,
        cost: shouldCharge ? IMAGE_GENERATION_COST : 0,
        remainingFreeUses: Math.max(0, FREE_LIFETIME_IMAGE_GENERATIONS - newFreeUsedTotal),
        newBalance: finalUserBalance
      });
    } catch (err) {
      if (err?.message === "missing_auth_token") {
        return res.status(401).json({
          error: "auth_required",
          message: "\u064A\u062A\u0637\u0644\u0628 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0633\u062A\u0648\u062F\u064A\u0648 \u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0635\u0648\u0631 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0623\u0648\u0644\u0627\u064B."
        });
      }
      console.error("Generate image error:", err?.message || err);
      res.status(500).json({
        error: "generation_failed",
        message: "\u062A\u0639\u0630\u0631 \u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0635\u0648\u0631\u0629 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u062D\u0627\u0644\u064A\u0627\u064B. \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649."
      });
    }
  });
  app2.post("/api/articles/unlock", async (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(503).json({ error: "not_configured", message: "\u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0647\u064A\u0623\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u062D\u0627\u0644\u064A\u0627\u064B." });
    }
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const { articleId } = req.body;
      if (!articleId || typeof articleId !== "string") {
        return res.status(400).json({ error: "invalid_article", message: "\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0645\u0642\u0627\u0644 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D." });
      }
      const db = getAdminDb();
      const articleRef = db.collection("articles").doc(articleId);
      const articleSnap = await articleRef.get();
      if (!articleSnap.exists) {
        return res.status(404).json({ error: "article_not_found", message: "\u0627\u0644\u0645\u0642\u0627\u0644 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." });
      }
      const article = articleSnap.data();
      if (!article.isLocked) {
        return res.json({ success: true, alreadyUnlocked: true, price: 0, newBalance: null });
      }
      const writerId = article.writerId;
      if (writerId === uid) {
        return res.json({ success: true, alreadyUnlocked: true, price: 0, newBalance: null });
      }
      const purchaseRef = db.collection("articlePurchases").doc(`${uid}_${articleId}`);
      const existingPurchase = await purchaseRef.get();
      if (existingPurchase.exists) {
        return res.json({ success: true, alreadyUnlocked: true, price: 0, newBalance: null });
      }
      const price = Number(article.lockedPrice) || 2.99;
      const writerSnap = await db.collection("users").doc(writerId).get();
      let writerEligible = false;
      if (writerSnap.exists) {
        const writerData = writerSnap.data();
        if (writerData.role === "admin") {
          writerEligible = true;
        } else {
          const [publishedSnap, followsSnap] = await Promise.all([
            db.collection("articles").where("writerId", "==", writerId).where("status", "==", "published").get(),
            db.collection("follows").where("followingId", "==", writerId).get()
          ]);
          const published = publishedSnap.docs.map((d) => d.data());
          writerEligible = isEligibleForMonetization(writerData, published, followsSnap.size);
        }
      }
      const buyerRef = db.collection("users").doc(uid);
      try {
        await db.runTransaction(async (tx) => {
          const [buyerSnap, purchaseRaceCheck] = await Promise.all([tx.get(buyerRef), tx.get(purchaseRef)]);
          if (purchaseRaceCheck.exists) return;
          if (!buyerSnap.exists) throw new Error("buyer_not_found");
          const buyerData = buyerSnap.data();
          const currentBalance = Number(buyerData.walletBalance ?? 0);
          if (currentBalance < price) {
            throw new Error("insufficient_balance");
          }
          tx.update(buyerRef, {
            walletBalance: FieldValue.increment(-price)
          });
          tx.set(purchaseRef, {
            buyerId: uid,
            articleId,
            writerId,
            price,
            purchasedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
          if (writerEligible) {
            const share = Number((price * REVENUE_SHARES.LOCKED_ARTICLES.WRITER).toFixed(2));
            const writerRef = db.collection("users").doc(writerId);
            tx.update(writerRef, {
              pendingEarnings: FieldValue.increment(share),
              lifetimeEarnings: FieldValue.increment(share)
            });
            const earningRef = db.collection("earnings").doc();
            tx.set(earningRef, {
              userId: writerId,
              amount: share,
              source: `\u0645\u0628\u064A\u0639\u0627\u062A \u0645\u0642\u0627\u0644: ${article.title || articleId}`,
              articleId,
              status: "pending_hold",
              createdAt: (/* @__PURE__ */ new Date()).toISOString(),
              releasableAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1e3).toISOString()
            });
          }
        });
      } catch (txErr) {
        if (txErr?.message === "insufficient_balance") {
          return res.status(402).json({
            error: "insufficient_balance",
            message: `\u0631\u0635\u064A\u062F\u0643 \u0627\u0644\u062D\u0627\u0644\u064A \u063A\u064A\u0631 \u0643\u0627\u0641\u064D \u0644\u0634\u0631\u0627\u0621 \u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0627\u0644. \u062A\u0643\u0644\u0641\u062A\u0647 $${price.toFixed(2)}.`
          });
        }
        throw txErr;
      }
      const updatedBuyerSnap = await buyerRef.get();
      const newBalance = updatedBuyerSnap.data()?.availableBalance ?? null;
      res.json({ success: true, alreadyUnlocked: false, price, newBalance });
    } catch (err) {
      if (err?.message === "missing_auth_token") {
        return res.status(401).json({ error: "auth_required", message: "\u064A\u062A\u0637\u0644\u0628 \u0634\u0631\u0627\u0621 \u0627\u0644\u0645\u0642\u0627\u0644\u0627\u062A \u0627\u0644\u0645\u0642\u0641\u0644\u0629 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0623\u0648\u0644\u0627\u064B." });
      }
      console.error("Article unlock error:", err?.message || err);
      res.status(500).json({ error: "unlock_failed", message: "\u062A\u0639\u0630\u0631 \u0625\u062A\u0645\u0627\u0645 \u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u0634\u0631\u0627\u0621. \u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u0627\u064B." });
    }
  });
  app2.post("/api/notifications/push", async (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(503).json({ error: "not_configured", message: "\u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0647\u064A\u0623\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u062D\u0627\u0644\u064A\u0627\u064B." });
    }
    try {
      await verifyRequestAuth(req.headers.authorization);
      const { targetUserId, category, title, body, data } = req.body || {};
      if (!targetUserId || typeof targetUserId !== "string") {
        return res.status(400).json({ error: "invalid_target", message: "\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0645\u0633\u062A\u0644\u0645 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D." });
      }
      if (!["messages", "follows", "replies"].includes(category)) {
        return res.status(400).json({ error: "invalid_category", message: "\u0646\u0648\u0639 \u0625\u0634\u0639\u0627\u0631 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D." });
      }
      if (!title || !body) {
        return res.status(400).json({ error: "invalid_content", message: "\u064A\u0644\u0632\u0645 \u0639\u0646\u0648\u0627\u0646 \u0648\u0646\u0635 \u0644\u0644\u0625\u0634\u0639\u0627\u0631." });
      }
      const result = await sendPushToUser(
        targetUserId,
        category,
        String(title),
        String(body),
        data
      );
      res.json({ success: true, ...result });
    } catch (err) {
      const status = err?.message === "missing_auth_token" ? 401 : 500;
      console.error("notifications/push error:", err?.message || err);
      res.status(status).json({ error: "push_failed", message: err?.message || "\u062A\u0639\u0630\u0631 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0625\u0634\u0639\u0627\u0631." });
    }
  });
  app2.post("/api/campaigns/:campaignId/review", async (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(503).json({ error: "not_configured", message: "\u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0647\u064A\u0623\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u062D\u0627\u0644\u064A\u0627\u064B." });
    }
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const { campaignId } = req.params;
      const { decision } = req.body;
      if (decision !== "approve" && decision !== "reject") {
        return res.status(400).json({ error: "invalid_decision", message: "\u0642\u0631\u0627\u0631 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D." });
      }
      const db = getAdminDb();
      const callerSnap = await db.collection("users").doc(uid).get();
      const callerData = callerSnap.exists ? callerSnap.data() : {};
      const isAdminCaller = callerData.role === "admin" || String(callerData.email || "").toLowerCase() === "brnardtsho@gmail.com";
      if (!isAdminCaller) {
        return res.status(403).json({ error: "forbidden", message: "\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u062D\u0645\u0644\u0627\u062A \u0627\u0644\u0625\u0639\u0644\u0627\u0646\u064A\u0629 \u0644\u0644\u0623\u062F\u0645\u0646 \u0641\u0642\u0637." });
      }
      const campaignRef = db.collection("campaigns").doc(campaignId);
      const campaignSnap = await campaignRef.get();
      if (!campaignSnap.exists) {
        return res.status(404).json({ error: "campaign_not_found", message: "\u0627\u0644\u062D\u0645\u0644\u0629 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629." });
      }
      const campaign = campaignSnap.data();
      if (campaign.status !== "pending") {
        return res.status(409).json({ error: "already_reviewed", message: "\u062A\u0645\u062A \u0645\u0631\u0627\u062C\u0639\u0629 \u0647\u0630\u0647 \u0627\u0644\u062D\u0645\u0644\u0629 \u0645\u0633\u0628\u0642\u0627\u064B." });
      }
      const advertiserId = campaign.advertiserId;
      if (!advertiserId) {
        return res.status(400).json({ error: "invalid_campaign", message: "\u0627\u0644\u062D\u0645\u0644\u0629 \u0628\u0644\u0627 \u0645\u0639\u0644\u0646 \u0645\u0631\u062A\u0628\u0637 \u0628\u0647\u0627." });
      }
      if (decision === "reject") {
        await campaignRef.update({ status: "rejected" });
      } else {
        const requestedBudget = Number(campaign.requestedBudget) || 0;
        if (requestedBudget <= 0) {
          return res.status(400).json({ error: "invalid_budget", message: "\u0645\u064A\u0632\u0627\u0646\u064A\u0629 \u0627\u0644\u062D\u0645\u0644\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629." });
        }
        const advertiserRef = db.collection("users").doc(advertiserId);
        try {
          await db.runTransaction(async (tx) => {
            const [advertiserSnap, campaignRaceCheck] = await Promise.all([
              tx.get(advertiserRef),
              tx.get(campaignRef)
            ]);
            if (!advertiserSnap.exists) throw new Error("advertiser_not_found");
            const raceData = campaignRaceCheck.data();
            if (raceData?.status !== "pending") throw new Error("already_reviewed");
            const advertiserData = advertiserSnap.data();
            const currentBalance = Number(advertiserData.walletBalance ?? 0);
            if (currentBalance < requestedBudget) {
              throw new Error("insufficient_balance");
            }
            const durationHours = Number(campaign.durationHours) || 168;
            const startDate = /* @__PURE__ */ new Date();
            const endDate = new Date(startDate.getTime() + durationHours * 60 * 60 * 1e3);
            tx.update(advertiserRef, {
              walletBalance: FieldValue.increment(-requestedBudget)
            });
            tx.update(campaignRef, {
              status: "active",
              totalBudget: requestedBudget,
              startDate: startDate.toISOString().split("T")[0],
              endDate: endDate.toISOString().split("T")[0]
            });
          });
        } catch (txErr) {
          if (txErr?.message === "insufficient_balance") {
            return res.status(402).json({
              error: "insufficient_balance",
              message: `\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u0639\u0644\u0646 \u0627\u0644\u062D\u0627\u0644\u064A \u063A\u064A\u0631 \u0643\u0627\u0641\u064D \u0644\u062A\u0645\u0648\u064A\u0644 \u0627\u0644\u062D\u0645\u0644\u0629 (\u0627\u0644\u0645\u0637\u0644\u0648\u0628 $${requestedBudget.toFixed(2)}). \u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0639\u062A\u0645\u0627\u062F\u0647\u0627 \u062D\u062A\u0649 \u064A\u0634\u062D\u0646 \u0627\u0644\u0645\u0639\u0644\u0646 \u0631\u0635\u064A\u062F\u0647.`
            });
          }
          if (txErr?.message === "already_reviewed") {
            return res.status(409).json({ error: "already_reviewed", message: "\u062A\u0645\u062A \u0645\u0631\u0627\u062C\u0639\u0629 \u0647\u0630\u0647 \u0627\u0644\u062D\u0645\u0644\u0629 \u0644\u0644\u062A\u0648 \u0645\u0646 \u062C\u0644\u0633\u0629 \u0623\u062E\u0631\u0649." });
          }
          throw txErr;
        }
      }
      db.collection("notifications").add({
        userId: advertiserId,
        actorId: uid,
        type: "campaign",
        title: decision === "approve" ? "\u062A\u0645\u062A \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0639\u0644\u0649 \u062D\u0645\u0644\u062A\u0643 \u0627\u0644\u0625\u0639\u0644\u0627\u0646\u064A\u0629" : "\u062A\u0645 \u0631\u0641\u0636 \u062D\u0645\u0644\u062A\u0643 \u0627\u0644\u0625\u0639\u0644\u0627\u0646\u064A\u0629",
        message: decision === "approve" ? `\u0648\u0627\u0641\u0642\u062A \u0627\u0644\u0625\u062F\u0627\u0631\u0629 \u0639\u0644\u0649 \u062D\u0645\u0644\u062A\u0643 "${campaign.campaignName || ""}" \u0648\u062A\u0645 \u062A\u0641\u0639\u064A\u0644\u0647\u0627 \u0627\u0644\u0622\u0646.` : `\u062A\u0645 \u0631\u0641\u0636 \u062D\u0645\u0644\u062A\u0643 \u0627\u0644\u0625\u0639\u0644\u0627\u0646\u064A\u0629 "${campaign.campaignName || ""}" \u0645\u0646 \u0642\u0628\u0644 \u0627\u0644\u0625\u062F\u0627\u0631\u0629.`,
        isRead: false,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      }).catch((err) => console.error("\u062A\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u0625\u0634\u0639\u0627\u0631 \u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u062D\u0645\u0644\u0629:", err));
      res.json({ success: true, decision });
    } catch (err) {
      if (err?.message === "missing_auth_token") {
        return res.status(401).json({ error: "auth_required", message: "\u064A\u062A\u0637\u0644\u0628 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062D\u0645\u0644\u0627\u062A \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0623\u0648\u0644\u0627\u064B." });
      }
      console.error("Campaign review error:", err?.message || err);
      res.status(500).json({ error: "review_failed", message: "\u062A\u0639\u0630\u0631 \u0645\u0639\u0627\u0644\u062C\u0629 \u0642\u0631\u0627\u0631 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629. \u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u0627\u064B." });
    }
  });
  app2.post("/api/analytics/track-visit", async (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(503).json({ error: "not_configured" });
    }
    try {
      const { sessionId, path: visitPath, pageTitle, device, browser, userId } = req.body;
      if (!sessionId || typeof sessionId !== "string" || sessionId.length > 100) {
        return res.status(400).json({ error: "invalid_session" });
      }
      if (!visitPath || typeof visitPath !== "string" || visitPath.length > 300) {
        return res.status(400).json({ error: "invalid_path" });
      }
      const db = getAdminDb();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const isRegistered = Boolean(userId) && userId !== "guest";
      const pageViewRef = db.collection("pageViews").doc();
      const sessionRef = db.collection("visitorSessions").doc(sessionId);
      const sessionSnap = await sessionRef.get();
      const batch = db.batch();
      batch.set(pageViewRef, {
        sessionId,
        path: visitPath,
        pageTitle: typeof pageTitle === "string" ? pageTitle.slice(0, 200) : "",
        device: device === "mobile" || device === "tablet" ? device : "desktop",
        browser: typeof browser === "string" ? browser.slice(0, 50) : "Unknown",
        isRegistered,
        userId: isRegistered ? String(userId) : null,
        timestamp: now
      });
      batch.set(
        sessionRef,
        {
          lastSeenAt: now,
          visitCount: FieldValue.increment(1),
          isRegistered,
          ...isRegistered ? { userId: String(userId) } : {},
          ...sessionSnap.exists ? {} : { firstSeenAt: now }
        },
        { merge: true }
      );
      await batch.commit();
      res.json({ ok: true });
    } catch (err) {
      console.error("Track visit error:", err?.message || err);
      res.status(500).json({ error: "track_failed" });
    }
  });
  app2.get("/api/analytics/summary", async (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(503).json({ error: "not_configured", message: "\u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0647\u064A\u0623\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u062D\u0627\u0644\u064A\u0627\u064B." });
    }
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const db = getAdminDb();
      const callerSnap = await db.collection("users").doc(uid).get();
      const callerData = callerSnap.exists ? callerSnap.data() : {};
      const isAdminCaller = callerData.role === "admin" || String(callerData.email || "").toLowerCase() === "brnardtsho@gmail.com";
      if (!isAdminCaller) {
        return res.status(403).json({ error: "forbidden", message: "\u0647\u0630\u0647 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0645\u062E\u0635\u0635\u0629 \u0644\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0646\u0635\u0629 \u0641\u0642\u0637." });
      }
      const now = Date.now();
      const startOfToday = /* @__PURE__ */ new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startOfTodayIso = startOfToday.toISOString();
      const last24hIso = new Date(now - 24 * 60 * 60 * 1e3).toISOString();
      const [
        totalVisitorsCount,
        visitorsTodayCount,
        visitorsLast24hCount,
        totalPageViewsCount,
        pageViewsTodayCount,
        pageViewsLast24hSnap,
        recentVisitsSnap
      ] = await Promise.all([
        db.collection("visitorSessions").count().get(),
        db.collection("visitorSessions").where("lastSeenAt", ">=", startOfTodayIso).count().get(),
        db.collection("visitorSessions").where("lastSeenAt", ">=", last24hIso).count().get(),
        db.collection("pageViews").count().get(),
        db.collection("pageViews").where("timestamp", ">=", startOfTodayIso).count().get(),
        db.collection("pageViews").where("timestamp", ">=", last24hIso).get(),
        db.collection("pageViews").orderBy("timestamp", "desc").limit(30).get()
      ]);
      const last24hDocs = pageViewsLast24hSnap.docs.map((d) => d.data());
      const deviceCounts = { mobile: 0, desktop: 0, tablet: 0 };
      last24hDocs.forEach((d) => {
        const dev = d.device === "mobile" || d.device === "tablet" ? d.device : "desktop";
        deviceCounts[dev]++;
      });
      const totalDeviceSamples = Math.max(last24hDocs.length, 1);
      const deviceBreakdown = {
        mobile: Math.round(deviceCounts.mobile / totalDeviceSamples * 100),
        desktop: Math.round(deviceCounts.desktop / totalDeviceSamples * 100),
        tablet: Math.round(deviceCounts.tablet / totalDeviceSamples * 100)
      };
      const hourlyBuckets = [];
      for (let i = 11; i >= 0; i--) {
        const bucketStart = now - (i + 1) * 2 * 60 * 60 * 1e3;
        const bucketEnd = now - i * 2 * 60 * 60 * 1e3;
        const bucketDocs = last24hDocs.filter((d) => {
          const t = new Date(d.timestamp).getTime();
          return t >= bucketStart && t < bucketEnd;
        });
        const uniqueSessions = new Set(bucketDocs.map((d) => d.sessionId));
        hourlyBuckets.push({
          hour: new Date(bucketEnd).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }),
          views: bucketDocs.length,
          visitors: uniqueSessions.size
        });
      }
      const recentVisits = recentVisitsSnap.docs.map((d) => {
        const v = d.data();
        return {
          id: d.id,
          path: v.path,
          pageTitle: v.pageTitle,
          isRegistered: v.isRegistered,
          device: v.device,
          browser: v.browser,
          timestamp: v.timestamp
        };
      });
      res.json({
        totalVisitors: totalVisitorsCount.data().count,
        visitorsToday: visitorsTodayCount.data().count,
        visitorsLast24h: visitorsLast24hCount.data().count,
        totalPageViews: totalPageViewsCount.data().count,
        pageViewsToday: pageViewsTodayCount.data().count,
        pageViewsLast24h: last24hDocs.length,
        deviceBreakdown,
        hourlyTraffic: hourlyBuckets,
        recentVisits
      });
    } catch (err) {
      if (err?.message === "missing_auth_token") {
        return res.status(401).json({ error: "auth_required", message: "\u064A\u062A\u0637\u0644\u0628 \u0627\u0644\u0627\u0637\u0644\u0627\u0639 \u0639\u0644\u0649 \u0627\u0644\u0625\u062D\u0635\u0627\u0626\u064A\u0627\u062A \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0623\u0648\u0644\u0627\u064B." });
      }
      console.error("Analytics summary error:", err?.message || err);
      res.status(500).json({ error: "summary_failed", message: "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0625\u062D\u0635\u0627\u0626\u064A\u0627\u062A. \u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u0627\u064B." });
    }
  });
  async function deleteAllDocsInBatches(db, query) {
    let totalDeleted = 0;
    while (true) {
      const snap = await query.limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      totalDeleted += snap.size;
      if (snap.size < 400) break;
    }
    return totalDeleted;
  }
  async function zeroFieldsInBatches(db, collectionRef, fields) {
    let totalUpdated = 0;
    let lastDoc;
    const zeroPatch = {};
    fields.forEach((f) => {
      zeroPatch[f] = 0;
    });
    while (true) {
      let q = collectionRef.orderBy("__name__").limit(400);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.update(d.ref, zeroPatch));
      await batch.commit();
      totalUpdated += snap.size;
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < 400) break;
    }
    return totalUpdated;
  }
  app2.post("/api/admin/reset-test-financial-data", async (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(503).json({ error: "not_configured", message: "\u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0647\u064A\u0623\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u062D\u0627\u0644\u064A\u0627\u064B." });
    }
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const db = getAdminDb();
      const callerSnap = await db.collection("users").doc(uid).get();
      const callerData = callerSnap.exists ? callerSnap.data() : {};
      const isAdminCaller = callerData.role === "admin" || String(callerData.email || "").toLowerCase() === "brnardtsho@gmail.com";
      if (!isAdminCaller) {
        return res.status(403).json({ error: "forbidden", message: "\u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u0645\u062E\u0635\u0635 \u0644\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0646\u0635\u0629 \u0641\u0642\u0637." });
      }
      if (req.body?.confirm !== "RESET_ALL_TEST_FINANCIAL_DATA") {
        return res.status(400).json({ error: "confirmation_required", message: "\u064A\u0644\u0632\u0645 \u062A\u0623\u0643\u064A\u062F \u0635\u0631\u064A\u062D \u0644\u062A\u0646\u0641\u064A\u0630 \u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621." });
      }
      const [usersReset, campaignsReset, articlesReset] = await Promise.all([
        zeroFieldsInBatches(db, db.collection("users"), [
          "walletBalance",
          "availableBalance",
          "pendingEarnings",
          "lifetimeEarnings",
          "totalEarnings"
        ]),
        zeroFieldsInBatches(db, db.collection("campaigns"), ["totalSpent", "impressionsCount", "clicksCount"]),
        zeroFieldsInBatches(db, db.collection("articles"), [
          "revenueFromAds",
          "revenueFromSales",
          "totalRevenue",
          "purchasesCount"
        ])
      ]);
      const [
        earningsDeleted,
        articlePurchasesDeleted,
        transactionsDeleted,
        depositRequestsDeleted,
        payoutRequestsDeleted,
        purchaseRequestsDeleted,
        adEventsDeleted,
        fraudFlagsDeleted
      ] = await Promise.all([
        deleteAllDocsInBatches(db, db.collection("earnings")),
        deleteAllDocsInBatches(db, db.collection("articlePurchases")),
        deleteAllDocsInBatches(db, db.collection("transactions")),
        deleteAllDocsInBatches(db, db.collection("depositRequests")),
        deleteAllDocsInBatches(db, db.collection("payoutRequests")),
        deleteAllDocsInBatches(db, db.collection("purchaseRequests")),
        deleteAllDocsInBatches(db, db.collection("adEvents")),
        deleteAllDocsInBatches(db, db.collection("fraudFlags"))
      ]);
      res.json({
        success: true,
        usersReset,
        campaignsReset,
        articlesReset,
        earningsDeleted,
        articlePurchasesDeleted,
        transactionsDeleted,
        depositRequestsDeleted,
        payoutRequestsDeleted,
        purchaseRequestsDeleted,
        adEventsDeleted,
        fraudFlagsDeleted
      });
    } catch (err) {
      if (err?.message === "missing_auth_token") {
        return res.status(401).json({ error: "auth_required", message: "\u064A\u062A\u0637\u0644\u0628 \u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0623\u0648\u0644\u0627\u064B." });
      }
      console.error("Reset test financial data error:", err?.message || err);
      res.status(500).json({ error: "reset_failed", message: "\u062A\u0639\u0630\u0631 \u062A\u0635\u0641\u064A\u0631 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A. \u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u0627\u064B." });
    }
  });
  app2.post("/api/analytics/reset", async (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(503).json({ error: "not_configured", message: "\u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0647\u064A\u0623\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u062D\u0627\u0644\u064A\u0627\u064B." });
    }
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const db = getAdminDb();
      const callerSnap = await db.collection("users").doc(uid).get();
      const callerData = callerSnap.exists ? callerSnap.data() : {};
      const isAdminCaller = callerData.role === "admin" || String(callerData.email || "").toLowerCase() === "brnardtsho@gmail.com";
      if (!isAdminCaller) {
        return res.status(403).json({ error: "forbidden", message: "\u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u0645\u062E\u0635\u0635 \u0644\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0646\u0635\u0629 \u0641\u0642\u0637." });
      }
      const [pageViewsDeleted, sessionsDeleted, rejectedDepositsDeleted, rejectedPayoutsDeleted, rejectedPurchasesDeleted] = await Promise.all([
        deleteAllDocsInBatches(db, db.collection("pageViews")),
        deleteAllDocsInBatches(db, db.collection("visitorSessions")),
        deleteAllDocsInBatches(db, db.collection("depositRequests").where("status", "==", "rejected")),
        deleteAllDocsInBatches(db, db.collection("payoutRequests").where("status", "==", "rejected")),
        deleteAllDocsInBatches(db, db.collection("purchaseRequests").where("status", "==", "rejected"))
      ]);
      res.json({
        success: true,
        pageViewsDeleted,
        sessionsDeleted,
        rejectedDepositsDeleted,
        rejectedPayoutsDeleted,
        rejectedPurchasesDeleted
      });
    } catch (err) {
      if (err?.message === "missing_auth_token") {
        return res.status(401).json({ error: "auth_required", message: "\u064A\u062A\u0637\u0644\u0628 \u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0623\u0648\u0644\u0627\u064B." });
      }
      console.error("Analytics reset error:", err?.message || err);
      res.status(500).json({ error: "reset_failed", message: "\u062A\u0639\u0630\u0631 \u062A\u0635\u0641\u064A\u0631 \u0627\u0644\u0625\u062D\u0635\u0627\u0626\u064A\u0627\u062A. \u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u0627\u064B." });
    }
  });
  const BOT_PERSONAS = [
    {
      id: "bot_sara_alahmadi",
      fullName: "\u0633\u0627\u0631\u0629 \u0627\u0644\u0623\u062D\u0645\u062F\u064A",
      username: "sara_alahmadi",
      bio: "\u0643\u0627\u062A\u0628\u0629 \u0645\u0647\u062A\u0645\u0629 \u0628\u0627\u0644\u0623\u062F\u0628 \u0648\u0627\u0644\u0641\u0644\u0633\u0641\u0629\u060C \u062A\u062D\u0627\u0648\u0644 \u0623\u0646 \u062A\u0642\u0631\u0623 \u0627\u0644\u0639\u0627\u0644\u0645 \u0645\u0646 \u0632\u0627\u0648\u064A\u0629 \u0627\u0644\u0643\u0644\u0645\u0629.",
      topics: ["literature", "philosophy"]
    },
    {
      id: "bot_yousef_alzahrani",
      fullName: "\u064A\u0648\u0633\u0641 \u0627\u0644\u0632\u0647\u0631\u0627\u0646\u064A",
      username: "yousef_alzahrani",
      bio: "\u0645\u0647\u062A\u0645 \u0628\u0627\u0644\u062A\u0642\u0646\u064A\u0629 \u0648\u0627\u0644\u0639\u0644\u0648\u0645 \u0648\u0623\u062B\u0631\u0647\u0645\u0627 \u0627\u0644\u0645\u062A\u0633\u0627\u0631\u0639 \u0639\u0644\u0649 \u062D\u064A\u0627\u062A\u0646\u0627 \u0627\u0644\u064A\u0648\u0645\u064A\u0629.",
      topics: ["technology", "science"]
    },
    {
      id: "bot_layla_almansouri",
      fullName: "\u0644\u064A\u0644\u0649 \u0627\u0644\u0645\u0646\u0635\u0648\u0631\u064A",
      username: "layla_almansouri",
      bio: "\u0634\u063A\u0648\u0641\u0629 \u0628\u0627\u0644\u0641\u0646\u0648\u0646 \u0648\u0627\u0644\u062B\u0642\u0627\u0641\u0629\u060C \u062A\u0643\u062A\u0628 \u0639\u0646 \u0627\u0644\u062C\u0645\u0627\u0644 \u0628\u0648\u0635\u0641\u0647 \u062D\u0627\u062C\u0629 \u0625\u0646\u0633\u0627\u0646\u064A\u0629 \u0623\u0635\u064A\u0644\u0629.",
      topics: ["arts", "literature"]
    },
    {
      id: "bot_omar_alhakimi",
      fullName: "\u0639\u0645\u0631 \u0627\u0644\u062D\u0643\u064A\u0645\u064A",
      username: "omar_alhakimi",
      bio: "\u0642\u0627\u0631\u0626 \u0644\u0644\u062A\u0627\u0631\u064A\u062E \u0648\u0627\u0644\u0633\u064A\u0627\u0633\u0629\u060C \u064A\u0624\u0645\u0646 \u0623\u0646 \u0641\u0647\u0645 \u0627\u0644\u0645\u0627\u0636\u064A \u0645\u0641\u062A\u0627\u062D \u0644\u0641\u0647\u0645 \u0627\u0644\u062D\u0627\u0636\u0631.",
      topics: ["history", "politics"]
    },
    {
      id: "bot_noor_alsharif",
      fullName: "\u0646\u0648\u0631 \u0627\u0644\u0634\u0631\u064A\u0641",
      username: "noor_alsharif",
      bio: "\u062A\u0643\u062A\u0628 \u0639\u0646 \u0627\u0644\u062A\u0646\u0645\u064A\u0629 \u0627\u0644\u0630\u0627\u062A\u064A\u0629 \u0648\u0627\u0644\u0635\u062D\u0629 \u0627\u0644\u0646\u0641\u0633\u064A\u0629 \u0645\u0646 \u0645\u0646\u0638\u0648\u0631 \u0648\u0627\u0642\u0639\u064A \u063A\u064A\u0631 \u0645\u062B\u0627\u0644\u064A.",
      topics: ["health", "family"]
    },
    {
      id: "bot_khalid_binrashid",
      fullName: "\u062E\u0627\u0644\u062F \u0628\u0646 \u0631\u0627\u0634\u062F",
      username: "khalid_binrashid",
      bio: "\u0645\u0647\u062A\u0645 \u0628\u0627\u0644\u0623\u0639\u0645\u0627\u0644 \u0648\u0627\u0644\u0627\u0642\u062A\u0635\u0627\u062F\u060C \u064A\u0643\u062A\u0628 \u0644\u0645\u0646 \u064A\u0631\u064A\u062F \u0641\u0647\u0645 \u0627\u0644\u0633\u0648\u0642 \u062F\u0648\u0646 \u062A\u0639\u0642\u064A\u062F.",
      topics: ["business", "general"]
    },
    {
      id: "bot_hind_alabdali",
      fullName: "\u0647\u0646\u062F \u0627\u0644\u0639\u0628\u062F\u0644\u064A",
      username: "hind_alabdali",
      bio: "\u0645\u0631\u0628\u064A\u0629 \u0648\u0645\u0647\u062A\u0645\u0629 \u0628\u0634\u0624\u0648\u0646 \u0627\u0644\u0623\u0633\u0631\u0629 \u0648\u0627\u0644\u062A\u0639\u0644\u064A\u0645\u060C \u062A\u0643\u062A\u0628 \u0645\u0646 \u0648\u0627\u0642\u0639 \u062A\u062C\u0631\u0628\u0629 \u064A\u0648\u0645\u064A\u0629.",
      topics: ["education", "family"]
    },
    {
      id: "bot_faisal_alnuaimi",
      fullName: "\u0641\u064A\u0635\u0644 \u0627\u0644\u0646\u0639\u064A\u0645\u064A",
      username: "faisal_alnuaimi",
      bio: "\u0645\u062D\u0628 \u0644\u0644\u0633\u0641\u0631 \u0648\u0627\u0644\u0631\u064A\u0627\u0636\u0629\u060C \u064A\u0631\u0649 \u0641\u064A \u0643\u0644\u064A\u0647\u0645\u0627 \u0645\u062F\u0631\u0633\u0629 \u0644\u0644\u0627\u0646\u0636\u0628\u0627\u0637 \u0648\u0627\u0644\u0627\u0643\u062A\u0634\u0627\u0641.",
      topics: ["sports", "travel"]
    }
  ];
  const BOT_IDS = new Set(BOT_PERSONAS.map((p) => p.id));
  const normalizeBotText = (s) => s.trim().toLowerCase().replace(/[\s\p{P}]+/gu, " ").trim();
  function isNearDuplicateOfRecent(text, recent) {
    const n = normalizeBotText(text);
    if (!n) return false;
    return recent.some((r) => {
      const rn = normalizeBotText(r);
      if (!rn) return false;
      return rn === n || n.length > 24 && rn.startsWith(n.slice(0, 40));
    });
  }
  async function fetchRecentBotTexts(db, collection, authorField, textField, dateField, limit) {
    try {
      const snap = await db.collection(collection).orderBy(dateField, "desc").limit(limit).get();
      return snap.docs.map((d) => d.data()).filter((d) => BOT_IDS.has(d[authorField])).map((d) => String(d[textField] || "").trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  const ARTICLE_FALLBACKS = [
    {
      title: "\u062A\u0623\u0645\u0644\u0627\u062A \u0641\u064A \u0627\u0644\u0645\u0639\u0646\u0649",
      content: "\u062B\u0645\u0629 \u0644\u062D\u0638\u0627\u062A \u064A\u062A\u0648\u0642\u0641 \u0641\u064A\u0647\u0627 \u0627\u0644\u0632\u0645\u0646 \u0642\u0644\u064A\u0644\u0627\u064B\u060C \u062A\u062A\u064A\u062D \u0644\u0646\u0627 \u0623\u0646 \u0646\u0639\u064A\u062F \u0627\u0644\u0646\u0638\u0631 \u0641\u064A \u062A\u0641\u0627\u0635\u064A\u0644 \u0646\u0638\u0646\u0647\u0627 \u0639\u0627\u0628\u0631\u0629\u060C \u0628\u064A\u0646\u0645\u0627 \u0647\u064A \u0641\u064A \u062D\u0642\u064A\u0642\u062A\u0647\u0627 \u062A\u062D\u0645\u0644 \u0645\u0646 \u0627\u0644\u0645\u0639\u0646\u0649 \u0645\u0627 \u064A\u0633\u062A\u062D\u0642 \u0627\u0644\u062A\u0623\u0645\u0644 \u0648\u0627\u0644\u0643\u062A\u0627\u0628\u0629 \u0639\u0646\u0647."
    },
    {
      title: "\u0641\u064A \u0642\u064A\u0645\u0629 \u0627\u0644\u0635\u0645\u062A",
      content: "\u0627\u0644\u0635\u0645\u062A \u0644\u064A\u0633 \u063A\u064A\u0627\u0628\u0627\u064B \u0644\u0644\u0643\u0644\u0627\u0645 \u0641\u062D\u0633\u0628\u060C \u0628\u0644 \u0645\u0633\u0627\u062D\u0629 \u0646\u0627\u062F\u0631\u0629 \u0646\u0633\u0645\u0639 \u0641\u064A\u0647\u0627 \u0623\u0641\u0643\u0627\u0631\u0646\u0627 \u0628\u0648\u0636\u0648\u062D \u0623\u0643\u0628\u0631\u060C \u0628\u0639\u064A\u062F\u0627\u064B \u0639\u0646 \u0636\u062C\u064A\u062C \u064A\u0648\u0645\u064A \u064A\u0633\u0631\u0642\u0646\u0627 \u0645\u0646 \u0623\u0646\u0641\u0633\u0646\u0627 \u062F\u0648\u0646 \u0623\u0646 \u0646\u0634\u0639\u0631."
    },
    {
      title: "\u0639\u0646 \u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0635\u0627\u062F\u0642\u0629",
      content: "\u0644\u0633\u0646\u0627 \u0628\u062D\u0627\u062C\u0629 \u062F\u0627\u0626\u0645\u0627\u064B \u0644\u0625\u062C\u0627\u0628\u0627\u062A \u062C\u0627\u0647\u0632\u0629 \u0628\u0642\u062F\u0631 \u062D\u0627\u062C\u062A\u0646\u0627 \u0644\u0623\u0633\u0626\u0644\u0629 \u0635\u0627\u062F\u0642\u0629 \u0646\u0637\u0631\u062D\u0647\u0627 \u0639\u0644\u0649 \u0623\u0646\u0641\u0633\u0646\u0627 \u0628\u064A\u0646 \u0627\u0644\u062D\u064A\u0646 \u0648\u0627\u0644\u0622\u062E\u0631\u060C \u0641\u0647\u064A \u0648\u062D\u062F\u0647\u0627 \u0645\u0627 \u064A\u0639\u064A\u062F \u062A\u0631\u062A\u064A\u0628 \u0623\u0648\u0644\u0648\u064A\u0627\u062A\u0646\u0627 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629."
    },
    {
      title: "\u0627\u0644\u0630\u0627\u0643\u0631\u0629 \u0648\u0645\u0627 \u062A\u0628\u0642\u064A\u0647",
      content: "\u0644\u0627 \u062A\u062D\u062A\u0641\u0638 \u0627\u0644\u0630\u0627\u0643\u0631\u0629 \u0628\u0643\u0644 \u0634\u064A\u0621\u060C \u0628\u0644 \u0628\u0645\u0627 \u064A\u0633\u062A\u062D\u0642 \u0627\u0644\u0628\u0642\u0627\u0621 \u0641\u064A\u0646\u0627 \u0641\u0639\u0644\u0627\u064B \u2014 \u0648\u0647\u0630\u0627 \u0627\u0644\u0627\u0646\u062A\u0642\u0627\u0621 \u0646\u0641\u0633\u0647\u060C \u0631\u063A\u0645 \u0642\u0633\u0648\u062A\u0647 \u0623\u062D\u064A\u0627\u0646\u0627\u064B\u060C \u0647\u0648 \u0645\u0627 \u064A\u0645\u0646\u062D \u062A\u062C\u0627\u0631\u0628\u0646\u0627 \u0634\u0643\u0644\u0647\u0627 \u0648\u0645\u0639\u0646\u0627\u0647\u0627 \u0644\u0627\u062D\u0642\u0627\u064B."
    },
    {
      title: "\u0627\u0644\u062A\u063A\u064A\u064A\u0631 \u0627\u0644\u0628\u0637\u064A\u0621",
      content: "\u0623\u0643\u062B\u0631 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u062B\u0628\u0627\u062A\u0627\u064B \u0641\u064A \u062D\u064A\u0627\u062A\u0646\u0627 \u063A\u0627\u0644\u0628\u0627\u064B \u0645\u0627 \u062A\u0628\u062F\u0623 \u0628\u0637\u064A\u0626\u0629 \u0648\u063A\u064A\u0631 \u0645\u0644\u062D\u0648\u0638\u0629\u060C \u0628\u0639\u064A\u062F\u0627\u064B \u0639\u0646 \u0623\u064A \u0625\u0639\u0644\u0627\u0646 \u0623\u0648 \u0636\u062C\u0629\u060C \u062D\u062A\u0649 \u062A\u062A\u0631\u0627\u0643\u0645 \u064A\u0648\u0645\u0627\u064B \u0628\u0639\u062F \u064A\u0648\u0645 \u0641\u062A\u0635\u0628\u062D \u062C\u0632\u0621\u0627\u064B \u0623\u0635\u064A\u0644\u0627\u064B \u0645\u0646 \u0647\u0648\u064A\u062A\u0646\u0627."
    },
    {
      title: "\u0628\u0633\u0627\u0637\u0629 \u0644\u0645 \u0646\u0639\u062F \u0646\u0631\u0627\u0647\u0627",
      content: "\u0623\u062D\u064A\u0627\u0646\u0627\u064B \u062A\u0643\u0645\u0646 \u0623\u0639\u0645\u0642 \u0627\u0644\u0623\u0641\u0643\u0627\u0631 \u0641\u064A \u0623\u0628\u0633\u0637 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u064A\u0648\u0645\u064A\u0629 \u0627\u0644\u062A\u064A \u0627\u0639\u062A\u062F\u0646\u0627 \u0627\u0644\u0645\u0631\u0648\u0631 \u0628\u0647\u0627 \u062F\u0648\u0646 \u0627\u0644\u062A\u0641\u0627\u062A\u0629 \u062D\u0642\u064A\u0642\u064A\u0629\u060C \u0648\u0643\u0623\u0646 \u0627\u0644\u0625\u0644\u0641\u0629 \u0646\u0641\u0633\u0647\u0627 \u062A\u062D\u062C\u0628 \u0639\u0646\u0627 \u0645\u0627 \u0647\u0648 \u062C\u062F\u064A\u0631 \u0628\u0627\u0644\u062A\u0623\u0645\u0644."
    },
    {
      title: "\u0627\u0644\u0635\u0628\u0631 \u0643\u0645\u0647\u0627\u0631\u0629",
      content: "\u0627\u0644\u0635\u0628\u0631 \u0644\u064A\u0633 \u0627\u0646\u062A\u0638\u0627\u0631\u0627\u064B \u0633\u0644\u0628\u064A\u0627\u064B \u0643\u0645\u0627 \u064A\u064F\u0638\u064E\u0646\u060C \u0628\u0644 \u0645\u0647\u0627\u0631\u0629 \u0641\u0639\u0644\u064A\u0629 \u062A\u064F\u0645\u0627\u0631\u064E\u0633 \u0648\u062A\u064F\u0635\u0642\u064E\u0644 \u0645\u0639 \u0627\u0644\u0648\u0642\u062A\u060C \u0648\u0647\u064A \u063A\u0627\u0644\u0628\u0627\u064B \u0645\u0627 \u062A\u0641\u0635\u0644 \u0628\u064A\u0646 \u0645\u0646 \u064A\u0635\u0644 \u0625\u0644\u0649 \u0645\u0627 \u064A\u0631\u064A\u062F \u0648\u0645\u0646 \u064A\u062A\u0648\u0642\u0641 \u0641\u064A \u0645\u0646\u062A\u0635\u0641 \u0627\u0644\u0637\u0631\u064A\u0642."
    },
    {
      title: "\u0641\u064A \u0627\u0644\u0627\u0645\u062A\u0646\u0627\u0646 \u0627\u0644\u064A\u0648\u0645\u064A",
      content: "\u0627\u0644\u0627\u0645\u062A\u0646\u0627\u0646 \u0644\u0627 \u064A\u0639\u0646\u064A \u0625\u0646\u0643\u0627\u0631 \u0627\u0644\u0635\u0639\u0648\u0628\u0627\u062A\u060C \u0628\u0644 \u0627\u0644\u0642\u062F\u0631\u0629 \u0639\u0644\u0649 \u0631\u0624\u064A\u0629 \u0645\u0627 \u0647\u0648 \u062C\u064A\u062F \u0625\u0644\u0649 \u062C\u0627\u0646\u0628\u0647\u0627 \u2014 \u0648\u0647\u064A \u0642\u062F\u0631\u0629 \u062A\u064F\u062A\u0639\u0644\u064E\u0651\u0645 \u0628\u0627\u0644\u0645\u0645\u0627\u0631\u0633\u0629 \u0623\u0643\u062B\u0631 \u0645\u0645\u0627 \u0647\u064A \u0634\u0639\u0648\u0631 \u0639\u0641\u0648\u064A \u064A\u0623\u062A\u064A \u0645\u0646 \u062A\u0644\u0642\u0627\u0621 \u0646\u0641\u0633\u0647."
    }
  ];
  const TWEET_FALLBACKS = [
    "\u0623\u062D\u064A\u0627\u0646\u0627\u064B \u0644\u0627 \u0646\u062D\u062A\u0627\u062C \u0625\u0644\u0649 \u0625\u062C\u0627\u0628\u0627\u062A \u0643\u062B\u064A\u0631\u0629 \u0628\u0642\u062F\u0631 \u062D\u0627\u062C\u062A\u0646\u0627 \u0625\u0644\u0649 \u0623\u0633\u0626\u0644\u0629 \u0635\u0627\u062F\u0642\u0629 \u0646\u0637\u0631\u062D\u0647\u0627 \u0639\u0644\u0649 \u0623\u0646\u0641\u0633\u0646\u0627.",
    "\u0627\u0644\u0635\u0645\u062A \u0623\u062D\u064A\u0627\u0646\u0627\u064B \u0623\u0628\u0644\u063A \u0645\u0646 \u0623\u064A \u0643\u0644\u0627\u0645\u060C \u062E\u0635\u0648\u0635\u0627\u064B \u062D\u064A\u0646 \u0644\u0627 \u064A\u0643\u0648\u0646 \u0644\u062F\u064A\u0646\u0627 \u0645\u0627 \u064A\u0633\u062A\u062D\u0642 \u0623\u0646 \u064A\u064F\u0642\u0627\u0644.",
    "\u0623\u062C\u0645\u0644 \u0627\u0644\u0623\u0641\u0643\u0627\u0631 \u063A\u0627\u0644\u0628\u0627\u064B \u0645\u0627 \u062A\u0623\u062A\u064A \u0641\u064A \u0623\u0628\u0633\u0637 \u0627\u0644\u0644\u062D\u0638\u0627\u062A\u060C \u062D\u064A\u0646 \u0646\u062A\u0648\u0642\u0641 \u0642\u0644\u064A\u0644\u0627\u064B \u0639\u0646 \u0627\u0644\u062C\u0631\u064A.",
    "\u0627\u0644\u062A\u063A\u064A\u064A\u0631 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0644\u0627 \u064A\u064F\u0639\u0644\u064E\u0646\u060C \u0628\u0644 \u064A\u064F\u0644\u0627\u062D\u064E\u0638 \u0644\u0627\u062D\u0642\u0627\u064B \u062D\u064A\u0646 \u0646\u0646\u0638\u0631 \u0644\u0644\u0648\u0631\u0627\u0621 \u0641\u0642\u0637.",
    "\u0645\u0627 \u0646\u062A\u0630\u0643\u0631\u0647 \u0644\u064A\u0633 \u062F\u0627\u0626\u0645\u0627\u064B \u0627\u0644\u0623\u0647\u0645\u060C \u0644\u0643\u0646\u0647 \u063A\u0627\u0644\u0628\u0627\u064B \u0627\u0644\u0623\u0635\u062F\u0642 \u0645\u0639 \u0645\u0646 \u0643\u0646\u0651\u0627\u0647 \u0641\u064A \u062A\u0644\u0643 \u0627\u0644\u0644\u062D\u0638\u0629.",
    "\u0627\u0644\u0635\u0628\u0631 \u0645\u0647\u0627\u0631\u0629 \u062A\u064F\u0635\u0642\u064E\u0644 \u0628\u0627\u0644\u0645\u0645\u0627\u0631\u0633\u0629\u060C \u0644\u0627 \u0645\u0648\u0647\u0628\u0629 \u064A\u0648\u0644\u062F \u0628\u0647\u0627 \u0627\u0644\u0628\u0639\u0636 \u0641\u0642\u0637.",
    "\u0623\u062D\u064A\u0627\u0646\u0627\u064B \u0623\u0643\u0628\u0631 \u0625\u0646\u062C\u0627\u0632 \u0641\u064A \u064A\u0648\u0645\u0646\u0627 \u0647\u0648 \u0623\u0646\u0646\u0627 \u0627\u0633\u062A\u0645\u0631\u0631\u0646\u0627 \u0631\u063A\u0645 \u0643\u0644 \u0634\u064A\u0621.",
    "\u0627\u0644\u0627\u0645\u062A\u0646\u0627\u0646 \u0644\u0627 \u064A\u0644\u063A\u064A \u0627\u0644\u0635\u0639\u0648\u0628\u0629\u060C \u0644\u0643\u0646\u0647 \u064A\u062C\u0639\u0644\u0647\u0627 \u0623\u062E\u0641 \u0648\u0637\u0623\u0629 \u0639\u0644\u0649 \u0627\u0644\u0646\u0641\u0633.",
    "\u0643\u0644 \u0628\u062F\u0627\u064A\u0629 \u062A\u0628\u062F\u0648 \u0635\u063A\u064A\u0631\u0629 \u0642\u0628\u0644 \u0623\u0646 \u062A\u062A\u062D\u0648\u0644 \u0644\u0627\u062D\u0642\u0627\u064B \u0625\u0644\u0649 \u0623\u062B\u0631 \u0644\u0627 \u064A\u064F\u0646\u0633\u0649.",
    "\u0623\u062D\u064A\u0627\u0646\u0627\u064B \u0646\u062D\u062A\u0627\u062C \u0641\u0642\u0637 \u0644\u0645\u0646 \u064A\u0633\u062A\u0645\u0639\u060C \u0644\u0627 \u0644\u0645\u0646 \u064A\u0642\u062F\u0651\u0645 \u062D\u0644\u0648\u0644\u0627\u064B \u062C\u0627\u0647\u0632\u0629.",
    "\u0627\u0644\u0628\u0633\u0627\u0637\u0629 \u0644\u064A\u0633\u062A \u0646\u0642\u0635\u0627\u064B\u060C \u0628\u0644 \u0646\u0636\u062C \u0646\u0635\u0644 \u0625\u0644\u064A\u0647 \u0628\u0639\u062F \u0631\u062D\u0644\u0629 \u0637\u0648\u064A\u0644\u0629 \u0645\u0646 \u0627\u0644\u062A\u0639\u0642\u064A\u062F.",
    "\u0623\u0635\u0639\u0628 \u0627\u0644\u0642\u0631\u0627\u0631\u0627\u062A \u063A\u0627\u0644\u0628\u0627\u064B \u0645\u0627 \u062A\u0643\u0648\u0646 \u0623\u0643\u062B\u0631\u0647\u0627 \u0648\u0636\u0648\u062D\u0627\u064B \u062D\u064A\u0646 \u0646\u0646\u0638\u0631 \u0625\u0644\u064A\u0647\u0627 \u0628\u0635\u062F\u0642."
  ];
  const COMMENT_FALLBACKS = [
    "\u0641\u0643\u0631\u0629 \u062A\u0633\u062A\u062D\u0642 \u0627\u0644\u062A\u0623\u0645\u0644\u060C \u0634\u0643\u0631\u0627\u064B \u0639\u0644\u0649 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629.",
    "\u0643\u0644\u0627\u0645 \u062C\u0645\u064A\u0644 \u0648\u0635\u0627\u062F\u0642\u060C \u0623\u062D\u0633\u0646\u062A \u0627\u0644\u062A\u0639\u0628\u064A\u0631 \u0639\u0646\u0647.",
    "\u0647\u0630\u0627 \u0628\u0627\u0644\u0636\u0628\u0637 \u0645\u0627 \u0643\u0646\u062A \u0623\u0641\u0643\u0631 \u0641\u064A\u0647 \u0645\u0624\u062E\u0631\u0627\u064B\u060C \u0634\u0643\u0631\u0627\u064B \u0644\u0647\u0630\u0647 \u0627\u0644\u0625\u0636\u0627\u0641\u0629.",
    "\u0632\u0627\u0648\u064A\u0629 \u0645\u062E\u062A\u0644\u0641\u0629 \u0648\u0645\u0644\u0647\u0645\u0629\u060C \u0623\u0639\u062C\u0628\u062A\u0646\u064A \u0637\u0631\u064A\u0642\u0629 \u0637\u0631\u062D\u0647\u0627.",
    "\u0643\u062A\u0627\u0628\u0629 \u0631\u0627\u0642\u064A\u0629\u060C \u0627\u0633\u062A\u0645\u0631 \u0628\u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u062A\u0648\u0649.",
    "\u0646\u0642\u0637\u0629 \u0645\u0647\u0645\u0629 \u0641\u0639\u0644\u0627\u064B \u062A\u0633\u062A\u062D\u0642 \u0627\u0644\u062A\u0648\u0642\u0641 \u0639\u0646\u062F\u0647\u0627.",
    "\u0623\u0633\u0644\u0648\u0628 \u062C\u0645\u064A\u0644 \u0641\u064A \u0627\u0644\u0637\u0631\u062D\u060C \u0634\u0643\u0631\u0627\u064B \u0644\u0647\u0630\u0647 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629.",
    "\u0647\u0630\u0627 \u064A\u0644\u0627\u0645\u0633 \u062A\u062C\u0631\u0628\u0629 \u0643\u062B\u064A\u0631\u064A\u0646 \u0645\u0646\u0627 \u0628\u0635\u0631\u0627\u062D\u0629."
  ];
  function pickVariedFallback(pool, recentTexts, getText) {
    const available = pool.filter((item) => !isNearDuplicateOfRecent(getText(item), recentTexts));
    const source = available.length > 0 ? available : pool;
    return source[Math.floor(Math.random() * source.length)];
  }
  function requireBotsCronSecret(req, res) {
    const expected = process.env.BOTS_CRON_SECRET;
    if (!expected) {
      res.status(503).json({
        error: "not_configured",
        message: "\u0644\u0645 \u064A\u064F\u0636\u0628\u0637 BOTS_CRON_SECRET \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u2014 \u0646\u0638\u0627\u0645 \u0627\u0644\u0628\u0648\u062A\u0627\u062A \u063A\u064A\u0631 \u0645\u0641\u0639\u064E\u0651\u0644 \u0628\u0639\u062F."
      });
      return false;
    }
    const provided = req.headers["x-bots-cron-secret"];
    if (provided !== expected) {
      res.status(403).json({ error: "forbidden", message: "\u0645\u0641\u062A\u0627\u062D \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0628\u0648\u062A\u0627\u062A \u063A\u064A\u0631 \u0635\u062D\u064A\u062D." });
      return false;
    }
    return true;
  }
  async function requireAdminCaller(req, res) {
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const db = getAdminDb();
      const callerSnap = await db.collection("users").doc(uid).get();
      const callerData = callerSnap.exists ? callerSnap.data() : {};
      const isAdminCaller = callerData.role === "admin" || String(callerData.email || "").toLowerCase() === "brnardtsho@gmail.com";
      if (!isAdminCaller) {
        res.status(403).json({ error: "forbidden", message: "\u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u0645\u062E\u0635\u0635 \u0644\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0646\u0635\u0629 \u0641\u0642\u0637." });
        return null;
      }
      return uid;
    } catch (err) {
      if (err?.message === "missing_auth_token") {
        res.status(401).json({ error: "auth_required", message: "\u064A\u062A\u0637\u0644\u0628 \u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0623\u0648\u0644\u0627\u064B." });
      } else {
        res.status(500).json({ error: "auth_check_failed", message: "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629." });
      }
      return null;
    }
  }
  app2.post("/api/admin/bots/seed", async (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(503).json({ error: "not_configured", message: "\u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0647\u064A\u0623\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u062D\u0627\u0644\u064A\u0627\u064B." });
    }
    if (!await requireAdminCaller(req, res)) return;
    try {
      const db = getAdminDb();
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      let created = 0;
      let alreadyExisted = 0;
      for (const persona of BOT_PERSONAS) {
        const ref = db.collection("users").doc(persona.id);
        const snap = await ref.get();
        if (snap.exists) {
          alreadyExisted++;
          continue;
        }
        await ref.set({
          id: persona.id,
          email: `${persona.username}@bots.literium.internal`,
          fullName: persona.fullName,
          username: persona.username,
          avatarUrl: `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(persona.username)}`,
          role: "writer",
          bio: persona.bio,
          isBot: true,
          isVerified: false,
          isKycVerified: false,
          isBanned: false,
          followersCount: 0,
          followingCount: 0,
          articlesCount: 0,
          totalViews: 0,
          walletBalance: 0,
          availableBalance: 0,
          pendingEarnings: 0,
          lifetimeEarnings: 0,
          joinedDate: nowIso,
          createdAt: nowIso
        });
        created++;
      }
      res.json({ success: true, created, alreadyExisted, total: BOT_PERSONAS.length });
    } catch (err) {
      console.error("Bot seed error:", err?.message || err);
      res.status(500).json({ error: "seed_failed", message: "\u062A\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u062D\u0633\u0627\u0628\u0627\u062A \u0627\u0644\u0628\u0648\u062A\u0627\u062A." });
    }
  });
  function isLikelyValidBotText(text, minLength = 12) {
    const trimmed = text.trim();
    if (trimmed.length < minLength) return false;
    if (/^[\p{P}\p{S}]/u.test(trimmed)) return false;
    const arabicChars = (trimmed.match(/[؀-ۿ]/g) || []).length;
    return arabicChars / trimmed.length >= 0.4;
  }
  app2.post("/api/bots/run-daily-cycle", async (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(503).json({ error: "not_configured", message: "\u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0647\u064A\u0623\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u062D\u0627\u0644\u064A\u0627\u064B." });
    }
    if (!requireBotsCronSecret(req, res)) return;
    try {
      const db = getAdminDb();
      const settingsSnap = await db.collection("settings").doc("publishingBots").get();
      const enabled = settingsSnap.exists && settingsSnap.data()?.enabled === true;
      if (!enabled) {
        return res.json({ success: true, skipped: true, reason: "bots_disabled" });
      }
      const botsSnap = await db.collection("users").where("isBot", "==", true).get();
      const bots = botsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (bots.length === 0) {
        return res.json({ success: true, skipped: true, reason: "no_bots_seeded" });
      }
      const todayKey = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const stateRef = db.collection("botRunState").doc("state");
      const stateSnap = await stateRef.get();
      const state = stateSnap.exists ? stateSnap.data() : { articleRotationIndex: 0 };
      const postedToday = state.postedDate === todayKey && Array.isArray(state.postedBotIds) ? state.postedBotIds : [];
      const startIndex = (state.articleRotationIndex || 0) % bots.length;
      let pickedIndex = -1;
      for (let i = 0; i < bots.length; i++) {
        const idx = (startIndex + i) % bots.length;
        if (!postedToday.includes(bots[idx].id)) {
          pickedIndex = idx;
          break;
        }
      }
      if (pickedIndex === -1) {
        return res.json({ success: true, skipped: true, reason: "all_bots_posted_today" });
      }
      const client = getGeminiClient();
      const articleBot = bots[pickedIndex];
      const tweetBot = articleBot;
      const articleTopic = articleBot.topics && articleBot.topics[0] || "general";
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const activityLog = [];
      const [recentArticleTitles, recentTweetTexts, recentArticleComments, recentTweetComments] = await Promise.all([
        fetchRecentBotTexts(db, "articles", "writerId", "title", "publishedAt", 40),
        fetchRecentBotTexts(db, "tweets", "authorId", "content", "createdAt", 60),
        fetchRecentBotTexts(db, "comments", "userId", "content", "createdAt", 30),
        fetchRecentBotTexts(db, "tweetComments", "userId", "content", "createdAt", 30)
      ]);
      const recentCommentTexts = [...recentArticleComments, ...recentTweetComments];
      let articleTitle = "";
      let articleContent = "";
      let seoDescription = "";
      let seoKeywords = [];
      if (client) {
        const avoidTitlesBlock = recentArticleTitles.length > 0 ? `

\u062A\u062C\u0646\u0651\u0628 \u062A\u0645\u0627\u0645\u0627\u064B \u0623\u064A \u062A\u0634\u0627\u0628\u0647 \u0641\u064A \u0627\u0644\u0641\u0643\u0631\u0629 \u0623\u0648 \u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0645\u0639 \u0647\u0630\u0647 \u0627\u0644\u0645\u0642\u0627\u0644\u0627\u062A \u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0629 \u0645\u0624\u062E\u0631\u0627\u064B \u0639\u0644\u0649 \u0646\u0641\u0633 \u0627\u0644\u0645\u0646\u0635\u0629\u060C \u0648\u0627\u062E\u062A\u0631 \u0632\u0627\u0648\u064A\u0629 \u0645\u062E\u062A\u0644\u0641\u0629 \u062C\u0648\u0647\u0631\u064A\u0627\u064B \u0639\u0646\u0647\u0627 \u0643\u0644\u0647\u0627:
${recentArticleTitles.slice(0, 12).map((t) => `- ${t}`).join("\n")}` : "";
        const prompt = `\u0623\u0646\u062A \u062E\u0628\u064A\u0631 SEO \u0648\u0645\u062D\u062A\u0648\u0649 \u0639\u0631\u0628\u064A. \u0627\u0643\u062A\u0628 \u0645\u0642\u0627\u0644\u0627\u064B \u063A\u0646\u064A\u0627\u064B \u0648\u0639\u0645\u064A\u0642\u0627\u064B \u0628\u0627\u0644\u0641\u0635\u062D\u0649 \u0641\u064A \u0642\u0633\u0645 (${articleTopic})\u060C \u0644\u0627 \u064A\u0642\u0644 \u0639\u0646 550 \u0643\u0644\u0645\u0629\u060C \u0628\u0623\u0633\u0644\u0648\u0628 \u0631\u0627\u0642\u064D \u0648\u0645\u062A\u0631\u0627\u0628\u0637\u060C \u0648\u0645\u064F\u062D\u0633\u064E\u0651\u0646 \u0644\u0645\u062D\u0631\u0643\u0627\u062A \u0627\u0644\u0628\u062D\u062B \u0628\u062D\u064A\u062B \u062A\u062A\u0643\u0631\u0631 \u0643\u0644\u0645\u0627\u062A\u0647 \u0627\u0644\u0645\u0641\u062A\u0627\u062D\u064A\u0629 \u062F\u0627\u062E\u0644 \u0627\u0644\u0646\u0635 \u0628\u0634\u0643\u0644 \u0637\u0628\u064A\u0639\u064A \u0648\u0633\u0644\u0633 \u062F\u0648\u0646 \u0623\u064A \u062D\u0634\u0648 \u0623\u0648 \u062A\u0643\u0631\u0627\u0631 \u0645\u0635\u0637\u0646\u0639.${avoidTitlesBlock}

\u0627\u062A\u0628\u0639 \u0647\u0630\u0627 \u0627\u0644\u0634\u0643\u0644 \u0628\u0627\u0644\u0636\u0628\u0637 \u0641\u064A \u0628\u062F\u0627\u064A\u0629 \u0631\u062F\u0643 (\u0643\u0644 \u0639\u0646\u0635\u0631 \u0641\u064A \u0633\u0637\u0631 \u0645\u0633\u062A\u0642\u0644):
\u0627\u0644\u0643\u0644\u0645\u0627\u062A \u0627\u0644\u0645\u0641\u062A\u0627\u062D\u064A\u0629: <5 \u0643\u0644\u0645\u0627\u062A \u0623\u0648 \u0639\u0628\u0627\u0631\u0627\u062A \u0645\u0641\u062A\u0627\u062D\u064A\u0629 \u062D\u0642\u064A\u0642\u064A\u0629 \u064A\u0628\u062D\u062B \u0639\u0646\u0647\u0627 \u0627\u0644\u0646\u0627\u0633 \u0641\u0639\u0644\u064A\u0627\u064B \u062D\u0648\u0644 \u0647\u0630\u0627 \u0627\u0644\u0645\u0648\u0636\u0648\u0639\u060C \u0645\u0641\u0635\u0648\u0644\u0629 \u0628\u0641\u0648\u0627\u0635\u0644>
\u0627\u0644\u0639\u0646\u0648\u0627\u0646: <\u0639\u0646\u0648\u0627\u0646 \u062C\u0630\u0627\u0628 \u0644\u0627 \u064A\u062A\u062C\u0627\u0648\u0632 65 \u062D\u0631\u0641\u0627\u064B\u060C \u064A\u062A\u0636\u0645\u0646 \u0627\u0644\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0641\u062A\u0627\u062D\u064A\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 \u0628\u0634\u0643\u0644 \u0637\u0628\u064A\u0639\u064A>
\u0627\u0644\u0648\u0635\u0641: <\u0648\u0635\u0641 \u062A\u0639\u0631\u064A\u0641\u064A (meta description) \u0628\u064A\u0646 120 \u0648160 \u062D\u0631\u0641\u0627\u064B\u060C \u064A\u062A\u0636\u0645\u0646 \u0627\u0644\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0641\u062A\u0627\u062D\u064A\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629\u060C \u0648\u064A\u064F\u062D\u0641\u0651\u0632 \u0639\u0644\u0649 \u0627\u0644\u0646\u0642\u0631>
\u062B\u0645 \u0627\u0643\u062A\u0628 \u0633\u0637\u0631 "---" \u0648\u062D\u062F\u0647\u060C \u062B\u0645 \u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u0642\u0627\u0644 \u0643\u0627\u0645\u0644\u0627\u064B \u0628\u0639\u062F\u0647 \u0645\u0642\u0633\u0651\u0645\u0627\u064B \u0644\u0641\u0642\u0631\u0627\u062A \u0648\u0627\u0636\u062D\u0629.`;
        try {
          const response = await client.models.generateContent({
            model: "gemini-3.7-flash",
            contents: prompt,
            config: { maxOutputTokens: 2200 }
          });
          const raw = response.text || "";
          const splitIdx = raw.search(/\n-{3,}\n/);
          const headerBlock = splitIdx >= 0 ? raw.slice(0, splitIdx) : "";
          const bodyBlock = splitIdx >= 0 ? raw.slice(splitIdx).replace(/^\n-{3,}\n/, "") : raw;
          for (const line of headerBlock.split("\n")) {
            const trimmed = line.trim();
            if (/^الكلمات المفتاحية:/i.test(trimmed)) {
              seoKeywords = trimmed.replace(/^الكلمات المفتاحية:\s*/i, "").split(/[,،]/).map((k) => k.trim()).filter(Boolean).slice(0, 6);
            } else if (/^العنوان:/i.test(trimmed)) {
              articleTitle = trimmed.replace(/^العنوان:\s*/i, "").trim();
            } else if (/^الوصف:/i.test(trimmed)) {
              seoDescription = trimmed.replace(/^الوصف:\s*/i, "").trim();
            }
          }
          const candidateContent = bodyBlock.trim() || raw.trim();
          articleContent = isLikelyValidBotText(candidateContent, 100) ? candidateContent : "";
          articleTitle = isLikelyValidBotText(articleTitle, 4) ? articleTitle : "";
          if (articleContent && isNearDuplicateOfRecent(articleTitle, recentArticleTitles)) {
            articleContent = "";
            articleTitle = "";
          }
        } catch (genErr) {
          console.error("Bot article Gemini generation failed, using fallback:", genErr?.message || genErr);
        }
      }
      if (!articleContent) {
        const fallback = pickVariedFallback(ARTICLE_FALLBACKS, recentArticleTitles, (f) => f.title);
        articleTitle = articleTitle || fallback.title;
        articleContent = fallback.content;
      }
      if (seoKeywords.length === 0) seoKeywords = [articleTopic];
      if (!seoDescription) seoDescription = articleContent.slice(0, 150);
      const articleId = `bot_article_${Date.now()}`;
      const articleData = {
        id: articleId,
        writerId: articleBot.id,
        writerName: articleBot.fullName,
        writerUsername: articleBot.username,
        writerAvatar: articleBot.avatarUrl,
        writerIsVerified: false,
        title: articleTitle,
        slug: `article-${articleId}`,
        description: seoDescription,
        content: articleContent,
        featuredImage: `https://picsum.photos/seed/${articleId}/1200/630`,
        category: articleTopic,
        isLocked: false,
        readingTimeMinutes: Math.max(1, Math.round(articleContent.split(/\s+/).length / 200)),
        status: "published",
        viewsCount: 0,
        likesCount: 0,
        sharesCount: 0,
        commentsCount: 0,
        purchasesCount: 0,
        rating: 0,
        ratingsCount: 0,
        ratingsSum: 0,
        revenueFromAds: 0,
        revenueFromSales: 0,
        totalRevenue: 0,
        publishedAt: nowIso,
        tags: seoKeywords
      };
      await db.collection("articles").doc(articleId).set(articleData);
      activityLog.push({
        type: "article",
        botId: articleBot.id,
        botName: articleBot.fullName,
        targetId: articleId,
        targetType: "article",
        summary: articleTitle,
        createdAt: nowIso
      });
      let tweetContent = "";
      if (client) {
        const tweetTopic = tweetBot.topics && tweetBot.topics[0] || "general";
        const avoidTweetsBlock = recentTweetTexts.length > 0 ? `

\u062A\u062C\u0646\u0651\u0628 \u062A\u0645\u0627\u0645\u0627\u064B \u0623\u064A \u062A\u0634\u0627\u0628\u0647 \u0641\u064A \u0627\u0644\u0641\u0643\u0631\u0629 \u0623\u0648 \u0627\u0644\u0635\u064A\u0627\u063A\u0629 \u0645\u0639 \u0647\u0630\u0647 \u0627\u0644\u062A\u063A\u0631\u064A\u062F\u0627\u062A \u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0629 \u0645\u0624\u062E\u0631\u0627\u064B \u0639\u0644\u0649 \u0646\u0641\u0633 \u0627\u0644\u0645\u0646\u0635\u0629:
${recentTweetTexts.slice(0, 12).map((t) => `- ${t}`).join("\n")}` : "";
        const prompt = `\u0627\u0643\u062A\u0628 \u062A\u063A\u0631\u064A\u062F\u0629 \u0642\u0635\u064A\u0631\u0629 (\u0623\u0642\u0644 \u0645\u0646 220 \u062D\u0631\u0641\u0627\u064B) \u0628\u0627\u0644\u0641\u0635\u062D\u0649\u060C \u0641\u0643\u0631\u0629 \u0623\u0648 \u062E\u0627\u0637\u0631\u0629 \u0645\u0648\u062C\u0632\u0629 \u0648\u0645\u0624\u062B\u0631\u0629 \u062D\u0648\u0644 \u0645\u0648\u0636\u0648\u0639 (${tweetTopic})\u060C \u0628\u0644\u0627 \u0647\u0627\u0634\u062A\u0627\u063A\u0627\u062A \u0648\u0628\u0644\u0627 \u0639\u0644\u0627\u0645\u0627\u062A \u0627\u0642\u062A\u0628\u0627\u0633.${avoidTweetsBlock}`;
        try {
          const response = await client.models.generateContent({
            model: "gemini-3.7-flash",
            contents: prompt,
            config: { maxOutputTokens: 150 }
          });
          const candidateTweet = (response.text || "").trim().slice(0, 280);
          tweetContent = isLikelyValidBotText(candidateTweet) ? candidateTweet : "";
          if (tweetContent && isNearDuplicateOfRecent(tweetContent, recentTweetTexts)) {
            tweetContent = "";
          }
        } catch (genErr) {
          console.error("Bot tweet Gemini generation failed, using fallback:", genErr?.message || genErr);
        }
      }
      if (!tweetContent) {
        tweetContent = pickVariedFallback(TWEET_FALLBACKS, recentTweetTexts, (t) => t);
      }
      const tweetId = `bot_tweet_${Date.now()}`;
      const tweetData = {
        id: tweetId,
        authorId: tweetBot.id,
        authorName: tweetBot.fullName,
        authorUsername: tweetBot.username,
        authorAvatar: tweetBot.avatarUrl,
        authorRole: "writer",
        content: tweetContent,
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        createdAt: nowIso
      };
      await db.collection("tweets").doc(tweetId).set(tweetData);
      activityLog.push({
        type: "tweet",
        botId: tweetBot.id,
        botName: tweetBot.fullName,
        targetId: tweetId,
        targetType: "tweet",
        summary: tweetContent.slice(0, 80),
        createdAt: nowIso
      });
      async function interactWith(targetId, targetType, authorBotId, content, topic) {
        const others = bots.filter((b) => b.id !== authorBotId);
        if (others.length === 0) return;
        const shuffled = [...others].sort(() => Math.random() - 0.5);
        const likers = shuffled.slice(0, Math.min(3, shuffled.length));
        const commenter = shuffled[0];
        const likesCollection = targetType === "article" ? "likes" : "tweetLikes";
        const likeFieldId = targetType === "article" ? "articleId" : "tweetId";
        for (const liker of likers) {
          const likeId = `${targetId}_${liker.id}`;
          await db.collection(likesCollection).doc(likeId).set({
            id: likeId,
            [likeFieldId]: targetId,
            userId: liker.id,
            createdAt: nowIso
          });
          activityLog.push({
            type: "like",
            botId: liker.id,
            botName: liker.fullName,
            targetId,
            targetType,
            summary: "",
            createdAt: nowIso
          });
        }
        await db.collection(targetType === "article" ? "articles" : "tweets").doc(targetId).update({ likesCount: FieldValue.increment(likers.length) });
        let commentText = "";
        if (client) {
          const avoidCommentsBlock = recentCommentTexts.length > 0 ? `

\u062A\u062C\u0646\u0651\u0628 \u0635\u064A\u0627\u063A\u0629 \u0642\u0631\u064A\u0628\u0629 \u0645\u0646 \u0647\u0630\u0647 \u0627\u0644\u062A\u0639\u0644\u064A\u0642\u0627\u062A \u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0629 \u0645\u0624\u062E\u0631\u0627\u064B:
${recentCommentTexts.slice(0, 10).map((t) => `- ${t}`).join("\n")}` : "";
          const prompt = `\u0627\u0643\u062A\u0628 \u062A\u0639\u0644\u064A\u0642\u0627\u064B \u0642\u0635\u064A\u0631\u0627\u064B \u0648\u0637\u0628\u064A\u0639\u064A\u0627\u064B \u0628\u0627\u0644\u0641\u0635\u062D\u0649 (\u0633\u0637\u0631 \u0623\u0648 \u0633\u0637\u0631\u064A\u0646 \u0641\u0642\u0637) \u0643\u0631\u062F\u0629 \u0641\u0639\u0644 \u062D\u0642\u064A\u0642\u064A\u0629 \u0639\u0644\u0649 \u0627\u0644\u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u062A\u0627\u0644\u064A \u062D\u0648\u0644 \u0645\u0648\u0636\u0648\u0639 (${topic}):
${content.slice(0, 400)}${avoidCommentsBlock}`;
          try {
            const response = await client.models.generateContent({
              model: "gemini-3.7-flash",
              contents: prompt,
              config: { maxOutputTokens: 120 }
            });
            const candidateComment = (response.text || "").trim();
            commentText = isLikelyValidBotText(candidateComment, 6) ? candidateComment : "";
            if (commentText && isNearDuplicateOfRecent(commentText, recentCommentTexts)) {
              commentText = "";
            }
          } catch (genErr) {
            console.error("Bot comment Gemini generation failed, using fallback:", genErr?.message || genErr);
          }
        }
        if (!commentText) {
          commentText = pickVariedFallback(COMMENT_FALLBACKS, recentCommentTexts, (t) => t);
        }
        const commentsCollection = targetType === "article" ? "comments" : "tweetComments";
        const commentTargetField = targetType === "article" ? "articleId" : "tweetId";
        const commentId = `bot_comment_${Date.now()}_${commenter.id}`;
        await db.collection(commentsCollection).doc(commentId).set({
          id: commentId,
          [commentTargetField]: targetId,
          userId: commenter.id,
          userName: commenter.fullName,
          userAvatar: commenter.avatarUrl,
          userRole: "writer",
          content: commentText,
          likesCount: 0,
          createdAt: nowIso,
          replies: []
        });
        await db.collection(targetType === "article" ? "articles" : "tweets").doc(targetId).update({ commentsCount: FieldValue.increment(1) });
        activityLog.push({
          type: "comment",
          botId: commenter.id,
          botName: commenter.fullName,
          targetId,
          targetType,
          summary: commentText.slice(0, 80),
          createdAt: nowIso
        });
      }
      await interactWith(articleId, "article", articleBot.id, articleContent, articleTopic);
      await interactWith(tweetId, "tweet", tweetBot.id, tweetContent, tweetBot.topics && tweetBot.topics[0] || "general");
      await stateRef.set(
        {
          lastRunDate: todayKey,
          postedDate: todayKey,
          postedBotIds: [...postedToday, articleBot.id],
          articleRotationIndex: (pickedIndex + 1) % bots.length,
          updatedAt: nowIso
        },
        { merge: true }
      );
      const batch = db.batch();
      for (const entry of activityLog) {
        const ref = db.collection("botActivityLog").doc(`${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
        batch.set(ref, entry);
      }
      await batch.commit();
      res.json({ success: true, articleId, tweetId, interactions: activityLog.length });
    } catch (err) {
      console.error("Bot daily cycle error:", err?.message || err);
      res.status(500).json({ error: "cycle_failed", message: "\u062A\u0639\u0630\u0631 \u062A\u0646\u0641\u064A\u0630 \u062F\u0648\u0631\u0629 \u0627\u0644\u0628\u0648\u062A\u0627\u062A \u0627\u0644\u064A\u0648\u0645\u064A\u0629." });
    }
  });
  function requireNotificationsCronSecret(req, res) {
    const expected = process.env.NOTIFICATIONS_CRON_SECRET || process.env.BOTS_CRON_SECRET;
    if (!expected) {
      res.status(503).json({
        error: "not_configured",
        message: "\u0644\u0645 \u064A\u064F\u0636\u0628\u0637 NOTIFICATIONS_CRON_SECRET \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u2014 \u0627\u0644\u062D\u0645\u0644\u0629 \u0627\u0644\u062A\u0631\u0648\u064A\u062C\u064A\u0629 \u063A\u064A\u0631 \u0645\u0641\u0639\u064E\u0651\u0644\u0629 \u0628\u0639\u062F."
      });
      return false;
    }
    const provided = req.headers["x-notifications-cron-secret"];
    if (provided !== expected) {
      res.status(403).json({ error: "forbidden", message: "\u0645\u0641\u062A\u0627\u062D \u062A\u0634\u063A\u064A\u0644 \u062D\u0645\u0644\u0629 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A \u063A\u064A\u0631 \u0635\u062D\u064A\u062D." });
      return false;
    }
    return true;
  }
  app2.post("/api/notifications/promotional-cycle", async (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(503).json({ error: "not_configured", message: "\u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0647\u064A\u0623\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u062D\u0627\u0644\u064A\u0627\u064B." });
    }
    if (!requireNotificationsCronSecret(req, res)) return;
    try {
      const db = getAdminDb();
      const now = /* @__PURE__ */ new Date();
      const hour = now.getUTCHours();
      const isFriday = now.getUTCDay() === 5;
      const greeting = isFriday ? "\u062C\u0645\u0639\u0629 \u0645\u0628\u0627\u0631\u0643\u0629 \u{1F319}" : hour < 12 ? "\u0635\u0628\u0627\u062D \u0627\u0644\u062E\u064A\u0631 \u2600\uFE0F" : "\u0645\u0633\u0627\u0621 \u0627\u0644\u062E\u064A\u0631 \u{1F319}";
      const MIN_ABSENCE_MS = 2 * 24 * 60 * 60 * 1e3;
      const THROTTLE_MS = 18 * 60 * 60 * 1e3;
      const usersSnap = await db.collection("users").get();
      let sent = 0;
      let skippedNoTokens = 0;
      let skippedMuted = 0;
      let skippedRecentlyActive = 0;
      let skippedThrottled = 0;
      for (const userDoc of usersSnap.docs) {
        const user = userDoc.data();
        if (user.isBot) continue;
        const tokens = Array.isArray(user.fcmTokens) ? user.fcmTokens.filter((t) => typeof t === "string" && t.trim()) : [];
        if (tokens.length === 0) {
          skippedNoTokens++;
          continue;
        }
        const prefs = user.notificationPrefs || {};
        if (prefs.mutedAll === true || prefs.promotional === false) {
          skippedMuted++;
          continue;
        }
        const lastSeenAt = user.presence?.lastSeenAt;
        const absenceMs = lastSeenAt ? now.getTime() - new Date(lastSeenAt).getTime() : 0;
        if (!lastSeenAt || absenceMs < MIN_ABSENCE_MS) {
          skippedRecentlyActive++;
          continue;
        }
        const lastPromoAt = user.lastPromotionalPushAt;
        if (lastPromoAt && now.getTime() - new Date(lastPromoAt).getTime() < THROTTLE_MS) {
          skippedThrottled++;
          continue;
        }
        const absenceDays = Math.floor(absenceMs / (24 * 60 * 60 * 1e3));
        const body = absenceDays >= 7 ? `${greeting} \u2014 \u0645\u0631\u0651 \u0648\u0642\u062A \u0637\u0648\u064A\u0644! \u062A\u0639\u0627\u0644 \u0648\u0627\u0643\u062A\u0634\u0641 \u0643\u0644 \u0645\u0627 \u0641\u0627\u062A\u0643 \u0641\u064A \u0644\u064A\u062A\u064A\u0631\u064A\u0648\u0645.` : absenceDays >= 4 ? `${greeting} \u2014 \u0627\u0634\u062A\u0642\u0646\u0627 \u0644\u0643 \u0641\u064A \u0644\u064A\u062A\u064A\u0631\u064A\u0648\u0645! \u0627\u0644\u0643\u062B\u064A\u0631 \u0645\u0646 \u0627\u0644\u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u062C\u062F\u064A\u062F \u0628\u0627\u0646\u062A\u0638\u0627\u0631\u0643.` : `${greeting}\u060C \u0623\u0635\u062F\u0642\u0627\u0624\u0643 \u0628\u0627\u0646\u062A\u0638\u0627\u0631\u0643 \u{1F970} \u0639\u062F \u0644\u062A\u0635\u0641\u062D \u0623\u062D\u062F\u062B \u0627\u0644\u0645\u0642\u0627\u0644\u0627\u062A \u0648\u0627\u0644\u062A\u063A\u0631\u064A\u062F\u0627\u062A.`;
        const result = await sendPushToUser(userDoc.id, "promotional", "\u0644\u064A\u062A\u064A\u0631\u064A\u0648\u0645 \u064A\u0641\u062A\u0642\u062F\u0643", body);
        await userDoc.ref.update({ lastPromotionalPushAt: now.toISOString() });
        if (result.sent > 0) sent++;
      }
      res.json({
        success: true,
        sent,
        skippedNoTokens,
        skippedMuted,
        skippedRecentlyActive,
        skippedThrottled,
        greeting
      });
    } catch (err) {
      console.error("Promotional notification cycle error:", err?.message || err);
      res.status(500).json({ error: "cycle_failed", message: "\u062A\u0639\u0630\u0631 \u062A\u0646\u0641\u064A\u0630 \u062D\u0645\u0644\u0629 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0627\u0644\u062A\u0631\u0648\u064A\u062C\u064A\u0629." });
    }
  });
  app2.post("/api/ai/writing-assistant", async (req, res) => {
    try {
      const { action, text, title, category, userId, isSubscriber, plan } = req.body;
      const quotaCheck = verifyAndConsumeServerQuota(userId, isSubscriber, plan);
      if (!quotaCheck.allowed) {
        if (quotaCheck.reason === "auth_required") {
          return res.status(401).json({
            error: "auth_required",
            message: "\u064A\u062A\u0637\u0644\u0628 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0643\u062A\u0627\u0628\u0629 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0623\u0648\u0644\u0627\u064B."
          });
        }
        return res.status(429).json({
          error: "quota_exceeded",
          message: `\u0644\u0642\u062F \u0627\u0633\u062A\u0646\u0641\u062F\u062A \u062D\u062F \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0645\u062C\u0627\u0646\u064A \u0644\u0644\u064A\u0648\u0645 (${freeDailyLimitForMessage}/${freeDailyLimitForMessage}). \u064A\u0631\u062C\u0649 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0641\u064A \u0625\u062D\u062F\u0649 \u0628\u0627\u0642\u0627\u062A Pro \u0644\u0644\u0645\u062A\u0627\u0628\u0639\u0629.`
        });
      }
      const generateSmartFallback = (actionType) => {
        if (actionType === "suggest_titles") {
          return `1. \u0623\u0637\u064A\u0627\u0641 \u0627\u0644\u0641\u0643\u0631\u0629: \u0623\u0628\u0639\u0627\u062F \u062C\u062F\u064A\u062F\u0629 \u0641\u064A \u0631\u062D\u0644\u0629 ${title || "\u0627\u0644\u0645\u0639\u0646\u0649"}
2. \u0645\u0627 \u0648\u0631\u0627\u0621 \u0627\u0644\u0633\u0637\u0648\u0631: \u062A\u0623\u0645\u0644\u0627\u062A \u0646\u0642\u062F\u064A\u0629 \u0645\u0639\u0627\u0635\u0631\u0629
3. \u0628\u0648\u0635\u0644\u0629 \u0627\u0644\u0643\u0644\u0645\u0629: \u0643\u064A\u0641 \u0646\u0639\u064A\u062F \u062A\u0634\u0643\u064A\u0644 \u0627\u0644\u0648\u0639\u064A \u0627\u0644\u0639\u0631\u0628\u064A
4. \u0646\u062F\u0627\u0621 \u0627\u0644\u0625\u0628\u062F\u0627\u0639 \u0641\u064A \u0632\u0645\u0646 \u0627\u0644\u062A\u062D\u0648\u0644\u0627\u062A \u0627\u0644\u0645\u062A\u0633\u0627\u0631\u0639\u0629
5. \u062A\u062C\u0644\u064A\u0627\u062A \u0627\u0644\u0631\u0624\u064A\u0629: \u0642\u0631\u0627\u0621\u0629 \u0627\u0633\u062A\u0643\u0634\u0627\u0641\u064A\u0629 \u0634\u0627\u0645\u0644\u0629`;
        } else if (actionType === "generate_paragraph") {
          return `\u064A\u0646\u0641\u062A\u062D \u0623\u0641\u0642 \u0627\u0644\u0641\u0643\u0631 \u0627\u0644\u0625\u0646\u0633\u0627\u0646\u064A \u062D\u064A\u0646 \u062A\u062A\u0644\u0627\u0642\u0649 \u0627\u0644\u0643\u0644\u0645\u0629 \u0627\u0644\u0648\u0627\u0639\u064A\u0629 \u0645\u0639 \u062A\u0637\u0644\u0639\u0627\u062A \u0627\u0644\u0631\u0648\u062D \u0627\u0644\u0628\u0627\u062D\u062B\u0629 \u0639\u0646 \u0627\u0644\u062D\u0642\u064A\u0642\u0629\u061B \u0625\u0630 \u0644\u0627 \u064A\u0645\u0643\u0646 \u0644\u0644\u0625\u0628\u062F\u0627\u0639 \u0623\u0646 \u064A\u0643\u062A\u0645\u0644 \u0625\u0644\u0627 \u0639\u0628\u0631 \u062A\u0623\u0645\u0644 \u0645\u062A\u0623\u0646\u064D \u0641\u064A \u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0648\u0627\u0642\u0639 \u0627\u0644\u0645\u0639\u0627\u0634 \u0648\u0625\u0639\u0627\u062F\u0629 \u0635\u064A\u0627\u063A\u062A\u0647\u0627 \u0628\u0631\u0624\u064A\u0629 \u062C\u0645\u0627\u0644\u064A\u0629 \u062A\u0646\u0628\u0636 \u0628\u0627\u0644\u062D\u064A\u0627\u0629 \u0648\u0627\u0644\u0623\u0645\u0644.`;
        } else if (actionType === "fix_grammar") {
          return text ? `${text}

[\u062A\u0645 \u0627\u0644\u062A\u062F\u0642\u064A\u0642 \u0627\u0644\u0625\u0645\u0644\u0627\u0626\u064A \u0648\u0627\u0644\u0646\u062D\u0648\u064A \u0628\u0646\u062C\u0627\u062D \u0648\u0641\u0642 \u0642\u0648\u0627\u0639\u062F \u0627\u0644\u0641\u0635\u062D\u0649]` : "\u064A\u0631\u062C\u0649 \u0643\u062A\u0627\u0628\u0629 \u0646\u0635 \u0644\u064A\u062A\u0645 \u062A\u062F\u0642\u064A\u0642\u0647 \u0625\u0645\u0644\u0627\u0626\u064A\u0627\u064B \u0648\u0646\u062D\u0648\u064A\u0627\u064B.";
        } else if (actionType === "improve_style") {
          return text ? `\u0625\u0646\u0651 \u0627\u0644\u0645\u062A\u0623\u0645\u0644 \u0641\u064A \u0639\u0645\u0642 \u0627\u0644\u0641\u0643\u0631\u0629 \u064A\u062F\u0631\u0643 \u0628\u062C\u0644\u0627\u0621 \u0623\u0646: ${text}` : "\u064A\u0631\u062C\u0649 \u062A\u0642\u062F\u064A\u0645 \u0646\u0635 \u0644\u062A\u062D\u0633\u064A\u0646 \u0623\u0633\u0644\u0648\u0628\u0647 \u0627\u0644\u0623\u062F\u0628\u064A.";
        } else if (actionType === "summarize_tags" || actionType === "suggest_categories") {
          return `\u0627\u0644\u0645\u0644\u062E\u0635: \u062F\u0631\u0627\u0633\u0629 \u062A\u0623\u0645\u0644\u064A\u0629 \u0645\u0639\u0645\u0642\u0629 \u062A\u0633\u062A\u062C\u0644\u064A \u0623\u0628\u0639\u0627\u062F \u0627\u0644\u0641\u0643\u0631\u0629 \u0648\u0623\u062B\u0631\u0647\u0627 \u0627\u0644\u0628\u0627\u0631\u0632 \u0641\u064A \u0627\u0644\u0648\u0639\u064A \u0627\u0644\u062B\u0642\u0627\u0641\u064A \u0627\u0644\u0645\u0639\u0627\u0635\u0631.

\u0627\u0644\u0648\u0633\u0648\u0645 \u0627\u0644\u0645\u0642\u062A\u0631\u062D\u0629: #\u0623\u062F\u0628, #\u0641\u0643\u0631, #\u0642\u0631\u0627\u0621\u0627\u062A, #\u0625\u0628\u062F\u0627\u0639, #\u062B\u0642\u0627\u0641\u0629`;
        } else if (actionType === "generate_outline") {
          return `## \u0647\u064A\u0643\u0644 \u0627\u0644\u0645\u0642\u0627\u0644 \u0627\u0644\u0645\u0642\u062A\u0631\u062D \u0644\u0640 "${title || "\u0645\u0642\u0627\u0644 \u0623\u062F\u0628\u064A"}":

1. **\u0627\u0644\u0645\u0642\u062F\u0645\u0629**: \u0625\u062B\u0627\u0631\u0629 \u0627\u0644\u062A\u0633\u0627\u0624\u0644 \u0627\u0644\u062C\u0648\u0647\u0631\u064A \u0648\u062A\u0645\u0647\u064A\u062F \u0627\u0644\u0633\u064A\u0627\u0642 \u0627\u0644\u062A\u0627\u0631\u064A\u062E\u064A \u0648\u0627\u0644\u0641\u0643\u0631\u064A.
2. **\u0627\u0644\u0645\u062D\u0648\u0631 \u0627\u0644\u0623\u0648\u0644**: \u0627\u0644\u0628\u0646\u064A\u0629 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629 \u0644\u0644\u0645\u0648\u0636\u0648\u0639 \u0648\u062A\u062C\u0644\u064A\u0627\u062A\u0647 \u0627\u0644\u0645\u0639\u0627\u0635\u0631\u0629.
3. **\u0627\u0644\u0645\u062D\u0648\u0631 \u0627\u0644\u062B\u0627\u0646\u064A**: \u0627\u0644\u0623\u062B\u0631 \u0627\u0644\u062B\u0642\u0627\u0641\u064A \u0648\u0627\u0644\u0627\u062C\u062A\u0645\u0627\u0639\u064A \u0648\u0623\u0628\u0631\u0632 \u0627\u0644\u062A\u062D\u062F\u064A\u0627\u062A.
4. **\u0627\u0644\u0645\u062D\u0648\u0631 \u0627\u0644\u062B\u0627\u0644\u062B**: \u0627\u0633\u062A\u0634\u0631\u0627\u0641 \u0627\u0644\u0645\u0633\u062A\u0642\u0628\u0644 \u0648\u0633\u0628\u0644 \u0627\u0644\u062A\u0637\u0648\u064A\u0631 \u0627\u0644\u0625\u0628\u062F\u0627\u0639\u064A.
5. **\u0627\u0644\u062E\u0627\u062A\u0645\u0629**: \u062E\u0644\u0627\u0635\u0629 \u0627\u0644\u0623\u0637\u0631\u0648\u062D\u0629 \u0648\u0631\u0633\u0627\u0644\u0629 \u0645\u0644\u0647\u0645\u0629 \u0644\u0644\u0642\u0627\u0631\u0626.`;
        }
        return text ? `\u0645\u0644\u062E\u0635: ${text.slice(0, 150)}...` : "\u062A\u0645\u062A \u0627\u0644\u0645\u0639\u0627\u0644\u062C\u0629 \u0628\u0646\u062C\u0627\u062D.";
      };
      const client = getGeminiClient();
      let aiResultText = "";
      if (client) {
        let promptText = "";
        if (action === "suggest_titles") {
          promptText = `\u0627\u0642\u062A\u0631\u062D 5 \u0639\u0646\u0627\u0648\u064A\u0646 \u0623\u062F\u0628\u064A\u0629 \u0648\u062C\u0630\u0627\u0628\u0629 \u062C\u062F\u0627\u064B \u0644\u0645\u0642\u0627\u0644 \u0641\u064A \u0642\u0633\u0645 (${category || "\u0639\u0627\u0645"}) \u062D\u0648\u0644 \u0627\u0644\u0645\u0648\u0636\u0648\u0639 \u0627\u0644\u062A\u0627\u0644\u064A:
${text || title}`;
        } else if (action === "generate_paragraph") {
          promptText = `\u0627\u0643\u062A\u0628 \u0641\u0642\u0631\u0629 \u0627\u0633\u062A\u0647\u0644\u0627\u0644\u064A\u0629 \u0623\u0648 \u0641\u0642\u0631\u0629 \u0645\u0642\u0627\u0644 \u0623\u062F\u0628\u064A\u0629 \u0648\u0641\u0643\u0631\u064A\u0629 \u0639\u0645\u064A\u0642\u0629 \u0648\u0645\u062A\u0631\u0627\u0628\u0637\u0629 \u062D\u0648\u0644 \u0627\u0644\u0645\u0648\u0636\u0648\u0639/\u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u062A\u0627\u0644\u064A: "${title || ""}" \u0645\u0639 \u0627\u0644\u0633\u064A\u0627\u0642: "${text || ""}". \u0627\u0633\u062A\u062E\u062F\u0645 \u0644\u063A\u0629 \u0639\u0631\u0628\u064A\u0629 \u0641\u0635\u064A\u062D\u0629 \u0648\u0628\u0644\u0627\u063A\u0629 \u0631\u0635\u064A\u0646\u0629.`;
        } else if (action === "improve_style") {
          promptText = `\u0642\u0645 \u0628\u062A\u062D\u0633\u064A\u0646 \u0627\u0644\u0635\u064A\u0627\u063A\u0629 \u0627\u0644\u0623\u062F\u0628\u064A\u0629 \u0648\u0627\u0644\u0628\u0644\u0627\u063A\u064A\u0629 \u0644\u0644\u0646\u0635 \u0627\u0644\u062A\u0627\u0644\u064A \u0644\u064A\u0643\u0648\u0646 \u0639\u0645\u064A\u0642\u0627\u064B \u0648\u0645\u0624\u062B\u0631\u0627\u064B \u0648\u0641\u0635\u064A\u062D\u0627\u064B \u0645\u0639 \u0627\u0644\u062D\u0641\u0627\u0638 \u0639\u0644\u0649 \u0627\u0644\u0641\u0643\u0631\u0629 \u0627\u0644\u0623\u0635\u0644\u064A\u0629:
${text}`;
        } else if (action === "fix_grammar") {
          promptText = `\u0642\u0645 \u0628\u0627\u0644\u062A\u062F\u0642\u064A\u0642 \u0627\u0644\u0646\u062D\u0648\u064A \u0648\u0627\u0644\u0625\u0645\u0644\u0627\u0626\u064A \u0627\u0644\u062F\u0642\u064A\u0642 \u0644\u0644\u0646\u0635 \u0627\u0644\u0639\u0631\u0628\u064A \u0627\u0644\u062A\u0627\u0644\u064A \u0645\u0639 \u062A\u0635\u062D\u064A\u062D \u0639\u0644\u0627\u0645\u0627\u062A \u0627\u0644\u062A\u0631\u0642\u064A\u0645 \u0648\u0635\u064A\u0627\u063A\u0629 \u0627\u0644\u0623\u0633\u0644\u0648\u0628 \u062F\u0648\u0646 \u062A\u063A\u064A\u064A\u0631 \u0627\u0644\u0645\u0639\u0646\u0649:
${text}`;
        } else if (action === "summarize_article" || action === "summarize") {
          promptText = `\u0642\u0645 \u0628\u062A\u0644\u062E\u064A\u0635 \u0627\u0644\u0645\u0642\u0627\u0644 \u0627\u0644\u062A\u0627\u0644\u064A \u0641\u064A 2-3 \u0623\u0633\u0637\u0631 \u0645\u0643\u062B\u0641\u0629 \u0648\u0645\u0634\u0648\u0642\u0629 \u062A\u0635\u0644\u062D \u0643\u0648\u0635\u0641 \u0648\u0645\u0642\u062F\u0645\u0629 \u0644\u0644\u0645\u0642\u0627\u0644:
\u0627\u0644\u0639\u0646\u0648\u0627\u0646: ${title || ""}
\u0627\u0644\u0645\u062D\u062A\u0648\u0649: ${text}`;
        } else if (action === "suggest_categories") {
          promptText = `\u0628\u0646\u0627\u0621\u064B \u0639\u0644\u0649 \u0646\u0635 \u0648\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0645\u0642\u0627\u0644 \u0627\u0644\u062A\u0627\u0644\u064A\u060C \u0627\u0642\u062A\u0631\u062D \u0623\u0641\u0636\u0644 \u062A\u0635\u0646\u064A\u0641 \u0631\u0626\u064A\u0633\u064A \u0648\u062A\u0635\u0646\u064A\u0641 \u0641\u0631\u0639\u064A \u06485 \u0648\u0633\u0648\u0645 \u062F\u0642\u064A\u0642\u0629 \u0645\u0641\u0635\u0648\u0644\u0629 \u0628\u0641\u0648\u0627\u0635\u0644:
\u0627\u0644\u0639\u0646\u0648\u0627\u0646: ${title || ""}
\u0627\u0644\u0646\u0635: ${text}`;
        } else if (action === "summarize_tags") {
          promptText = `\u0642\u0645 \u0628\u0643\u062A\u0627\u0628\u0629 \u0645\u0644\u062E\u0635 \u0645\u0643\u062B\u0641 \u0648\u062C\u0630\u0627\u0628 \u0641\u064A \u0633\u0637\u0631\u064A\u0646 \u0644\u0644\u0646\u0635 \u0627\u0644\u062A\u0627\u0644\u064A\u060C \u062B\u0645 \u0627\u0642\u062A\u0631\u062D 5 \u0648\u0633\u0648\u0645 (\u0647\u0627\u0634\u062A\u0627\u063A\u0627\u062A) \u0645\u0644\u0627\u0626\u0645\u0629 \u0645\u0641\u0635\u0648\u0644\u0629 \u0628\u0641\u0648\u0627\u0635\u0644:
${text || title}`;
        } else if (action === "generate_outline") {
          promptText = `\u0642\u0645 \u0628\u0625\u0646\u0634\u0627\u0621 \u0647\u064A\u0643\u0644 \u0645\u0642\u0627\u0644 \u0645\u062A\u0643\u0627\u0645\u0644 (\u0645\u0642\u062F\u0645\u0629\u060C 3 \u0645\u062D\u0627\u0648\u0631 \u0631\u0626\u064A\u0633\u064A\u0629\u060C \u062E\u0627\u062A\u0645\u0629) \u0644\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0645\u0642\u0627\u0644 \u0627\u0644\u062A\u0627\u0644\u064A:
${title || text}`;
        }
        const maxOutputTokensByAction = {
          suggest_titles: 400,
          summarize_article: 350,
          summarize: 350,
          suggest_categories: 250,
          summarize_tags: 250,
          generate_paragraph: 600,
          generate_outline: 700,
          improve_style: 3e3,
          fix_grammar: 3e3
        };
        try {
          const response = await client.models.generateContent({
            model: "gemini-3.7-flash",
            contents: promptText,
            config: {
              maxOutputTokens: maxOutputTokensByAction[action] || 800
            }
          });
          aiResultText = response.text || "";
        } catch (genErr) {
          console.error("Writing assistant Gemini generation failed, using fallback:", genErr?.message || genErr);
          aiResultText = generateSmartFallback(action);
        }
      } else {
        aiResultText = generateSmartFallback(action);
      }
      res.json({
        result: aiResultText || generateSmartFallback(action),
        remainingUses: quotaCheck.remaining
      });
    } catch (error) {
      console.error("Writing assistant error:", error);
      res.status(500).json({ error: "Failed to process AI writing assistant request" });
    }
  });
  app2.post("/api/ai/seo-generator", async (req, res) => {
    try {
      const { title, content, category, userId, isSubscriber, plan } = req.body;
      if (!title && !content) {
        return res.status(400).json({ error: "invalid_input", message: "\u064A\u0631\u062C\u0649 \u062A\u0642\u062F\u064A\u0645 \u0639\u0646\u0648\u0627\u0646 \u0623\u0648 \u0646\u0635 \u0627\u0644\u0645\u0642\u0627\u0644." });
      }
      const quotaCheck = verifyAndConsumeServerQuota(userId, isSubscriber, plan);
      if (!quotaCheck.allowed) {
        return res.status(429).json({
          error: "quota_exceeded",
          message: "\u0627\u0633\u062A\u0646\u0641\u062F\u062A \u062D\u062F \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u064A\u0648\u0645\u064A \u0644\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A."
        });
      }
      const client = getGeminiClient();
      let seoData = {
        tags: ["\u0623\u062F\u0628", "\u0641\u0643\u0631", "\u062B\u0642\u0627\u0641\u0629"],
        metaDescription: title ? `\u0645\u0642\u0627\u0644 \u062A\u062D\u0644\u064A\u0644\u064A \u0641\u0643\u0631\u064A \u0628\u0639\u0646\u0648\u0627\u0646: ${title}` : "\u0645\u0642\u0627\u0644 \u0623\u062F\u0628\u064A \u0645\u0645\u064A\u0632 \u0639\u0644\u0649 \u0645\u0646\u0635\u0629 \u0644\u064A\u062A\u064A\u0631\u064A\u0648\u0645.",
        suggestedCategory: category || "literature"
      };
      if (client) {
        const prompt = `\u062D\u0644\u0644 \u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0627\u0644 \u0648\u0627\u0633\u062A\u062E\u0631\u062C:
1. \u0642\u0627\u0626\u0645\u0629 \u0628\u0640 5 \u0625\u0644\u0649 8 \u0648\u0633\u0648\u0645 (Tags) \u062F\u0642\u064A\u0642\u0629 \u0648\u062C\u0627\u0630\u0628\u0629 \u0644\u0644\u0628\u062D\u062B \u0628\u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 (\u0628\u062F\u0648\u0646 \u0639\u0644\u0627\u0645\u0629 # \u0648\u0628\u062F\u0648\u0646 \u0623\u0631\u0642\u0627\u0645\u060C \u0645\u0641\u0635\u0648\u0644\u0629 \u0628\u0641\u0627\u0635\u0644\u0629).
2. \u0648\u0635\u0641 \u062A\u0639\u0631\u064A\u0641\u064A \u062A\u0633\u0648\u064A\u0642\u064A \u0644\u0644\u0645\u0642\u0627\u0644 (Meta Description) \u0641\u064A \u062D\u062F\u0648\u062F 130-155 \u062D\u0631\u0641\u0627\u064B \u0645\u0644\u0627\u0626\u0645\u0627\u064B \u0644\u0645\u062D\u0631\u0643\u0627\u062A \u0627\u0644\u0628\u062D\u062B.
3. \u0623\u0646\u0633\u0628 \u062A\u0635\u0646\u064A\u0641 \u0631\u0626\u064A\u0633\u064A \u0645\u0646 \u0628\u064A\u0646 \u0647\u0630\u0647 \u0627\u0644\u062A\u0635\u0646\u064A\u0641\u0627\u062A \u062D\u0635\u0631\u0627\u064B: (literature, philosophy, technology, history, science, arts, business, health, politics, education, beauty_fashion, sports, food, travel, family, general).

\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0645\u0642\u0627\u0644: "${title || ""}"
\u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u0642\u0627\u0644: "${(content || "").slice(0, 2e3)}"

\u0623\u0639\u062F \u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u0628\u0635\u064A\u063A\u0629 JSON \u062D\u0635\u0631\u0627\u064B \u0628\u0627\u0644\u0634\u0643\u0644:
{
  "tags": ["\u0648\u0633\u06451", "\u0648\u0633\u06452", "\u0648\u0633\u06453"],
  "metaDescription": "\u0627\u0644\u0648\u0635\u0641 \u0627\u0644\u062A\u0639\u0631\u064A\u0641\u064A \u0647\u0646\u0627",
  "suggestedCategory": "literature"
}`;
        try {
          const response = await client.models.generateContent({
            model: "gemini-3.7-flash",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              maxOutputTokens: 600
            }
          });
          if (response.text) {
            const parsed = JSON.parse(response.text);
            if (Array.isArray(parsed.tags)) seoData.tags = parsed.tags;
            if (parsed.metaDescription) seoData.metaDescription = parsed.metaDescription;
            if (parsed.suggestedCategory) seoData.suggestedCategory = parsed.suggestedCategory;
          }
        } catch (genErr) {
          console.warn("AI SEO generation fallback used:", genErr);
        }
      }
      res.json({
        ...seoData,
        remainingUses: quotaCheck.remaining
      });
    } catch (error) {
      console.error("SEO generator error:", error);
      res.status(500).json({ error: "Failed to generate SEO data" });
    }
  });
  app2.get("/api/payments/status", (req, res) => {
    res.json({
      automated: isPaymentAutomationReady(),
      provider: activeProvider.isConfigured() ? activeProvider.name : null,
      adminConfigured: isAdminConfigured(),
      reason: isPaymentAutomationReady() ? void 0 : getAdminInitError() || "payment_provider_not_configured"
    });
  });
  app2.post("/api/payments/deposit/create-checkout", async (req, res) => {
    if (!requireAutomation(res)) return;
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount < 1 || amount > 5e4) {
        return res.status(400).json({ error: "invalid_amount", message: "\u0627\u0644\u0645\u0628\u0644\u063A \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0628\u064A\u0646 1 \u064850,000$." });
      }
      const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
      const result = await activeProvider.createDepositCheckout({
        uid,
        amount,
        currency: "usd",
        successUrl: `${baseUrl}/?payment=success`,
        cancelUrl: `${baseUrl}/?payment=cancelled`
      });
      res.json(result);
    } catch (err) {
      const status = err?.message === "missing_auth_token" ? 401 : 500;
      console.error("deposit/create-checkout error:", err?.message || err);
      res.status(status).json({ error: "deposit_checkout_failed", message: err?.message || "\u062A\u0639\u0630\u0631 \u0628\u062F\u0621 \u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u0625\u064A\u062F\u0627\u0639." });
    }
  });
  app2.get("/api/payments/nowpayments/status", (req, res) => {
    res.json({
      automated: isNowPaymentsConfigured() && isNowPaymentsIpnConfigured() && isAdminConfigured(),
      configured: isNowPaymentsConfigured()
    });
  });
  app2.post("/api/payments/nowpayments/create-invoice", async (req, res) => {
    if (!isNowPaymentsConfigured() || !isNowPaymentsIpnConfigured() || !isAdminConfigured()) {
      return res.status(503).json({
        error: "nowpayments_not_configured",
        message: "\u0627\u0644\u062F\u0641\u0639 \u0627\u0644\u0641\u0648\u0631\u064A \u0628\u0627\u0644\u0639\u0645\u0644\u0627\u062A \u0627\u0644\u0631\u0642\u0645\u064A\u0629 \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062E\u0627\u062F\u0645 \u0628\u0639\u062F."
      });
    }
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount < 1 || amount > 5e4) {
        return res.status(400).json({ error: "invalid_amount", message: "\u0627\u0644\u0645\u0628\u0644\u063A \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0628\u064A\u0646 1 \u064850,000$." });
      }
      const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
      const result = await createNowPaymentsInvoice({
        uid,
        amount,
        successUrl: `${baseUrl}/?payment=success`,
        cancelUrl: `${baseUrl}/?payment=cancelled`
      });
      res.json({ checkoutUrl: result.invoiceUrl });
    } catch (err) {
      const status = err?.message === "missing_auth_token" ? 401 : 500;
      console.error("nowpayments/create-invoice error:", err?.message || err);
      res.status(status).json({ error: "nowpayments_invoice_failed", message: err?.message || "\u062A\u0639\u0630\u0631 \u0628\u062F\u0621 \u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u062F\u0641\u0639 \u0628\u0627\u0644\u0639\u0645\u0644\u0629 \u0627\u0644\u0631\u0642\u0645\u064A\u0629." });
    }
  });
  app2.post("/api/payments/nowpayments/create-direct-payment", async (req, res) => {
    if (!isNowPaymentsConfigured() || !isNowPaymentsIpnConfigured() || !isAdminConfigured()) {
      return res.status(503).json({
        error: "nowpayments_not_configured",
        message: "\u0627\u0644\u062F\u0641\u0639 \u0627\u0644\u0641\u0648\u0631\u064A \u0628\u0627\u0644\u0639\u0645\u0644\u0627\u062A \u0627\u0644\u0631\u0642\u0645\u064A\u0629 \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062E\u0627\u062F\u0645 \u0628\u0639\u062F."
      });
    }
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount < 1 || amount > 5e4) {
        return res.status(400).json({ error: "invalid_amount", message: "\u0627\u0644\u0645\u0628\u0644\u063A \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0628\u064A\u0646 1 \u064850,000$." });
      }
      const result = await createNowPaymentsDirectPayment({ uid, amount });
      res.json({
        payAddress: result.payAddress,
        payCurrency: result.payCurrency,
        payAmount: result.payAmount
      });
    } catch (err) {
      const status = err?.message === "missing_auth_token" ? 401 : 500;
      console.error("nowpayments/create-direct-payment error:", err?.message || err);
      res.status(status).json({ error: "nowpayments_direct_payment_failed", message: err?.message || "\u062A\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u0639\u0646\u0648\u0627\u0646 \u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u062F\u0641\u0639." });
    }
  });
  app2.get("/api/payments/payout/status", async (req, res) => {
    if (!requireAutomation(res)) return;
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const db = getAdminDb();
      const snap = await db.collection("users").doc(uid).get();
      const accountId = snap.data()?.stripeConnectedAccountId;
      if (!accountId) {
        return res.json({ connected: false, payoutsEnabled: false });
      }
      const status = await activeProvider.getPayoutAccountStatus(accountId);
      res.json(status);
    } catch (err) {
      const status = err?.message === "missing_auth_token" ? 401 : 500;
      res.status(status).json({ error: "status_check_failed", message: err?.message || "\u062A\u0639\u0630\u0631 \u0641\u062D\u0635 \u062D\u0627\u0644\u0629 \u062D\u0633\u0627\u0628 \u0627\u0644\u0633\u062D\u0628." });
    }
  });
  app2.post("/api/payments/payout/connect-link", async (req, res) => {
    if (!requireAutomation(res)) return;
    try {
      const { uid, email } = await verifyRequestAuth(req.headers.authorization);
      const db = getAdminDb();
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        return res.status(404).json({ error: "user_not_found" });
      }
      const existingAccountId = userSnap.data()?.stripeConnectedAccountId;
      const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
      const result = await activeProvider.ensurePayoutAccount({
        uid,
        email,
        existingAccountId,
        refreshUrl: `${baseUrl}/?payoutConnect=refresh`,
        returnUrl: `${baseUrl}/?payoutConnect=done`
      });
      if (result.accountId !== existingAccountId) {
        await userRef.update({ stripeConnectedAccountId: result.accountId });
      }
      res.json(result);
    } catch (err) {
      const status = err?.message === "missing_auth_token" ? 401 : 500;
      console.error("payout/connect-link error:", err?.message || err);
      res.status(status).json({ error: "connect_link_failed", message: err?.message || "\u062A\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u0631\u0627\u0628\u0637 \u0631\u0628\u0637 \u062D\u0633\u0627\u0628 \u0627\u0644\u0633\u062D\u0628." });
    }
  });
  app2.post("/api/payments/payout/create", async (req, res) => {
    if (!requireAutomation(res)) return;
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount < 50) {
        return res.status(400).json({ error: "invalid_amount", message: "\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649 \u0644\u0644\u0633\u062D\u0628 50$." });
      }
      const db = getAdminDb();
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) return res.status(404).json({ error: "user_not_found" });
      const userData = userSnap.data() || {};
      if (userData.kycDetails?.status !== "verified" && !userData.isKycVerified) {
        return res.status(403).json({ error: "kyc_required", message: "\u064A\u062C\u0628 \u0625\u062A\u0645\u0627\u0645 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0647\u0648\u064A\u0629 (KYC) \u0642\u0628\u0644 \u0627\u0644\u0633\u062D\u0628." });
      }
      const accountId = userData.stripeConnectedAccountId;
      if (!accountId) {
        return res.status(409).json({ error: "payout_account_not_connected", message: "\u064A\u062C\u0628 \u0631\u0628\u0637 \u062D\u0633\u0627\u0628 \u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u0623\u0645\u0648\u0627\u0644 \u0623\u0648\u0644\u0627\u064B." });
      }
      const accountStatus = await activeProvider.getPayoutAccountStatus(accountId);
      if (!accountStatus.payoutsEnabled) {
        return res.status(409).json({ error: "payout_account_not_ready", message: "\u062D\u0633\u0627\u0628 \u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u0623\u0645\u0648\u0627\u0644 \u0644\u0645 \u064A\u0643\u062A\u0645\u0644 \u062A\u0641\u0639\u064A\u0644\u0647 \u0628\u0639\u062F." });
      }
      try {
        await db.runTransaction(async (tx) => {
          const freshSnap = await tx.get(userRef);
          if (!freshSnap.exists) throw new Error("user_not_found");
          const freshAvailable = Number(freshSnap.data()?.availableBalance || 0);
          if (amount > freshAvailable) {
            throw new Error("insufficient_balance");
          }
          tx.update(userRef, { availableBalance: Number((freshAvailable - amount).toFixed(2)) });
        });
      } catch (reserveErr) {
        if (reserveErr?.message === "insufficient_balance") {
          return res.status(400).json({ error: "insufficient_balance", message: "\u0627\u0644\u0645\u0628\u0644\u063A \u064A\u062A\u062C\u0627\u0648\u0632 \u0631\u0635\u064A\u062F\u0643 \u0627\u0644\u0645\u062A\u0627\u062D \u0644\u0644\u0633\u062D\u0628." });
        }
        throw reserveErr;
      }
      const payout = await activeProvider.createPayout({ accountId, amount, currency: "usd", uid });
      if (!payout.ok) {
        await userRef.update({ availableBalance: FieldValue.increment(amount) });
        return res.status(502).json({ error: "payout_failed", message: payout.reason || "\u0641\u0634\u0644 \u062A\u0646\u0641\u064A\u0630 \u0627\u0644\u062A\u062D\u0648\u064A\u0644." });
      }
      await db.runTransaction(async (tx) => {
        tx.set(db.collection("payoutRequests").doc(), {
          userId: uid,
          amount,
          method: "stripe",
          status: "completed",
          providerRef: payout.providerRef,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        tx.set(db.collection("notifications").doc(), {
          userId: uid,
          type: "withdrawal",
          title: "\u2705 \u062A\u0645 \u062A\u0646\u0641\u064A\u0630 \u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u0633\u062D\u0628",
          message: `\u062A\u0645 \u062A\u062D\u0648\u064A\u0644 ${amount}$ \u0625\u0644\u0649 \u062D\u0633\u0627\u0628\u0643 \u0627\u0644\u0645\u0631\u062A\u0628\u0637 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B.`,
          isRead: false,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      });
      res.json({ ok: true, providerRef: payout.providerRef });
    } catch (err) {
      const status = err?.message === "missing_auth_token" ? 401 : 500;
      console.error("payout/create error:", err?.message || err);
      res.status(status).json({ error: "payout_create_failed", message: err?.message || "\u062A\u0639\u0630\u0631 \u062A\u0646\u0641\u064A\u0630 \u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u0633\u062D\u0628." });
    }
  });
  const mediaUpload = (0, import_multer.default)({
    storage: import_multer.default.memoryStorage(),
    limits: { fileSize: MAX_VIDEO_BYTES }
  });
  app2.get("/api/media/status", (req, res) => {
    res.json({ configured: isMediaUploadConfigured() });
  });
  app2.post("/api/media/upload", mediaUpload.single("file"), async (req, res) => {
    if (!isMediaUploadConfigured()) {
      return res.status(503).json({
        error: "media_upload_not_configured",
        message: "\u0631\u0641\u0639 \u0627\u0644\u0648\u0633\u0627\u0626\u0637 \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062E\u0627\u062F\u0645 \u0628\u0639\u062F. \u0627\u0633\u062A\u062E\u062F\u0645 \u0631\u0627\u0628\u0637\u0627\u064B \u062E\u0627\u0631\u062C\u064A\u0627\u064B \u0628\u062F\u0644\u0627\u064B \u0645\u0646 \u0630\u0644\u0643."
      });
    }
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "no_file", message: "\u0644\u0645 \u064A\u062A\u0645 \u0625\u0631\u0641\u0627\u0642 \u0623\u064A \u0645\u0644\u0641." });
      }
      const isImage = file.mimetype.startsWith("image/");
      const isVideo = file.mimetype.startsWith("video/");
      if (!isImage && !isVideo) {
        return res.status(400).json({ error: "unsupported_type", message: "\u0646\u0648\u0639 \u0627\u0644\u0645\u0644\u0641 \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645. \u0627\u0633\u062A\u062E\u062F\u0645 \u0635\u0648\u0631\u0629 \u0623\u0648 \u0641\u064A\u062F\u064A\u0648." });
      }
      if (isImage && file.size > MAX_IMAGE_BYTES) {
        return res.status(400).json({ error: "file_too_large", message: "\u062D\u062C\u0645 \u0627\u0644\u0635\u0648\u0631\u0629 \u064A\u062A\u062C\u0627\u0648\u0632 8 \u0645\u064A\u063A\u0627\u0628\u0627\u064A\u062A." });
      }
      if (isVideo && file.size > MAX_VIDEO_BYTES) {
        return res.status(400).json({ error: "file_too_large", message: "\u062D\u062C\u0645 \u0627\u0644\u0641\u064A\u062F\u064A\u0648 \u064A\u062A\u062C\u0627\u0648\u0632 50 \u0645\u064A\u063A\u0627\u0628\u0627\u064A\u062A." });
      }
      const purpose = req.body?.purpose === "article" ? "article" : req.body?.purpose === "message" ? "message" : req.body?.purpose === "tweet" ? "tweet" : "ad";
      const folderName = purpose === "article" ? "articles" : purpose === "message" ? "messages" : purpose === "tweet" ? "tweets" : "ads";
      const result = await uploadMediaBuffer(file.buffer, {
        folder: `literium/${folderName}/${uid}`,
        resourceType: isVideo ? "video" : "image",
        maxDurationSeconds: purpose === "article" ? Infinity : purpose === "message" ? 300 : void 0
      });
      res.json(result);
    } catch (err) {
      const status = err?.message === "missing_auth_token" ? 401 : err?.message === "video_too_long" ? 400 : 500;
      const message = err?.message === "video_too_long" ? "\u0645\u062F\u0629 \u0627\u0644\u0641\u064A\u062F\u064A\u0648 \u062A\u062A\u062C\u0627\u0648\u0632 \u0627\u0644\u062F\u0642\u064A\u0642\u0629 \u0627\u0644\u0645\u0633\u0645\u0648\u062D\u0629." : err?.message || "\u062A\u0639\u0630\u0631 \u0631\u0641\u0639 \u0627\u0644\u0645\u0644\u0641.";
      console.error("media/upload error:", err?.message || err);
      res.status(status).json({ error: "upload_failed", message });
    }
  });
  const CLIENT_ERROR_MAX_PER_MINUTE = 40;
  let clientErrorWindowStart = Date.now();
  let clientErrorCountThisWindow = 0;
  app2.post("/api/client-errors/report", async (req, res) => {
    const now = Date.now();
    if (now - clientErrorWindowStart > 6e4) {
      clientErrorWindowStart = now;
      clientErrorCountThisWindow = 0;
    }
    if (clientErrorCountThisWindow >= CLIENT_ERROR_MAX_PER_MINUTE) {
      return res.status(429).json({ ok: false });
    }
    clientErrorCountThisWindow++;
    if (!isAdminConfigured()) {
      return res.json({ ok: true });
    }
    try {
      const { source, message, stack, time, page, userAgent } = req.body || {};
      if (!message || typeof message !== "string") {
        return res.status(400).json({ ok: false });
      }
      await getAdminDb().collection("clientErrorReports").add({
        source: String(source || "unknown").slice(0, 200),
        message: String(message).slice(0, 500),
        stack: String(stack || "").slice(0, 3e3),
        time: String(time || (/* @__PURE__ */ new Date()).toISOString()).slice(0, 40),
        page: String(page || "").slice(0, 300),
        userAgent: String(userAgent || "").slice(0, 300),
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: true });
    }
  });
  app2.get("/api/client-errors/pending", async (req, res) => {
    if (!requireBotsCronSecret(req, res)) return;
    if (!isAdminConfigured()) {
      return res.json({ count: 0, entries: [] });
    }
    try {
      const db = getAdminDb();
      const snap = await db.collection("clientErrorReports").limit(30).get();
      const entries = snap.docs.map((doc) => doc.data());
      await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
      res.json({ count: entries.length, entries });
    } catch (err) {
      res.status(500).json({ count: 0, entries: [], error: err?.message });
    }
  });
  app2.post("/api/kyc/submit", mediaUpload.single("document"), async (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(503).json({ error: "not_configured", message: "\u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0647\u064A\u0623\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u062D\u0627\u0644\u064A\u0627\u064B." });
    }
    if (!isMediaUploadConfigured()) {
      return res.status(503).json({ error: "media_upload_not_configured", message: "\u0631\u0641\u0639 \u0627\u0644\u0645\u0633\u062A\u0646\u062F\u0627\u062A \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062E\u0627\u062F\u0645 \u0628\u0639\u062F." });
    }
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const file = req.file;
      const idType = String(req.body?.idType || "").trim();
      const idNumber = String(req.body?.idNumber || "").trim();
      if (!file) {
        return res.status(400).json({ error: "no_file", message: "\u064A\u0631\u062C\u0649 \u0625\u0631\u0641\u0627\u0642 \u0635\u0648\u0631\u0629 \u0648\u0627\u0636\u062D\u0629 \u0644\u0644\u0648\u062B\u064A\u0642\u0629 \u0627\u0644\u0631\u0633\u0645\u064A\u0629." });
      }
      if (!file.mimetype.startsWith("image/")) {
        return res.status(400).json({ error: "unsupported_type", message: "\u064A\u062C\u0628 \u0623\u0646 \u062A\u0643\u0648\u0646 \u0627\u0644\u0648\u062B\u064A\u0642\u0629 \u0635\u0648\u0631\u0629 (JPG \u0623\u0648 PNG)." });
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return res.status(400).json({ error: "file_too_large", message: "\u062D\u062C\u0645 \u0627\u0644\u0635\u0648\u0631\u0629 \u064A\u062A\u062C\u0627\u0648\u0632 8 \u0645\u064A\u063A\u0627\u0628\u0627\u064A\u062A." });
      }
      if (!idType || !idNumber) {
        return res.status(400).json({ error: "missing_fields", message: "\u064A\u0631\u062C\u0649 \u0625\u062F\u062E\u0627\u0644 \u0646\u0648\u0639 \u0627\u0644\u0648\u062B\u064A\u0642\u0629 \u0648\u0631\u0642\u0645\u0647\u0627." });
      }
      const db = getAdminDb();
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        return res.status(404).json({ error: "user_not_found", message: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u062D\u0633\u0627\u0628\u0643." });
      }
      const userData = userSnap.data();
      const registeredName = userData.fullName || userData.displayName || "";
      const upload = await uploadMediaBuffer(file.buffer, {
        folder: `literium/kyc/${uid}`,
        resourceType: "image",
        type: "authenticated"
      });
      let extractedName = "";
      let matchConfidence = "none";
      let aiReasoning = "\u062A\u0639\u0630\u0631 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062A\u062D\u0644\u064A\u0644 \u0627\u0644\u0622\u0644\u064A \u2014 \u0627\u0644\u0648\u062B\u064A\u0642\u0629 \u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u064A\u062F\u0648\u064A\u0629.";
      const client = getGeminiClient();
      if (client && registeredName) {
        try {
          const base64Data = file.buffer.toString("base64");
          const verificationPrompt = `\u0623\u0646\u062A \u0646\u0638\u0627\u0645 \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0647\u0648\u064A\u0629. \u0633\u0623\u0639\u0631\u0636 \u0639\u0644\u064A\u0643 \u0635\u0648\u0631\u0629 \u0648\u062B\u064A\u0642\u0629 \u0631\u0633\u0645\u064A\u0629 (\u0628\u0637\u0627\u0642\u0629 \u0647\u0648\u064A\u0629 \u0623\u0648 \u062C\u0648\u0627\u0632 \u0633\u0641\u0631 \u0623\u0648 \u0631\u062E\u0635\u0629 \u0642\u064A\u0627\u062F\u0629 \u0623\u0648 \u0633\u062C\u0644 \u062A\u062C\u0627\u0631\u064A)\u060C \u0648\u0645\u0639\u0647\u0627 \u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062C\u064E\u0651\u0644 \u0641\u064A \u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645: "${registeredName}".

\u0627\u0642\u0631\u0623 \u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644 \u0627\u0644\u0645\u0637\u0628\u0648\u0639 \u0639\u0644\u0649 \u0627\u0644\u0648\u062B\u064A\u0642\u0629 \u0628\u062F\u0642\u0629 (\u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0623\u0648 \u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629 \u0643\u0645\u0627 \u0647\u0648 \u0645\u0643\u062A\u0648\u0628)\u060C \u062B\u0645 \u0642\u0627\u0631\u0646\u0647 \u0628\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062C\u064E\u0651\u0644 \u0623\u0639\u0644\u0627\u0647 \u0645\u0639 \u0645\u0631\u0627\u0639\u0627\u0629 \u0627\u0644\u0641\u0631\u0648\u0642 \u0627\u0644\u0637\u0628\u064A\u0639\u064A\u0629 (\u062A\u0631\u062A\u064A\u0628 \u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0623\u0648\u0644/\u0627\u0644\u0623\u062E\u064A\u0631\u060C \u0627\u0644\u0623\u0644\u0642\u0627\u0628\u060C \u0627\u062E\u062A\u0644\u0627\u0641 \u0628\u0633\u064A\u0637 \u0641\u064A \u0627\u0644\u0646\u0642\u062D\u0631\u0629 \u0628\u064A\u0646 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0648\u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629\u060C \u0648\u062C\u0648\u062F/\u063A\u064A\u0627\u0628 \u0627\u0633\u0645 \u0627\u0644\u0623\u0628 \u0623\u0648 \u0627\u0644\u062C\u062F).

\u0623\u062C\u0628 \u062D\u0635\u0631\u0627\u064B \u0628\u0643\u0627\u0626\u0646 JSON \u0635\u0627\u0644\u062D \u0628\u0644\u0627 \u0623\u064A \u0646\u0635 \u0625\u0636\u0627\u0641\u064A \u0642\u0628\u0644\u0647 \u0623\u0648 \u0628\u0639\u062F\u0647\u060C \u0628\u0647\u0630\u0627 \u0627\u0644\u0634\u0643\u0644 \u0628\u0627\u0644\u0636\u0628\u0637:
{"extractedName": "\u0627\u0644\u0627\u0633\u0645 \u0643\u0645\u0627 \u0642\u0631\u0623\u062A\u0647 \u0645\u0646 \u0627\u0644\u0648\u062B\u064A\u0642\u0629\u060C \u0623\u0648 \u0641\u0627\u0631\u063A \u0625\u0646 \u062A\u0639\u0630\u0651\u0631\u062A \u0627\u0644\u0642\u0631\u0627\u0621\u0629", "matchConfidence": "high \u0623\u0648 medium \u0623\u0648 low \u0623\u0648 none", "reasoning": "\u062C\u0645\u0644\u0629 \u0623\u0648 \u062C\u0645\u0644\u062A\u0627\u0646 \u062A\u0634\u0631\u062D\u0627\u0646 \u0642\u0631\u0627\u0631\u0643"}

\u0645\u0639\u0627\u064A\u064A\u0631 \u0627\u0644\u062B\u0642\u0629:
- high: \u0627\u0644\u0627\u0633\u0645\u0627\u0646 \u0645\u062A\u0637\u0627\u0628\u0642\u0627\u0646 \u0628\u0648\u0636\u0648\u062D \u062A\u0627\u0645 (\u062D\u062A\u0649 \u0644\u0648 \u0628\u0627\u062E\u062A\u0644\u0627\u0641 \u062A\u0631\u062A\u064A\u0628 \u0628\u0633\u064A\u0637)
- medium: \u062A\u0634\u0627\u0628\u0647 \u0642\u0648\u064A \u0644\u0643\u0646 \u0644\u064A\u0633 \u062A\u0637\u0627\u0628\u0642\u0627\u064B \u0643\u0627\u0645\u0644\u0627\u064B (\u062D\u0631\u0641 \u0645\u062E\u062A\u0644\u0641\u060C \u0627\u0633\u0645 \u062C\u0632\u0626\u064A)
- low: \u062A\u0634\u0627\u0628\u0647 \u062C\u0632\u0626\u064A \u0641\u0642\u0637 \u0623\u0648 \u0627\u0644\u0635\u0648\u0631\u0629 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D\u0629 \u0628\u0645\u0627 \u064A\u0643\u0641\u064A \u0644\u0644\u062C\u0632\u0645
- none: \u0644\u0627 \u0639\u0644\u0627\u0642\u0629 \u0628\u064A\u0646 \u0627\u0644\u0627\u0633\u0645\u064A\u0646\u060C \u0623\u0648 \u0627\u0644\u0635\u0648\u0631\u0629 \u0644\u064A\u0633\u062A \u0648\u062B\u064A\u0642\u0629 \u0647\u0648\u064A\u0629 \u0623\u0635\u0644\u0627\u064B\u060C \u0623\u0648 \u062A\u0639\u0630\u0651\u0631\u062A \u0642\u0631\u0627\u0621\u062A\u0647\u0627 \u0643\u0644\u064A\u0627\u064B`;
          const response = await client.models.generateContent({
            model: "gemini-3.7-flash",
            contents: {
              parts: [
                { inlineData: { mimeType: file.mimetype, data: base64Data } },
                { text: verificationPrompt }
              ]
            }
          });
          const rawText = (response.text || "").trim();
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            extractedName = String(parsed.extractedName || "").trim();
            const conf = String(parsed.matchConfidence || "").toLowerCase();
            matchConfidence = ["high", "medium", "low", "none"].includes(conf) ? conf : "none";
            aiReasoning = String(parsed.reasoning || "").trim() || aiReasoning;
          }
        } catch (aiErr) {
          console.error("KYC AI verification error:", aiErr?.message || aiErr);
        }
      }
      const decision = matchConfidence === "high" ? "auto_verified" : "pending_review";
      const submittedAt = (/* @__PURE__ */ new Date()).toISOString();
      await db.collection("kycDocuments").doc(uid).set({
        idImagePublicId: upload.publicId,
        idType,
        idNumber,
        extractedName,
        matchConfidence,
        aiReasoning,
        decision,
        submittedAt,
        reviewedAt: decision === "auto_verified" ? submittedAt : null,
        reviewedBy: decision === "auto_verified" ? "ai_auto" : null
      });
      await userRef.update({
        kycDetails: { idType, idNumber, status: decision === "auto_verified" ? "verified" : "pending", submittedAt },
        ...decision === "auto_verified" ? { isKycVerified: true } : {}
      });
      const notifBase = { isRead: false, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
      await db.collection("notifications").add({
        ...notifBase,
        userId: uid,
        type: "system",
        title: decision === "auto_verified" ? "\u062A\u0645 \u062A\u0648\u062B\u064A\u0642 \u0647\u0648\u064A\u062A\u0643 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u2713" : "\u0637\u0644\u0628 \u062A\u0648\u062B\u064A\u0642 \u0627\u0644\u0647\u0648\u064A\u0629 \u0642\u064A\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629",
        message: decision === "auto_verified" ? "\u0637\u0627\u0628\u0642\u062A \u0648\u062B\u064A\u0642\u062A\u0643 \u0627\u0633\u0645 \u062D\u0633\u0627\u0628\u0643 \u0628\u0646\u062C\u0627\u062D\u060C \u0648\u062A\u0645 \u062A\u0648\u062B\u064A\u0642 \u0647\u0648\u064A\u062A\u0643 \u0641\u0648\u0631\u0627\u064B." : "\u0627\u0633\u062A\u0644\u0645\u0646\u0627 \u0648\u062B\u064A\u0642\u062A\u0643 \u0648\u0633\u064A\u0631\u0627\u062C\u0639\u0647\u0627 \u0641\u0631\u064A\u0642 \u0644\u064A\u062A\u064A\u0631\u064A\u0648\u0645 \u064A\u062F\u0648\u064A\u0627\u064B \u062E\u0644\u0627\u0644 24 \u0625\u0644\u0649 48 \u0633\u0627\u0639\u0629."
      });
      if (decision === "pending_review") {
        const adminsSnap = await db.collection("users").where("role", "==", "admin").get();
        await Promise.all(
          adminsSnap.docs.map(
            (adminDoc) => db.collection("notifications").add({
              ...notifBase,
              userId: adminDoc.id,
              actorId: uid,
              type: "system",
              title: "\u0637\u0644\u0628 \u062A\u0648\u062B\u064A\u0642 \u0647\u0648\u064A\u0629 \u062C\u062F\u064A\u062F \u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629",
              message: `\u0642\u062F\u0651\u0645 ${registeredName || "\u0645\u0633\u062A\u062E\u062F\u0645"} \u0648\u062B\u064A\u0642\u0629 \u062A\u0648\u062B\u064A\u0642 \u062A\u062D\u062A\u0627\u062C \u0645\u0631\u0627\u062C\u0639\u0629 \u064A\u062F\u0648\u064A\u0629 (\u062B\u0642\u0629 \u0627\u0644\u0645\u0637\u0627\u0628\u0642\u0629 \u0627\u0644\u0622\u0644\u064A\u0629: ${matchConfidence}).`
            })
          )
        );
      }
      res.json({
        success: true,
        status: decision === "auto_verified" ? "verified" : "pending",
        message: decision === "auto_verified" ? "\u062A\u0645 \u062A\u0648\u062B\u064A\u0642 \u0647\u0648\u064A\u062A\u0643 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0628\u0646\u062C\u0627\u062D \u2713" : "\u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628\u0643 \u0648\u0647\u0648 \u0627\u0644\u0622\u0646 \u0642\u064A\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u064A\u062F\u0648\u064A\u0629."
      });
    } catch (err) {
      if (err?.message === "missing_auth_token") {
        return res.status(401).json({ error: "auth_required", message: "\u064A\u062A\u0637\u0644\u0628 \u0627\u0644\u062A\u0648\u062B\u064A\u0642 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0623\u0648\u0644\u0627\u064B." });
      }
      console.error("KYC submit error:", err?.message || err);
      res.status(500).json({ error: "kyc_submit_failed", message: "\u062A\u0639\u0630\u0631 \u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628 \u0627\u0644\u062A\u0648\u062B\u064A\u0642. \u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u0627\u064B." });
    }
  });
  app2.get("/api/kyc/document/:userId", async (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(503).json({ error: "not_configured" });
    }
    try {
      const { uid } = await verifyRequestAuth(req.headers.authorization);
      const db = getAdminDb();
      const callerSnap = await db.collection("users").doc(uid).get();
      const callerData = callerSnap.exists ? callerSnap.data() : {};
      const isAdminCaller = callerData.role === "admin" || String(callerData.email || "").toLowerCase() === "brnardtsho@gmail.com";
      if (!isAdminCaller) {
        return res.status(403).json({ error: "forbidden", message: "\u0645\u0631\u0627\u062C\u0639\u0629 \u0648\u062B\u0627\u0626\u0642 \u0627\u0644\u062A\u0648\u062B\u064A\u0642 \u0644\u0644\u0623\u062F\u0645\u0646 \u0641\u0642\u0637." });
      }
      const docSnap = await db.collection("kycDocuments").doc(req.params.userId).get();
      if (!docSnap.exists) {
        return res.status(404).json({ error: "not_found", message: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0648\u062B\u064A\u0642\u0629 \u062A\u0648\u062B\u064A\u0642 \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645." });
      }
      const data = docSnap.data();
      const imageUrl = getSignedKycImageUrl(data.idImagePublicId);
      res.json({
        imageUrl,
        idType: data.idType,
        idNumber: data.idNumber,
        extractedName: data.extractedName,
        matchConfidence: data.matchConfidence,
        aiReasoning: data.aiReasoning,
        decision: data.decision,
        submittedAt: data.submittedAt
      });
    } catch (err) {
      if (err?.message === "missing_auth_token") {
        return res.status(401).json({ error: "auth_required" });
      }
      console.error("KYC document fetch error:", err?.message || err);
      res.status(500).json({ error: "fetch_failed", message: "\u062A\u0639\u0630\u0631 \u062C\u0644\u0628 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0648\u062B\u064A\u0642\u0629." });
    }
  });
  app2.get("/api/social/status", (req, res) => {
    res.json({
      telegram: isTelegramVerificationConfigured(),
      youtube: isYoutubeVerificationConfigured()
    });
  });
  app2.post("/api/social/verify-telegram", async (req, res) => {
    if (!isTelegramVerificationConfigured()) {
      return res.status(503).json({
        error: "telegram_not_configured",
        message: "\u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u062A\u064A\u0644\u064A\u062C\u0631\u0627\u0645 \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062E\u0627\u062F\u0645 \u0628\u0639\u062F."
      });
    }
    try {
      const { uid, isAnonymous } = await verifyRequestAuth(req.headers.authorization);
      if (isAnonymous) {
        return res.status(403).json({
          error: "registered_members_only",
          message: "\u064A\u062C\u0628 \u0625\u0646\u0634\u0627\u0621 \u062D\u0633\u0627\u0628 \u0645\u0633\u062C\u064E\u0651\u0644 (\u0648\u0644\u064A\u0633 \u062A\u0635\u0641\u062D\u0627\u064B \u0643\u0632\u0627\u0626\u0631) \u0644\u062A\u0644\u0642\u064A \u0645\u0643\u0627\u0641\u0623\u0629 \u0627\u0644\u062A\u062D\u0642\u0642."
        });
      }
      const { campaignId, widgetData } = req.body || {};
      if (!campaignId || !widgetData) {
        return res.status(400).json({ error: "missing_params" });
      }
      const db = getAdminDb();
      const campaignSnap = await db.collection("campaigns").doc(campaignId).get();
      if (!campaignSnap.exists) {
        return res.status(404).json({ error: "campaign_not_found" });
      }
      const campaign = campaignSnap.data() || {};
      if (campaign.promotionKind !== "telegram" || !campaign.destinationUrl) {
        return res.status(400).json({ error: "not_a_telegram_campaign" });
      }
      const result = await verifyTelegramMembership(widgetData, campaign.destinationUrl);
      let rewarded = false;
      if (result.verified) {
        const rewardResult = await recordVerificationAndReward(campaignId, uid, "telegram", {
          telegramUserId: result.telegramUserId,
          telegramUsername: result.telegramUsername || null
        });
        rewarded = rewardResult.rewarded;
      }
      res.json({ verified: result.verified, rewarded });
    } catch (err) {
      const status = err?.message === "missing_auth_token" ? 401 : 400;
      res.status(status).json({ error: "telegram_verify_failed", message: err?.message || "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0627\u0646\u0636\u0645\u0627\u0645." });
    }
  });
  app2.post("/api/social/verify-youtube", async (req, res) => {
    try {
      const { uid, isAnonymous } = await verifyRequestAuth(req.headers.authorization);
      if (isAnonymous) {
        return res.status(403).json({
          error: "registered_members_only",
          message: "\u064A\u062C\u0628 \u0625\u0646\u0634\u0627\u0621 \u062D\u0633\u0627\u0628 \u0645\u0633\u062C\u064E\u0651\u0644 (\u0648\u0644\u064A\u0633 \u062A\u0635\u0641\u062D\u0627\u064B \u0643\u0632\u0627\u0626\u0631) \u0644\u062A\u0644\u0642\u064A \u0645\u0643\u0627\u0641\u0623\u0629 \u0627\u0644\u062A\u062D\u0642\u0642."
        });
      }
      const { campaignId, accessToken } = req.body || {};
      if (!campaignId || !accessToken) {
        return res.status(400).json({ error: "missing_params" });
      }
      const db = getAdminDb();
      const campaignSnap = await db.collection("campaigns").doc(campaignId).get();
      if (!campaignSnap.exists) {
        return res.status(404).json({ error: "campaign_not_found" });
      }
      const campaign = campaignSnap.data() || {};
      if (campaign.promotionKind !== "youtube" || !campaign.destinationUrl) {
        return res.status(400).json({ error: "not_a_youtube_campaign" });
      }
      const result = await verifyYoutubeSubscription(accessToken, campaign.destinationUrl);
      let rewarded = false;
      if (result.verified) {
        const rewardResult = await recordVerificationAndReward(campaignId, uid, "youtube");
        rewarded = rewardResult.rewarded;
      }
      res.json({ verified: result.verified, rewarded });
    } catch (err) {
      const status = err?.message === "missing_auth_token" ? 401 : 400;
      res.status(status).json({ error: "youtube_verify_failed", message: err?.message || "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643." });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app2.use(vite.middlewares);
  } else {
    let injectOgTags = function(indexPath, pageUrl, title, rawDescription, image, ogType) {
      const safeTitle = escapeHtmlAttr(title || "LITERIUM");
      const cleanDescription = String(rawDescription || "").replace(/\s+/g, " ").trim();
      const description = escapeHtmlAttr(
        cleanDescription.length > 200 ? cleanDescription.slice(0, 197) + "..." : cleanDescription
      );
      const safeImage = image && image.startsWith("http") ? image : null;
      let html = import_fs2.default.readFileSync(indexPath, "utf-8");
      html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${safeTitle} | LITERIUM</title>`);
      html = html.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${description}" />`);
      const ogTags = `
    <meta property="og:type" content="${ogType}" />
    <meta property="og:site_name" content="LITERIUM" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${escapeHtmlAttr(pageUrl)}" />
    ${safeImage ? `<meta property="og:image" content="${escapeHtmlAttr(safeImage)}" />` : ""}
    <meta name="twitter:card" content="${safeImage ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${description}" />
    ${safeImage ? `<meta name="twitter:image" content="${escapeHtmlAttr(safeImage)}" />` : ""}
  </head>`;
      return html.replace("</head>", ogTags);
    };
    const distPath = import_path.default.join(process.cwd(), "dist");
    app2.use(import_express.default.static(distPath, { dotfiles: "allow" }));
    const escapeHtmlAttr = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    app2.get("*", async (req, res) => {
      const indexPath = import_path.default.join(distPath, "index.html");
      try {
        const articleId = typeof req.query.article === "string" ? req.query.article : null;
        const tweetId = typeof req.query.tweet === "string" ? req.query.tweet : null;
        const pageUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
        if (articleId && isAdminConfigured()) {
          const db = getAdminDb();
          const snap = await db.collection("articles").doc(articleId).get();
          if (snap.exists) {
            const art = snap.data() || {};
            const image = typeof art.featuredImage === "string" ? art.featuredImage : null;
            const html = injectOgTags(indexPath, pageUrl, art.title || "LITERIUM", art.description || "", image, "article");
            res.set("Content-Type", "text/html; charset=utf-8");
            return res.send(html);
          }
        }
        if (tweetId && isAdminConfigured()) {
          const db = getAdminDb();
          const snap = await db.collection("tweets").doc(tweetId).get();
          if (snap.exists) {
            const tw = snap.data() || {};
            const title = tw.authorName ? `\u062A\u063A\u0631\u064A\u062F\u0629 ${tw.authorName} \u0639\u0644\u0649 LITERIUM` : "\u062A\u063A\u0631\u064A\u062F\u0629 \u0639\u0644\u0649 LITERIUM";
            const tweetImage = tw.mediaType !== "video" && typeof tw.imageUrl === "string" ? tw.imageUrl : null;
            const html = injectOgTags(indexPath, pageUrl, title, tw.content || "", tweetImage, "website");
            res.set("Content-Type", "text/html; charset=utf-8");
            return res.send(html);
          }
        }
      } catch (err) {
        console.error("OG tag injection error:", err?.message || err);
      }
      res.sendFile(indexPath);
    });
  }
  app2.listen(PORT, "0.0.0.0", () => {
    console.log(`LITERIUM Server running on http://0.0.0.0:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
