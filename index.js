const TelegramBot = require("node-telegram-bot-api");
const http = require("http");
const fs = require("fs");

// =====================================================
// CONFIG
// =====================================================

const TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID || "");
const PORT = Number(process.env.PORT) || 10000;

if (!TOKEN) {
  console.error("❌ BOT_TOKEN غير موجود في Environment Variables");
  process.exit(1);
}

if (!OWNER_ID) {
  console.error("❌ OWNER_ID غير موجود في Environment Variables");
  process.exit(1);
}

// =====================================================
// RENDER WEB SERVER
// =====================================================

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("DREX BOT is running");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Server running on port ${PORT}`);
});

// =====================================================
// TELEGRAM
// =====================================================

const bot = new TelegramBot(TOKEN, {
  polling: true
});

console.log("🤖 DREX BOT started");

// =====================================================
// DATABASE
// =====================================================

const DATA_FILE = "./data.json";

let data = {
  groups: {},
  users: {},
  games: {},
  punishments: {}
};

function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(data, null, 2)
    );
  } catch (err) {
    console.error("❌ Database save error:", err.message);
  }
}

if (fs.existsSync(DATA_FILE)) {
  try {
    const saved = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    data = {
      groups: saved.groups || {},
      users: saved.users || {},
      games: saved.games || {},
      punishments: saved.punishments || {}
    };
  } catch {
    console.log("⚠️ Creating new database");
  }
}

// =====================================================
// DEFAULT GROUP
// =====================================================

function getGroup(chatId) {
  const id = String(chatId);

  if (!data.groups[id]) {
    data.groups[id] = {
      antiLink: true,
      antiSwear: true,
      antiFlood: true,
      lockdown: false,
      warningsLimit: 3,
      muteMinutes: 10,
      roles: {}
    };

    saveData();
  }

  return data.groups[id];
}

// =====================================================
// USERS
// =====================================================

function getUser(userId) {
  const id = String(userId);

  if (!data.users[id]) {
    data.users[id] = {
      points: 0,
      xp: 0,
      wins: 0,
      losses: 0,
      games: 0,
      warnings: {},
      daily: null
    };

    saveData();
  }

  return data.users[id];
}

// =====================================================
// HELPERS
// =====================================================

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ًٌٍَُِْـ]/g, "")
    .trim();
}

function mention(user) {
  const name =
    user.first_name ||
    user.username ||
    "العضو";

  return `[${name}](tg://user?id=${user.id})`;
}

function randomItem(array) {
  return array[
    Math.floor(Math.random() * array.length)
  ];
}

function repliedUser(msg) {
  return msg.reply_to_message?.from || null;
}

async function deleteMessage(chatId, messageId) {
  try {
    await bot.deleteMessage(
      chatId,
      messageId
    );
  } catch {}
}

// =====================================================
// TELEGRAM ADMIN CHECK
// =====================================================

async function telegramMember(chatId, userId) {
  try {
    return await bot.getChatMember(
      chatId,
      userId
    );
  } catch {
    return null;
  }
}

async function isTelegramAdmin(chatId, userId) {
  const member =
    await telegramMember(chatId, userId);

  if (!member) return false;

  return (
    member.status === "administrator" ||
    member.status === "creator"
  );
}

// =====================================================
// CUSTOM RANK SYSTEM
// =====================================================

const RANKS = {
  member: 0,
  admin: 1,
  manager: 2,
  owner: 3,
  founder: 4,
  main_owner: 5
};

const RANK_NAMES = {
  member: "عضو",
  admin: "أدمن",
  manager: "مدير",
  owner: "مالك",
  founder: "مؤسس",
  main_owner: "مالك أساسي"
};

function getRank(chatId, userId) {
  if (String(userId) === OWNER_ID) {
    return "main_owner";
  }

  const group = getGroup(chatId);

  return (
    group.roles[String(userId)] ||
    "member"
  );
}

function rankLevel(rank) {
  return RANKS[rank] ?? 0;
}

function rankName(rank) {
  return (
    RANK_NAMES[rank] ||
    "عضو"
  );
}

function canManageRank(chatId, actorId, targetId, newRank) {
  const actorRank =
    getRank(chatId, actorId);

  const targetRank =
    getRank(chatId, targetId);

  if (
    rankLevel(actorRank) <=
    rankLevel(targetRank)
  ) {
    return false;
  }

  if (
    rankLevel(actorRank) <=
    rankLevel(newRank)
  ) {
    return false;
  }

  return true;
}

// =====================================================
// PERMISSION SYSTEM
// =====================================================

function hasPermission(chatId, userId, permission) {
  const rank =
    getRank(chatId, userId);

  const permissions = {
    admin: [
      "warn",
      "mute",
      "unmute",
      "kick",
      "view"
    ],

    manager: [
      "warn",
      "mute",
      "unmute",
      "kick",
      "ban",
      "unban",
      "protection",
      "lockdown",
      "view"
    ],

    owner: [
      "warn",
      "mute",
      "unmute",
      "kick",
      "ban",
      "unban",
      "protection",
      "lockdown",
      "roles",
      "view"
    ],

    founder: [
      "warn",
      "mute",
      "unmute",
      "kick",
      "ban",
      "unban",
      "protection",
      "lockdown",
      "roles",
      "view"
    ],

    main_owner: [
      "warn",
      "mute",
      "unmute",
      "kick",
      "ban",
      "unban",
      "protection",
      "lockdown",
      "roles",
      "view"
    ]
  };

  return (
    permissions[rank] || []
  ).includes(permission);
}

async function requirePermission(
  msg,
  permission
) {
  if (
    String(msg.from.id) === OWNER_ID
  ) {
    return true;
  }

  if (
    msg.chat.type === "private"
  ) {
    await bot.sendMessage(
      msg.chat.id,
      "❌ هذا الأمر للقروبات فقط."
    );

    return false;
  }

  if (
    !hasPermission(
      msg.chat.id,
      msg.from.id,
      permission
    )
  ) {
    await bot.sendMessage(
      msg.chat.id,
      "❌ ما عندك صلاحية لهذا الأمر."
    );

    return false;
  }

  return true;
}

// =====================================================
// MODERATION
// =====================================================

async function muteUser(
  chatId,
  userId,
  minutes
) {
  try {
    const until =
      Math.floor(Date.now() / 1000) +
      minutes * 60;

    await bot.restrictChatMember(
      chatId,
      userId,
      {
        until_date: until,
        permissions: {
          can_send_messages: false,
          can_send_audios: false,
          can_send_documents: false,
          can_send_photos: false,
          can_send_videos: false,
          can_send_video_notes: false,
          can_send_voice_notes: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false
        }
      }
    );

    return true;
  } catch (err) {
    console.error(
      "Mute error:",
      err.message
    );

    return false;
  }
}

async function unmuteUser(
  chatId,
  userId
) {
  try {
    await bot.restrictChatMember(
      chatId,
      userId,
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

    return true;
  } catch {
    return false;
  }
}

async function banUser(
  chatId,
  userId
) {
  try {
    await bot.banChatMember(
      chatId,
      userId
    );

    return true;
  } catch {
    return false;
  }
}

async function unbanUser(
  chatId,
  userId
) {
  try {
    await bot.unbanChatMember(
      chatId,
      userId,
      {
        only_if_banned: true
      }
    );

    return true;
  } catch {
    return false;
  }
}

async function kickUser(
  chatId,
  userId
) {
  try {
    await bot.banChatMember(
      chatId,
      userId
    );

    await bot.unbanChatMember(
      chatId,
      userId
    );

    return true;
  } catch {
    return false;
  }
}

// =====================================================
// PROMOTE TELEGRAM ADMIN
// =====================================================

async function promoteTelegramAdmin(
  chatId,
  userId
) {
  try {
    await bot.promoteChatMember(
      chatId,
      userId,
      {
        can_manage_chat: true,
        can_delete_messages: true,
        can_manage_video_chats: true,
        can_restrict_members: true,
        can_promote_members: false,
        can_change_info: false,
        can_invite_users: true,
        can_pin_messages: true,
        can_manage_topics: true,
        can_post_messages: true,
        can_edit_messages: true
      }
    );

    return true;
  } catch (err) {
    console.error(
      "Promote error:",
      err.message
    );

    return false;
  }
}

async function demoteTelegramAdmin(
  chatId,
  userId
) {
  try {
    await bot.promoteChatMember(
      chatId,
      userId,
      {
        can_manage_chat: false,
        can_delete_messages: false,
        can_manage_video_chats: false,
        can_restrict_members: false,
        can_promote_members: false,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
        can_manage_topics: false,
        can_post_messages: false,
        can_edit_messages: false
      }
    );

    return true;
  } catch {
    return false;
  }
}

// =====================================================
// AUTO REPLIES
// =====================================================

const AUTO_REPLIES = [
  {
    words: [
      "السلام عليكم",
      "سلام عليكم",
      "السلامعليكم"
    ],
    replies: [
      "وعليكم السلام ورحمة الله وبركاته 🌹",
      "وعليكم السلام يا الغالي 🤍",
      "وعليكم السلام ورحمة الله وبركاته ❤️"
    ]
  },

  {
    words: [
      "بوت",
      "يا بوت",
      "يالبوت",
      "البوت"
    ],
    replies: [
      "سمّ؟ 👀",
      "معك يا بعدي 🤖",
      "هلا، وش تبي؟ 😂",
      "أمرني 😎",
      "نعم؟ أنا موجود 😂"
    ]
  },

  {
    words: [
      "هلا",
      "هلا والله"
    ],
    replies: [
      "هلا والله 🔥",
      "ياهلا وغلا 🤍",
      "هلااا 😎",
      "يا مرحبا 🌹"
    ]
  },

  {
    words: [
      "كيفك",
      "شلونك",
      "شخبارك",
      "وش اخبارك"
    ],
    replies: [
      "بخير دامك بخير 🤍",
      "تمام التمام 😎",
      "بخير، وأنت وش أخبارك؟ 👀",
      "عايشين ونراقب الوضع 😂"
    ]
  },

  {
    words: [
      "شكرا",
      "شكراً",
      "مشكور",
      "يعطيك العافية"
    ],
    replies: [
      "العفو يا بطل 🤍",
      "ولو 🌹",
      "تستاهل أكثر 🔥",
      "العفو، هذا واجبي 😎"
    ]
  },

  {
    words: [
      "كفو",
      "كفوو"
    ],
    replies: [
      "الكفو أنت 🔥",
      "كفوك الطيب 🤍",
      "ونعم فيك 😎"
    ]
  },

  {
    words: [
      "منور",
      "منورين"
    ],
    replies: [
      "بنورك يا الغالي 🤍",
      "النور نورك 🌹",
      "منور بأهله 😎"
    ]
  },

  {
    words: [
      "هههه",
      "ههههه",
      "هههههه",
      "هههههههه"
    ],
    replies: [
      "وش اللي يضحك؟ 😂",
      "ضحكتك معدية 😂",
      "ههههههههههههه 😭",
      "أهم شيء انبسطت 😂🔥"
    ]
  },

  {
    words: [
      "طفشان",
      "ملل",
      "طفش"
    ],
    replies: [
      "تعال العب 🎮",
      "اكتب /games وشوف الألعاب 😂",
      "الملل ممنوع هنا 🔥",
      "قم العب وخلك رايق 😎"
    ]
  },

  {
    words: [
      "صباح الخير"
    ],
    replies: [
      "صباح النور والسرور ☀️🤍",
      "صباحك جميل يا بطل 🌹",
      "صباح الخير والنشاط 🔥"
    ]
  },

  {
    words: [
      "تصبح على خير"
    ],
    replies: [
      "وأنت من أهله 🌙🤍",
      "تصبح على خير يا الغالي ❤️",
      "أحلام سعيدة 😴🌙"
    ]
  }
];

// =====================================================
// PROTECTION
// =====================================================

const BAD_WORDS = [
  "كلمة_مسيئة_1",
  "كلمة_مسيئة_2",
  "كلمة_مسيئة_3"
];

// عدّل القائمة لاحقًا للكلمات التي تريد منعها.

const floodMap = new Map();

function containsLink(text) {
  return /(https?:\/\/|www\.|t\.me\/)/i.test(
    text || ""
  );
}

function containsBadWord(text) {
  if (!text) return false;

  const cleanText =
    normalize(text)
      .replace(/[\s_\-*.]+/g, "");

  return BAD_WORDS.some(word => {
    const cleanWord =
      normalize(word)
        .replace(/[\s_\-*.]+/g, "");

    return cleanText.includes(
      cleanWord
    );
  });
}

async function protection(msg) {
  if (!msg.chat || !msg.from) {
    return false;
  }

  if (
    msg.chat.type === "private"
  ) {
    return false;
  }

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (
    String(userId) === OWNER_ID
  ) {
    return false;
  }

  if (
    await isTelegramAdmin(
      chatId,
      userId
    )
  ) {
    return false;
  }

  const settings =
    getGroup(chatId);

  const text =
    msg.text ||
    msg.caption ||
    "";

  // LOCKDOWN
  if (settings.lockdown) {
    await deleteMessage(
      chatId,
      msg.message_id
    );

    return true;
  }

  // ANTI LINK
  if (
    settings.antiLink &&
    containsLink(text)
  ) {
    await deleteMessage(
      chatId,
      msg.message_id
    );

    await bot.sendMessage(
      chatId,
      `🔗 ${mention(msg.from)}\nممنوع إرسال الروابط.`,
      {
        parse_mode: "Markdown"
      }
    );

    return true;
  }

  // ANTI SWEAR
  if (
    settings.antiSwear &&
    containsBadWord(text)
  ) {
    await deleteMessage(
      chatId,
      msg.message_id
    );

    const user =
      getUser(userId);

    if (
      !user.warnings[chatId]
    ) {
      user.warnings[chatId] = 0;
    }

    user.warnings[chatId]++;

    const warnings =
      user.warnings[chatId];

    saveData();

    await bot.sendMessage(
      chatId,
      `🤬 ${mention(msg.from)}\n⚠️ تحذير ${warnings}/${settings.warningsLimit}`,
      {
        parse_mode: "Markdown"
      }
    );

    if (
      warnings >=
      settings.warningsLimit
    ) {
      await muteUser(
        chatId,
        userId,
        settings.muteMinutes
      );

      user.warnings[chatId] = 0;

      saveData();

      await bot.sendMessage(
        chatId,
        `🔇 تم كتم ${mention(msg.from)} لمدة ${settings.muteMinutes} دقائق.`,
        {
          parse_mode: "Markdown"
        }
      );
    }

    return true;
  }

  // ANTI FLOOD
  if (settings.antiFlood) {
    const key =
      `${chatId}:${userId}`;

    const now = Date.now();

    if (!floodMap.has(key)) {
      floodMap.set(key, []);
    }

    const messages =
      floodMap.get(key);

    messages.push(now);

    while (
      messages.length &&
      now - messages[0] > 5000
    ) {
      messages.shift();
    }

    if (messages.length >= 7) {
      floodMap.delete(key);

      await deleteMessage(
        chatId,
        msg.message_id
      );

      const muted =
        await muteUser(
          chatId,
          userId,
          settings.muteMinutes
        );

      if (muted) {
        await bot.sendMessage(
          chatId,
          `🌊 تم اكتشاف Flood.\n🔇 تم كتم ${mention(msg.from)} لمدة ${settings.muteMinutes} دقائق.`,
          {
            parse_mode: "Markdown"
          }
        );
      }

      return true;
    }
  }

  return false;
}

// =====================================================
// START
// =====================================================

bot.onText(
  /^\/start$/,
  async msg => {
    await bot.sendMessage(
      msg.chat.id,
      `🤖 *DREX BOT*

أهلًا بك 👋

🛡️ حماية متقدمة
🎮 ألعاب فردية وجماعية
🏆 XP ونقاط
👑 نظام رتب
👮 إدارة القروب
🤖 ردود تلقائية

اكتب /help لمعرفة الأوامر.`,
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// HELP
// =====================================================

bot.onText(
  /^\/help$/,
  async msg => {
    await bot.sendMessage(
      msg.chat.id,
      `📚 *أوامر DREX*

🛡️ الحماية:
/antilink on
/antilink off
/antiswear on
/antiswear off
/antiflood on
/antiflood off
/lockdown
/unlockdown

👮 الإدارة:
/warn
/unwarn
/warnings
/mute
/unmute
/ban
/unban
/kick

👑 الرتب:
رفع مشرف
تنزيل مشرف
رفع ادمن
رفع مدير
رفع مالك
رفع مؤسس
تنزيل رتبة
/roles

🎮 الألعاب:
/games
/guess
/rps حجر
/rps ورق
/rps مقص
/duel

🏆 الحساب:
/profile
/balance
/daily
/top

⚙️ الإعدادات:
/settings`,
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// SETTINGS
// =====================================================

function registerToggle(
  command,
  property
) {
  bot.onText(
    new RegExp(
      `^\\/${command} (on|off)$`,
      "i"
    ),
    async msg => {
      if (
        !(await requirePermission(
          msg,
          "protection"
        ))
      ) {
        return;
      }

      const value =
        msg.text
          .toLowerCase()
          .endsWith("on");

      getGroup(
        msg.chat.id
      )[property] = value;

      saveData();

      await bot.sendMessage(
        msg.chat.id,
        `✅ ${command}: ${
          value
            ? "🟢 ON"
            : "🔴 OFF"
        }`
      );
    }
  );
}

registerToggle(
  "antilink",
  "antiLink"
);

registerToggle(
  "antiswear",
  "antiSwear"
);

registerToggle(
  "antiflood",
  "antiFlood"
);

// =====================================================
// SETTINGS VIEW
// =====================================================

bot.onText(
  /^\/settings$/,
  async msg => {
    if (
      !(await requirePermission(
        msg,
        "view"
      ))
    ) {
      return;
    }

    const s =
      getGroup(msg.chat.id);

    await bot.sendMessage(
      msg.chat.id,
      `⚙️ *إعدادات DREX*

🔗 Anti-Link:
${s.antiLink ? "🟢" : "🔴"}

🤬 Anti-Swear:
${s.antiSwear ? "🟢" : "🔴"}

🌊 Anti-Flood:
${s.antiFlood ? "🟢" : "🔴"}

🚨 Lockdown:
${s.lockdown ? "🔴" : "🟢"}

⚠️ حد التحذيرات:
${s.warningsLimit}

🔇 مدة الكتم:
${s.muteMinutes} دقيقة`,
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// WARN
// =====================================================

bot.onText(
  /^\/warn$/,
  async msg => {
    if (
      !(await requirePermission(
        msg,
        "warn"
      ))
    ) {
      return;
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        "↩️ رد على رسالة العضو واكتب /warn"
      );
    }

    if (
      rankLevel(
        getRank(
          msg.chat.id,
          target.id
        )
      ) >=
      rankLevel(
        getRank(
          msg.chat.id,
          msg.from.id
        )
      )
    ) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ لا يمكنك معاقبة شخص برتبة مساوية أو أعلى."
      );
    }

    const user =
      getUser(target.id);

    if (
      !user.warnings[msg.chat.id]
    ) {
      user.warnings[msg.chat.id] = 0;
    }

    user.warnings[msg.chat.id]++;

    const count =
      user.warnings[msg.chat.id];

    const limit =
      getGroup(
        msg.chat.id
      ).warningsLimit;

    saveData();

    await bot.sendMessage(
      msg.chat.id,
      `⚠️ ${mention(target)}\nالتحذير: ${count}/${limit}`,
      {
        parse_mode: "Markdown"
      }
    );

    if (count >= limit) {
      const minutes =
        getGroup(
          msg.chat.id
        ).muteMinutes;

      await muteUser(
        msg.chat.id,
        target.id,
        minutes
      );

      user.warnings[
        msg.chat.id
      ] = 0;

      saveData();

      await bot.sendMessage(
        msg.chat.id,
        `🔇 تم كتم ${mention(target)} لمدة ${minutes} دقائق.`,
        {
          parse_mode: "Markdown"
        }
      );
    }
  }
);

// =====================================================
// UNWARN
// =====================================================

bot.onText(
  /^\/unwarn$/,
  async msg => {
    if (
      !(await requirePermission(
        msg,
        "warn"
      ))
    ) {
      return;
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        "↩️ رد على العضو واكتب /unwarn"
      );
    }

    const user =
      getUser(target.id);

    user.warnings[
      msg.chat.id
    ] = Math.max(
      0,
      (user.warnings[
        msg.chat.id
      ] || 0) - 1
    );

    saveData();

    await bot.sendMessage(
      msg.chat.id,
      `✅ تم إزالة تحذير من ${mention(target)}.`,
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// WARNINGS
// =====================================================

bot.onText(
  /^\/warnings$/,
  async msg => {
    const target =
      repliedUser(msg) ||
      msg.from;

    const user =
      getUser(target.id);

    const count =
      user.warnings[
        msg.chat.id
      ] || 0;

    await bot.sendMessage(
      msg.chat.id,
      `⚠️ تحذيرات ${mention(target)}: ${count}`,
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// MUTE
// =====================================================

bot.onText(
  /^\/mute(?: (\d+))?$/,
  async (msg, match) => {
    if (
      !(await requirePermission(
        msg,
        "mute"
      ))
    ) {
      return;
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        "↩️ رد على العضو واكتب /mute"
      );
    }

    const actorRank =
      getRank(
        msg.chat.id,
        msg.from.id
      );

    const targetRank =
      getRank(
        msg.chat.id,
        target.id
      );

    if (
      rankLevel(targetRank) >=
      rankLevel(actorRank)
    ) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ لا يمكنك كتم رتبة مساوية أو أعلى."
      );
    }

    const minutes =
      Number(match[1] || 10);

    const ok =
      await muteUser(
        msg.chat.id,
        target.id,
        minutes
      );

    await bot.sendMessage(
      msg.chat.id,
      ok
        ? `🔇 تم كتم ${mention(target)} لمدة ${minutes} دقيقة.`
        : "❌ تعذر تنفيذ الكتم.",
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// UNMUTE
// =====================================================

bot.onText(
  /^\/unmute$/,
  async msg => {
    if (
      !(await requirePermission(
        msg,
        "unmute"
      ))
    ) {
      return;
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        "↩️ رد على العضو واكتب /unmute"
      );
    }

    const ok =
      await unmuteUser(
        msg.chat.id,
        target.id
      );

    await bot.sendMessage(
      msg.chat.id,
      ok
        ? `🔊 تم فك كتم ${mention(target)}.`
        : "❌ تعذر فك الكتم.",
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// BAN
// =====================================================

bot.onText(
  /^\/ban$/,
  async msg => {
    if (
      !(await requirePermission(
        msg,
        "ban"
      ))
    ) {
      return;
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        "↩️ رد على العضو واكتب /ban"
      );
    }

    const actorRank =
      getRank(
        msg.chat.id,
        msg.from.id
      );

    const targetRank =
      getRank(
        msg.chat.id,
        target.id
      );

    if (
      rankLevel(targetRank) >=
      rankLevel(actorRank)
    ) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ لا يمكنك حظر رتبة مساوية أو أعلى."
      );
    }

    const ok =
      await banUser(
        msg.chat.id,
        target.id
      );

    await bot.sendMessage(
      msg.chat.id,
      ok
        ? `🔨 تم حظر ${mention(target)}.`
        : "❌ تعذر تنفيذ الحظر.",
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// UNBAN
// =====================================================

bot.onText(
  /^\/unban$/,
  async msg => {
    if (
      !(await requirePermission(
        msg,
        "ban"
      ))
    ) {
      return;
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        "↩️ رد على العضو واكتب /unban"
      );
    }

    const ok =
      await unbanUser(
        msg.chat.id,
        target.id
      );

    await bot.sendMessage(
      msg.chat.id,
      ok
        ? `✅ تم فك حظر ${mention(target)}.`
        : "❌ تعذر فك الحظر.",
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// KICK
// =====================================================

bot.onText(
  /^\/kick$/,
  async msg => {
    if (
      !(await requirePermission(
        msg,
        "kick"
      ))
    ) {
      return;
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        "↩️ رد على العضو واكتب /kick"
      );
    }

    const actorRank =
      getRank(
        msg.chat.id,
        msg.from.id
      );

    const targetRank =
      getRank(
        msg.chat.id,
        target.id
      );

    if (
      rankLevel(targetRank) >=
      rankLevel(actorRank)
    ) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ لا يمكنك طرد رتبة مساوية أو أعلى."
      );
    }

    const ok =
      await kickUser(
        msg.chat.id,
        target.id
      );

    await bot.sendMessage(
      msg.chat.id,
      ok
        ? `👢 تم طرد ${mention(target)}.`
        : "❌ تعذر تنفيذ الطرد.",
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// LOCKDOWN
// =====================================================

bot.onText(
  /^\/lockdown$/,
  async msg => {
    if (
      !(await requirePermission(
        msg,
        "lockdown"
      ))
    ) {
      return;
    }

    getGroup(
      msg.chat.id
    ).lockdown = true;

    saveData();

    await bot.sendMessage(
      msg.chat.id,
      "🚨 تم تفعيل LOCKDOWN."
    );
  }
);

bot.onText(
  /^\/unlockdown$/,
  async msg => {
    if (
      !(await requirePermission(
        msg,
        "lockdown"
      ))
    ) {
      return;
    }

    getGroup(
      msg.chat.id
    ).lockdown = false;

    saveData();

    await bot.sendMessage(
      msg.chat.id,
      "✅ تم إيقاف LOCKDOWN."
    );
  }
);

// =====================================================
// RANK COMMAND PARSER
// =====================================================

const RANK_COMMANDS = {
  "رفع ادمن": "admin",
  "رفع مدير": "manager",
  "رفع مالك": "owner",
  "رفع مؤسس": "founder"
};

for (const [command, rank] of Object.entries(
  RANK_COMMANDS
)) {
  bot.onText(
    new RegExp(
      `^${command}$`
    ),
    async msg => {
      if (
        !(await requirePermission(
          msg,
          "roles"
        ))
      ) {
        return;
      }

      const target =
        repliedUser(msg);

      if (!target) {
        return bot.sendMessage(
          msg.chat.id,
          `↩️ رد على العضو واكتب:\n${command}`
        );
      }

      if (
        String(target.id) ===
        OWNER_ID
      ) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ هذا هو المالك الأساسي."
        );
      }

      if (
        !canManageRank(
          msg.chat.id,
          msg.from.id,
          target.id,
          rank
        )
      ) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ لا يمكنك إعطاء هذه الرتبة."
        );
      }

      getGroup(
        msg.chat.id
      ).roles[
        String(target.id)
      ] = rank;

      saveData();

      await bot.sendMessage(
        msg.chat.id,
        `✅ تم تعيين رتبة *${rankName(rank)}* لـ ${mention(target)}.`,
        {
          parse_mode: "Markdown"
        }
      );
    }
  );
}

// =====================================================
// REMOVE CUSTOM RANK
// =====================================================

bot.onText(
  /^تنزيل رتبة$/,
  async msg => {
    if (
      !(await requirePermission(
        msg,
        "roles"
      ))
    ) {
      return;
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        "↩️ رد على العضو واكتب: تنزيل رتبة"
      );
    }

    const currentRank =
      getRank(
        msg.chat.id,
        target.id
      );

    if (
      !canManageRank(
        msg.chat.id,
        msg.from.id,
        target.id,
        "member"
      )
    ) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ لا يمكنك تنزيل هذه الرتبة."
      );
    }

    delete getGroup(
      msg.chat.id
    ).roles[
      String(target.id)
    ];

    saveData();

    await bot.sendMessage(
      msg.chat.id,
      `✅ تم تنزيل ${mention(target)} من رتبة ${rankName(currentRank)}.`,
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// TELEGRAM PROMOTE
// =====================================================

bot.onText(
  /^رفع مشرف$/,
  async msg => {
    if (
      !(
        String(msg.from.id) ===
        OWNER_ID
      ) &&
      !(
        getRank(
          msg.chat.id,
          msg.from.id
        ) === "founder" ||
        getRank(
          msg.chat.id,
          msg.from.id
        ) === "owner"
      )
    ) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ المالك أو المؤسس فقط."
      );
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        "↩️ رد على العضو واكتب: رفع مشرف"
      );
    }

    const actorRank =
      getRank(
        msg.chat.id,
        msg.from.id
      );

    const targetRank =
      getRank(
        msg.chat.id,
        target.id
      );

    if (
      rankLevel(targetRank) >=
      rankLevel(actorRank)
    ) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ لا يمكنك إدارة رتبة مساوية أو أعلى."
      );
    }

    const ok =
      await promoteTelegramAdmin(
        msg.chat.id,
        target.id
      );

    await bot.sendMessage(
      msg.chat.id,
      ok
        ? `👮 تم رفع ${mention(target)} مشرفًا في تيليجرام.`
        : "❌ فشل رفع المشرف. تأكد أن البوت لديه صلاحية إضافة مشرفين.",
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// TELEGRAM DEMOTE
// =====================================================

bot.onText(
  /^تنزيل مشرف$/,
  async msg => {
    if (
      !(await requirePermission(
        msg,
        "roles"
      ))
    ) {
      return;
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        "↩️ رد على المشرف واكتب: تنزيل مشرف"
      );
    }

    const actorRank =
      getRank(
        msg.chat.id,
        msg.from.id
      );

    const targetRank =
      getRank(
        msg.chat.id,
        target.id
      );

    if (
      rankLevel(targetRank) >=
      rankLevel(actorRank)
    ) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ لا يمكنك تنزيل رتبة مساوية أو أعلى."
      );
    }

    const ok =
      await demoteTelegramAdmin(
        msg.chat.id,
        target.id
      );

    await bot.sendMessage(
      msg.chat.id,
      ok
        ? `✅ تم تنزيل ${mention(target)} من الإشراف.`
        : "❌ تعذر تنزيل المشرف.",
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// ROLES
// =====================================================

bot.onText(
  /^\/roles$/,
  async msg => {
    const group =
      getGroup(msg.chat.id);

    const entries =
      Object.entries(
        group.roles
      );

    let text =
      "👑 *رتب DREX*\n\n";

    text +=
      `👑 مالك أساسي: ${OWNER_ID}\n\n`;

    if (!entries.length) {
      text +=
        "لا توجد رتب مخصصة حتى الآن.";
    } else {
      for (const [id, rank] of entries) {
        text +=
          `• ${id} — ${rankName(rank)}\n`;
      }
    }

    await bot.sendMessage(
      msg.chat.id,
      text,
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// PROFILE
// =====================================================

bot.onText(
  /^\/profile$/,
  async msg => {
    const user =
      getUser(msg.from.id);

    const rank =
      msg.chat.type === "private"
        ? "member"
        : getRank(
            msg.chat.id,
            msg.from.id
          );

    await bot.sendMessage(
      msg.chat.id,
      `👤 *DREX PROFILE*

👤 ${msg.from.first_name || "عضو"}

👑 الرتبة:
${rankName(rank)}

💰 النقاط:
${user.points}

⭐ XP:
${user.xp}

🏆 الانتصارات:
${user.wins}

❌ الخسائر:
${user.losses}

🎮 الألعاب:
${user.games}`,
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// BALANCE
// =====================================================

bot.onText(
  /^\/balance$/,
  async msg => {
    const user =
      getUser(msg.from.id);

    await bot.sendMessage(
      msg.chat.id,
      `💰 النقاط: ${user.points}\n⭐ XP: ${user.xp}`
    );
  }
);

// =====================================================
// DAILY
// =====================================================

bot.onText(
  /^\/daily$/,
  async msg => {
    const user =
      getUser(msg.from.id);

    const today =
      new Date()
        .toISOString()
        .slice(0, 10);

    if (
      user.daily === today
    ) {
      return bot.sendMessage(
        msg.chat.id,
        "⏳ أخذت مكافأتك اليومية."
      );
    }

    user.daily = today;
    user.points += 250;
    user.xp += 100;

    saveData();

    await bot.sendMessage(
      msg.chat.id,
      "🎁 مكافأتك اليومية!\n\n💰 +250 نقطة\n⭐ +100 XP"
    );
  }
);

// =====================================================
// GUESS GAME
// =====================================================

bot.onText(
  /^\/guess$/,
  async msg => {
    data.games[
      String(msg.from.id)
    ] = {
      type: "guess",
      number:
        Math.floor(
          Math.random() * 10
        ) + 1
    };

    saveData();

    await bot.sendMessage(
      msg.chat.id,
      "🎯 خمن رقمًا من 1 إلى 10.\n\nاكتب:\n/guess 7"
    );
  }
);

bot.onText(
  /^\/guess (\d+)$/,
  async (msg, match) => {
    const game =
      data.games[
        String(msg.from.id)
      ];

    if (
      !game ||
      game.type !== "guess"
    ) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ ابدأ اللعبة بـ /guess"
      );
    }

    const guess =
      Number(match[1]);

    const user =
      getUser(msg.from.id);

    user.games++;

    if (
      guess === game.number
    ) {
      user.wins++;
      user.points += 100;
      user.xp += 50;

      await bot.sendMessage(
        msg.chat.id,
        `🎉 فزت!\n🎯 الرقم: ${game.number}\n💰 +100\n⭐ +50 XP`
      );
    } else {
      user.losses++;

      await bot.sendMessage(
        msg.chat.id,
        `❌ خسرت!\n🎯 الرقم الصحيح: ${game.number}`
      );
    }

    delete data.games[
      String(msg.from.id)
    ];

    saveData();
  }
);

// =====================================================
// ROCK PAPER SCISSORS
// =====================================================

bot.onText(
  /^\/rps (حجر|ورق|مقص)$/,
  async (msg, match) => {
    const choices = [
      "حجر",
      "ورق",
      "مقص"
    ];

    const player =
      match[1];

    const computer =
      randomItem(choices);

    const user =
      getUser(msg.from.id);

    user.games++;

    let result;

    if (
      player === computer
    ) {
      result = "🤝 تعادل!";
    } else if (
      (player === "حجر" &&
        computer === "مقص") ||
      (player === "ورق" &&
        computer === "حجر") ||
      (player === "مقص" &&
        computer === "ورق")
    ) {
      result = "🎉 فزت!";

      user.wins++;
      user.points += 50;
      user.xp += 25;
    } else {
      result = "❌ خسرت!";

      user.losses++;
    }

    saveData();

    await bot.sendMessage(
      msg.chat.id,
      `🎮 *حجر ورق مقص*

👤 أنت: ${player}
🤖 DREX: ${computer}

${result}`,
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// GROUP DUEL
// =====================================================

bot.onText(
  /^\/duel$/,
  async msg => {
    if (
      msg.chat.type ===
      "private"
    ) {
      return;
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        "↩️ رد على العضو واكتب /duel لتحديه."
      );
    }

    if (
      target.id ===
      msg.from.id
    ) {
      return bot.sendMessage(
        msg.chat.id,
        "😂 ما تقدر تتحدى نفسك."
      );
    }

    const key =
      `${msg.chat.id}:duel`;

    data.games[key] = {
      type: "duel",
      chatId: msg.chat.id,
      challenger: msg.from.id,
      target: target.id
    };

    saveData();

    await bot.sendMessage(
      msg.chat.id,
      `⚔️ *تحدي جديد!*

${mention(msg.from)} تحدى ${mention(target)}

إذا موافق، اكتب:
\`/accept\``,
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// ACCEPT DUEL
// =====================================================

bot.onText(
  /^\/accept$/,
  async msg => {
    if (
      msg.chat.type ===
      "private"
    ) {
      return;
    }

    const key =
      `${msg.chat.id}:duel`;

    const game =
      data.games[key];

    if (
      !game ||
      game.type !== "duel"
    ) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ لا يوجد تحدي حالي."
      );
    }

    if (
      String(msg.from.id) !==
      String(game.target)
    ) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ هذا التحدي ليس لك."
      );
    }

    const winner =
      Math.random() < 0.5
        ? game.challenger
        : game.target;

    const loser =
      winner === game.challenger
        ? game.target
        : game.challenger;

    const winnerUser =
      getUser(winner);

    const loserUser =
      getUser(loser);

    winnerUser.games++;
    winnerUser.wins++;
    winnerUser.points += 100;
    winnerUser.xp += 50;

    loserUser.games++;
    loserUser.losses++;

    delete data.games[key];

    saveData();

    let winnerName =
      "الفائز";

    try {
      const member =
        await bot.getChatMember(
          msg.chat.id,
          winner
        );

      winnerName =
        member.user.first_name ||
        winnerName;
    } catch {}

    await bot.sendMessage(
      msg.chat.id,
      `⚔️ *انتهى التحدي!*

🏆 الفائز: ${winnerName}

💰 +100 نقطة
⭐ +50 XP`,
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// GAMES MENU
// =====================================================

bot.onText(
  /^\/games$/,
  async msg => {
    await bot.sendMessage(
      msg.chat.id,
      `🎮 *DREX GAMES*

🎯 ألعاب فردية:
• /guess
• /rps حجر
• /rps ورق
• /rps مقص

👥 ألعاب جماعية:
• رد على شخص واكتب /duel
• اللاعب الآخر يكتب /accept

🏆 الحساب:
• /profile
• /balance
• /daily
• /top`,
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// TOP
// =====================================================

bot.onText(
  /^\/top$/,
  async msg => {
    const top =
      Object.entries(
        data.users
      )
        .map(
          ([id, user]) => ({
            id,
            points:
              user.points || 0
          })
        )
        .sort(
          (a, b) =>
            b.points - a.points
        )
        .slice(0, 10);

    if (!top.length) {
      return bot.sendMessage(
        msg.chat.id,
        "🏆 لا توجد بيانات."
      );
    }

    let text =
      "🏆 *DREX TOP 10*\n\n";

    for (
      let i = 0;
      i < top.length;
      i++
    ) {
      text +=
        `${i + 1}. ${top[i].id} — 💰 ${top[i].points}\n`;
    }

    await bot.sendMessage(
      msg.chat.id,
      text,
      {
        parse_mode: "Markdown"
      }
    );
  }
);

// =====================================================
// MESSAGE HANDLER
// =====================================================

bot.on(
  "message",
  async msg => {
    try {
      if (
        !msg.chat ||
        !msg.from
      ) {
        return;
      }

      // حماية القروب
      const blocked =
        await protection(msg);

      if (blocked) {
        return;
      }

      // الأوامر لا تدخل الردود
      if (
        !msg.text ||
        msg.text.startsWith("/")
      ) {
        return;
      }

      const text =
        normalize(msg.text);

      // الردود التلقائية
      for (
        const item of AUTO_REPLIES
      ) {
        const matched =
          item.words.some(
            word =>
              text ===
              normalize(word)
          );

        if (matched) {
          await bot.sendMessage(
            msg.chat.id,
            randomItem(
              item.replies
            ),
            {
              reply_to_message_id:
                msg.message_id
            }
          );

          break;
        }
      }
    } catch (err) {
      console.error(
        "Message handler:",
        err.message
      );
    }
  }
);

// =====================================================
// ERRORS
// =====================================================

bot.on(
  "polling_error",
  error => {
    console.error(
      "❌ Telegram polling error:",
      error.message
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ Uncaught Exception:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled Rejection:",
      error
    );
  }
); 
