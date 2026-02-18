const MENU = {
  keyboard: [
    [{ text: "🆓 Free Tips" }, { text: "🔒 VIP Tips" }],
    [{ text: "📢 Join Channel" }, { text: "🧾 Send Payment Proof" }]
  ],
  resize_keyboard: true,
  one_time_keyboard: false
};

const TEXT = {
  welcome:
    "🍊 *OrangePark Tips*\n" +
    "Your home of smart picks.\n\n" +
    "Choose an option below:",
  payHow:
    "💳 *VIP Payment*\n" +
    "Send payment, then upload a screenshot here.\n\n" +
    "After you send proof, wait for admin confirmation."
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function tg(method, token, payload) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return r.json();
}

function nowSec() { return Math.floor(Date.now() / 1000); }
function isAdmin(env, userId) { return String(userId) === String(env.ADMIN_ID); }

async function getVipUntil(env, userId) {
  const v = await env.VIP.get(`vip:${userId}`);
  return v ? Number(v) : 0;
}
async function setVipWeek(env, userId) {
  const until = nowSec() + 7 * 24 * 3600;
  await env.VIP.put(`vip:${userId}`, String(until), { expirationTtl: 8 * 24 * 3600 });
  return until;
}

async function sendMenu(env, chatId) {
  return tg("sendMessage", env.TELEGRAM_BOT_TOKEN, {
    chat_id: chatId,
    text: TEXT.welcome,
    parse_mode: "Markdown",
    reply_markup: MENU
  });
}

async function handleMessage(env, msg) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = msg.chat.id;
  const fromId = msg.from.id;
  const text = (msg.text || "").trim();

  if (text === "/start" || text === "/menu") {
    return sendMenu(env, chatId);
  }

  if (text === "/myid") {
    return tg("sendMessage", token, { chat_id: chatId, text: `Your ID: ` });
  }

  // Admin commands
  if (text.startsWith("/setfree ") && isAdmin(env, fromId)) {
    const tips = text.replace("/setfree ", "");
    await env.CONTENT.put("free_tips", tips);
    return tg("sendMessage", token, { chat_id: chatId, text: "✅ Free tips updated." });
  }

  if (text.startsWith("/approve ") && isAdmin(env, fromId)) {
    const userId = text.split(/\s+/)[1];
    const until = await setVipWeek(env, userId);
    await tg("sendMessage", token, { chat_id: userId, text: "✅ VIP activated for 7 days." });
    return tg("sendMessage", token, {
      chat_id: chatId,
      text: `Approved ${userId}. VIP until ${new Date(until * 1000).toUTCString()}`
    });
  }

  if (text.startsWith("/deny ") && isAdmin(env, fromId)) {
    const userId = text.split(/\s+/)[1];
    await tg("sendMessage", token, { chat_id: userId, text: "❌ Payment not confirmed. Please contact admin." });
    return tg("sendMessage", token, { chat_id: chatId, text: `Denied ${userId}.` });
  }

  // Payment proof: photo/document
  if (msg.photo || msg.document) {
    await tg("forwardMessage", token, {
      chat_id: env.ADMIN_ID,
      from_chat_id: chatId,
      message_id: msg.message_id
    });
    await tg("sendMessage", token, {
      chat_id: env.ADMIN_ID,
      text: `🧾 Proof received.\nUser ID: ${fromId}\nApprove: /approve ${fromId}\nDeny: /deny ${fromId}`
    });
    return tg("sendMessage", token, { chat_id: chatId, text: "✅ Proof received. Waiting for confirmation." });
  }

  // Menu actions (reply keyboard sends normal text messages)
  if (text === "🆓 Free Tips") {
    const tips = (await env.CONTENT.get("free_tips")) || "No free tips posted yet.";
    return tg("sendMessage", token, { chat_id: chatId, text: tips });
  }

  if (text === "🔒 VIP Tips") {
    const until = await getVipUntil(env, fromId);
    if (until > nowSec()) {
      // VIP channel invite link
      const link = env.VIP_CHANNEL_INVITE || "";
      if (link) {
        return tg("sendMessage", token, {
          chat_id: chatId,
          text: `✅ VIP Active.\nHere is your VIP channel link:\n${link}`
        });
      }
      return tg("sendMessage", token, { chat_id: chatId, text: "✅ VIP Active, but VIP link not configured yet." });
    }
    return tg("sendMessage", token, { chat_id: chatId, text: "🔒 VIP is locked.\n\n" + TEXT.payHow, parse_mode: "Markdown" });
  }

  if (text === "📢 Join Channel") {
    return tg("sendMessage", token, {
      chat_id: chatId,
      text: "📢 Join our free channel:\nhttps://t.me/toxicpuntertips"
    });
  }

  if (text === "🧾 Send Payment Proof") {
    return tg("sendMessage", token, {
      chat_id: chatId,
      text: "🧾 Please upload your payment screenshot (photo or document) in this chat."
    });
  }

  return tg("sendMessage", token, { chat_id: chatId, text: "Type /menu" });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ ok: true });

    const secret = env.TELEGRAM_SECRET;
    if (secret) {
      const got = request.headers.get("x-telegram-bot-api-secret-token") || "";
      if (got !== secret) return json({ ok: false, error: "bad secret" }, 401);
    }

    const update = await request.json();
    if (update.message) await handleMessage(env, update.message);

    return json({ ok: true });
  }
};
