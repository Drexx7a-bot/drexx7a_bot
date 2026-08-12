const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const fs = require('fs');

const TOKEN = process.env.BOT_TOKEN;
const PORT = Number(process.env.PORT) || 10000;

if (!TOKEN) {
  console.error('❌ BOT_TOKEN غير موجود');
  process.exit(1);
}

// =========================
// RENDER PORT
// =========================

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });
  res.end('DREX BOT is running');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 DREX BOT listening on port ${PORT}`);
});

// =========================
// TELEGRAM
// =========================

const bot = new TelegramBot(TOKEN, {
  polling: true
});

console.log('🤖 DREX BOT started');

// =========================
// DATA
// =========================

const DATA_FILE = './data.json';

let data = {
  groups: {},
  users: {},
  guesses: {}
};

function save() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(data, null, 2)
    );
  } catch (err) {
    console.error('❌ Save error:', err.message);
  }
}

if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(
      fs.readFileSync(DATA_FILE, 'utf8')
    );
  } catch (err) {
    console.log('⚠️ Creating new data');
  }
}

function getGroup(chatId) {
  const id = String(chatId);

  if (!data.groups[id]) {
    data.groups[id] = {
      antiLink: false,
      antiSwear: true,
      antiFlood: true,
      lockdown: false,
      warningsLimit: 3,
      muteMinutes: 10
    };

    save();
  }

  return data.groups[id];
}

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

    save();
  }

  return data.users[id];
}

// =========================
// HELPERS
// =========================

function mention(user) {
  const name =
    user.first_name ||
    user.username ||
    'العضو';

  return `[${name}](tg://user?id=${user.id})`;
}

async function isAdmin(chatId, userId) {
  try {
    const member =
      await bot.getChatMember(
        chatId,
        userId
      );

    return (
      member.status === 'administrator' ||
      member.status === 'creator'
    );
  } catch {
    return false;
  }
}

function repliedUser(msg) {
  return msg.reply_to_message?.from || null;
}

async function deleteMsg(chatId, messageId) {
  try {
    await bot.deleteMessage(
      chatId,
      messageId
    );
  } catch {}
}

async function mute(
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
      'Mute error:',
      err.message
    );

    return false;
  }
}

async function unmute(
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

async function ban(
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

async function unban(
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

async function kick(
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

// =========================
// PROTECTION
// =========================

const badWords = [
  'كلمة_مسيئة_1',
  'كلمة_مسيئة_2',
  'كلمة_مسيئة_3'
];

const floodMap = new Map();

function hasLink(text) {
  return /(https?:\/\/|www\.|t\.me\/)/i.test(
    text || ''
  );
}

function hasSwear(text) {
  if (!text) return false;

  const normalized =
    text
      .toLowerCase()
      .replace(/[\s_\-*.]+/g, '');

  return badWords.some(word => {
    const clean =
      word
        .toLowerCase()
        .replace(/[\s_\-*.]+/g, '');

    return normalized.includes(clean);
  });
}

async function protection(msg) {
  if (!msg.chat) return;

  if (
    msg.chat.type === 'private'
  ) {
    return;
  }

  if (!msg.from) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (
    await isAdmin(
      chatId,
      userId
    )
  ) {
    return;
  }

  const settings =
    getGroup(chatId);

  // LOCKDOWN
  if (settings.lockdown) {
    await deleteMsg(
      chatId,
      msg.message_id
    );

    return;
  }

  const text =
    msg.text ||
    msg.caption ||
    '';

  // ANTI LINK
  if (
    settings.antiLink &&
    hasLink(text)
  ) {
    await deleteMsg(
      chatId,
      msg.message_id
    );

    await bot.sendMessage(
      chatId,
      `🔗 ${mention(msg.from)}\nممنوع إرسال الروابط.`,
      {
        parse_mode: 'Markdown'
      }
    );

    return;
  }

  // ANTI SWEAR
  if (
    settings.antiSwear &&
    hasSwear(text)
  ) {
    await deleteMsg(
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

    save();

    const count =
      user.warnings[chatId];

    await bot.sendMessage(
      chatId,
      `🤬 ${mention(msg.from)}\n⚠️ تحذير ${count}/${settings.warningsLimit}`,
      {
        parse_mode: 'Markdown'
      }
    );

    if (
      count >=
      settings.warningsLimit
    ) {
      await mute(
        chatId,
        userId,
        settings.muteMinutes
      );

      user.warnings[chatId] = 0;

      save();

      await bot.sendMessage(
        chatId,
        `🔇 تم كتم ${mention(msg.from)} لمدة ${settings.muteMinutes} دقائق.`,
        {
          parse_mode: 'Markdown'
        }
      );
    }

    return;
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

    if (
      messages.length >= 7
    ) {
      floodMap.delete(key);

      await deleteMsg(
        chatId,
        msg.message_id
      );

      const ok =
        await mute(
          chatId,
          userId,
          settings.muteMinutes
        );

      if (ok) {
        await bot.sendMessage(
          chatId,
          `🌊 تم اكتشاف Flood.\n🔇 تم كتم ${mention(msg.from)} لمدة ${settings.muteMinutes} دقائق.`,
          {
            parse_mode: 'Markdown'
          }
        );
      }
    }
  }
}

bot.on(
  'message',
  async msg => {
    try {
      await protection(msg);
    } catch (err) {
      console.error(
        'Protection error:',
        err.message
      );
    }
  }
);

// =========================
// START
// =========================

bot.onText(
  /^\/start$/,
  async msg => {
    await bot.sendMessage(
      msg.chat.id,
      `🤖 *DREX BOT*

🛡️ نظام حماية
🎮 ألعاب
🏆 نقاط و XP
👮 إدارة القروب
🚨 نظام طوارئ

استخدم /help لمعرفة الأوامر.`,
      {
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// HELP
// =========================

bot.onText(
  /^\/help$/,
  async msg => {
    await bot.sendMessage(
      msg.chat.id,
      `📚 *أوامر DREX*

🛡️ الحماية
/antilink on
/antilink off
/antiswear on
/antiswear off
/antiflood on
/antiflood off

👮 الإدارة
/warn
/unwarn
/warnings
/mute
/unmute
/ban
/unban
/kick

🚨 الطوارئ
/lockdown
/unlockdown

🎮 الألعاب
/games
/guess
/rps حجر
/rps ورق
/rps مقص

🏆 الحساب
/profile
/balance
/daily
/top

⚙️ الإعدادات
/settings`,
      {
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// SETTINGS
// =========================

function settingCommand(
  command,
  property
) {
  bot.onText(
    new RegExp(
      `^\\/${command} (on|off)$`,
      'i'
    ),
    async msg => {
      if (
        msg.chat.type ===
        'private'
      ) {
        return;
      }

      if (
        !(await isAdmin(
          msg.chat.id,
          msg.from.id
        ))
      ) {
        return bot.sendMessage(
          msg.chat.id,
          '❌ للمشرفين فقط.'
        );
      }

      const value =
        msg.text
          .toLowerCase()
          .endsWith('on');

      getGroup(
        msg.chat.id
      )[property] = value;

      save();

      await bot.sendMessage(
        msg.chat.id,
        `✅ ${command}: ${
          value
            ? 'تشغيل 🟢'
            : 'إيقاف 🔴'
        }`
      );
    }
  );
}

settingCommand(
  'antilink',
  'antiLink'
);

settingCommand(
  'antiswear',
  'antiSwear'
);

settingCommand(
  'antiflood',
  'antiFlood'
);

// =========================
// SETTINGS VIEW
// =========================

bot.onText(
  /^\/settings$/,
  async msg => {
    if (
      msg.chat.type ===
      'private'
    ) {
      return;
    }

    if (
      !(await isAdmin(
        msg.chat.id,
        msg.from.id
      ))
    ) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ للمشرفين فقط.'
      );
    }

    const s =
      getGroup(msg.chat.id);

    await bot.sendMessage(
      msg.chat.id,
      `⚙️ *DREX SETTINGS*

🔗 Anti-Link:
${s.antiLink ? '🟢 ON' : '🔴 OFF'}

🤬 Anti-Swear:
${s.antiSwear ? '🟢 ON' : '🔴 OFF'}

🌊 Anti-Flood:
${s.antiFlood ? '🟢 ON' : '🔴 OFF'}

🚨 Lockdown:
${s.lockdown ? '🔴 ON' : '🟢 OFF'}

⚠️ حد التحذيرات:
${s.warningsLimit}

🔇 مدة الكتم:
${s.muteMinutes} دقيقة`,
      {
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// WARN
// =========================

bot.onText(
  /^\/warn$/,
  async msg => {
    if (
      !(await isAdmin(
        msg.chat.id,
        msg.from.id
      ))
    ) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ للمشرفين فقط.'
      );
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        '↩️ استخدم /warn بالرد على رسالة العضو.'
      );
    }

    if (
      await isAdmin(
        msg.chat.id,
        target.id
      )
    ) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ لا يمكن تحذير مشرف.'
      );
    }

    const user =
      getUser(target.id);

    if (
      !user.warnings[
        msg.chat.id
      ]
    ) {
      user.warnings[
        msg.chat.id
      ] = 0;
    }

    user.warnings[
      msg.chat.id
    ]++;

    save();

    const count =
      user.warnings[
        msg.chat.id
      ];

    const limit =
      getGroup(
        msg.chat.id
      ).warningsLimit;

    await bot.sendMessage(
      msg.chat.id,
      `⚠️ ${mention(target)}\nالتحذير: ${count}/${limit}`,
      {
        parse_mode: 'Markdown'
      }
    );

    if (count >= limit) {
      const minutes =
        getGroup(
          msg.chat.id
        ).muteMinutes;

      await mute(
        msg.chat.id,
        target.id,
        minutes
      );

      user.warnings[
        msg.chat.id
      ] = 0;

      save();

      await bot.sendMessage(
        msg.chat.id,
        `🔇 تم كتم ${mention(target)} لمدة ${minutes} دقائق.`,
        {
          parse_mode: 'Markdown'
        }
      );
    }
  }
);

// =========================
// UNWARN
// =========================

bot.onText(
  /^\/unwarn$/,
  async msg => {
    if (
      !(await isAdmin(
        msg.chat.id,
        msg.from.id
      ))
    ) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ للمشرفين فقط.'
      );
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        '↩️ استخدم /unwarn بالرد على العضو.'
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

    save();

    await bot.sendMessage(
      msg.chat.id,
      `✅ تم إزالة تحذير من ${mention(target)}.`,
      {
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// WARNINGS
// =========================

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
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// MUTE
// =========================

bot.onText(
  /^\/mute(?: (\d+))?$/,
  async (msg, match) => {
    if (
      !(await isAdmin(
        msg.chat.id,
        msg.from.id
      ))
    ) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ للمشرفين فقط.'
      );
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        '↩️ استخدم /mute بالرد على العضو.'
      );
    }

    const minutes =
      Number(match[1] || 10);

    const ok =
      await mute(
        msg.chat.id,
        target.id,
        minutes
      );

    await bot.sendMessage(
      msg.chat.id,
      ok
        ? `🔇 تم كتم ${mention(target)} لمدة ${minutes} دقيقة.`
        : '❌ تعذر تنفيذ الكتم.',
      {
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// UNMUTE
// =========================

bot.onText(
  /^\/unmute$/,
  async msg => {
    if (
      !(await isAdmin(
        msg.chat.id,
        msg.from.id
      ))
    ) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ للمشرفين فقط.'
      );
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        '↩️ استخدم /unmute بالرد على العضو.'
      );
    }

    const ok =
      await unmute(
        msg.chat.id,
        target.id
      );

    await bot.sendMessage(
      msg.chat.id,
      ok
        ? `🔊 تم فك كتم ${mention(target)}.`
        : '❌ تعذر فك الكتم.',
      {
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// BAN
// =========================

bot.onText(
  /^\/ban$/,
  async msg => {
    if (
      !(await isAdmin(
        msg.chat.id,
        msg.from.id
      ))
    ) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ للمشرفين فقط.'
      );
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        '↩️ استخدم /ban بالرد على العضو.'
      );
    }

    if (
      await isAdmin(
        msg.chat.id,
        target.id
      )
    ) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ لا يمكن حظر مشرف.'
      );
    }

    const ok =
      await ban(
        msg.chat.id,
        target.id
      );

    await bot.sendMessage(
      msg.chat.id,
      ok
        ? `🔨 تم حظر ${mention(target)}.`
        : '❌ تعذر تنفيذ الحظر.',
      {
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// UNBAN
// =========================

bot.onText(
  /^\/unban$/,
  async msg => {
    if (
      !(await isAdmin(
        msg.chat.id,
        msg.from.id
      ))
    ) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ للمشرفين فقط.'
      );
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        '↩️ استخدم /unban بالرد على العضو.'
      );
    }

    const ok =
      await unban(
        msg.chat.id,
        target.id
      );

    await bot.sendMessage(
      msg.chat.id,
      ok
        ? `✅ تم فك حظر ${mention(target)}.`
        : '❌ تعذر فك الحظر.',
      {
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// KICK
// =========================

bot.onText(
  /^\/kick$/,
  async msg => {
    if (
      !(await isAdmin(
        msg.chat.id,
        msg.from.id
      ))
    ) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ للمشرفين فقط.'
      );
    }

    const target =
      repliedUser(msg);

    if (!target) {
      return bot.sendMessage(
        msg.chat.id,
        '↩️ استخدم /kick بالرد على العضو.'
      );
    }

    const ok =
      await kick(
        msg.chat.id,
        target.id
      );

    await bot.sendMessage(
      msg.chat.id,
      ok
        ? `👢 تم طرد ${mention(target)}.`
        : '❌ تعذر تنفيذ الطرد.',
      {
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// LOCKDOWN
// =========================

bot.onText(
  /^\/lockdown$/,
  async msg => {
    if (
      !(await isAdmin(
        msg.chat.id,
        msg.from.id
      ))
    ) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ للمشرفين فقط.'
      );
    }

    getGroup(
      msg.chat.id
    ).lockdown = true;

    save();

    await bot.sendMessage(
      msg.chat.id,
      '🚨 تم تفعيل Lockdown.'
    );
  }
);

// =========================
// UNLOCKDOWN
// =========================

bot.onText(
  /^\/unlockdown$/,
  async msg => {
    if (
      !(await isAdmin(
        msg.chat.id,
        msg.from.id
      ))
    ) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ للمشرفين فقط.'
      );
    }

    getGroup(
      msg.chat.id
    ).lockdown = false;

    save();

    await bot.sendMessage(
      msg.chat.id,
      '✅ تم إيقاف Lockdown.'
    );
  }
);

// =========================
// PROFILE
// =========================

bot.onText(
  /^\/profile$/,
  async msg => {
    const user =
      getUser(msg.from.id);

    await bot.sendMessage(
      msg.chat.id,
      `👤 *DREX PROFILE*

👤 الاسم:
${msg.from.first_name || 'غير معروف'}

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
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// BALANCE
// =========================

bot.onText(
  /^\/balance$/,
  async msg => {
    const user =
      getUser(msg.from.id);

    await bot.sendMessage(
      msg.chat.id,
      `💰 نقاطك: ${user.points}\n⭐ XP: ${user.xp}`
    );
  }
);

// =========================
// DAILY
// =========================

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
        '⏳ أخذت مكافأتك اليومية بالفعل.'
      );
    }

    user.daily = today;
    user.points += 250;
    user.xp += 100;

    save();

    await bot.sendMessage(
      msg.chat.id,
      '🎁 المكافأة اليومية!\n\n💰 +250 نقطة\n⭐ +100 XP'
    );
  }
);

// =========================
// GUESS GAME
// =========================

bot.onText(
  /^\/guess$/,
  async msg => {
    const number =
      Math.floor(
        Math.random() * 10
      ) + 1;

    data.guesses[
      msg.from.id
    ] = number;

    save();

    await bot.sendMessage(
      msg.chat.id,
      '🎯 خمن رقمًا من 1 إلى 10.\n\nاكتب مثلًا:\n/guess 7'
    );
  }
);

bot.onText(
  /^\/guess (\d+)$/,
  async (msg, match) => {
    const answer =
      data.guesses[
        msg.from.id
      ];

    if (!answer) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ ابدأ اللعبة بـ /guess'
      );
    }

    const guess =
      Number(match[1]);

    const user =
      getUser(msg.from.id);

    user.games++;

    if (
      guess === answer
    ) {
      user.wins++;
      user.points += 100;
      user.xp += 50;

      await bot.sendMessage(
        msg.chat.id,
        `🎉 فزت!\n🎯 الرقم كان ${answer}\n💰 +100\n⭐ +50 XP`
      );
    } else {
      user.losses++;

      await bot.sendMessage(
        msg.chat.id,
        `❌ خسرت!\nالرقم الصحيح: ${answer}`
      );
    }

    delete data.guesses[
      msg.from.id
    ];

    save();
  }
);

// =========================
// RPS
// =========================

bot.onText(
  /^\/rps (حجر|ورق|مقص)$/,
  async (msg, match) => {
    const choices = [
      'حجر',
      'ورق',
      'مقص'
    ];

    const player =
      match[1];

    const computer =
      choices[
        Math.floor(
          Math.random() *
          choices.length
        )
      ];

    const user =
      getUser(msg.from.id);

    user.games++;

    let result;

    if (
      player === computer
    ) {
      result = '🤝 تعادل!';
    } else if (
      (player === 'حجر' &&
        computer === 'مقص') ||
      (player === 'ورق' &&
        computer === 'حجر') ||
      (player === 'مقص' &&
        computer === 'ورق')
    ) {
      result = '🎉 فزت!';

      user.wins++;
      user.points += 50;
      user.xp += 25;
    } else {
      result = '❌ خسرت!';

      user.losses++;
    }

    save();

    await bot.sendMessage(
      msg.chat.id,
      `🎮 *حجر ورق مقص*

👤 أنت: ${player}
🤖 البوت: ${computer}

${result}`,
      {
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// GAMES
// =========================

bot.onText(
  /^\/games$/,
  async msg => {
    await bot.sendMessage(
      msg.chat.id,
      `🎮 *DREX GAMES*

🎯 /guess
🪨 /rps حجر
📄 /rps ورق
✂️ /rps مقص

🏆 /profile
💰 /balance
🎁 /daily
📊 /top`,
      {
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// TOP
// =========================

bot.onText(
  /^\/top$/,
  async msg => {
    const top =
      Object.entries(data.users)
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
        '🏆 لا توجد بيانات حتى الآن.'
      );
    }

    let text =
      '🏆 *DREX TOP 10*\n\n';

    top.forEach(
      (user, index) => {
        text +=
          `${index + 1}. ${user.id} — 💰 ${user.points}\n`;
      }
    );

    await bot.sendMessage(
      msg.chat.id,
      text,
      {
        parse_mode: 'Markdown'
      }
    );
  }
);

// =========================
// ERRORS
// =========================

bot.on(
  'polling_error',
  error => {
    console.error(
      '❌ Telegram polling error:',
      error.message
    );
  }
);

process.on(
  'uncaughtException',
  error => {
    console.error(
      '❌ Uncaught Exception:',
      error
    );
  }
);

process.on(
  'unhandledRejection',
  error => {
    console.error(
      '❌ Unhandled Rejection:',
      error
    );
  }
);
