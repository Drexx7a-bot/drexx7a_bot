const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const TOKEN = process.env.BOT_TOKEN;

if (!TOKEN) {
  console.error('❌ BOT_TOKEN غير موجود');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const DATA_FILE = './data.json';

let data = {
  groups: {},
  users: {}
};

if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    console.log('⚠️ تعذر قراءة data.json، سيتم إنشاء بيانات جديدة');
  }
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('❌ خطأ حفظ البيانات:', e.message);
  }
}

function groupData(chatId) {
  chatId = String(chatId);

  if (!data.groups[chatId]) {
    data.groups[chatId] = {
      antiSpam: true,
      antiFlood: true,
      antiLink: false,
      antiSwear: true,
      lockdown: false,
      warningsLimit: 3,
      muteMinutes: 10,
      logs: null,
      customWords: []
    };
  }

  return data.groups[chatId];
}

function userData(userId) {
  userId = String(userId);

  if (!data.users[userId]) {
    data.users[userId] = {
      xp: 0,
      points: 0,
      wins: 0,
      losses: 0,
      games: 0,
      warnings: {}
    };
  }

  return data.users[userId];
}

function addXP(userId, amount) {
  const user = userData(userId);
  user.xp += amount;
  user.points += amount;
  save();
}

function mention(user) {
  const name =
    user.first_name ||
    user.username ||
    'العضو';

  return `[${name}](tg://user?id=${user.id})`;
}

async function isAdmin(chatId, userId) {
  try {
    const member = await bot.getChatMember(chatId, userId);

    return (
      member.status === 'administrator' ||
      member.status === 'creator'
    );
  } catch {
    return false;
  }
}

async function botIsAdmin(chatId) {
  try {
    const me = await bot.getMe();
    return await isAdmin(chatId, me.id);
  } catch {
    return false;
  }
}

async function deleteMessage(chatId, messageId) {
  try {
    await bot.deleteMessage(chatId, messageId);
    return true;
  } catch {
    return false;
  }
}

async function muteUser(chatId, userId, minutes) {
  try {
    const until = Math.floor(Date.now() / 1000) + minutes * 60;

    await bot.restrictChatMember(chatId, userId, {
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
    });

    return true;
  } catch (e) {
    console.error('Mute error:', e.message);
    return false;
  }
}

async function unmuteUser(chatId, userId) {
  try {
    await bot.restrictChatMember(chatId, userId, {
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
    });

    return true;
  } catch {
    return false;
  }
}

async function banUser(chatId, userId) {
  try {
    await bot.banChatMember(chatId, userId);
    return true;
  } catch {
    return false;
  }
}

async function unbanUser(chatId, userId) {
  try {
    await bot.unbanChatMember(chatId, userId, {
      only_if_banned: true
    });
    return true;
  } catch {
    return false;
  }
}

async function kickUser(chatId, userId) {
  try {
    await bot.banChatMember(chatId, userId);
    await bot.unbanChatMember(chatId, userId);
    return true;
  } catch {
    return false;
  }
}

async function sendLog(chatId, text) {
  const settings = groupData(chatId);

  if (!settings.logs) return;

  try {
    await bot.sendMessage(settings.logs, text, {
      parse_mode: 'Markdown'
    });
  } catch {}
}

function containsLink(text) {
  if (!text) return false;

  return /(https?:\/\/|www\.|t\.me\/|telegram\.me\/)/i.test(text);
}

const badWords = [
  'كلمة_مسيئة_1',
  'كلمة_مسيئة_2',
  'كلمة_مسيئة_3'
];

function containsSwear(text, settings) {
  if (!text) return false;

  const normalized = text
    .toLowerCase()
    .replace(/[\s_\-*.]+/g, '');

  const words = [
    ...badWords,
    ...(settings.customWords || [])
  ];

  return words.some(word => {
    const clean = String(word)
      .toLowerCase()
      .replace(/[\s_\-*.]+/g, '');

    return clean && normalized.includes(clean);
  });
}

const spamMap = new Map();

async function processProtection(msg) {
  if (!msg.chat || msg.chat.type === 'private') return;
  if (!msg.from) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const settings = groupData(chatId);

  if (await isAdmin(chatId, userId)) return;

  if (settings.lockdown) {
    await deleteMessage(chatId, msg.message_id);
    return;
  }

  const text = msg.text || msg.caption || '';

  // Anti-Link
  if (settings.antiLink && containsLink(text)) {
    await deleteMessage(chatId, msg.message_id);

    const user = userData(userId);

    if (!user.warnings[chatId]) {
      user.warnings[chatId] = 0;
    }

    user.warnings[chatId]++;
    save();

    await bot.sendMessage(
      chatId,
      `🔗 ${mention(msg.from)} تم حذف الرابط.\n⚠️ التحذير: ${user.warnings[chatId]}/${settings.warningsLimit}`,
      { parse_mode: 'Markdown' }
    );

    await sendLog(
      chatId,
      `🔗 *Anti-Link*\n👤 ${mention(msg.from)}\n⚠️ تحذير ${user.warnings[chatId]}/${settings.warningsLimit}`
    );

    if (user.warnings[chatId] >= settings.warningsLimit) {
      await muteUser(chatId, userId, settings.muteMinutes);
      user.warnings[chatId] = 0;
      save();

      await bot.sendMessage(
        chatId,
        `🔇 تم كتم ${mention(msg.from)} لمدة ${settings.muteMinutes} دقائق.`,
        { parse_mode: 'Markdown' }
      );
    }

    return;
  }

  // Anti-Swear
  if (settings.antiSwear && containsSwear(text, settings)) {
    await deleteMessage(chatId, msg.message_id);

    const user = userData(userId);

    if (!user.warnings[chatId]) {
      user.warnings[chatId] = 0;
    }

    user.warnings[chatId]++;
    save();

    await bot.sendMessage(
      chatId,
      `🤬 ${mention(msg.from)} ممنوع السب.\n⚠️ التحذير: ${user.warnings[chatId]}/${settings.warningsLimit}`,
      { parse_mode: 'Markdown' }
    );

    await sendLog(
      chatId,
      `🤬 *Anti-Swear*\n👤 ${mention(msg.from)}\n⚠️ تحذير ${user.warnings[chatId]}/${settings.warningsLimit}`
    );

    if (user.warnings[chatId] >= settings.warningsLimit) {
      await muteUser(chatId, userId, settings.muteMinutes);

      user.warnings[chatId] = 0;
      save();

      await bot.sendMessage(
        chatId,
        `🔇 تم كتم ${mention(msg.from)} بسبب تكرار المخالفات.`,
        { parse_mode: 'Markdown' }
      );
    }

    return;
  }

  // Anti-Flood / Spam
  const key = `${chatId}:${userId}`;
  const now = Date.now();

  if (!spamMap.has(key)) {
    spamMap.set(key, []);
  }

  const timestamps = spamMap.get(key);

  timestamps.push(now);

  while (
    timestamps.length &&
    now - timestamps[0] > 5000
  ) {
    timestamps.shift();
  }

  if (settings.antiFlood && timestamps.length >= 7) {
    spamMap.delete(key);

    await deleteMessage(chatId, msg.message_id);

    const muted = await muteUser(
      chatId,
      userId,
      settings.muteMinutes
    );

    if (muted) {
      await bot.sendMessage(
        chatId,
        `🌊 تم اكتشاف Flood.\n🔇 تم كتم ${mention(msg.from)} لمدة ${settings.muteMinutes} دقائق.`,
        { parse_mode: 'Markdown' }
      );

      await sendLog(
        chatId,
        `🌊 *Anti-Flood*\n👤 ${mention(msg.from)}\n🔇 Mute ${settings.muteMinutes}m`
      );
    }
  }
}

bot.on('message', async msg => {
  try {
    await processProtection(msg);
  } catch (e) {
    console.error('Protection error:', e.message);
  }
});

// /start
bot.onText(/^\/start$/, async msg => {
  await bot.sendMessage(
    msg.chat.id,
    `🤖 *DREX BOT*

🛡️ حماية وإدارة
🎮 ألعاب
🏆 نقاط ومستويات
📊 ترتيب
⚙️ إعدادات

البوت قيد التطوير 🔥`,
    { parse_mode: 'Markdown' }
  );
});

// /help
bot.onText(/^\/help$/, async msg => {
  await bot.sendMessage(
    msg.chat.id,
    `📚 *أوامر DREX*

🛡️ الحماية
/antilink on
/antilink off
/antiswear on
/antiswear off
/antispam on
/antispam off
/antiflood on
/antiflood off

👮 الإدارة
/ban
/unban
/kick
/mute
/unmute
/warn
/unwarn
/warnings

🚨 الطوارئ
/lockdown
/unlockdown

🎮 الألعاب
/games
/guess
/rps

🏆 الحساب
/profile
/balance
/daily
/top`,
    { parse_mode: 'Markdown' }
  );
});

// Settings commands
function settingCommand(command, property) {
  bot.onText(
    new RegExp(`^\\/${command} (on|off)$`, 'i'),
    async msg => {
      if (msg.chat.type === 'private') return;

      if (!(await isAdmin(msg.chat.id, msg.from.id))) {
        return bot.sendMessage(
          msg.chat.id,
          '❌ هذا الأمر للمشرفين فقط.'
        );
      }

      const value = msg.text.toLowerCase().endsWith('on');

      groupData(msg.chat.id)[property] = value;
      save();

      await bot.sendMessage(
        msg.chat.id,
        `✅ ${command}: ${value ? 'تشغيل' : 'إيقاف'}`
      );
    }
  );
}

settingCommand('antilink', 'antiLink');
settingCommand('antiswear', 'antiSwear');
settingCommand('antispam', 'antiSpam');
settingCommand('antiflood', 'antiFlood');

// /settings
bot.onText(/^\/settings$/, async msg => {
  if (msg.chat.type === 'private') return;

  if (!(await isAdmin(msg.chat.id, msg.from.id))) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ للمشرفين فقط.'
    );
  }

  const s = groupData(msg.chat.id);

  await bot.sendMessage(
    msg.chat.id,
    `⚙️ *إعدادات DREX*

🔗 Anti-Link: ${s.antiLink ? '🟢' : '🔴'}
🤬 Anti-Swear: ${s.antiSwear ? '🟢' : '🔴'}
🚫 Anti-Spam: ${s.antiSpam ? '🟢' : '🔴'}
🌊 Anti-Flood: ${s.antiFlood ? '🟢' : '🔴'}
🚨 Lockdown: ${s.lockdown ? '🔴' : '🟢'}

⚠️ الحد: ${s.warningsLimit}
🔇 الكتم: ${s.muteMinutes} دقيقة`,
    { parse_mode: 'Markdown' }
  );
});

// Get replied user
function repliedUser(msg) {
  return msg.reply_to_message?.from || null;
}

// /warn
bot.onText(/^\/warn$/, async msg => {
  if (msg.chat.type === 'private') return;

  if (!(await isAdmin(msg.chat.id, msg.from.id))) {
    return bot.sendMessage(msg.chat.id, '❌ للمشرفين فقط.');
  }

  const target = repliedUser(msg);

  if (!target) {
    return bot.sendMessage(
      msg.chat.id,
      '↩️ استخدم الأمر بالرد على رسالة العضو.'
    );
  }

  if (await isAdmin(msg.chat.id, target.id)) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ لا يمكن تحذير مشرف.'
    );
  }

  const user = userData(target.id);

  if (!user.warnings[msg.chat.id]) {
    user.warnings[msg.chat.id] = 0;
  }

  user.warnings[msg.chat.id]++;

  const s = groupData(msg.chat.id);

  save();

  await bot.sendMessage(
    msg.chat.id,
    `⚠️ ${mention(target)}\nالتحذير: ${user.warnings[msg.chat.id]}/${s.warningsLimit}`,
    { parse_mode: 'Markdown' }
  );

  if (user.warnings[msg.chat.id] >= s.warningsLimit) {
    await muteUser(
      msg.chat.id,
      target.id,
      s.muteMinutes
    );

    user.warnings[msg.chat.id] = 0;
    save();

    await bot.sendMessage(
      msg.chat.id,
      `🔇 تم كتم ${mention(target)} لمدة ${s.muteMinutes} دقائق.`,
      { parse_mode: 'Markdown' }
    );
  }
});

// /unwarn
bot.onText(/^\/unwarn$/, async msg => {
  if (!(await isAdmin(msg.chat.id, msg.from.id))) {
    return bot.sendMessage(msg.chat.id, '❌ للمشرفين فقط.');
  }

  const target = repliedUser(msg);

  if (!target) {
    return bot.sendMessage(
      msg.chat.id,
      '↩️ استخدم الأمر بالرد على رسالة العضو.'
    );
  }

  const user = userData(target.id);

  user.warnings[msg.chat.id] = Math.max(
    0,
    (user.warnings[msg.chat.id] || 0) - 1
  );

  save();

  await bot.sendMessage(
    msg.chat.id,
    `✅ تم إزالة تحذير من ${mention(target)}.`,
    { parse_mode: 'Markdown' }
  );
});

// /warnings
bot.onText(/^\/warnings$/, async msg => {
  const target = repliedUser(msg) || msg.from;

  const user = userData(target.id);

  await bot.sendMessage(
    msg.chat.id,
    `⚠️ تحذيرات ${mention(target)}: ${user.warnings[msg.chat.id] || 0}`,
    { parse_mode: 'Markdown' }
  );
});

// /mute
bot.onText(/^\/mute(?: (\d+))?$/, async (msg, match) => {
  if (!(await isAdmin(msg.chat.id, msg.from.id))) {
    return bot.sendMessage(msg.chat.id, '❌ للمشرفين فقط.');
  }

  const target = repliedUser(msg);

  if (!target) {
    return bot.sendMessage(
      msg.chat.id,
      '↩️ استخدم /mute بالرد على العضو.'
    );
  }

  const minutes = Number(match[1] || 10);

  const ok = await muteUser(
    msg.chat.id,
    target.id,
    minutes
  );

  await bot.sendMessage(
    msg.chat.id,
    ok
      ? `🔇 تم كتم ${mention(target)} لمدة ${minutes} دقيقة.`
      : '❌ تعذر تنفيذ الكتم.',
    { parse_mode: 'Markdown' }
  );
});

// /unmute
bot.onText(/^\/unmute$/, async msg => {
  if (!(await isAdmin(msg.chat.id, msg.from.id))) {
    return bot.sendMessage(msg.chat.id, '❌ للمشرفين فقط.');
  }

  const target = repliedUser(msg);

  if (!target) {
    return bot.sendMessage(
      msg.chat.id,
      '↩️ استخدم /unmute بالرد على العضو.'
    );
  }

  const ok = await unmuteUser(
    msg.chat.id,
    target.id
  );

  await bot.sendMessage(
    msg.chat.id,
    ok ? `🔊 تم فك كتم ${mention(target)}.` : '❌ تعذر فك الكتم.',
    { parse_mode: 'Markdown' }
  );
});

// /ban
bot.onText(/^\/ban$/, async msg => {
  if (!(await isAdmin(msg.chat.id, msg.from.id))) {
    return bot.sendMessage(msg.chat.id, '❌ للمشرفين فقط.');
  }

  const target = repliedUser(msg);

  if (!target) {
    return bot.sendMessage(
      msg.chat.id,
      '↩️ استخدم /ban بالرد على العضو.'
    );
  }

  if (await isAdmin(msg.chat.id, target.id)) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ لا يمكن حظر مشرف.'
    );
  }

  const ok = await banUser(
    msg.chat.id,
    target.id
  );

  await bot.sendMessage(
    msg.chat.id,
    ok
      ? `🔨 تم حظر ${mention(target)}.`
      : '❌ تعذر تنفيذ الحظر.',
    { parse_mode: 'Markdown' }
  );
});

// /unban
bot.onText(/^\/unban$/, async msg => {
  if (!(await isAdmin(msg.chat.id, msg.from.id))) {
    return bot.sendMessage(msg.chat.id, '❌ للمشرفين فقط.');
  }

  const target = repliedUser(msg);

  if (!target) {
    return bot.sendMessage(
      msg.chat.id,
      '↩️ استخدم /unban بالرد على رسالة العضو.'
    );
  }

  const ok = await unbanUser(
    msg.chat.id,
    target.id
  );

  await bot.sendMessage(
    msg.chat.id,
    ok
      ? `✅ تم فك حظر ${mention(target)}.`
      : '❌ تعذر فك الحظر.',
    { parse_mode: 'Markdown' }
  );
});

// /kick
bot.onText(/^\/kick$/, async msg => {
  if (!(await isAdmin(msg.chat.id, msg.from.id))) {
    return bot.sendMessage(msg.chat.id, '❌ للمشرفين فقط.');
  }

  const target = repliedUser(msg);

  if (!target) {
    return bot.sendMessage(
      msg.chat.id,
      '↩️ استخدم /kick بالرد على العضو.'
    );
  }

  const ok = await kickUser(
    msg.chat.id,
    target.id
  );

  await bot.sendMessage(
    msg.chat.id,
    ok
      ? `👢 تم طرد ${mention(target)}.`
      : '❌ تعذر تنفيذ الطرد.',
    { parse_mode: 'Markdown' }
  );
});

// /lockdown
bot.onText(/^\/lockdown$/, async msg => {
  if (!(await isAdmin(msg.chat.id, msg.from.id))) {
    return bot.sendMessage(msg.chat.id, '❌ للمشرفين فقط.');
  }

  groupData(msg.chat.id).lockdown = true;
  save();

  await bot.sendMessage(
    msg.chat.id,
    '🚨 *تم تفعيل وضع الطوارئ Lockdown.*\n\nلن يتم السماح للأعضاء بإرسال الرسائل.',
    { parse_mode: 'Markdown' }
  );
});

// /unlockdown
bot.onText(/^\/unlockdown$/, async msg => {
  if (!(await isAdmin(msg.chat.id, msg.from.id))) {
    return bot.sendMessage(msg.chat.id, '❌ للمشرفين فقط.');
  }

  groupData(msg.chat.id).lockdown = false;
  save();

  await bot.sendMessage(
    msg.chat.id,
    '✅ تم إيقاف وضع الطوارئ.'
  );
});

// /profile
bot.onText(/^\/profile$/, async msg => {
  const user = userData(msg.from.id);

  await bot.sendMessage(
    msg.chat.id,
    `👤 *ملف DREX*

الاسم: ${msg.from.first_name || 'غير معروف'}
⭐ XP: ${user.xp}
💰 النقاط: ${user.points}
🏆 الانتصارات: ${user.wins}
❌ الخسائر: ${user.losses}
🎮 الألعاب: ${user.games}`,
    { parse_mode: 'Markdown' }
  );
});

// /balance
bot.onText(/^\/balance$/, async msg => {
  const user = userData(msg.from.id);

  await bot.sendMessage(
    msg.chat.id,
    `💰 نقاطك: ${user.points}\n⭐ XP: ${user.xp}`
  );
});

// /daily
bot.onText(/^\/daily$/, async msg => {
  const user = userData(msg.from.id);

  const today = new Date().toISOString().slice(0, 10);

  if (user.daily === today) {
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
    '🎁 حصلت على مكافأتك اليومية!\n\n💰 +250 DREX\n⭐ +100 XP'
  );
});

// /guess
bot.onText(/^\/guess$/, async msg => {
  const number = Math.floor(Math.random() * 10) + 1;

  data.guesses = data.guesses || {};
  data.guesses[msg.from.id] = number;

  save();

  await bot.sendMessage(
    msg.chat.id,
    '🎯 *تخمين الرقم*\n\nاختر رقمًا من 1 إلى 10 باستخدام:\n`/guess 5`',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/^\/guess (\d+)$/, async (msg, match) => {
  const guess = Number(match[1]);

  data.guesses = data.guesses || {};

  const answer = data.guesses[msg.from.id];

  if (!answer) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ ابدأ اللعبة أولًا بـ /guess'
    );
  }

  const user = userData(msg.from.id);

  user.games++;

  if (guess === answer) {
    user.wins++;
    user.points += 100;
    user.xp += 50;

    await bot.sendMessage(
      msg.chat.id,
      `🎉 صح!\n\n🎯 الرقم: ${answer}\n💰 +100 DREX\n⭐ +50 XP`
    );
  } else {
    user.losses++;

    await bot.sendMessage(
      msg.chat.id,
      `❌ خطأ!\nالرقم الصحيح كان: ${answer}`
    );
  }

  delete data.guesses[msg.from.id];
  save();
});

// /rps
bot.onText(/^\/rps (حجر|ورق|مقص)$/, async (msg, match) => {
  const choices = ['حجر', 'ورق', 'مقص'];

  const botChoice =
    choices[Math.floor(Math.random() * choices.length)];

  const player = match[1];

  const user = userData(msg.from.id);

  user.games++;

  let result;

  if (player === botChoice) {
    result = '🤝 تعادل!';
  } else if (
    (player === 'حجر' && botChoice === 'مقص') ||
    (player === 'ورق' && botChoice === 'حجر') ||
    (player === 'مقص' && botChoice === 'ورق')
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
🤖 البوت: ${botChoice}

${result}`,
    { parse_mode: 'Markdown' }
  );
});

// /games
bot.onText(/^\/games$/, async msg => {
  await bot.sendMessage(
    msg.chat.id,
    `🎮 *DREX GAMES*

🎯 /guess
🪨 /rps حجر
📊 /profile
💰 /balance
🎁 /daily
🏆 /top

🚧 ألعاب جماعية إضافية قادمة...`,
    { parse_mode: 'Markdown' }
  );
});

// /top
bot.onText(/^\/top$/, async msg => {
  const users = Object.entries(data.users)
    .map(([id, user]) => ({
      id,
      points: user.points || 0
    }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);

  if (!users.length) {
    return bot.sendMessage(
      msg.chat.id,
      '🏆 لا توجد بيانات حتى الآن.'
    );
  }

  let text = '🏆 *DREX TOP 10*\n\n';

  users.forEach((user, index) => {
    text += `${index + 1}. 👤 ${user.id} — 💰 ${user.points}\n`;
  });

  await bot.sendMessage(
    msg.chat.id,
    text,
    { parse_mode: 'Markdown' }
  );
});

bot.on('polling_error', error => {
  console.error('❌ Telegram polling error:', error.message);
});

console.log('━━━━━━━━━━━━━━━━━━━━');
console.log('🤖 DREX BOT');
console.log('🛡️ Security: ON');
console.log('🎮 Games: ON');
console.log('🏆 Points: ON');
console.log('━━━━━━━━━━━━━━━━━━━━');
const http = require('http');

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('DREX BOT is running');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Server running on port ${PORT}`);
});
