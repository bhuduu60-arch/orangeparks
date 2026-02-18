cd ~/orangeparks

cat > worker.js <<'JS'
const MENU = {
  keyboard: [
    [{ text: "🆓 Free Tips" }, { text: "🔒 VIP Tips" }],
    [{ text: "📢 Join Channel" }, { text: "🧾 Send Payment Proof" }]
  ],
  resize_keyboard: true
};

const FREE_CHANNEL = "https://t.me/toxicpuntertips";

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
  return tg(env, "sendMessage", {
    chat_id: chatId,
    text: "🍊 OrangePark Tips\nChoose an option below:",
    reply_markup: MENU
  });
}

async function handleMessage(env, msg) {
  const chatId = msg.chat.id;
  const fromId = msg.from?.id;
  const text = (msg.text || "").trim();

  if (!fromId) return;

  if (text === "/start" || text === "/menu") return sendMenu(env, chatId);

  // debug/admin helpers
  if (text === "/myid") {
    return tg(env, "sendMessage", { chat_id: chatId, text: "Your ID: " + String(fromId) });
  }
  if (text === "/admincheck") {
    return tg(env, "sendMessage", { chat_id: chatId, text: "fromId=" + String(fromId) + " admin=" + String(env.ADMIN_ID) });
  }

  // ADMIN: set free tips text
  if (text.startsWith("/setfree ") && isAdmin(env, fromId)) {
    const tips = text.slice(9);
    await env.CONTENT.put("free_tips", tips);
    return tg(env, "sendMessage", { chat_id: chatId, text: "✅ Free tips updated." });
  }

  // ADMIN: approve / deny VIP (manual confirmation)
  if (text.startsWith("/approve ") && isAdmin(env, fromId)) {
    const userId = text.split(/\s+/)[1];
    const until = await setVipWeek(env, userId);

    await tg(env, "sendMessage", {
      chat_id: userId,
      text:
        "✅ Payment confirmed!\n" +
        "VIP activated for 7 days.\n\n" +
        (env.VIP_CHANNEL_INVITE ? ("VIP Channel:\n" + env.VIP_CHANNEL_INVITE) : "")
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

  // Payment proof: forward to admin (you)
  if (msg.photo || msg.document) {
    await tg(env, "forwardMessage", {
      chat_id: env.ADMIN_ID,
      from_chat_id: chatId,
      message_id: msg.message_id
    });

    await tg(env, "sendMessage", {
      chat_id: env.ADMIN_ID,
      text:
        "🧾 Proof received.\n" +
        "User ID: " + fromId + "\n\n" +
        "Approve: /approve " + fromId + "\n" +
        "Deny: /deny " + fromId
    });

    return tg(env, "sendMessage", { chat_id: chatId, text: "✅ Proof received. Waiting for confirmation." });
  }

  // Buttons (reply keyboard)
  if (text === "🆓 Free Tips") {
    const tips = (await env.CONTENT.get("free_tips")) || "No free tips posted yet.";
    return tg(env, "sendMessage", { chat_id: chatId, text: tips });
  }

  if (text === "🔒 VIP Tips") {
    const until = await getVipUntil(env, fromId);

    // VIP active
    if (until > nowSec()) {
      const link = env.VIP_CHANNEL_INVITE || "";
      return tg(env, "sendMessage", {
        chat_id: chatId,
        text:
          "✅ VIP Active\n" +
          "Expires: " + new Date(until * 1000).toUTCString() + "\n\n" +
          (link ? ("VIP Channel:\n" + link) : "")
      });
    }

    // VIP locked (show payment info)
    const pay = env.VIP_PAYMENT_TEXT || "Payment details not set yet.";
    return tg(env, "sendMessage", {
      chat_id: chatId,
      text:
        "🔒 VIP locked (7 days access)\n\n" +
        pay +
        "\n\nAfter payment, tap 🧾 Send Payment Proof and upload screenshot."
    });
  }

  if (text === "📢 Join Channel") {
    return tg(env, "sendMessage", { chat_id: chatId, text: "📢 Free channel:\n" + FREE_CHANNEL });
  }

  if (text === "🧾 Send Payment Proof") {
    return tg(env, "sendMessage", {
      chat_id: chatId,
      text: "🧾 Upload your payment screenshot (photo or document) here."
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
JS
