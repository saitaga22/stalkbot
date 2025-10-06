'use strict';

const path = require('path');
const {
  ActivityType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
} = require('discord.js');
const { QuickDB } = require('quick.db');

const db = new QuickDB({ filePath: path.join(__dirname, 'presence.sqlite') });

const PREFIX = '!';
const ACTIVE_STATUSES = new Set(['online', 'idle', 'dnd']);
const DEFAULT_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = new Set(['en', 'tr']);
const BOT_OWNER_ID = '599189960725364747';
let ownerUserCache = null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.User, Partials.GuildMember],
});

const monitorKey = (guildId) => `monitor.${guildId}`;
const accumKey = (userId) => `accum.${userId}`;
const logsKey = (userId) => `logs.${userId}`;
const langKey = (guildId) => `lang.${guildId}`;

const translations = {
  en: {
    general: {
      prefixDescription: 'Command prefix: `!`',
      manageRequired: '❌ You need the **Manage Server** permission to configure monitoring.',
      manageRequiredLang: '❌ You need the **Manage Server** permission to change the bot language.',
      mentionRequired: '⚠️ Please mention a user to monitor, e.g. `!monitor @username`.',
      monitoringNotConfigured: 'ℹ️ Monitoring is not configured for this server.',
      nothingMonitored: 'ℹ️ No user is currently being monitored in this server.',
      noActivityLogged: 'No activity logged yet.',
      helpFooter: 'Presence Stalker Bot',
      languageAlreadySet: 'ℹ️ Language is already set to {language}.',
      languageMissingArgument: '⚠️ Please supply a language code (en/tr).',
    },
    help: {
      title: 'Presence Monitor Help',
      description: 'Command prefix: `!`',
      fields: {
  monitor: 'Admins only. Start monitoring a member and relay updates to the bot owner via DM.',
        stopmonitor: 'Admins only. Stop monitoring in this guild and clear the saved channel.',
        status: "Show the monitored user's total active time, latest status, and last activity.",
        help: 'Display this help message.',
        setlang: 'Admins only. Switch between English and Turkish (e.g. `!setlang tr`).',
      },
    },
    monitor: {
      success: '✅ Now monitoring <@{userId}>. Presence updates will be sent to the bot owner via DM.',
    },
    stopmonitor: {
      success: '🛑 Monitoring disabled for this server.',
    },
    status: {
      embedTitle: 'Presence Monitor Status',
      fields: {
        monitoredUser: 'Monitored User',
        lastStatus: 'Last Status',
        totalActiveTime: 'Total Active Time',
        currentSession: 'Current Session',
        lastActivity: 'Last Activity',
        lastCustomStatus: 'Last Custom Status',
      },
      currentSessionValue: '{duration} (and counting)',
      noCustomStatus: 'None',
    },
    language: {
      invalid: '⚠️ Supported languages: {languages}.',
      updated: {
        en: '✅ Language set to English.',
        tr: '✅ Language set to Turkish.',
      },
      names: {
        en: 'English',
        tr: 'Turkish',
      },
    },
    logs: {
      statusNow: '🔔 **{user}** is now **{status}**.',
      statusOffline: '📴 **{user}** went **{status}**.',
      sessionSummary: 'Active for {session} this session. Total active time: {total}.',
      activityStart: '🎮 **{user}** started {verb} **{activity}**.',
      activityStop: '🛑 **{user}** stopped {verb} **{activity}**.',
      customStatus: '💬 <@{userId}> changed status: ‘{old}’ → ‘{new}’.',
    },
    activityVerbs: {
      start: {
        [ActivityType.Playing]: 'playing',
        [ActivityType.Listening]: 'listening to',
        [ActivityType.Streaming]: 'streaming',
        [ActivityType.Watching]: 'watching',
        [ActivityType.Competing]: 'competing in',
        default: 'doing',
      },
      stop: {
        [ActivityType.Playing]: 'playing',
        [ActivityType.Listening]: 'listening to',
        [ActivityType.Streaming]: 'streaming',
        [ActivityType.Watching]: 'watching',
        [ActivityType.Competing]: 'competing in',
        default: 'doing',
      },
    },
    statuses: {
      online: 'ONLINE',
      idle: 'IDLE',
      dnd: 'DO NOT DISTURB',
      offline: 'OFFLINE',
    },
    statusWords: {
      online: 'online',
      idle: 'idle',
      dnd: 'do not disturb',
      offline: 'offline',
    },
    durationUnits: {
      hour: 'h',
      minute: 'm',
      second: 's',
    },
    customStatus: {
      none: 'None',
    },
  },
  tr: {
    general: {
      prefixDescription: 'Komut ön eki: `!`',
      manageRequired: '❌ İzleme ayarlarını yapmak için **Sunucuyu Yönet** iznine ihtiyacınız var.',
      manageRequiredLang: '❌ Bot dilini değiştirmek için **Sunucuyu Yönet** iznine ihtiyacınız var.',
      mentionRequired: '⚠️ Lütfen izlemek için bir kullanıcı etiketleyin, örn. `!monitor @kullanici`.',
      monitoringNotConfigured: 'ℹ️ Bu sunucuda izleme yapılandırılmadı.',
      nothingMonitored: 'ℹ️ Bu sunucuda şu anda izlenen bir kullanıcı yok.',
      noActivityLogged: 'Henüz etkinlik kaydedilmedi.',
      helpFooter: 'Presence Stalker Bot',
      languageAlreadySet: 'ℹ️ Dil zaten {language} olarak ayarlı.',
      languageMissingArgument: '⚠️ Lütfen bir dil kodu belirtin (en/tr).',
    },
    help: {
      title: 'Presence Monitor Yardımı',
      description: 'Komut ön eki: `!`',
      fields: {
  monitor: 'Sadece yöneticiler. Bir üyeyi izlemeye başlayın ve güncellemeleri bot sahibine DM olarak iletin.',
        stopmonitor: 'Sadece yöneticiler. Bu sunucuda izlemeyi durdurur ve kayıtlı kanalı temizler.',
        status: 'İzlenen kullanıcının toplam aktif süresini, son durumunu ve son etkinliğini gösterir.',
        help: 'Bu yardım mesajını gösterir.',
        setlang: 'Sadece yöneticiler. İngilizce ve Türkçe arasında geçiş yapar (örn. `!setlang tr`).',
      },
    },
    monitor: {
      success: '✅ Artık <@{userId}> izleniyor. Durum güncellemeleri bot sahibine DM olarak gönderilecek.',
    },
    stopmonitor: {
      success: '🛑 Bu sunucu için izleme devre dışı bırakıldı.',
    },
    status: {
      embedTitle: 'Presence Monitor Durumu',
      fields: {
        monitoredUser: 'İzlenen Kullanıcı',
        lastStatus: 'Son Durum',
        totalActiveTime: 'Toplam Aktif Süre',
        currentSession: 'Geçerli Oturum',
        lastActivity: 'Son Günlük',
        lastCustomStatus: 'Son Özel Durum',
      },
      currentSessionValue: '{duration} (devam ediyor)',
      noCustomStatus: 'Yok',
    },
    language: {
      invalid: '⚠️ Desteklenen diller: {languages}.',
      updated: {
        en: '✅ Dil İngilizce olarak ayarlandı.',
        tr: '✅ Dil Türkçe olarak ayarlandı.',
      },
      names: {
        en: 'İngilizce',
        tr: 'Türkçe',
      },
    },
    logs: {
      statusNow: '🔔 **{user}** şimdi **{status}**.',
      statusOffline: '📴 **{user}** **{status}** oldu.',
      sessionSummary: 'Bu oturumda {session} aktifti. Toplam aktif süre: {total}.',
      activityStart: '🎮 **{user}** **{activity}** {verb}.',
      activityStop: '🛑 **{user}** **{activity}** {verb}.',
      customStatus: '💬 <@{userId}> durumu değiştirdi: ‘{old}’ → ‘{new}’.',
    },
    activityVerbs: {
      start: {
        [ActivityType.Playing]: 'oynamaya başladı',
        [ActivityType.Listening]: 'dinlemeye başladı',
        [ActivityType.Streaming]: 'yayın yapmaya başladı',
        [ActivityType.Watching]: 'izlemeye başladı',
        [ActivityType.Competing]: 'yarışmaya başladı',
        default: 'etkinliğe başladı',
      },
      stop: {
        [ActivityType.Playing]: 'oynamayı bıraktı',
        [ActivityType.Listening]: 'dinlemeyi bıraktı',
        [ActivityType.Streaming]: 'yayını durdurdu',
        [ActivityType.Watching]: 'izlemeyi bıraktı',
        [ActivityType.Competing]: 'yarışmayı bıraktı',
        default: 'etkinliği sonlandırdı',
      },
    },
    statuses: {
      online: 'ÇEVRİMİÇİ',
      idle: 'BOŞTA',
      dnd: 'RAHATSIZ ETMEYİN',
      offline: 'ÇEVRİMDIŞI',
    },
    statusWords: {
      online: 'çevrimiçi',
      idle: 'boşta',
      dnd: 'rahatsız etmeyin',
      offline: 'çevrimdışı',
    },
    durationUnits: {
      hour: 'sa',
      minute: 'dk',
      second: 'sn',
    },
    customStatus: {
      none: 'Yok',
    },
  },
};

function safeLanguage(lang) {
  return SUPPORTED_LANGUAGES.has(lang) ? lang : DEFAULT_LANGUAGE;
}

function translateRaw(lang, key) {
  const safeLang = safeLanguage(lang);
  const segments = key.split('.');
  let node = translations[safeLang];
  for (const segment of segments) {
    if (node && Object.prototype.hasOwnProperty.call(node, segment)) {
      node = node[segment];
    } else {
      node = undefined;
      break;
    }
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return node;
  }

  if (node && typeof node === 'object') {
    return node;
  }

  if (safeLang !== DEFAULT_LANGUAGE) {
    return translateRaw(DEFAULT_LANGUAGE, key);
  }

  return undefined;
}

function translate(lang, key, replacements = {}) {
  const template = translateRaw(lang, key);
  if (typeof template !== 'string') {
    return key;
  }

  return template.replace(/\{(\w+)\}/g, (match, token) => {
    if (Object.prototype.hasOwnProperty.call(replacements, token)) {
      return replacements[token];
    }
    return match;
  });
}

function getStatusLabel(status, lang) {
  const labels = translateRaw(lang, 'statuses');
  if (labels && Object.prototype.hasOwnProperty.call(labels, status)) {
    return labels[status];
  }
  const fallback = translateRaw(DEFAULT_LANGUAGE, 'statuses');
  return (fallback && fallback[status]) || status.toUpperCase();
}

function getStatusWord(status, lang) {
  const labels = translateRaw(lang, 'statusWords');
  if (labels && Object.prototype.hasOwnProperty.call(labels, status)) {
    return labels[status];
  }
  const fallback = translateRaw(DEFAULT_LANGUAGE, 'statusWords');
  return (fallback && fallback[status]) || status;
}

function getActivityVerb(activity, lang, phase) {
  const verbs = translateRaw(lang, `activityVerbs.${phase}`);
  const fallback = translateRaw(DEFAULT_LANGUAGE, `activityVerbs.${phase}`);
  return (
    verbs?.[activity.type] ?? verbs?.default ?? fallback?.[activity.type] ?? fallback?.default ?? 'doing'
  );
}

function getDurationUnits(lang) {
  const units = translateRaw(lang, 'durationUnits');
  if (units && units.hour && units.minute && units.second) {
    return units;
  }
  return translateRaw(DEFAULT_LANGUAGE, 'durationUnits');
}

function formatDuration(ms, lang = DEFAULT_LANGUAGE) {
  const { hour, minute, second } = getDurationUnits(lang);
  if (!ms || ms < 0) {
    return `0${second}`;
  }

  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const parts = [];
  if (hours) parts.push(`${hours}${hour}`);
  if (minutes) parts.push(`${minutes}${minute}`);
  if (seconds || parts.length === 0) parts.push(`${seconds}${second}`);
  return parts.join(' ');
}

function serializeActivityEmoji(emoji) {
  if (!emoji) return '';
  if (emoji.id) {
    return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
  }
  return emoji.name ?? '';
}

function getCustomStatusText(presence) {
  const activity = presence?.activities?.find((entry) => entry.type === ActivityType.Custom);
  if (!activity) return null;

  const emojiText = serializeActivityEmoji(activity.emoji);
  const stateText = activity.state?.trim() ?? '';
  const combined = [emojiText, stateText].filter(Boolean).join(' ').trim();
  return combined.length > 0 ? combined : emojiText || null;
}

async function getGuildLanguage(guildId) {
  if (!guildId) return DEFAULT_LANGUAGE;
  const stored = await db.get(langKey(guildId));
  return safeLanguage(stored);
}

async function setGuildLanguage(guildId, lang) {
  await db.set(langKey(guildId), safeLanguage(lang));
}

async function appendLog(userId, message) {
  const entry = { timestamp: Date.now(), message };
  const key = logsKey(userId);
  const existing = (await db.get(key)) ?? [];
  existing.push(entry);
  if (existing.length > 200) {
    existing.splice(0, existing.length - 200);
  }
  await db.set(key, existing);
  return entry;
}

async function getOwnerUser() {
  if (ownerUserCache) {
    return ownerUserCache;
  }

  try {
    ownerUserCache = await client.users.fetch(BOT_OWNER_ID);
    return ownerUserCache;
  } catch (error) {
    console.error(`Failed to fetch bot owner (${BOT_OWNER_ID}):`, error);
    ownerUserCache = null;
    return null;
  }
}

async function recordEvent(config, content) {
  const entry = await appendLog(config.userId, content);
  config.lastActivity = content;
  config.lastActivityAt = entry.timestamp;

  const ownerUser = await getOwnerUser();
  if (!ownerUser) {
    return;
  }

  try {
    await ownerUser.send({ content });
  } catch (error) {
    console.error('Failed to send log DM to bot owner:', error);
  }
}

function activitySignature(activity) {
  return [activity?.type, activity?.name, activity?.details, activity?.state, activity?.applicationId].join('::');
}

async function processStatusChange(config, oldStatus, newStatus, presence, lang) {
  if (oldStatus === newStatus) {
    return false;
  }

  const displayName = presence?.member?.displayName ?? presence?.user?.tag ?? config.userId;
  const now = Date.now();
  let updated = false;

  if (ACTIVE_STATUSES.has(newStatus)) {
    if (!config.sessionStart) {
      config.sessionStart = now;
      updated = true;
    }
    await recordEvent(
      config,
      translate(lang, 'logs.statusNow', {
        user: displayName,
        status: getStatusLabel(newStatus, lang),
      }),
    );
    updated = true;
  } else if (newStatus === 'offline') {
    let message = translate(lang, 'logs.statusOffline', {
      user: displayName,
      status: getStatusLabel('offline', lang),
    });
    if (config.sessionStart) {
      const duration = now - config.sessionStart;
      const totalBefore = (await db.get(accumKey(config.userId))) ?? 0;
      const newTotal = totalBefore + duration;
      await db.set(accumKey(config.userId), newTotal);
      message = `${message} ${translate(lang, 'logs.sessionSummary', {
        session: formatDuration(duration, lang),
        total: formatDuration(newTotal, lang),
      })}`;
      config.sessionStart = null;
      updated = true;
    }
    await recordEvent(config, message.trim());
    updated = true;
  }

  config.lastStatus = newStatus;
  config.lastStatusAt = now;
  return updated;
}

async function processActivityChanges(config, oldPresence, newPresence, lang) {
  const member = newPresence?.member ?? oldPresence?.member;
  const displayName = member?.displayName ?? member?.user?.tag ?? config.userId;

  const oldActivities = (oldPresence?.activities ?? []).filter((activity) => activity.type !== ActivityType.Custom);
  const newActivities = (newPresence?.activities ?? []).filter((activity) => activity.type !== ActivityType.Custom);

  const oldMap = new Map(oldActivities.map((activity) => [activitySignature(activity), activity]));
  const newMap = new Map(newActivities.map((activity) => [activitySignature(activity), activity]));

  let updated = false;

  for (const [signature, activity] of newMap.entries()) {
    if (!oldMap.has(signature)) {
      await recordEvent(
        config,
        translate(lang, 'logs.activityStart', {
          user: displayName,
          verb: getActivityVerb(activity, lang, 'start'),
          activity: activity.name,
        }),
      );
      updated = true;
    }
  }

  for (const [signature, activity] of oldMap.entries()) {
    if (!newMap.has(signature)) {
      await recordEvent(
        config,
        translate(lang, 'logs.activityStop', {
          user: displayName,
          verb: getActivityVerb(activity, lang, 'stop'),
          activity: activity.name,
        }),
      );
      updated = true;
    }
  }

  return updated;
}

async function processCustomStatusChange(config, oldPresence, newPresence, lang) {
  const previousDetected = getCustomStatusText(oldPresence);
  const storedPrevious = config.lastCustomStatus ?? null;
  const previous = previousDetected ?? storedPrevious ?? null;
  const next = getCustomStatusText(newPresence);

  if (previous === next) {
    return false;
  }

  const noneLabel = translate(lang, 'customStatus.none');
  const oldDisplay = previous ?? noneLabel;
  const newDisplay = next ?? noneLabel;

  await recordEvent(
    config,
    translate(lang, 'logs.customStatus', {
      userId: config.userId,
      old: oldDisplay,
      new: newDisplay,
    }),
  );

  config.lastCustomStatus = next ?? null;
  config.lastCustomStatusAt = Date.now();

  return true;
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);

  try {
    const entries = await db.all();
    const monitorEntries = entries.filter((entry) => entry.id.startsWith('monitor.'));

    await Promise.all(
      monitorEntries.map(async (entry) => {
        const guildId = entry.id.split('.')[1];
        const config = entry.value ?? {};
        const guild = readyClient.guilds.cache.get(guildId);
        if (!guild || !config.userId) {
          return;
        }

        const lang = safeLanguage(config.language) || (await getGuildLanguage(guildId));
        config.language = lang;

        try {
          const member = await guild.members.fetch(config.userId);
          const currentStatus = member.presence?.status ?? 'offline';
          config.lastStatus = currentStatus;
          config.lastStatusAt = Date.now();
          const customStatus = getCustomStatusText(member.presence);
          config.lastCustomStatus = customStatus ?? null;
          config.lastCustomStatusAt = customStatus ? Date.now() : null;
          if (!config.lastActivity) {
            config.lastActivity = translate(lang, 'general.noActivityLogged');
            config.lastActivityAt = null;
          }
          if (currentStatus === 'offline') {
            config.sessionStart = null;
          } else if (!config.sessionStart && ACTIVE_STATUSES.has(currentStatus)) {
            config.sessionStart = Date.now();
          }
          await db.set(entry.id, config);
        } catch (error) {
          console.warn(`Unable to refresh monitoring state for guild ${guildId}:`, error.message);
        }
      }),
    );
  } catch (error) {
    console.error('Failed to refresh monitor state during startup:', error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot || !message.content.startsWith(PREFIX)) {
    return;
  }

  const [commandName, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = commandName?.toLowerCase();
  if (!command) return;

  const guildId = message.guild.id;
  let lang = await getGuildLanguage(guildId);

  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(translate(lang, 'help.title'))
      .setDescription(translate(lang, 'help.description'))
      .addFields(
        { name: '!monitor @user', value: translate(lang, 'help.fields.monitor') },
        { name: '!stopmonitor', value: translate(lang, 'help.fields.stopmonitor') },
        { name: '!status', value: translate(lang, 'help.fields.status') },
        { name: '!setlang <code>', value: translate(lang, 'help.fields.setlang') },
        { name: '!help', value: translate(lang, 'help.fields.help') },
      )
      .setFooter({ text: translate(lang, 'general.helpFooter') })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    return;
  }

  if (command === 'setlang') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply(translate(lang, 'general.manageRequiredLang'));
      return;
    }

    const input = (args[0] || '').toLowerCase();
    if (!input) {
      await message.reply(translate(lang, 'general.languageMissingArgument'));
      return;
    }

    if (!SUPPORTED_LANGUAGES.has(input)) {
      const languages = Array.from(SUPPORTED_LANGUAGES).join(', ');
      await message.reply(translate(lang, 'language.invalid', { languages }));
      return;
    }

    const newLang = safeLanguage(input);
    if (lang === newLang) {
      await message.reply(translate(lang, 'general.languageAlreadySet', {
        language: translate(lang, `language.names.${newLang}`),
      }));
      return;
    }

    const previousLang = lang;
    const monitorConfig = await db.get(monitorKey(guildId));

    await setGuildLanguage(guildId, newLang);
    lang = newLang;

    if (monitorConfig) {
      monitorConfig.language = newLang;
      if (
        !monitorConfig.lastActivity ||
        monitorConfig.lastActivity === translate(previousLang, 'general.noActivityLogged')
      ) {
        monitorConfig.lastActivity = translate(newLang, 'general.noActivityLogged');
        monitorConfig.lastActivityAt = null;
      }
      await db.set(monitorKey(guildId), monitorConfig);
    }

    await message.reply(translate(newLang, `language.updated.${newLang}`));
    return;
  }

  if (command === 'monitor') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply(translate(lang, 'general.manageRequired'));
      return;
    }

    const target = message.mentions.users.first();
    if (!target) {
      await message.reply(translate(lang, 'general.mentionRequired'));
      return;
    }

    const config = {
      userId: target.id,
      channelId: message.channel.id,
      sessionStart: null,
      lastStatus: 'offline',
      lastStatusAt: Date.now(),
      lastActivity: translate(lang, 'general.noActivityLogged'),
      lastActivityAt: null,
      lastCustomStatus: null,
      lastCustomStatusAt: null,
      language: lang,
    };

    await db.set(monitorKey(guildId), config);

    await message.reply(
      translate(lang, 'monitor.success', {
        userId: target.id,
      }),
    );

    return;
  }

  if (command === 'stopmonitor') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply(translate(lang, 'general.manageRequired'));
      return;
    }

    const key = monitorKey(guildId);
    const existing = await db.get(key);
    if (!existing) {
      await message.reply(translate(lang, 'general.monitoringNotConfigured'));
      return;
    }

    await db.delete(key);
    await message.reply(translate(lang, 'stopmonitor.success'));
    return;
  }

  if (command === 'status') {
    const config = await db.get(monitorKey(guildId));
    if (!config || !config.userId) {
      await message.reply(translate(lang, 'general.nothingMonitored'));
      return;
    }

    const configLang = safeLanguage(config.language) || lang;
    if (config.language !== configLang) {
      config.language = configLang;
      await db.set(monitorKey(guildId), config);
    }

    const totalMs = (await db.get(accumKey(config.userId))) ?? 0;
    const isActive = config.sessionStart && ACTIVE_STATUSES.has(config.lastStatus);
    const currentSessionMs = isActive ? Date.now() - config.sessionStart : 0;
    const lastActivity = config.lastActivity ?? translate(configLang, 'general.noActivityLogged');
    const lastCustomStatus = config.lastCustomStatus;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(translate(configLang, 'status.embedTitle'))
      .addFields(
        {
          name: translate(configLang, 'status.fields.monitoredUser'),
          value: `<@${config.userId}>`,
          inline: true,
        },
        {
          name: translate(configLang, 'status.fields.lastStatus'),
          value: config.lastStatus
            ? getStatusLabel(config.lastStatus, configLang)
            : getStatusLabel('offline', configLang),
          inline: true,
        },
        {
          name: translate(configLang, 'status.fields.totalActiveTime'),
          value: formatDuration(totalMs, configLang),
          inline: true,
        },
      )
      .setTimestamp();

    if (isActive) {
      embed.addFields({
        name: translate(configLang, 'status.fields.currentSession'),
        value: translate(configLang, 'status.currentSessionValue', {
          duration: formatDuration(currentSessionMs, configLang),
        }),
        inline: true,
      });
    }

    embed.addFields(
      {
        name: translate(configLang, 'status.fields.lastCustomStatus'),
        value: lastCustomStatus ? `‘${lastCustomStatus}’` : translate(configLang, 'status.noCustomStatus'),
      },
      {
        name: translate(configLang, 'status.fields.lastActivity'),
        value: lastActivity,
      },
    );

    await message.reply({ embeds: [embed] });
    return;
  }
});

client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
  try {
    const guild = newPresence?.guild ?? oldPresence?.guild;
    if (!guild) return;

    const key = monitorKey(guild.id);
    const config = await db.get(key);
    if (!config || config.userId !== newPresence?.userId) {
      return;
    }

    let updated = false;
    let lang = safeLanguage(config.language);
    if (!lang) {
      lang = await getGuildLanguage(guild.id);
      config.language = lang;
      updated = true;
    }

    if (!Object.prototype.hasOwnProperty.call(config, 'lastCustomStatus')) {
      config.lastCustomStatus = null;
      config.lastCustomStatusAt = null;
      updated = true;
    }

    const oldStatus = oldPresence?.status ?? 'offline';
    const newStatus = newPresence?.status ?? 'offline';

    const statusChanged = await processStatusChange(config, oldStatus, newStatus, newPresence, lang);
    if (statusChanged) {
      updated = true;
    }

    const activityChanged = await processActivityChanges(config, oldPresence, newPresence, lang);
    if (activityChanged) {
      updated = true;
    }

    const customStatusChanged = await processCustomStatusChange(config, oldPresence, newPresence, lang);
    if (customStatusChanged) {
      updated = true;
    }

    if (updated) {
      await db.set(key, config);
    }
  } catch (error) {
    console.error('Error handling presence update:', error);
  }
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('SIGINT', async () => {
  console.log('Shutting down bot...');
  try {
    await client.destroy();
  } finally {
    process.exit(0);
  }
});

const token = "OTAzMjk1NTE1MTE3MTA1MTUy.GJTD-m.xMJshE9Jx1IedDxQkHfU9KCFinTJtm-DMbhApU"
if (!token) {
  console.error('Missing DISCORD_TOKEN or BOT_TOKEN environment variable. Please set your bot token before starting.');
  process.exit(1);
}

client
  .login(token)
  .catch((error) => {
    console.error('Failed to login to Discord:', error);
    process.exit(1);
  });
