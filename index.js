'use strict';

require('dotenv').config();

const path = require('path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType,
  ComponentType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
} = require('discord.js');
const { QuickDB } = require('quick.db');
const { startKeepAlive } = require('./keepAlive');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const { registerables } = require('chart.js');

const db = new QuickDB({ filePath: path.join(__dirname, 'presence.sqlite') });

const PREFIX = '!';
const ACTIVE_STATUSES = new Set(['online', 'idle', 'dnd']);
const DEFAULT_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = new Set(['en', 'tr']);
const BOT_OWNER_ID = '599189960725364747';
const CUSTOM_PLAYING = process.env.CUSTOM_PLAYING?.trim();
const ANALYTICS_MAX_DAYS = 30;
const presenceSessions = new Map();
const voiceSessions = new Map();
const DAY_IN_MS = 86_400_000;
const chartRenderer = new ChartJSNodeCanvas({
  width: 900,
  height: 420,
  backgroundColour: '#0f172a',
  chartCallback: (ChartJS) => {
    ChartJS.register(...registerables);
    ChartJS.defaults.color = '#e5e7eb';
    ChartJS.defaults.font.family = 'Segoe UI, Helvetica Neue, Arial, sans-serif';
    ChartJS.defaults.font.size = 14;
  },
});
let ownerUserCache = null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
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
  ownerOnly: '❌ Only the bot owner can use this command.',
      mentionRequired: '⚠️ Please mention a user to monitor, e.g. `!monitor @username`.',
      monitoringNotConfigured: 'ℹ️ Monitoring is not configured for this server.',
      nothingMonitored: 'ℹ️ No user is currently being monitored in this server.',
      noActivityLogged: 'No activity logged yet.',
      helpFooter: 'Presence Stalker Bot',
      languageAlreadySet: 'ℹ️ Language is already set to {language}.',
      languageMissingArgument: '⚠️ Please supply a language code (en/tr).',
  deleteFailed: '❌ Failed to delete data. Please check the bot logs for details.',
    },
    help: {
      title: 'Presence Monitor Help',
      description: 'Command prefix: `!`',
      fields: {
  monitor: 'Admins only. Start monitoring a member and relay updates to the bot owner via DM.',
        stopmonitor: 'Admins only. Stop monitoring in this guild and clear the saved channel.',
  status: "Show the monitored user's total active time, latest status, and last activity.",
  analytics: 'Admins only. View charts and rankings for recent activity (e.g. `!analytics 30 @user`).',
  help: 'Display this help message.',
  setlang: 'Admins only. Switch between English and Turkish (e.g. `!setlang tr`).',
      },
    },
    monitor: {
      prompt: 'Do you want me to send it in DMs?',
      successDm: '✅ Now monitoring <@{userId}>. Updates will arrive via DM.',
      successChannel: '✅ Now monitoring <@{userId}>. Updates will post in this channel.',
      timeout: '⌛ Monitoring cancelled because no option was selected.',
      notYourButtons: '❌ Only the admin who used the command can choose an option.',
      buttons: {
        dm: 'Yes, send in DM',
        channel: 'No, send here',
      },
    },
    stopmonitor: {
      success: '🛑 Monitoring disabled for this server.',
    },
    delete: {
      confirm: '🧹 All monitoring data has been deleted.',
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
    analytics: {
      manageRequired: '❌ You need the **Manage Server** permission to view analytics.',
      title: '{guild} analytics — {range}',
      ranges: {
        7: 'Last 7 days',
        30: 'Last 30 days',
      },
      noData: 'Not enough data recorded yet.',
      sections: {
        activity: 'Top Active Users',
        voice: 'Voice Channel Leaders',
        messages: 'Top Messages in {channel}',
      },
      autoChannelNote: 'Showing busiest channel automatically: {channel}',
      specificChannelNote: 'Channel: {channel}',
      messageCount: '{count} messages',
      noMessages: 'No message activity recorded for this range.',
      footer: 'Analytics window: last 30 days of history.',
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
  ownerOnly: '❌ Bu komutu yalnızca bot sahibi kullanabilir.',
      mentionRequired: '⚠️ Lütfen izlemek için bir kullanıcı etiketleyin, örn. `!monitor @kullanici`.',
      monitoringNotConfigured: 'ℹ️ Bu sunucuda izleme yapılandırılmadı.',
      nothingMonitored: 'ℹ️ Bu sunucuda şu anda izlenen bir kullanıcı yok.',
      noActivityLogged: 'Henüz etkinlik kaydedilmedi.',
      helpFooter: 'Presence Stalker Bot',
      languageAlreadySet: 'ℹ️ Dil zaten {language} olarak ayarlı.',
      languageMissingArgument: '⚠️ Lütfen bir dil kodu belirtin (en/tr).',
  deleteFailed: '❌ Veriler silinemedi. Ayrıntılar için bot günlüklerini kontrol edin.',
    },
    help: {
      title: 'Presence Monitor Yardımı',
      description: 'Komut ön eki: `!`',
      fields: {
  monitor: 'Sadece yöneticiler. Bir üyeyi izlemeye başlayın ve güncellemeleri bot sahibine DM olarak iletin.',
        stopmonitor: 'Sadece yöneticiler. Bu sunucuda izlemeyi durdurur ve kayıtlı kanalı temizler.',
  status: 'İzlenen kullanıcının toplam aktif süresini, son durumunu ve son etkinliğini gösterir.',
  analytics: 'Sadece yöneticiler. Son etkinlik için grafik ve sıralamaları görüntüler (örn. `!analytics 30 @kullanıcı`).',
  help: 'Bu yardım mesajını gösterir.',
  setlang: 'Sadece yöneticiler. İngilizce ve Türkçe arasında geçiş yapar (örn. `!setlang tr`).',
      },
    },
    monitor: {
      prompt: 'Güncellemeleri DM olarak göndermemi ister misiniz?',
      successDm: '✅ Artık <@{userId}> izleniyor. Güncellemeler DM olarak gönderilecek.',
      successChannel: '✅ Artık <@{userId}> izleniyor. Güncellemeler bu kanala gönderilecek.',
      timeout: '⌛ Hiçbir seçenek seçilmediği için izleme iptal edildi.',
      notYourButtons: '❌ Yalnızca komutu kullanan yönetici bir seçenek seçebilir.',
      buttons: {
        dm: 'Evet, DM olarak gönder',
        channel: 'Hayır, buraya gönder',
      },
    },
    stopmonitor: {
      success: '🛑 Bu sunucu için izleme devre dışı bırakıldı.',
    },
    delete: {
      confirm: '🧹 Tüm izleme verileri silindi.',
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
    analytics: {
      manageRequired: '❌ Analitikleri görüntülemek için **Sunucuyu Yönet** iznine ihtiyacınız var.',
      title: '{guild} analitik — {range}',
      ranges: {
        7: 'Son 7 gün',
        30: 'Son 30 gün',
      },
      noData: 'Bu aralık için yeterli veri yok.',
      sections: {
        activity: 'En Aktif Kullanıcılar',
        voice: 'Ses Kanalı Liderleri',
        messages: '{channel} kanalındaki mesaj liderleri',
      },
      autoChannelNote: 'En yoğun kanal otomatik seçildi: {channel}',
      specificChannelNote: 'Kanal: {channel}',
      messageCount: '{count} mesaj',
      noMessages: 'Bu aralık için mesaj etkinliği yok.',
      footer: 'Analitik kapsamı: Son 30 günlük geçmiş.',
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

function formatDateKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clampAnalyticsDays(days) {
  if (Number.isNaN(Number(days))) return 7;
  return Math.max(1, Math.min(ANALYTICS_MAX_DAYS, Number(days)));
}

function splitDurationByDay(start, end) {
  if (!start || !end || end <= start) {
    return [];
  }

  const segments = [];
  let cursor = start;
  while (cursor < end) {
    const cursorDate = new Date(cursor);
    const nextMidnight = Date.UTC(
      cursorDate.getUTCFullYear(),
      cursorDate.getUTCMonth(),
      cursorDate.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    );
    const segmentEnd = Math.min(end, nextMidnight);
    segments.push({ date: formatDateKey(cursor), duration: segmentEnd - cursor });
    cursor = segmentEnd;
  }
  return segments;
}

async function addDurationToAnalytics(type, guildId, userId, start, end) {
  const segments = splitDurationByDay(start, end);
  await Promise.all(
    segments.map(async ({ date, duration }) => {
      if (duration <= 0) return;
      await db.add(`analytics.${type}.${guildId}.${userId}.${date}`, duration);
    }),
  );
}

async function addVoiceDuration(guildId, userId, channelId, start, end) {
  const segments = splitDurationByDay(start, end);
  await Promise.all(
    segments.map(async ({ date, duration }) => {
      if (duration <= 0) return;
      const baseKey = `analytics.voice.${guildId}.${userId}.${date}`;
      await db.add(baseKey, duration);
      if (channelId) {
        await db.add(`analytics.voiceChannels.${guildId}.${channelId}.${date}.${userId}`, duration);
      }
    }),
  );
}

function presenceSessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function voiceSessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function presenceSessionStoreKey(guildId, userId) {
  return `analytics.sessions.activity.${guildId}.${userId}`;
}

function voiceSessionStoreKey(guildId, userId) {
  return `analytics.sessions.voice.${guildId}.${userId}`;
}

async function startPresenceSession(guildId, userId, start) {
  const key = presenceSessionKey(guildId, userId);
  if (!presenceSessions.has(key)) {
    presenceSessions.set(key, start);
    await db.set(presenceSessionStoreKey(guildId, userId), { start });
  }
}

async function endPresenceSession(guildId, userId, end) {
  const key = presenceSessionKey(guildId, userId);
  let start = presenceSessions.get(key);
  if (!start) {
    const stored = await db.get(presenceSessionStoreKey(guildId, userId));
    if (stored?.start) {
      start = stored.start;
    }
  }

  presenceSessions.delete(key);
  await db.delete(presenceSessionStoreKey(guildId, userId));

  if (start && end > start) {
    await addDurationToAnalytics('activity', guildId, userId, start, end);
  }
}

async function startVoiceSession(guildId, userId, channelId, start) {
  const key = voiceSessionKey(guildId, userId);
  const payload = { start, channelId };
  voiceSessions.set(key, payload);
  await db.set(voiceSessionStoreKey(guildId, userId), payload);
}

async function endVoiceSession(guildId, userId, fallbackChannelId, end) {
  const key = voiceSessionKey(guildId, userId);
  let session = voiceSessions.get(key);
  if (!session) {
    session = await db.get(voiceSessionStoreKey(guildId, userId));
  }

  voiceSessions.delete(key);
  await db.delete(voiceSessionStoreKey(guildId, userId));

  const start = session?.start;
  const channelId = session?.channelId ?? fallbackChannelId;
  if (start && end > start) {
    await addVoiceDuration(guildId, userId, channelId, start, end);
  }
}

async function incrementMessageCount(guildId, channelId, userId, timestamp) {
  if (!guildId || !channelId || !userId) return;
  const dateKey = formatDateKey(timestamp);
  await db.add(`analytics.messages.${guildId}.${channelId}.${dateKey}.${userId}`, 1);
}

async function handlePresenceAnalytics(oldPresence, newPresence) {
  const guild = newPresence?.guild ?? oldPresence?.guild;
  if (!guild) return;

  const userId = newPresence?.userId ?? oldPresence?.userId;
  if (!userId || userId === client.user.id) {
    return;
  }

  const oldStatus = oldPresence?.status ?? 'offline';
  const newStatus = newPresence?.status ?? 'offline';
  const wasActive = ACTIVE_STATUSES.has(oldStatus);
  const isActive = ACTIVE_STATUSES.has(newStatus);
  const now = Date.now();

  if (isActive && !wasActive) {
    await startPresenceSession(guild.id, userId, now);
    return;
  }

  if (!isActive && wasActive) {
    await endPresenceSession(guild.id, userId, now);
    return;
  }

  const key = presenceSessionKey(guild.id, userId);
  if (isActive && !presenceSessions.has(key)) {
    await startPresenceSession(guild.id, userId, now);
  }
}

async function handleVoiceAnalytics(oldState, newState) {
  const guild = newState?.guild ?? oldState?.guild;
  if (!guild) return;

  const userId = newState?.id ?? oldState?.id;
  if (!userId || userId === client.user.id) {
    return;
  }

  const oldChannelId = oldState?.channelId ?? null;
  const newChannelId = newState?.channelId ?? null;
  const now = Date.now();

  if (oldChannelId && oldChannelId !== newChannelId) {
    await endVoiceSession(guild.id, userId, oldChannelId, now);
  }

  if (newChannelId && newChannelId !== oldChannelId) {
    await startVoiceSession(guild.id, userId, newChannelId, now);
  }

  if (!newChannelId && !oldChannelId) {
    const key = voiceSessionKey(guild.id, userId);
    if (voiceSessions.has(key)) {
      await endVoiceSession(guild.id, userId, voiceSessions.get(key)?.channelId ?? null, now);
    }
  }

  if (newChannelId && newChannelId === oldChannelId) {
    const key = voiceSessionKey(guild.id, userId);
    if (!voiceSessions.has(key)) {
      const stored = await db.get(voiceSessionStoreKey(guild.id, userId));
      const start = stored?.start ?? now;
      await startVoiceSession(guild.id, userId, newChannelId, start);
    }
  }
}

function getLocaleForLanguage(lang) {
  return lang === 'tr' ? 'tr-TR' : 'en-US';
}

function buildRecentDateKeys(days) {
  const normalized = clampAnalyticsDays(days);
  const keys = [];
  const now = Date.now();
  for (let offset = normalized - 1; offset >= 0; offset -= 1) {
    const timestamp = now - offset * DAY_IN_MS;
    keys.push(formatDateKey(timestamp));
  }
  return keys;
}

function formatChartLabel(dateKey, lang) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const formatter = new Intl.DateTimeFormat(getLocaleForLanguage(lang), {
    month: 'short',
    day: 'numeric',
  });
  return formatter.format(new Date(Date.UTC(year, month - 1, day)));
}

function msToHours(ms) {
  return Math.round((ms / 3_600_000) * 100) / 100;
}

function formatNumberPretty(value, lang) {
  const locale = getLocaleForLanguage(lang);
  return new Intl.NumberFormat(locale).format(Math.round(value));
}

function sumDurationsForDates(source = {}, dateKeys) {
  return dateKeys.reduce((total, dateKey) => {
    const value = source?.[dateKey];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return total + value;
    }
    return total;
  }, 0);
}

async function getActivitySeries(guildId, userId, days) {
  const dateKeys = buildRecentDateKeys(days);
  const store = (await db.get(`analytics.activity.${guildId}.${userId}`)) ?? {};
  const series = dateKeys.map((dateKey) => {
    const value = store?.[dateKey];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  });
  return { dateKeys, series };
}

async function getTopActivityUsers(guildId, days, limit = 5) {
  const dateKeys = buildRecentDateKeys(days);
  const store = (await db.get(`analytics.activity.${guildId}`)) ?? {};
  const entries = Object.entries(store).map(([userId, value]) => ({
    userId,
    total: sumDurationsForDates(value, dateKeys),
  }));
  return entries
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

async function getTopVoiceUsers(guildId, days, limit = 5) {
  const dateKeys = buildRecentDateKeys(days);
  const store = (await db.get(`analytics.voice.${guildId}`)) ?? {};
  const entries = Object.entries(store).map(([userId, value]) => ({
    userId,
    total: sumDurationsForDates(value, dateKeys),
  }));
  return entries
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

async function getMessageLeaderboard(guildId, days, requestedChannelId = null, limit = 5) {
  const dateKeys = buildRecentDateKeys(days);
  const store = (await db.get(`analytics.messages.${guildId}`)) ?? {};

  let targetChannelId = requestedChannelId ?? null;
  let targetChannelData = targetChannelId ? store?.[targetChannelId] ?? {} : null;
  let targetTotal = 0;

  const computeChannelTotal = (channelData = {}) =>
    dateKeys.reduce((sum, dateKey) => {
      const users = channelData?.[dateKey];
      if (!users) return sum;
      return (
        sum +
        Object.values(users).reduce((inner, value) => {
          if (typeof value === 'number' && Number.isFinite(value)) {
            return inner + value;
          }
          return inner;
        }, 0)
      );
    }, 0);

  if (!targetChannelId) {
    for (const [channelId, channelData] of Object.entries(store)) {
      const total = computeChannelTotal(channelData);
      if (total > targetTotal) {
        targetTotal = total;
        targetChannelId = channelId;
        targetChannelData = channelData;
      }
    }
  } else {
    targetTotal = computeChannelTotal(targetChannelData);
  }

  if (!targetChannelId) {
    return null;
  }

  const perUser = new Map();
  for (const dateKey of dateKeys) {
    const users = targetChannelData?.[dateKey];
    if (!users) continue;
    for (const [userId, count] of Object.entries(users)) {
      if (typeof count !== 'number' || !Number.isFinite(count)) continue;
      perUser.set(userId, (perUser.get(userId) ?? 0) + count);
    }
  }

  const leaders = Array.from(perUser.entries())
    .map(([userId, total]) => ({ userId, total }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  return {
    channelId: targetChannelId,
    total: targetTotal,
    leaders,
    requested: Boolean(requestedChannelId),
  };
}

async function resolveUserLabels(guild, userIds) {
  const map = new Map();
  const unique = Array.from(new Set(userIds));
  await Promise.all(
    unique.map(async (userId) => {
      try {
        const member =
          guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
        if (member) {
          map.set(userId, member.displayName);
          return;
        }
      } catch (error) {
        // ignore
      }
      try {
        const user = await client.users.fetch(userId);
        map.set(userId, user.username ?? user.tag ?? userId);
      } catch (error) {
        map.set(userId, userId);
      }
    }),
  );
  return map;
}

async function createActivityChartAttachment(userLabel, lang, dateKeys, seriesMs, days) {
  const labels = dateKeys.map((date) => formatChartLabel(date, lang));
  const dataPoints = seriesMs.map((ms) => msToHours(ms));
  const totalHours = dataPoints.reduce((sum, value) => sum + value, 0);

  const configuration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Active hours',
          data: dataPoints,
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.25)',
          borderWidth: 3,
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: '#93c5fd',
        },
      ],
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        title: {
          display: true,
          text: `${userLabel} • ${days}-day activity (${totalHours.toFixed(1)}h)`,
          color: '#f9fafb',
          font: {
            size: 20,
            weight: '600',
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#cbd5f5',
          },
          grid: {
            color: 'rgba(255,255,255,0.05)',
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: '#cbd5f5',
            callback: (value) => `${value}h`,
          },
          grid: {
            color: 'rgba(255,255,255,0.08)',
          },
        },
      },
    },
  };

  const buffer = await chartRenderer.renderToBuffer(configuration, 'image/png');
  return new AttachmentBuilder(buffer, { name: `analytics-activity-${days}d.png` });
}

async function recordEvent(config, content) {
  const entry = await appendLog(config.userId, content);
  config.lastActivity = content;
  config.lastActivityAt = entry.timestamp;

  const deliveryMode = config.deliveryMode ?? 'dm';

  if (deliveryMode === 'channel' && config.channelId) {
    try {
      const channel =
        client.channels.cache.get(config.channelId) ??
        (await client.channels.fetch(config.channelId).catch(() => null));
      if (channel && typeof channel.isTextBased === 'function' && channel.isTextBased()) {
        await channel.send({ content });
        return;
      }
    } catch (error) {
      console.error('Failed to send log message to channel:', error);
    }
  }

  const targetUserId = config.deliveryUserId ?? BOT_OWNER_ID;
  if (targetUserId) {
    try {
      const user = await client.users.fetch(targetUserId);
      await user.send({ content });
      return;
    } catch (error) {
      console.error('Failed to send log DM:', error);
    }
  }

  const ownerUser = await getOwnerUser();
  if (!ownerUser || ownerUser.id === targetUserId) {
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

  if (CUSTOM_PLAYING) {
    try {
      await readyClient.user.setPresence({
        activities: [{ name: 'watching over the server', type: ActivityType.Playing }],
      });
      console.log(`🎮 Custom playing set to: ${CUSTOM_PLAYING}`);
    } catch (error) {
      console.error('Failed to set custom playing presence:', error);
    }
  }

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

        if (!config.deliveryMode) {
          config.deliveryMode = 'dm';
        }
        if (config.deliveryMode === 'dm' && !config.deliveryUserId) {
          config.deliveryUserId = BOT_OWNER_ID;
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

    const now = Date.now();
    const activitySessions = entries.filter((entry) => entry.id.startsWith('analytics.sessions.activity.'));
    await Promise.all(
      activitySessions.map(async (entry) => {
        const [, , , guildId, userId] = entry.id.split('.');
        const start = entry.value?.start;
        if (!guildId || !userId || !start) {
          await db.delete(entry.id);
          return;
        }

        const guild = readyClient.guilds.cache.get(guildId);
        if (!guild) {
          await db.delete(entry.id);
          return;
        }

        const member =
          guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
        const status = member?.presence?.status ?? 'offline';
        if (ACTIVE_STATUSES.has(status)) {
          presenceSessions.set(presenceSessionKey(guildId, userId), start);
        } else {
          await addDurationToAnalytics('activity', guildId, userId, start, now);
          await db.delete(entry.id);
        }
      }),
    );

    const voiceSessionEntries = entries.filter((entry) => entry.id.startsWith('analytics.sessions.voice.'));
    await Promise.all(
      voiceSessionEntries.map(async (entry) => {
        const [, , , guildId, userId] = entry.id.split('.');
        const { start, channelId } = entry.value ?? {};
        if (!guildId || !userId || !start || !channelId) {
          await db.delete(entry.id);
          return;
        }

        const guild = readyClient.guilds.cache.get(guildId);
        if (!guild) {
          await db.delete(entry.id);
          return;
        }

        const member =
          guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
        if (member?.voice?.channelId === channelId) {
          voiceSessions.set(voiceSessionKey(guildId, userId), { start, channelId });
        } else {
          await addVoiceDuration(guildId, userId, channelId, start, now);
          await db.delete(entry.id);
        }
      }),
    );
  } catch (error) {
    console.error('Failed to refresh monitor state during startup:', error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.guild && !message.author.bot) {
    incrementMessageCount(message.guild.id, message.channel.id, message.author.id, message.createdTimestamp ?? Date.now()).catch(
      (error) => console.error('Failed to record message analytics:', error),
    );
  }

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

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('monitor_dm')
        .setLabel(translate(lang, 'monitor.buttons.dm'))
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('monitor_channel')
        .setLabel(translate(lang, 'monitor.buttons.channel'))
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger),
    );

    const promptMessage = await message.reply({
      content: translate(lang, 'monitor.prompt'),
      components: [row],
    });

    const filter = async (interaction) => {
      if (interaction.user.id !== message.author.id) {
        await interaction.reply({
          content: translate(lang, 'monitor.notYourButtons'),
          ephemeral: true,
        });
        return false;
      }
      return true;
    };

    const interaction = await promptMessage
      .awaitMessageComponent({ filter, componentType: ComponentType.Button, time: 30_000 })
      .catch(() => null);

    if (!interaction) {
      await promptMessage.edit({
        content: translate(lang, 'monitor.timeout'),
        components: [],
      });
      return;
    }

    const deliveryMode = interaction.customId === 'monitor_dm' ? 'dm' : 'channel';

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
      deliveryMode,
      deliveryUserId: deliveryMode === 'dm' ? message.author.id : null,
    };

    await db.set(monitorKey(guildId), config);

    const successKey = deliveryMode === 'dm' ? 'monitor.successDm' : 'monitor.successChannel';
    await interaction.update({
      content: translate(lang, successKey, {
        userId: target.id,
      }),
      components: [],
    });

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

  if (command === 'delete') {
    if (message.author.id !== BOT_OWNER_ID) {
      await message.reply(translate(lang, 'general.ownerOnly'));
      return;
    }

    try {
      await db.deleteAll();
      presenceSessions.clear();
      voiceSessions.clear();
      await message.reply(translate(lang, 'delete.confirm'));
    } catch (error) {
      console.error('Failed to clear database:', error);
      await message.reply(translate(lang, 'general.deleteFailed'));
    }

    return;
  }

  if (command === 'analytics') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply(translate(lang, 'analytics.manageRequired'));
      return;
    }

    let days = 7;
    for (const arg of args) {
      if (['7', '30'].includes(arg)) {
        days = Number(arg);
        break;
      }
    }
    days = clampAnalyticsDays(days);

    const targetUser = message.mentions.users.first() ?? message.author;
    const requestedChannelMention = message.mentions.channels.first() ?? null;
    const requestedChannelId = requestedChannelMention?.id ?? null;

    const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
    const userLabel = targetMember?.displayName ?? targetUser.tag ?? `<@${targetUser.id}>`;

    const [activitySeries, topActive, topVoice, messageLeaderboard] = await Promise.all([
      getActivitySeries(guildId, targetUser.id, days),
      getTopActivityUsers(guildId, days, 5),
      getTopVoiceUsers(guildId, days, 5),
      getMessageLeaderboard(guildId, days, requestedChannelId, 5),
    ]);

    const chartAttachment = await createActivityChartAttachment(
      userLabel,
      lang,
      activitySeries.dateKeys,
      activitySeries.series,
      days,
    );

    const userIdsForLabels = new Set([targetUser.id]);
    for (const entry of topActive) userIdsForLabels.add(entry.userId);
    for (const entry of topVoice) userIdsForLabels.add(entry.userId);
    if (messageLeaderboard) {
      for (const entry of messageLeaderboard.leaders) userIdsForLabels.add(entry.userId);
    }

    const labelMap = await resolveUserLabels(message.guild, Array.from(userIdsForLabels));

    const activityFieldValue = topActive.length
      ? topActive
          .map((entry, index) => {
            const name = labelMap.get(entry.userId) ?? `<@${entry.userId}>`;
            return `**${index + 1}.** ${name} — ${formatDuration(entry.total, lang)}`;
          })
          .join('\n')
      : translate(lang, 'analytics.noData');

    const voiceFieldValue = topVoice.length
      ? topVoice
          .map((entry, index) => {
            const name = labelMap.get(entry.userId) ?? `<@${entry.userId}>`;
            return `**${index + 1}.** ${name} — ${formatDuration(entry.total, lang)}`;
          })
          .join('\n')
      : translate(lang, 'analytics.noData');

    let messageFieldName = translate(lang, 'analytics.sections.messages', {
      channel: requestedChannelMention?.toString() ?? '#—',
    });
    let messageFieldValue = translate(lang, 'analytics.noMessages');
    if (messageLeaderboard) {
      const channel =
        message.guild.channels.cache.get(messageLeaderboard.channelId) ??
        (await message.guild.channels.fetch(messageLeaderboard.channelId).catch(() => null));
      const channelDisplay = channel?.toString() ?? `#${messageLeaderboard.channelId}`;
      messageFieldName = translate(lang, 'analytics.sections.messages', {
        channel: channelDisplay,
      });

      if (messageLeaderboard.leaders.length) {
        const noteKey = messageLeaderboard.requested
          ? 'analytics.specificChannelNote'
          : 'analytics.autoChannelNote';
        const note = translate(lang, noteKey, { channel: channelDisplay });
        const leaderText = messageLeaderboard.leaders
          .map((entry, index) => {
            const name = labelMap.get(entry.userId) ?? `<@${entry.userId}>`;
            const formattedCount = formatNumberPretty(entry.total, lang);
            return `**${index + 1}.** ${name} — ${translate(lang, 'analytics.messageCount', {
              count: formattedCount,
            })}`;
          })
          .join('\n');
        messageFieldValue = `${leaderText}\n\n*${note}*`;
      } else if (messageLeaderboard.requested) {
        messageFieldValue = translate(lang, 'analytics.noMessages');
      } else {
        messageFieldValue = translate(lang, 'analytics.noMessages');
      }
    }

    const rangeLabel =
      translate(lang, `analytics.ranges.${days}`) ?? translate(DEFAULT_LANGUAGE, `analytics.ranges.${days}`) ?? `${days} days`;

    const embed = new EmbedBuilder()
      .setColor(0x1f2937)
      .setTitle(
        translate(lang, 'analytics.title', {
          guild: message.guild.name,
          range: rangeLabel,
        }),
      )
      .setDescription(`**${userLabel}** — ${rangeLabel}`)
      .addFields(
        {
          name: translate(lang, 'analytics.sections.activity'),
          value: activityFieldValue,
        },
        {
          name: translate(lang, 'analytics.sections.voice'),
          value: voiceFieldValue,
        },
        {
          name: messageFieldName,
          value: messageFieldValue,
        },
      )
      .setFooter({ text: translate(lang, 'analytics.footer') })
      .setImage(`attachment://${chartAttachment.name}`)
      .setTimestamp();

    await message.reply({ embeds: [embed], files: [chartAttachment] });
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

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    await handleVoiceAnalytics(oldState, newState);
  } catch (error) {
    console.error('Error handling voice analytics:', error);
  }
});

client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
  try {
    const guild = newPresence?.guild ?? oldPresence?.guild;
    if (!guild) return;

    await handlePresenceAnalytics(oldPresence, newPresence);

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

const token = (process.env.DISCORD_TOKEN || process.env.BOT_TOKEN || '').trim();
if (!token) {
  console.error('Missing DISCORD_TOKEN or BOT_TOKEN environment variable. Please set your bot token before starting.');
  process.exit(1);
}

startKeepAlive();

client
  .login(token)
  .catch((error) => {
    console.error('Failed to login to Discord:', error);
    process.exit(1);
  });
