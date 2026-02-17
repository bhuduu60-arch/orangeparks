const MENU = {
  inline_keyboard: [[
    { text: "Free Tips", callback_data: "FREE" },
    { text: "VIP Tips (Locked)", callback_data: "VIP" }
  ],[
    { text: "Join Channel", callback_data: "JOIN" },
    { text: "Send Payment Proof", callback_data: "PROOF" }
  ]]
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

async function handleMessage(env, msg) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = msg.chat.id;
  const fromId = msg.from.id;
  const text = msg.text || "";

  if (text === "/start" || text === "/menu") {
    return tg("sendMessage", token, {
      chat_id: chatId,
      text: "Welcome to OrangePark Tips.\nChoose an option:",
      reply_markup: MENU
    });
  }

  if (text.startsWith("/approve ") && isAdmin(env, fromId)) {
    const parts = text.trim().split(/\s+/);
    const userId = parts[1];
    if (!userId) {
      return tg("sendMessage", token, { chat_id: chatId, text: "Usage: /approve USER_ID" });
    }
    const until = await setVipWeek(env, userId);
    await tg("sendMessage", token, {
      chat_id: userId,
      text: "Payment confirmed. You are VIP for 7 days."
    });
    return tg("sendMessage", token, {
      chat_id: chatId,
      text: `Approved ${userId}. VIP until ${new Date(until * 1000).toUTCString()}`
    });
  }

  if (text.startsWith("/deny ") && isAdmin(env, fromId)) {
    const parts = text.trim().split(/\s+/);
    const userId = parts[1];
    return tg("sendMessage", token, { chat_id: chatId, text: `Denied ${userId}.` });
  }

  // If user sends photo as proof: forward to admin and tell them their user id.
  if (msg.photo) {
    await tg("forwardMessage", token, {
      chat_id: env.ADMIN_ID,
      from_chat_id: chatId,
      message_id: msg.message_id
    });
    await tg("sendMessage", token, {
      chat_id: env.ADMIN_ID,
      text:
        `Payment proof received.\nUser ID: ${fromId}\nReply with:\n/approve ${fromId}\nor\n/deny ${fromId}`
    });
    return tg("sendMessage", token, {
      chat_id: chatId,
      text: "Proof received. Waiting for confirmation."
    });
  }

  return tg("sendMessage", token, {
    chat_id: chatId,
    text: "Type /menu to see options."
  });
}

async function handleCallback(env, cb) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const data = cb.data;
  const chatId = cb.message.chat.id;
  const userId = cb.from.id;

  // remove loading spinner
  await tg("answerCallbackQuery", token, { callback_query_id: cb.id });

  if (data === "JOIN") {
    return tg("sendMessage", token, {
      chat_id: chatId,
      text: "Join our free channel:\nhttps://t.me/toxicpuntertips"
    });
  }

  if (data === "FREE") {
    const tips = (await env.CONTENT.get("free_tips")) || "No free tips posted yet.";
    return tg("sendMessage", token, { chat_id: chatId, text: tips });
  }

  if (data === "VIP") {
    const until = await getVipUntil(env, userId);
    if (until > nowSec()) {
      const vip = (await env.CONTENT.get("vip_tips")) || "No VIP tips posted yet.";
      return tg("sendMessage", token, { chat_id: chatId, text: vip });
    }
    return tg("sendMessage", token, {
      chat_id: chatId,
      text:
        "VIP is locked.\nSend payment, then tap 'Send Payment Proof' and upload screenshot."
    });
  }

  if (data === "PROOF") {
    return tg("sendMessage", token, {
      chat_id: chatId,
      text: "Upload your payment screenshot here in this chat."
    });
  }

  return tg("sendMessage", token, { chat_id: chatId, text: "Unknown option." });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ ok: true });

    // optional simple secret check for Telegram webhook
    const secret = env.TELEGRAM_SECRET;
    if (secret) {
      const got = request.headers.get("x-telegram-bot-api-secret-token") || "";
      if (got !== secret) return json({ ok: false, error: "bad secret" }, 401);
    }

    const update = await request.json();

    if (update.message) await handleMessage(env, update.message);
    if (update.callback_query) await handleCallback(env, update.callback_query);

    return json({ ok: true });
  }
};
