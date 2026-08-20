const { Telegraf } = require("telegraf");
const fs = require("fs");
const path = require("path");

// =====================================================
// CONFIG
// =====================================================

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_ID || 0);

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN غير موجود");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// =====================================================
// DATABASE
// =====================================================

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "database.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultDB = {
  groups: {},
  users: {}
};

function loadDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(defaultDB, null, 2),
        "utf8"
      );

      return JSON.parse(JSON.stringify(defaultDB));
    }

    return JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );
  } catch (error) {
    console.error("❌ خطأ في قراءة قاعدة البيانات:", error.message);
    return JSON.parse(JSON.stringify(defaultDB));
  }
}

let db = loadDB();

function saveDB() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(db, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("❌ خطأ في حفظ قاعدة البيانات:", error.message);
  }
}

// =====================================================
// GROUPS
// =====================================================

function getGroup(chatId) {
  const id = String(chatId);

  if (!db.groups[id]) {
    db.groups[id] = {
      title: "",
      users: {},
      warnings: {},
      replies: {},
      settings: {
        protection: true,
        antiSpam: true,
        antiLinks: false,
        welcome: true,
        xp: true,
        games: true,
        autoReplies: true
      },
      gamePoints: {}
    };

    saveDB();
  }

  const group = db.groups[id];

  // توافق مع قاعدة بيانات قديمة
  group.users ||= {};
  group.warnings ||= {};
  group.replies ||= {};
  group.gamePoints ||= {};

  group.settings ||= {};

  group.settings.protection ??= true;
  group.settings.antiSpam ??= true;
  group.settings.antiLinks ??= false;
  group.settings.welcome ??= true;
  group.settings.xp ??= true;
  group.settings.games ??= true;
  group.settings.autoReplies ??= true;

  return group;
}

// =====================================================
// USERS
// =====================================================

function getUser(userId) {
  const id = String(userId);

  if (!db.users[id]) {
    db.users[id] = {
      xp: 0,
      level: 1,
      messages: 0
    };

    saveDB();
  }

  return db.users[id];
}

// =====================================================
// ROLES
// =====================================================

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

function canManage(ctx, role = "مشرف") {
  return (
    rolePower(getRole(ctx)) >=
    rolePower(role)
  );
}

// =====================================================
// TELEGRAM ADMIN
// =====================================================

async function isTelegramAdmin(ctx, userId = null) {
  if (
    !ctx.chat ||
    !["group", "supergroup"].includes(ctx.chat.type)
  ) {
    return false;
  }

  try {
    const id = userId || ctx.from.id;

    const member =
      await ctx.telegram.getChatMember(
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

// =====================================================
// TARGET FROM REPLY
// =====================================================

function getTarget(ctx) {
  const reply = ctx.message?.reply_to_message;

  if (!reply?.from) {
    return null;
  }

  return reply.from;
}

// =====================================================
// XP
// =====================================================

function addXP(userId, amount) {
  const user = getUser(userId);

  user.xp += amount;
  user.messages++;

  let levelUp = false;

  while (user.xp >= user.level * 100) {
    user.xp -= user.level * 100;
    user.level++;
    levelUp = true;
  }

  saveDB();

  return levelUp;
}

// =====================================================
// GAME POINTS
// =====================================================

function addGamePoints(chatId, userId, amount) {
  const group = getGroup(chatId);
  const id = String(userId);

  group.gamePoints[id] =
    (group.gamePoints[id] || 0) + amount;

  saveDB();
}

function getGamePoints(chatId, userId) {
  const group = getGroup(chatId);

  return group.gamePoints[String(userId)] || 0;
}

// =====================================================
// GAME STATE
// =====================================================

const games = new Map();

function getGame(chatId) {
  return games.get(String(chatId));
}

function setGame(chatId, game) {
  games.set(String(chatId), game);
}

function deleteGame(chatId) {
  games.delete(String(chatId));
}

// =====================================================
// SPAM
// =====================================================

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

  const key =
    `${ctx.chat.id}:${ctx.from.id}`;

  const now = Date.now();

  let messages =
    spamMap.get(key) || [];

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

// =====================================================
// LINK PROTECTION
// =====================================================

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

// =====================================================
// START
// =====================================================

bot.start(async ctx => {
  await ctx.reply(
`🤖 أهلاً ${ctx.from.first_name || ""}

مرحبًا بك في DrexChatBot ❤️

بوت شات وإدارة وترفيه متكامل.

📚 /المساعدة
👤 /ملفي
🏆 /رتبتي
🎮 /العاب
⚙️ /الاعدادات`
  );
});

// =====================================================
// HELP
// =====================================================

bot.command("المساعدة", async ctx => {
  await ctx.reply(
`📚 أوامر DrexChatBot

👤 الأعضاء

/ملفي
/رتبتي
/المتصدرين
/نقاطي
/نقاط_الالعاب

🎮 الألعاب

/العاب
/حجر
/خمن
/سؤال
/صح_خطأ
/اسرع
/عملة

💬 الردود

/اضف_رد
/حذف_رد
/الردود
/مسح_الردود

🛡️ الإدارة

/تحذير
/تحذيرات
/كتم
/فك_كتم
/طرد
/حظر
/فك_حظر

👑 الرتب

/ترقية
/تنزيل

⚙️ الإعدادات

/الاعدادات
/تفعيل
/تعطيل`
  );
});

// =====================================================
// PROFILE
// =====================================================

bot.command("ملفي", async ctx => {
  const user = getUser(ctx.from.id);
  const role = getRole(ctx);

  await ctx.reply(
`👤 ملفك الشخصي

الاسم: ${ctx.from.first_name || "غير معروف"}

👑 الرتبة: ${role}
⭐ المستوى: ${user.level}
✨ XP: ${user.xp}/${user.level * 100}
💬 الرسائل: ${user.messages}`
  );
});

// =====================================================
// RANK
// =====================================================

bot.command("رتبتي", async ctx => {
  const user = getUser(ctx.from.id);

  await ctx.reply(
`🏆 رتبتك

⭐ المستوى: ${user.level}
✨ XP: ${user.xp}/${user.level * 100}
👑 الرتبة: ${getRole(ctx)}`
  );
});

// =====================================================
// TOP
// =====================================================

bot.command("المتصدرين", async ctx => {
  const users =
    Object.entries(db.users)
      .sort((a, b) => {
        const A =
          b[1].level * 1000 +
          b[1].xp;

        const B =
          a[1].level * 1000 +
          a[1].xp;

        return B - A;
      })
      .slice(0, 10);

  if (!users.length) {
    return ctx.reply(
      "📊 لا توجد بيانات حتى الآن."
    );
  }

  let message =
    "🏆 متصدرون الـXP\n\n";

  users.forEach(
    ([id, user], index) => {
      message +=
`#${index + 1} — ID: ${id}
⭐ المستوى: ${user.level}
✨ XP: ${user.xp}

`;
    }
  );

  await ctx.reply(message);
});

// =====================================================
// GAME POINTS
// =====================================================

bot.command("نقاطي", async ctx => {
  const points =
    getGamePoints(
      ctx.chat.id,
      ctx.from.id
    );

  await ctx.reply(
    `🎮 نقاط ألعابك: ${points}`
  );
});

bot.command("نقاط_الالعاب", async ctx => {
  const group =
    getGroup(ctx.chat.id);

  const top =
    Object.entries(
      group.gamePoints
    )
      .sort(
        (a, b) => b[1] - a[1]
      )
      .slice(0, 10);

  if (!top.length) {
    return ctx.reply(
      "🎮 لا توجد نقاط ألعاب حتى الآن."
    );
  }

  let text =
    "🏆 متصدرو الألعاب\n\n";

  top.forEach(
    ([id, points], index) => {
      text +=
        `${index + 1}. ID: ${id} — ${points} نقطة\n`;
    }
  );

  await ctx.reply(text);
});

// =====================================================
// GAMES MENU
// =====================================================

bot.command("العاب", async ctx => {
  const group =
    getGroup(ctx.chat.id);

  if (!group.settings.games) {
    return ctx.reply(
      "🚫 الألعاب متوقفة في هذه المجموعة."
    );
  }

  await ctx.reply(
`🎮 ألعاب Drex

🎯 /خمن
خمن الرقم من 1 إلى 100

✊ /حجر
حجر ورق مقص

🧠 /سؤال
سؤال عام

❓ /صح_خطأ
سؤال صح أو خطأ

⚡ /اسرع
أول شخص يرسل الإجابة يحصل على النقطة

🪙 /عملة
صورة أو كتابة

🏆 /نقاطي
شوف نقاطك

🥇 /نقاط_الالعاب
ترتيب اللاعبين`
  );
});

// =====================================================
// COIN
// =====================================================

bot.command("عملة", async ctx => {
  const result =
    Math.random() < 0.5
      ? "🪙 صورة"
      : "🪙 كتابة";

  addGamePoints(
    ctx.chat.id,
    ctx.from.id,
    1
  );

  await ctx.reply(
    `${result}\n\n🎁 +1 نقطة`
  );
});

// =====================================================
// GUESS NUMBER
// =====================================================

bot.command("خمن", async ctx => {
  const group =
    getGroup(ctx.chat.id);

  if (!group.settings.games) {
    return;
  }

  const number =
    Math.floor(
      Math.random() * 100
    ) + 1;

  setGame(
    ctx.chat.id,
    {
      type: "guess",
      number,
      userId: ctx.from.id
    }
  );

  await ctx.reply(
`🔢 لعبة خمن الرقم

أنا اخترت رقمًا بين 1 و100.

أرسل تخمينك الآن 👇`
  );
});

// =====================================================
// ROCK PAPER SCISSORS
// =====================================================

bot.command("حجر", async ctx => {
  const choices = [
    "حجر",
    "ورق",
    "مقص"
  ];

  const botChoice =
    choices[
      Math.floor(
        Math.random() *
        choices.length
      )
    ];

  const userChoice =
    choices[
      Math.floor(
        Math.random() *
        choices.length
      )
    ];

  let result;

  if (botChoice === userChoice) {
    result = "تعادل 🤝";
  } else if (
    (userChoice === "حجر" &&
      botChoice === "مقص") ||
    (userChoice === "ورق" &&
      botChoice === "حجر") ||
    (userChoice === "مقص" &&
      botChoice === "ورق")
  ) {
    result = "فزت 🎉";

    addGamePoints(
      ctx.chat.id,
      ctx.from.id,
      3
    );
  } else {
    result = "خسرت 😭";
  }

  await ctx.reply(
`✊ حجر ورق مقص

أنت: ${userChoice}
أنا: ${botChoice}

${result}`
  );
});

// =====================================================
// GENERAL QUESTIONS
// =====================================================

const questions = [
  {
    q: "ما عاصمة السعودية؟",
    a: "الرياض"
  },
  {
    q: "ما أكبر كوكب في المجموعة الشمسية؟",
    a: "المشتري"
  },
  {
    q: "كم عدد أيام الأسبوع؟",
    a: "7"
  },
  {
    q: "ما اللغة المستخدمة في هذا البوت؟",
    a: "جافاسكربت"
  },
  {
    q: "كم عدد أشهر السنة؟",
    a: "12"
  }
];

bot.command("سؤال", async ctx => {
  const q =
    questions[
      Math.floor(
        Math.random() *
        questions.length
      )
    ];

  setGame(
    ctx.chat.id,
    {
      type: "question",
      answer:
        q.a.toLowerCase()
    }
  );

  await ctx.reply(
`🧠 سؤال

${q.q}

أول شخص يرسل الإجابة الصحيحة يفوز 🏆`
  );
});

// =====================================================
// TRUE / FALSE
// =====================================================

const trueFalseQuestions = [
  {
    q: "الشمس نجم.",
    a: "صح"
  },
  {
    q: "الأرض أكبر من الشمس.",
    a: "خطأ"
  },
  {
    q: "الماء يتجمد عند درجة صفر مئوية.",
    a: "صح"
  },
  {
    q: "القمر كوكب.",
    a: "خطأ"
  }
];

bot.command("صح_خطأ", async ctx => {
  const q =
    trueFalseQuestions[
      Math.floor(
        Math.random() *
        trueFalseQuestions.length
      )
    ];

  setGame(
    ctx.chat.id,
    {
      type: "truefalse",
      answer:
        q.a.toLowerCase()
    }
  );

  await ctx.reply(
`❓ صح أو خطأ

${q.q}

اكتب: صح أو خطأ`
  );
});

// =====================================================
// FAST ANSWER
// =====================================================

const fastQuestions = [
  {
    q: "اكتب كلمة: دركس",
    a: "دركس"
  },
  {
    q: "اكتب كلمة: تيليجرام",
    a: "تيليجرام"
  },
  {
    q: "اكتب كلمة: بوت",
    a: "بوت"
  },
  {
    q: "اكتب كلمة: لعبة",
    a: "لعبة"
  }
];

bot.command("اسرع", async ctx => {
  const q =
    fastQuestions[
      Math.floor(
        Math.random() *
        fastQuestions.length
      )
    ];

  setGame(
    ctx.chat.id,
    {
      type: "fast",
      answer:
        q.a.toLowerCase()
    }
  );

  await ctx.reply(
`⚡ أسرع إجابة

${q.q}

أول شخص يجاوب صح يحصل على 🏆 5 نقاط!`
  );
});

// =====================================================
// ANSWER GAMES
// =====================================================

bot.on("text", async ctx => {
  const text =
    ctx.message.text
      .trim()
      .toLowerCase();

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

  const game =
    getGame(ctx.chat.id);

  if (!game) {
    return;
  }

  if (game.type === "guess") {
    const guess =
      Number(text);

    if (
      Number.isNaN(guess) ||
      guess < 1 ||
      guess > 100
    ) {
      return;
    }

    if (
      guess === game.number
    ) {
      addGamePoints(
        ctx.chat.id,
        ctx.from.id,
        5
      );

      deleteGame(ctx.chat.id);

      return ctx.reply(
`🎉 فاز ${ctx.from.first_name || "اللاعب"}!

🔢 الرقم كان: ${game.number}

🏆 +5 نقاط`
      );
    }

    if (
      guess < game.number
    ) {
      return ctx.reply(
        "⬆️ أكبر!"
      );
    }

    return ctx.reply(
      "⬇️ أصغر!"
    );
  }

  if (
    ["question", "truefalse", "fast"]
      .includes(game.type)
  ) {
    if (
      text === game.answer
    ) {
      const points =
        game.type === "fast"
          ? 5
          : 3;

      addGamePoints(
        ctx.chat.id,
        ctx.from.id,
        points
      );

      deleteGame(ctx.chat.id);

      return ctx.reply(
`🎉 إجابة صحيحة!

👤 ${ctx.from.first_name || "اللاعب"}
🏆 +${points} نقاط`
      );
    }
  }
});

// =====================================================
// ADD REPLY
// =====================================================

const replySetup = new Map();

bot.command("اضف_رد", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  replySetup.set(
    ctx.from.id,
    {
      chatId: ctx.chat.id,
      step: "word"
    }
  );

  await ctx.reply(
`📝 إضافة رد جديد

أرسل الآن الكلمة التي تريد أن يراقبها البوت.

مثال:
سلام`
  );
});

// =====================================================
// DELETE REPLY
// =====================================================

bot.command("حذف_رد", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  replySetup.set(
    ctx.from.id,
    {
      chatId: ctx.chat.id,
      step: "delete"
    }
  );

  await ctx.reply(
`🗑️ حذف رد

أرسل الكلمة التي تريد حذف ردها.`
  );
});

// =====================================================
// LIST REPLIES
// =====================================================

bot.command("الردود", async ctx => {
  const group =
    getGroup(ctx.chat.id);

  const replies =
    Object.entries(
      group.replies
    );

  if (!replies.length) {
    return ctx.reply(
      "📭 لا توجد ردود مضافة."
    );
  }

  let text =
    "💬 الردود الموجودة:\n\n";

  replies.forEach(
    ([word, response], index) => {
      text +=
`${index + 1}. ${word} ← ${response}\n\n`;
    }
  );

  await ctx.reply(text);
});

// =====================================================
// DELETE ALL REPLIES
// =====================================================

bot.command("مسح_الردود", async ctx => {
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

  group.replies = {};

  saveDB();

  await ctx.reply(
    "🗑️ تم حذف جميع الردود."
  );
});

// =====================================================
// SETTINGS
// =====================================================

bot.command("الاعدادات", async ctx => {
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

  const s =
    group.settings;

  await ctx.reply(
`⚙️ إعدادات المجموعة

🛡️ الحماية:
${s.protection ? "✅ مفعلة" : "❌ متوقفة"}

🚫 منع السبام:
${s.antiSpam ? "✅ مفعل" : "❌ متوقف"}

🔗 منع الروابط:
${s.antiLinks ? "✅ مفعل" : "❌ متوقف"}

👋 الترحيب:
${s.welcome ? "✅ مفعل" : "❌ متوقف"}

⭐ XP:
${s.xp ? "✅ مفعل" : "❌ متوقف"}

🎮 الألعاب:
${s.games ? "✅ مفعلة" : "❌ متوقفة"}

💬 الردود:
${s.autoReplies ? "✅ مفعلة" : "❌ متوقفة"}

لتغيير الإعداد:

/تفعيل الحماية
/تعطيل الحماية

/تفعيل السبام
/تعطيل السبام

/تفعيل الروابط
/تعطيل الروابط

/تفعيل الترحيب
/تعطيل الترحيب

/تفعيل xp
/تعطيل xp

/تفعيل الالعاب
/تعطيل الالعاب

/تفعيل الردود
/تعطيل الردود`
  );
});

// =====================================================
// ENABLE
// =====================================================

bot.command("تفعيل", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const option =
    ctx.message.text
      .split(/\s+/)
      .slice(1)
      .join(" ");

  const group =
    getGroup(ctx.chat.id);

  const map = {
    "الحماية": "protection",
    "السبام": "antiSpam",
    "الروابط": "antiLinks",
    "الترحيب": "welcome",
    "xp": "xp",
    "الالعاب": "games",
    "الردود": "autoReplies"
  };

  if (!map[option]) {
    return ctx.reply(
`❌ اختر إعدادًا صحيحًا:

الحماية
السبام
الروابط
الترحيب
xp
الالعاب
الردود`
    );
  }

  group.settings[
    map[option]
  ] = true;

  saveDB();

  await ctx.reply(
    `✅ تم تفعيل ${option}.`
  );
});

// =====================================================
// DISABLE
// =====================================================

bot.command("تعطيل", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const option =
    ctx.message.text
      .split(/\s+/)
      .slice(1)
      .join(" ");

  const group =
    getGroup(ctx.chat.id);

  const map = {
    "الحماية": "protection",
    "السبام": "antiSpam",
    "الروابط": "antiLinks",
    "الترحيب": "welcome",
    "xp": "xp",
    "الالعاب": "games",
    "الردود": "autoReplies"
  };

  if (!map[option]) {
    return ctx.reply(
      "❌ الإعداد غير موجود."
    );
  }

  group.settings[
    map[option]
  ] = false;

  saveDB();

  await ctx.reply(
    `❌ تم تعطيل ${option}.`
  );
});

// =====================================================
// WARN
// =====================================================

bot.command("تحذير", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مشرف"
    ))
  ) {
    return;
  }

  const target =
    getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد على رسالة العضو."
    );
  }

  const group =
    getGroup(ctx.chat.id);

  const id =
    String(target.id);

  group.warnings[id] =
    (group.warnings[id] || 0) + 1;

  saveDB();

  await ctx.reply(
`⚠️ تم تحذير ${target.first_name || "العضو"}.

عدد التحذيرات:
${group.warnings[id]}`
  );
});

// =====================================================
// WARNINGS
// =====================================================

bot.command("تحذيرات", async ctx => {
  const target =
    getTarget(ctx) ||
    ctx.from;

  const group =
    getGroup(ctx.chat.id);

  const count =
    group.warnings[
      String(target.id)
    ] || 0;

  await ctx.reply(
    `⚠️ تحذيرات ${target.first_name || "العضو"}: ${count}`
  );
});

// =====================================================
// MUTE
// =====================================================

bot.command("كتم", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مشرف"
    ))
  ) {
    return;
  }

  const target =
    getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد."
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
      "❌ تأكد أن البوت مشرف."
    );
  }
});

// =====================================================
// UNMUTE
// =====================================================

bot.command("فك_كتم", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مشرف"
    ))
  ) {
    return;
  }

  const target =
    getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد."
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

// =====================================================
// KICK
// =====================================================

bot.command("طرد", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const target =
    getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد."
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

// =====================================================
// BAN
// =====================================================

bot.command("حظر", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const target =
    getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد."
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

// =====================================================
// UNBAN
// =====================================================

bot.command("فك_حظر", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const target =
    getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد."
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

// =====================================================
// PROMOTE
// =====================================================

bot.command("ترقية", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const target =
    getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد على العضو."
    );
  }

  const role =
    ctx.message.text
      .split(/\s+/)
      .slice(1)
      .join(" ");

  if (
    !assignableRoles.includes(role)
  ) {
    return ctx.reply(
`❌ الرتب المتاحة:

🏅 عضو شرف
🛡️ مشرف
⚡ مدير
🏛️ مؤسس
💎 مالك

مثال:

/ترقية عضو شرف`
    );
  }

  if (
    rolePower(role) >=
    rolePower(getRole(ctx))
  ) {
    return ctx.reply(
      "❌ لا يمكنك إعطاء رتبة مساوية أو أعلى من رتبتك."
    );
  }

  const group =
    getGroup(ctx.chat.id);

  group.users[
    String(target.id)
  ] = {
    role
  };

  saveDB();

  await ctx.reply(
`✅ تمت الترقية

👤 ${target.first_name || "العضو"}
👑 الرتبة: ${role}`
  );
});

// =====================================================
// DEMOTE
// =====================================================

bot.command("تنزيل", async ctx => {
  if (
    !(await requireManagement(
      ctx,
      "مدير"
    ))
  ) {
    return;
  }

  const target =
    getTarget(ctx);

  if (!target) {
    return ctx.reply(
      "↩️ استخدم الأمر بالرد."
    );
  }

  const group =
    getGroup(ctx.chat.id);

  group.users[
    String(target.id)
  ] = {
    role: "عضو"
  };

  saveDB();

  await ctx.reply(
    `↩️ تم تنزيل ${target.first_name || "العضو"} إلى رتبة العضو.`
  );
});

// =====================================================
// WELCOME
// =====================================================

bot.on(
  "new_chat_members",
  async ctx => {
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
`👋 أهلاً وسهلاً

نورتنا ${member.first_name || "يا عضو"} ❤️

استمتع معنا 🤍`
      );
    }
  }
);

// =====================================================
// NORMAL MESSAGES
// =====================================================

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

  // -------------------------------
  // Protection
  // -------------------------------

  if (await checkSpam(ctx)) {
    return;
  }

  if (await checkLinks(ctx)) {
    return;
  }

  const group =
    getGroup(ctx.chat.id);

  // -------------------------------
  // XP
  // -------------------------------

  if (group.settings.xp) {
    const levelUp =
      addXP(
        ctx.from.id,
        Math.floor(
          Math.random() * 6
        ) + 5
      );

    if (levelUp) {
      await ctx.reply(
`🎉 مبروك ${ctx.from.first_name || ""}!

⭐ وصلت إلى مستوى ${getUser(ctx.from.id).level}`
      );
    }
  }

  // -------------------------------
  // Reply setup
  // -------------------------------

  const setup =
    replySetup.get(
      ctx.from.id
    );

  if (
    setup &&
    setup.chatId === ctx.chat.id
  ) {
    // إضافة كلمة
    if (setup.step === "word") {
      setup.word = text;
      setup.step = "response";

      replySetup.set(
        ctx.from.id,
        setup
      );

      return ctx.reply(
`💬 ممتاز.

الآن أرسل الكلام الذي تريد أن يرد به البوت عندما يقول أحد:

"${text}"`
      );
    }

    // إضافة الرد
    if (
      setup.step === "response"
    ) {
      const group =
        getGroup(ctx.chat.id);

      group.replies[
        setup.word
      ] = text;

      saveDB();

      replySetup.delete(
        ctx.from.id
      );

      return ctx.reply(
`✅ تم إضافة الرد بنجاح!

🗣️ الكلمة:
${setup.word}

💬 الرد:
${text}`
      );
    }

    // حذف رد
    if (
      setup.step === "delete"
    ) {
      const group =
        getGroup(ctx.chat.id);

      if (
        !group.replies[text]
      ) {
        replySetup.delete(
          ctx.from.id
        );

        return ctx.reply(
          "❌ ما لقيت رد لهذه الكلمة."
        );
      }

      delete group.replies[
        text
      ];

      saveDB();

      replySetup.delete(
        ctx.from.id
      );

      return ctx.reply(
`🗑️ تم حذف الرد الخاص بـ:

"${text}"`
      );
    }
  }

  // -------------------------------
  // Auto Replies
  // -------------------------------

  if (
    group.settings.autoReplies
  ) {
    const key =
      text.toLowerCase();

    const replies =
      group.replies || {};

    for (
      const [word, response]
      of Object.entries(replies)
    ) {
      if (
        word.toLowerCase() === key
      ) {
        await ctx.reply(response);
        return;
      }
    }
  }
});

// =====================================================
// ERROR HANDLER
// =====================================================

bot.catch(error => {
  console.error(
    "❌ Telegram Bot Error:",
    error
  );
});

// =====================================================
// START
// =====================================================

bot.launch()
  .then(() => {
    console.log(
      "===================================="
    );

    console.log(
      "✅ DrexChatBot يعمل الآن"
    );

    console.log(
      "🤖 Telegram Bot Online"
    );

    console.log(
      "🎮 Games System Online"
    );

    console.log(
      "💬 Auto Replies Online"
    );

    console.log(
      "===================================="
    );
  })
  .catch(error => {
    console.error(
      "❌ فشل تشغيل البوت:",
      error
    );

    process.exit(1);
  });

// =====================================================
// SAFE STOP
// =====================================================

process.once(
  "SIGINT",
  () => bot.stop("SIGINT")
);

process.once(
  "SIGTERM",
  () => bot.stop("SIGTERM")
); 
