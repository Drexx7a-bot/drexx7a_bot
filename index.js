const { Telegraf } = require("telegraf");
const fs = require("fs");
const path = require("path");

// =========================
// CONFIG
// =========================

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_ID || 0);

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN غير موجود");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// =========================
// DATABASE
// =========================

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "database.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultDatabase = {
  groups: {},
  users: {}
};

function loadDatabase() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(defaultDatabase, null, 2)
      );

      return JSON.parse(JSON.stringify(defaultDatabase));
    }

    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    console.error("❌ خطأ في قاعدة البيانات:", error.message);

    return JSON.parse(JSON.stringify(defaultDatabase));
  }
}

let db = loadDatabase();

function saveDatabase() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(db, null, 2)
    );
  } catch (error) {
    console.error("❌ فشل حفظ قاعدة البيانات:", error.message);
  }
}

// =========================
// GROUP DATA
// =========================

function getGroup(chatId) {
  const id = String(chatId);

  if (!db.groups[id]) {
    db.groups[id] = {
      title: "",

      settings: {
        protection: true,
        antiSpam: true,
        antiLinks: false,
        welcome: true,
        xp: true
      },

      users: {},
      warnings: {},
      customReplies: {}
    };

    saveDatabase();
  }

  return db.groups[id];
}

// =========================
// USER DATA
// =========================

function getUser(userId) {
  const id = String(userId);

  if (!db.users[id]) {
    db.users[id] = {
      xp: 0,
      level: 1,
      messages: 0
    };

    saveDatabase();
  }

  return db.users[id];
}

// =========================
// ROLES
// =========================

const roles = {
  "عضو": 1,
  "عضو شرف": 2,
  "مشرف": 3,
  "مدير": 4,
  "مؤسس": 5,
  "مالك": 6,
  "المالك الأساسي": 7
};

const assignableRoles = [
  "عضو شرف",
  "مشرف",
  "مدير",
  "مؤسس",
  "مالك"
];

function getRole(ctx) {
  const userId = Number(ctx.from?.id || 0);

  if (OWNER_ID && userId === OWNER_ID) {
    return "المالك الأساسي";
  }

  if (
    !ctx.chat ||
    !["group", "supergroup"].includes(ctx.chat.type)
  ) {
    return "عضو";
  }

  const group = getGroup(ctx.chat.id);

  return group.users[String(userId)]?.role || "عضو";
}

function rolePower(role) {
  return roles[role] || 0;
}

function canManage(ctx, requiredRole = "مشرف") {
  const currentRole = getRole(ctx);

  return (
    rolePower(currentRole) >=
    rolePower(requiredRole)
  );
}

// =========================
// TELEGRAM ADMIN CHECK
// =========================

async function isTelegramAdmin(ctx, userId = null) {
  if (
    !ctx.chat ||
    !["group", "supergroup"].includes(ctx.chat.type)
  ) {
    return false;
  }

  try {
    const id = userId || ctx.from.id;

    const member = await ctx.telegram.getChatMember(
      ctx.chat.id,
      id
    );

    return (
      member.status === "creator" ||
      member.status === "administrator"
    );
  } catch {
    return false;
  }
}

// =========================
// TARGET MEMBER
// =========================

function getTarget(ctx) {
  const reply = ctx.message?.reply_to_message;

  if (!reply || !reply.from) {
    return null;
  }

  return reply.from;
}

// =========================
// XP SYSTEM
// =========================

function addXP(userId, amount) {
  const user = getUser(userId);

  user.xp += amount;
  user.messages++;

  const requiredXP = user.level * 100;

  if (user.xp >= requiredXP) {
    user.xp -= requiredXP;
    user.level++;

    saveDatabase();

    return true;
  }

  saveDatabase();

  return false;
}

// =========================
// SPAM SYSTEM
// =========================

const spamMap = new Map();

async function checkSpam(ctx) {
  if (
    !ctx.chat ||
    !["group", "supergroup"].includes(ctx.chat.type)
  ) {
    return false;
  }

  const group = getGroup(ctx.chat.id);

  if (!group.settings.antiSpam) {
    return false;
  }

  if (
    canManage(ctx, "مشرف") ||
    await isTelegramAdmin(ctx)
  ) {
    return false;
  }

  const key = `${ctx.chat.id}:${ctx.from.id}`;

  const now = Date.now();

  let messages = spamMap.get(key) || [];

  messages = messages.filter(
    time => now - time < 5000
  );

  messages.push(now);

  spamMap.set(key, messages);

  if (messages.length >= 6) {
    try {
      await ctx.deleteMessage();

      await ctx.restrictChatMember(
        ctx.from.id,
        {
          permissions: {
            can_send_messages: false
          }
        }
      );

      await ctx.reply(
        `🔇 تم كتم ${ctx.from.first_name || "العضو"} بسبب السبام.`
      );

      spamMap.delete(key);

      return true;
    } catch {
      return false;
    }
  }

  return false;
}

// =========================
// LINK PROTECTION
// =========================

async function checkLinks(ctx) {
  if (
    !ctx.chat ||
    !["group", "supergroup"].includes(ctx.chat.type)
  ) {
    return false;
  }

  const group = getGroup(ctx.chat.id);

  if (!group.settings.antiLinks) {
    return false;
  }

  if (
    canManage(ctx, "مشرف") ||
    await isTelegramAdmin(ctx)
  ) {
    return false;
  }

  const text =
    ctx.message?.text ||
    ctx.message?.caption ||
    "";

  const linkRegex =
    /(https?:\/\/|www\.|t\.me\/)/i;

  if (linkRegex.test(text)) {
    try {
      await ctx.deleteMessage();

      await ctx.reply(
        "🚫 الروابط ممنوعة في هذه المجموعة."
      );

      return true;
    } catch {
      return false;
    }
  }

  return false;
}

// =========================
// START
// =========================

bot.start(async ctx => {
  await ctx.reply(
`🤖 أهلاً بك في DrexChatBot

بوت شات وإدارة وترفيه متكامل.

📚 /help
👤 /profile
🏆 /rank
🥇 /top
🎮 /games
⚙️ /settings`
  );
});

// =========================
// HELP
// =========================

bot.command("help", async ctx => {
  await ctx.reply(
`📚 أوامر DrexChatBot

👤 الأعضاء
/profile — ملفك الشخصي
/rank — مستواك
/top — المتصدرون

🎮 الترفيه
/roll — رقم عشوائي
/coin — عملة
/quiz — سؤال

🛡️ الإدارة
/warn — تحذير
/warnings — التحذيرات
/mute — كتم
/unmute — فك الكتم
/kick — طرد
/ban — حظر
/unban — فك الحظر

👑 الرتب
/promote — إعطاء رتبة
/demote — إزالة رتبة

⚙️ الإعدادات
/settings — الإعدادات`
  );
});

// =========================
// PROFILE
// =========================

bot.command("profile", async ctx => {
  const user = getUser(ctx.from.id);
  const role = getRole(ctx);

  await ctx.reply(
`👤 الملف الشخصي

الاسم: ${ctx.from.first_name || "غير معروف"}
🪪 الرتبة: ${role}

⭐ المستوى: ${user.level}
✨ XP: ${user.xp}/${user.level * 100}
💬 الرسائل: ${user.messages}`
  );
});

// =========================
// RANK
// =========================

bot.command("rank", async ctx => {
  const user = getUser(ctx.from.id);

  await ctx.reply(
`🏆 رتبتك

⭐ المستوى: ${user.level}
✨ XP: ${user.xp}/${user.level * 100}
💬 الرسائل: ${user.messages}`
  );
});

// =========================
// TOP
// =========================

bot.command("top", async ctx => {
  const users = Object.entries(db.users)
    .sort((a, b) => {
      const scoreA =
        a[1].level * 1000 + a[1].xp;

      const scoreB =
        b[1].level * 1000 + b[1].xp;

      return scoreB - scoreA;
    })
    .slice(0, 10);

  if (!users.length) {
    return ctx.reply(
      "📊 لا توجد بيانات حتى الآن."
    );
  }

  let message = "🏆 أفضل الأعضاء\n\n";

  users.forEach(([id, user], index) => {
    message +=
      `${index + 1}. ID: ${id}\n` +
      `   ⭐ المستوى ${user.level}\n` +
      `   ✨ ${user.xp} XP\n\n`;
  });

  await ctx.reply(message);
});

// =========================
// ROLL
// =========================

bot.command("roll", async ctx => {
  const number =
    Math.floor(Math.random() * 100) + 1;

  await ctx.reply(
    `🎲 رقمك العشوائي: ${number}`
  );
});

// =========================
// COIN
// =========================

bot.command("coin", async ctx => {
  const result =
    Math.random() < 0.5
      ? "صورة"
      : "كتابة";

  await ctx.reply(
    `🪙 النتيجة: ${result}`
  );
});

// =========================
// QUIZ
// =========================

const quizzes = [
  {
    question: "ما عاصمة السعودية؟",
    answer: "الرياض"
  },
  {
    question: "كم عدد أيام الأسبوع؟",
    answer: "7"
  },
  {
    question:
      "ما أكبر كوكب في المجموعة الشمسية؟",
    answer: "المشتري"
  },
  {
    question:
      "ما اللغة التي يستخدمها هذا البوت؟",
    answer: "جافاسكربت"
  }
];

const activeQuizzes = new Map();

bot.command("quiz", async ctx => {
  const quiz =
    quizzes[
      Math.floor(Math.random() * quizzes.length)
    ];

  activeQuizzes.set(
    ctx.chat.id,
    quiz.answer.toLowerCase()
  );

  await ctx.reply(
`🧠 سؤال:

${quiz.question}

اكتب الإجابة في الشات 👇`
  );
});

// =========================
// MANAGEMENT CHECK
// =========================

async function requireManagement(
  ctx,
  role = "مشرف"
) {
  if (
    !ctx.chat ||
    !["group", "supergroup"].includes(
      ctx.chat.type
    )
  ) {
    await ctx.reply(
      "❌ هذا الأمر للمجموعات فقط."
    );

    return false;
  }

  const customPermission =
    canManage(ctx, role);

  const telegramPermission =
    await isTelegramAdmin(ctx);

  if (
    !customPermission &&
    !telegramPermission
  ) {
    await ctx.reply(
      "❌ ما عندك صلاحية لاستخدام هذا الأمر."
    );

    return false;
  }

  return true;
}

// =========================
// WARN
// =========================

bot.command("warn", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مشرف"
    ))
  ) {
    return;
  }

  const target = getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد على رسالة العضو."
    );
  }

  const group = getGroup(ctx.chat.id);

  const id = String(target.id);

  group.warnings[id] =
    (group.warnings[id] || 0) + 1;

  saveDatabase();

  await ctx.reply(
`⚠️ تم تحذير ${target.first_name || "العضو"}.

عدد التحذيرات: ${group.warnings[id]}`
  );
});

// =========================
// WARNINGS
// =========================

bot.command("warnings", async ctx => {
  if (
    !ctx.chat ||
    !["group", "supergroup"].includes(
      ctx.chat.type
    )
  ) {
    return ctx.reply(
      "❌ هذا الأمر للمجموعات فقط."
    );
  }

  const target =
    getTarget(ctx) || ctx.from;

  const group = getGroup(ctx.chat.id);

  const count =
    group.warnings[String(target.id)] || 0;

  await ctx.reply(
`⚠️ تحذيرات ${target.first_name || "العضو"}: ${count}`
  );
});

// =========================
// MUTE
// =========================

bot.command("mute", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مشرف"
    ))
  ) {
    return;
  }

  const target = getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد على رسالة العضو."
    );
  }

  try {
    await ctx.restrictChatMember(
      target.id,
      {
        permissions: {
          can_send_messages: false
        }
      }
    );

    await ctx.reply(
      `🔇 تم كتم ${target.first_name || "العضو"}.`
    );
  } catch {
    await ctx.reply(
      "❌ لم أستطع كتم العضو. تأكد أن البوت مشرف."
    );
  }
});

// =========================
// UNMUTE
// =========================

bot.command("unmute", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مشرف"
    ))
  ) {
    return;
  }

  const target = getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد على رسالة العضو."
    );
  }

  try {
    await ctx.restrictChatMember(
      target.id,
      {
        permissions: {
          can_send_messages: true,
          can_send_audios: true,
          can_send_documents: true,
          can_send_photos: true,
          can_send_videos: true,
          can_send_video_notes: true,
          can_send_voice_notes: true,
          can_send_polls: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true
        }
      }
    );

    await ctx.reply(
      `🔊 تم فك كتم ${target.first_name || "العضو"}.`
    );
  } catch {
    await ctx.reply(
      "❌ لم أستطع فك الكتم."
    );
  }
});

// =========================
// KICK
// =========================

bot.command("kick", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const target = getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد على رسالة العضو."
    );
  }

  try {
    await ctx.banChatMember(
      target.id
    );

    await ctx.unbanChatMember(
      target.id,
      {
        only_if_banned: true
      }
    );

    await ctx.reply(
      `👢 تم طرد ${target.first_name || "العضو"}.`
    );
  } catch {
    await ctx.reply(
      "❌ لم أستطع طرد العضو."
    );
  }
});

// =========================
// BAN
// =========================

bot.command("ban", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const target = getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد على رسالة العضو."
    );
  }

  try {
    await ctx.banChatMember(
      target.id
    );

    await ctx.reply(
      `🚫 تم حظر ${target.first_name || "العضو"}.`
    );
  } catch {
    await ctx.reply(
      "❌ لم أستطع حظر العضو."
    );
  }
});

// =========================
// UNBAN
// =========================

bot.command("unban", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const target = getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد على رسالة العضو."
    );
  }

  try {
    await ctx.unbanChatMember(
      target.id
    );

    await ctx.reply(
      `✅ تم فك حظر ${target.first_name || "العضو"}.`
    );
  } catch {
    await ctx.reply(
      "❌ لم أستطع فك الحظر."
    );
  }
});

// =========================
// PROMOTE
// =========================

bot.command("promote", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const target = getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد على رسالة العضو."
    );
  }

  const parts =
    ctx.message.text
      .trim()
      .split(/\s+/);

  const requestedRole =
    parts.slice(1).join(" ");

  if (
    !assignableRoles.includes(
      requestedRole
    )
  ) {
    return ctx.reply(
`❌ الرتب المتاحة:

🏅 عضو شرف
🛡️ مشرف
⚡ مدير
🏛️ مؤسس
💎 مالك

مثال:
 /promote عضو شرف`
    );
  }

  const myRole = getRole(ctx);

  if (
    rolePower(requestedRole) >=
    rolePower(myRole)
  ) {
    return ctx.reply(
      "❌ لا يمكنك إعطاء رتبة مساوية أو أعلى من رتبتك."
    );
  }

  const group =
    getGroup(ctx.chat.id);

  group.users[String(target.id)] = {
    role: requestedRole
  };

  saveDatabase();

  await ctx.reply(
`✅ تمت الترقية

👤 ${target.first_name || "العضو"}
🏅 الرتبة: ${requestedRole}`
  );
});

// =========================
// DEMOTE
// =========================

bot.command("demote", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const target = getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد على رسالة العضو."
    );
  }

  const targetRole =
    getGroup(ctx.chat.id)
      .users[String(target.id)]
      ?.role || "عضو";

  if (
    rolePower(targetRole) >=
    rolePower(getRole(ctx))
  ) {
    return ctx.reply(
      "❌ لا يمكنك إزالة رتبة أعلى أو مساوية لرتبتك."
    );
  }

  const group =
    getGroup(ctx.chat.id);

  group.users[String(target.id)] = {
    role: "عضو"
  };

  saveDatabase();

  await ctx.reply(
    `↩️ تمت إعادة ${target.first_name || "العضو"} إلى رتبة العضو.`
  );
});

// =========================
// SETTINGS
// =========================

bot.command("settings", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const group =
    getGroup(ctx.chat.id);

  const s = group.settings;

  await ctx.reply(
`⚙️ إعدادات المجموعة

🛡️ الحماية: ${s.protection ? "مفعلة ✅" : "متوقفة ❌"}
🚫 منع السبام: ${s.antiSpam ? "مفعل ✅" : "متوقف ❌"}
🔗 منع الروابط: ${s.antiLinks ? "مفعل ✅" : "متوقف ❌"}
👋 الترحيب: ${s.welcome ? "مفعل ✅" : "متوقف ❌"}
⭐ XP: ${s.xp ? "مفعل ✅" : "متوقف ❌"}

لتغيير الإعداد:

/set protection on
/set antispam on
/set links on
/set welcome on
/set xp on`
  );
});

// =========================
// SET SETTINGS
// =========================

bot.command("set", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const parts =
    ctx.message.text
      .trim()
      .split(/\s+/);

  const option = parts[1];
  const value = parts[2];

  const settingsMap = {
    protection: "protection",
    antispam: "antiSpam",
    links: "antiLinks",
    welcome: "welcome",
    xp: "xp"
  };

  if (
    !settingsMap[option] ||
    !["on", "off"].includes(value)
  ) {
    return ctx.reply(
`❌ الاستخدام الصحيح:

/set protection on
/set antispam on
/set links on
/set welcome on
/set xp on`
    );
  }

  const group =
    getGroup(ctx.chat.id);

  group.settings[
    settingsMap[option]
  ] = value === "on";

  saveDatabase();

  await ctx.reply(
    `✅ تم ${value === "on" ? "تفعيل" : "إيقاف"} الإعداد.`
  );
});

// =========================
// WELCOME
// =========================

bot.on("new_chat_members", async ctx => {
  const group =
    getGroup(ctx.chat.id);

  if (!group.settings.welcome) {
    return;
  }

  for (
    const member of
    ctx.message.new_chat_members
  ) {
    await ctx.reply(
      `👋 أهلاً ${member.first_name || "بك"}!

نورت المجموعة ❤️`
    );
  }
});

// =========================
// TEXT HANDLER
// =========================

bot.on("text", async ctx => {
  const text =
    ctx.message.text.trim();

  if (text.startsWith("/")) {
    return;
  }

  if (
    !ctx.chat ||
    !["group", "supergroup"].includes(
      ctx.chat.type
    )
  ) {
    return;
  }

  // حماية السبام
  if (await checkSpam(ctx)) {
    return;
  }

  // حماية الروابط
  if (await checkLinks(ctx)) {
    return;
  }

  const group =
    getGroup(ctx.chat.id);

  // XP
  if (group.settings.xp) {
    const leveledUp =
      addXP(
        ctx.from.id,
        Math.floor(
          Math.random() * 6
        ) + 5
      );

    if (leveledUp) {
      await ctx.reply(
        `🎉 مبروك ${ctx.from.first_name || ""}!

وصلت إلى المستوى الجديد ⭐`
      );
    }
  }

  // الردود المخصصة
  const lowerText =
    text.toLowerCase();

  const customReplies =
    group.customReplies || {};

  for (
    const [trigger, response]
    of Object.entries(customReplies)
  ) {
    if (
      lowerText ===
      trigger.toLowerCase()
    ) {
      await ctx.reply(response);
      break;
    }
  }

  // إجابة المسابقة
  const quizAnswer =
    activeQuizzes.get(
      ctx.chat.id
    );

  if (
    quizAnswer &&
    lowerText === quizAnswer
  ) {
    activeQuizzes.delete(
      ctx.chat.id
    );

    await ctx.reply(
      `🎉 إجابة صحيحة يا ${ctx.from.first_name || "بطل"}!`
    );
  }
});

// =========================
// BOT ERRORS
// =========================

bot.catch(error => {
  console.error(
    "❌ Bot Error:",
    error
  );
});

// =========================
// START BOT
// =========================

bot.launch()
  .then(() => {
    console.log(
      "================================="
    );

    console.log(
      "✅ DrexChatBot يعمل الآن"
    );

    console.log(
      "🤖 Telegram Bot Online"
    );

    console.log(
      "================================="
    );
  })
  .catch(error => {
    console.error(
      "❌ فشل تشغيل البوت:",
      error
    );

    process.exit(1);
  });

// =========================
// SAFE STOP
// =========================

process.once(
  "SIGINT",
  () => bot.stop("SIGINT")
);

process.once(
  "SIGTERM",
  () => bot.stop("SIGTERM")
);
