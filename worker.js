const MENU = {
  keyboard: [
    [{ text: "🆓 Free Tips" }, { text: "🔒 VIP Tips" }],
    [{ text: "📢 Join Channel" }, { text: "🧾 Send Payment Proof" }],
    [{ text: "🔔 Subscribe" }, { text: "ℹ️ Info" }]
  ],
  resize_keyboard: true
};

const DEFAULTS = {
  freeChannel: "https://t.me/toxicpuntertips",
  contact: "@Olami2501",
  vipInvite: "https://t.me/+w-CG6u7jog42YjY0",
  vipPay:
    "💳 VIP PAYMENT (7 days) — ₦5,000\n\n" +
    "Bank: OPay\n" +
    "Account Name: Lukmon Fatai Olamide",
  welcome:
    "🍊 OrangePark Tips\n" +
    "Choose an option below:"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function tg(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return r.json();
}

function nowSec() { return Math.floor(Date.now() / 1000); }
function isAdmin(env, userId) { return String(userId) === String(env.ADMIN_ID); }
function adminTarget(env) { return env.ADMIN_GROUP_ID ? Number(env.ADMIN_GROUP_ID) : Number(env.ADMIN_ID); }

async function ensureUser(env, userId) {
  const key = `user:${userId}`;
  const existing = await env.CONTENT.get(key);
  if (!existing) {
    await env.CONTENT.put(key, "1");
    const c = Number((await env.CONTENT.get("stats:users")) || "0") + 1;
    await env.CONTENT.put("stats:users", String(c));
  }
}

async function setSubscribed(env, userId, on) {
  const key = `sub:${userId}`;
  if (on) {
    const was = await env.CONTENT.get(key);
    if (!was) {
      await env.CONTENT.put(key, "1");
      const c = Number((await env.CONTENT.get("stats:subs")) || "0") + 1;
      await env.CONTENT.put("stats:subs", String(c));
    }
  } else {
    const was = await env.CONTENT.get(key);
    if (was) {
      await env.CONTENT.delete(key);
      const c = Math.max(0, Number((await env.CONTENT.get("stats:subs")) || "0") - 1);
      await env.CONTENT.put("stats:subs", String(c));
    }
  }
}

async function listSubscribers(env) {
  let cursor = undefined;
  const subs = [];
  for (let i = 0; i < 20; i++) {
    const page = await env.CONTENT.list({ prefix: "sub:", cursor });
    for (const k of page.keys) subs.push(k.name.slice(4));
    if (!page.list_complete) cursor = page.cursor;
    else break;
  }
  return subs;
}

async function broadcast(env, text) {
  const subs = await listSubscribers(env);
  let ok = 0, fail = 0;
  for (const id of subs) {
    const r = await tg(env, "sendMessage", { chat_id: id, text });
    if (r && r.ok) ok++;
    else fail++;
  }
  return { total: subs.length, ok, fail };
}

async function getVipUntil(env, userId) {
  const v = await env.VIP.get(`vip:${userId}`);
  return v ? Number(v) : 0;
}

async function setVipWeek(env, userId) {
  const until = nowSec() + 7 * 24 * 3600;
  await env.VIP.put(`vip:${userId}`, String(until), { expirationTtl: 8 * 24 * 3600 });
  return until;
}

async function getText(env, key, fallback) {
  const v = await env.CONTENT.get(`cfg:${key}`);
  return v || fallback;
}

async function sendMenu(env, chatId) {
  const welcome = await getText(env, "welcome", DEFAULTS.welcome);
  return tg(env, "sendMessage", { chat_id: chatId, text: welcome, reply_markup: MENU });
}

async function handleMessage(env, msg) {
  const chatId = msg.chat.id;
  const fromId = msg.from?.id;
  const text = (msg.text || "").trim();
  if (!fromId) return;

  await ensureUser(env, fromId);

  if (env.LIVE_ALERTS === "1") {
    await tg(env, "sendMessage", {
      chat_id: adminTarget(env),
      text: `👤 Active user: ${fromId}\nText: ${text || "[non-text]"}`.slice(0, 4000)
    });
  }

  if (text === "/start" || text === "/menu") return sendMenu(env, chatId);

  // Admin: set welcome
  if (text.startsWith("/setwelcome ") && isAdmin(env, fromId)) {
    const w = text.slice(12);
    await env.CONTENT.put("cfg:welcome", w);
    return tg(env, "sendMessage", { chat_id: chatId, text: "✅ Welcome message updated." });
  }

  // Admin stats & broadcast
  if (text === "/stats" && isAdmin(env, fromId)) {
    const users = (await env.CONTENT.get("stats:users")) || "0";
    const subs = (await env.CONTENT.get("stats:subs")) || "0";
    return tg(env, "sendMessage", { chat_id: chatId, text: `📊 Stats\nUsers: ${users}\nSubscribers: ${subs}` });
  }

  if (text.startsWith("/broadcast ") && isAdmin(env, fromId)) {
    const msgText = text.slice(11);
    const res = await broadcast(env, msgText);
    return tg(env, "sendMessage", {
      chat_id: chatId,
      text: `📣 Broadcast done\nTotal: ${res.total}\nSent: ${res.ok}\nFailed: ${res.fail}`
    });
  }

  // Admin: set free tips
  if (text.startsWith("/setfree ") && isAdmin(env, fromId)) {
    const tips = text.slice(9);
    await env.CONTENT.put("free_tips", tips);
    return tg(env, "sendMessage", { chat_id: chatId, text: "✅ Free tips updated." });
  }

  // Admin: approve/deny VIP
  if (text.startsWith("/approve ") && isAdmin(env, fromId)) {
    const userId = text.split(/\s+/)[1];
    const until = await setVipWeek(env, userId);
    const vipInvite = env.VIP_CHANNEL_INVITE || DEFAULTS.vipInvite;

    await tg(env, "sendMessage", {
      chat_id: userId,
      text:
        "✅ Payment confirmed!\nVIP activated for 7 days.\n\n" +
        (vipInvite ? ("VIP Channel:\n" + vipInvite) : "")
    });

    return tg(env, "sendMessage", {
      chat_id: chatId,
      text: "Approved " + userId + " until " + new Date(until * 1000).toUTCString()
    });
  }

  if (text.startsWith("/deny ") && isAdmin(env, fromId)) {
    const userId = text.split(/\s+/)[1];
    await tg(env, "sendMessage", { chat_id: userId, text: "❌ Payment not confirmed. Please contact admin." });
    return tg(env, "sendMessage", { chat_id: chatId, text: "Denied " + userId });
  }

  // Payment proof
  if (msg.photo || msg.document) {
    const target = adminTarget(env);

    await tg(env, "forwardMessage", {
      chat_id: target,
      from_chat_id: chatId,
      message_id: msg.message_id
    });

    await tg(env, "sendMessage", {
      chat_id: target,
      text:
        "🧾 Proof received.\nUser ID: " + fromId + "\n\n" +
        "Approve: /approve " + fromId + "\n" +
        "Deny: /deny " + fromId
    });

    return tg(env, "sendMessage", { chat_id: chatId, text: "✅ Proof received. Waiting for confirmation." });
  }

  // Buttons
  if (text === "🆓 Free Tips") {
    const tips = (await env.CONTENT.get("free_tips")) || "No free tips posted yet.";
    return tg(env, "sendMessage", { chat_id: chatId, text: tips });
  }

  if (text === "🔒 VIP Tips") {
    const until = await getVipUntil(env, fromId);
    const vipInvite = env.VIP_CHANNEL_INVITE || DEFAULTS.vipInvite;
    const vipPay = env.VIP_PAYMENT_TEXT || DEFAULTS.vipPay;

    if (until > nowSec()) {
      return tg(env, "sendMessage", {
        chat_id: chatId,
        text:
          "✅ VIP Active\nExpires: " + new Date(until * 1000).toUTCString() + "\n\n" +
          (vipInvite ? ("VIP Channel:\n" + vipInvite) : "")
      });
    }

    return tg(env, "sendMessage", {
      chat_id: chatId,
      text:
        "🔒 VIP locked (7 days access)\n\n" +
        vipPay +
        "\n\nAfter payment, tap 🧾 Send Payment Proof and upload screenshot."
    });
  }

  if (text === "📢 Join Channel") {
    const link = await getText(env, "join", DEFAULTS.freeChannel);
    return tg(env, "sendMessage", { chat_id: chatId, text: "📢 Free channel:\n" + link });
  }

  if (text === "🧾 Send Payment Proof") {
    return tg(env, "sendMessage", { chat_id: chatId, text: "🧾 Upload your payment screenshot (photo or document) here." });
  }

  if (text === "🔔 Subscribe") {
    await setSubscribed(env, fromId, true);
    return tg(env, "sendMessage", { chat_id: chatId, text: "✅ Subscribed.\nTo stop: send /unsub" });
  }

  if (text === "/unsub") {
    await setSubscribed(env, fromId, false);
    return tg(env, "sendMessage", { chat_id: chatId, text: "✅ Unsubscribed." });
  }

  if (text === "ℹ️ Info") {
    const contact = await getText(env, "contact", DEFAULTS.contact);
    const link = await getText(env, "join", DEFAULTS.freeChannel);
    return tg(env, "sendMessage", {
      chat_id: chatId,
      text:
        "ℹ️ OrangePark Tips\n\n" +
        "Contact admin: " + contact + "\n" +
        "Free channel: " + link
    });
  }

  return tg(env, "sendMessage", { chat_id: chatId, text: "Type /menu" });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ ok: true });

    const secret = env.TELEGRAM_SECRET;
    if (secret) {
      const got = request.headers.get("x-telegram-bot-api-secret-token") || "";
      if (got !== secret) return json({ ok: false }, 401);
    }

    const update = await request.json();
    if (update.message) await handleMessage(env, update.message);

    return json({ ok: true });
  }
};
