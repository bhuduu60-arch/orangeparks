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
  welcome: "🍊 OrangePark Tips\nChoose an option below:"
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
  for (let i = 0; i < 50; i++) {
    const page = await env.CONTENT.list({ prefix: "sub:", cursor });
    for (const k of page.keys) subs.push(k.name.slice(4));
    if (!page.list_complete) cursor = page.cursor;
    else break;
  }
  return subs;
}

async function broadcastText(env, text) {
  const subs = await listSubscribers(env);
  let ok = 0, fail = 0;
  for (const id of subs) {
    const r = await tg(env, "sendMessage", { chat_id: id, text });
    if (r && r.ok) ok++;
    else fail++;
  }
  return { total: subs.length, ok, fail };
}

async function broadcastPhoto(env, fileId, caption = "") {
  const subs = await listSubscribers(env);
  let ok = 0, fail = 0;
  for (const id of subs) {
    const r = await tg(env, "sendPhoto", { chat_id: id, photo: fileId, caption });
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

async function getCfg(env, key, fallback) {
  const v = await env.CONTENT.get(`cfg:${key}`);
  return v || fallback;
}
async function setCfg(env, key, value) { await env.CONTENT.put(`cfg:${key}`, value); }

function cmdValue(text, cmd) { return text.slice(cmd.length + 2); }

async function sendMenu(env, chatId) {
  const welcome = await getCfg(env, "welcome", DEFAULTS.welcome);
  return tg(env, "sendMessage", { chat_id: chatId, text: welcome, reply_markup: MENU });
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
    const msg = update.message;
    if (!msg) return json({ ok: true });

    const chatId = msg.chat.id;
    const fromId = msg.from?.id;
    const text = (msg.text || "").trim();
    if (!fromId) return json({ ok: true });

    await ensureUser(env, fromId);

    // --- Admin panel commands ---
    if (text === "/start" || text === "/menu") {
      await sendMenu(env, chatId);
      return json({ ok: true });
    }

    if (text.startsWith("/setwelcome ") && isAdmin(env, fromId)) {
      await setCfg(env, "welcome", cmdValue(text, "setwelcome"));
      await tg(env, "sendMessage", { chat_id: chatId, text: "✅ Welcome updated." });
      return json({ ok: true });
    }

    if (text.startsWith("/setjoin ") && isAdmin(env, fromId)) {
      await setCfg(env, "join", cmdValue(text, "setjoin"));
      await tg(env, "sendMessage", { chat_id: chatId, text: "✅ Join link updated." });
      return json({ ok: true });
    }

    if (text.startsWith("/setprice ") && isAdmin(env, fromId)) {
      await setCfg(env, "vipPay", cmdValue(text, "setprice"));
      await tg(env, "sendMessage", { chat_id: chatId, text: "✅ VIP payment text updated." });
      return json({ ok: true });
    }

    if (text.startsWith("/setviplink ") && isAdmin(env, fromId)) {
      await setCfg(env, "vipInvite", cmdValue(text, "setviplink"));
      await tg(env, "sendMessage", { chat_id: chatId, text: "✅ VIP link updated." });
      return json({ ok: true });
    }

    if (text.startsWith("/setcontact ") && isAdmin(env, fromId)) {
      await setCfg(env, "contact", cmdValue(text, "setcontact"));
      await tg(env, "sendMessage", { chat_id: chatId, text: "✅ Contact updated." });
      return json({ ok: true });
    }

    if (text === "/stats" && isAdmin(env, fromId)) {
      const users = (await env.CONTENT.get("stats:users")) || "0";
      const subs = (await env.CONTENT.get("stats:subs")) || "0";
      await tg(env, "sendMessage", { chat_id: chatId, text: `📊 Stats\nUsers: ${users}\nSubscribers: ${subs}` });
      return json({ ok: true });
    }

    if (text.startsWith("/broadcast ") && isAdmin(env, fromId)) {
      const res = await broadcastText(env, text.slice(11));
      await tg(env, "sendMessage", { chat_id: chatId, text: `📣 Broadcast: sent ${res.ok}/${res.total}` });
      return json({ ok: true });
    }

    // ---- NEW: broadcast photo mode ----
    if (text === "/broadcastphoto" && isAdmin(env, fromId)) {
      await env.CONTENT.put("admin:await_photo_broadcast", "1", { expirationTtl: 10 * 60 });
      await tg(env, "sendMessage", { chat_id: chatId, text: "📸 Send the photo now (caption optional). I will broadcast it to subscribers." });
      return json({ ok: true });
    }

    // If admin is in photo-broadcast mode and sends a photo
    if (isAdmin(env, fromId) && msg.photo) {
      const awaiting = await env.CONTENT.get("admin:await_photo_broadcast");
      if (awaiting) {
        // biggest size is last
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const caption = msg.caption || "";
        await env.CONTENT.delete("admin:await_photo_broadcast");

        const res = await broadcastPhoto(env, fileId, caption);
        await tg(env, "sendMessage", { chat_id: chatId, text: `📣 Photo broadcast: sent ${res.ok}/${res.total}` });
        return json({ ok: true });
      }
    }

    // Admin: set free tips
    if (text.startsWith("/setfree ") && isAdmin(env, fromId)) {
      await env.CONTENT.put("free_tips", text.slice(9));
      await tg(env, "sendMessage", { chat_id: chatId, text: "✅ Free tips updated." });
      return json({ ok: true });
    }

    // Admin: approve/deny VIP
    if (text.startsWith("/approve ") && isAdmin(env, fromId)) {
      const userId = text.split(/\s+/)[1];
      const until = await setVipWeek(env, userId);
      const vipInvite = await getCfg(env, "vipInvite", DEFAULTS.vipInvite);

      await tg(env, "sendMessage", {
        chat_id: userId,
        text: "✅ Payment confirmed!\nVIP activated for 7 days.\n\n" + (vipInvite ? ("VIP Channel:\n" + vipInvite) : "")
      });

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: "Approved " + userId + " until " + new Date(until * 1000).toUTCString()
      });
      return json({ ok: true });
    }

    if (text.startsWith("/deny ") && isAdmin(env, fromId)) {
      const userId = text.split(/\s+/)[1];
      await tg(env, "sendMessage", { chat_id: userId, text: "❌ Payment not confirmed. Please contact admin." });
      await tg(env, "sendMessage", { chat_id: chatId, text: "Denied " + userId });
      return json({ ok: true });
    }

    // Payment proof (any user photo/doc)
    if (msg.photo || msg.document) {
      const target = adminTarget(env);
      await tg(env, "forwardMessage", {
        chat_id: target,
        from_chat_id: chatId,
        message_id: msg.message_id
      });
      await tg(env, "sendMessage", {
        chat_id: target,
        text: "🧾 Proof received.\nUser ID: " + fromId + "\n\nApprove: /approve " + fromId + "\nDeny: /deny " + fromId
      });
      await tg(env, "sendMessage", { chat_id: chatId, text: "✅ Proof received. Waiting for confirmation." });
      return json({ ok: true });
    }

    // Buttons
    if (text === "🆓 Free Tips") {
      const tips = (await env.CONTENT.get("free_tips")) || "No free tips posted yet.";
      await tg(env, "sendMessage", { chat_id: chatId, text: tips });
      return json({ ok: true });
    }

    if (text === "🔒 VIP Tips") {
      const until = await getVipUntil(env, fromId);
      const vipInvite = await getCfg(env, "vipInvite", DEFAULTS.vipInvite);
      const vipPay = await getCfg(env, "vipPay", DEFAULTS.vipPay);

      if (until > nowSec()) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: "✅ VIP Active\nExpires: " + new Date(until * 1000).toUTCString() + "\n\n" + (vipInvite ? ("VIP Channel:\n" + vipInvite) : "")
        });
      } else {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: "🔒 VIP locked (7 days access)\n\n" + vipPay + "\n\nAfter payment, tap 🧾 Send Payment Proof and upload screenshot."
        });
      }
      return json({ ok: true });
    }

    if (text === "📢 Join Channel") {
      const link = await getCfg(env, "join", DEFAULTS.freeChannel);
      await tg(env, "sendMessage", { chat_id: chatId, text: "📢 Free channel:\n" + link });
      return json({ ok: true });
    }

    if (text === "🧾 Send Payment Proof") {
      await tg(env, "sendMessage", { chat_id: chatId, text: "🧾 Upload your payment screenshot (photo or document) here." });
      return json({ ok: true });
    }

    if (text === "🔔 Subscribe") {
      await setSubscribed(env, fromId, true);
      await tg(env, "sendMessage", { chat_id: chatId, text: "✅ Subscribed.\nTo stop: send /unsub" });
      return json({ ok: true });
    }

    if (text === "/unsub") {
      await setSubscribed(env, fromId, false);
      await tg(env, "sendMessage", { chat_id: chatId, text: "✅ Unsubscribed." });
      return json({ ok: true });
    }

    if (text === "ℹ️ Info") {
      const contact = await getCfg(env, "contact", DEFAULTS.contact);
      const link = await getCfg(env, "join", DEFAULTS.freeChannel);
      await tg(env, "sendMessage", { chat_id: chatId, text: "ℹ️ OrangePark Tips\n\nContact admin: " + contact + "\nFree channel: " + link });
      return json({ ok: true });
    }

    await tg(env, "sendMessage", { chat_id: chatId, text: "Type /menu" });
    return json({ ok: true });
  }
};
