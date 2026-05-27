// index.js
const dotenv = require('dotenv');
dotenv.config({ override: true });

const { Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('./database');

// Читаем настройки из .env
const config = {
  CHANNEL_ID: process.env.CHANNEL_ID,
  HIGH_ROLE_ID: process.env.HIGH_ROLE_ID,
  MAIN_ROLE_ID: process.env.MAIN_ROLE_ID,
  ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID,
  COMMANDS_CHANNEL_ID: process.env.COMMANDS_CHANNEL_ID,
  REWARD_AMOUNT: parseInt(process.env.REWARD_AMOUNT) || 100000,
  PREFIX: process.env.PREFIX || '!',
};

// Проверка обязательных настроек
if (!config.CHANNEL_ID || !config.HIGH_ROLE_ID || !config.MAIN_ROLE_ID || !config.COMMANDS_CHANNEL_ID || !config.ADMIN_ROLE_ID) {
  console.error('❌ Ошибка: В .env не указаны обязательные ID');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ]
});

async function isAdmin(member) {
  if (!member) return false;
  return member.roles.cache.has(config.ADMIN_ROLE_ID);
}

function createPublicPanel() {
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('my_invites')
        .setLabel('📊 Мои инвайты')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('who_invited')
        .setLabel('🔍 Кто пригласил')
        .setStyle(ButtonStyle.Secondary)
    );
  return row;
}

function createAdminPanel() {
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('repeat_request')
        .setLabel('🔁 Повторить заявку')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('reset_user')
        .setLabel('🗑️ Сбросить участника')
        .setStyle(ButtonStyle.Danger)
    );
  return row;
}

async function sendPublicPanel(channel) {
  const messages = await channel.messages.fetch({ limit: 20 });
  const existingPanel = messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title === '🤖 Панель управления инвайтами');
  
  const embed = new EmbedBuilder()
    .setTitle('🤖 Панель управления инвайтами')
    .setDescription('Нажми на кнопку ниже, чтобы выполнить действие.\n\n📩 **Новичкам:** Вы получите личное сообщение от бота с инструкцией.')
    .setColor(0x2b2d31)
    .setFooter({ text: 'Все ответы видны только вам' });
  
  const row = createPublicPanel();
  
  if (existingPanel) {
    await existingPanel.edit({ embeds: [embed], components: [row] });
    console.log('✅ Обычная панель обновлена');
  } else {
    await channel.send({ embeds: [embed], components: [row] });
    console.log('✅ Обычная панель отправлена');
  }
}

async function sendAdminPanel(channel) {
  const messages = await channel.messages.fetch({ limit: 20 });
  const existingPanel = messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title === '🛠️ Админ-панель');
  
  const embed = new EmbedBuilder()
    .setTitle('🛠️ Админ-панель')
    .setDescription('⚠️ Кнопки доступны только участникам с ролью <@&' + config.ADMIN_ROLE_ID + '>')
    .setColor(0xed4245)
    .setFooter({ text: 'При нажатии без прав будет ошибка' });
  
  const row = createAdminPanel();
  
  if (existingPanel) {
    await existingPanel.edit({ embeds: [embed], components: [row] });
    console.log('✅ Админ-панель обновлена');
  } else {
    await channel.send({ embeds: [embed], components: [row] });
    console.log('✅ Админ-панель отправлена');
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ Бот запущен: ${client.user.tag}`);
  
  await db.initDB();
  
  const guild = client.guilds.cache.first();
  if (guild) {
    const members = await guild.members.fetch();
    const memberIds = [...members.keys()];
    await db.markExistingAsOld(memberIds);
    console.log(`✅ Загружено ${memberIds.length} участников`);
  }
  
  const commandsChannel = client.channels.cache.get(config.COMMANDS_CHANNEL_ID);
  if (commandsChannel) {
    await sendPublicPanel(commandsChannel);
  } else {
    console.error(`❌ Канал ${config.COMMANDS_CHANNEL_ID} не найден!`);
  }
  
  console.log('🎮 Бот готов к работе!');
  console.log(`👑 Роль администратора: <@&${config.ADMIN_ROLE_ID}>`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  
  if (message.content === '!админ_панель') {
    const member = await message.guild.members.fetch(message.author.id);
    const admin = await isAdmin(member);
    
    if (!admin) {
      return message.reply({ content: '❌ У вас нет прав для этой команды. Требуется роль <@&' + config.ADMIN_ROLE_ID + '>', ephemeral: true });
    }
    
    const commandsChannel = client.channels.cache.get(config.COMMANDS_CHANNEL_ID);
    if (!commandsChannel) {
      return message.reply('❌ Канал для команд не найден!');
    }
    
    await sendAdminPanel(commandsChannel);
    await message.reply({ content: '✅ Админ-панель отправлена в канал!', ephemeral: true });
  }
});

// НОВЫЙ УЧАСТНИК
client.on(Events.GuildMemberAdd, async (member) => {
  console.log(`🔔 Событие GuildMemberAdd: ${member.user.tag} (${member.id})`);
  
  const isNew = await db.registerNewUser(member.id, Date.now());
  console.log(`📝 isNew: ${isNew}`);
  
  if (isNew) {
    console.log(`📨 Пытаюсь отправить ЛС для ${member.user.tag}...`);
    try {
      await member.send(`🎉 Добро пожаловать на сервер семьи ПЕХОТА!

Если тебя кто-то пригласил — напиши сюда **Discord ID** пригласившего.

**Как получить Discord ID:**
1. Включи в Discord "Режим разработчика" (Настройки → Дополнительно → Режим разработчика)
2. Нажми ПКМ на имени пригласившего → "Копировать ID"
3. Вставь этот ID в ответ на это сообщение

Если тебя никто не приглашал — просто проигнорируй это сообщение.`);
      console.log(`✅ ЛС успешно отправлено для ${member.user.tag}`);
    } catch (err) {
      console.log(`❌ Ошибка отправки ЛС для ${member.user.tag}: ${err.message}`);
    }
  } else {
    console.log(`👋 ${member.user.tag} уже был на сервере, ЛС не отправлено`);
  }
});

// Обработка ЛС
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) {
    console.log(`📩 Получено ЛС от ${message.author.tag}: ${message.content}`);
    
    const userId = message.author.id;
    const content = message.content.trim();
    
    const canInvite = await db.canUserInvite(userId);
    if (!canInvite) {
      await message.reply('❌ Ты не можешь использовать эту команду. Возможно, ты уже был на сервере раньше.');
      return;
    }
    
    const alreadySent = await db.hasSentInvite(userId);
    if (alreadySent) {
      await message.reply('❌ Ты уже отправлял Discord ID ранее.');
      return;
    }
    
    if (!/^\d+$/.test(content)) {
      await message.reply('❌ Это не похоже на Discord ID. ID должен состоять только из цифр.');
      return;
    }
    
    const inviterId = content;
    if (inviterId === userId) {
      await message.reply('❌ Нельзя пригласить самого себя.');
      return;
    }
    
    const guild = client.guilds.cache.first();
    let inviterMember;
    try {
      inviterMember = await guild.members.fetch(inviterId);
    } catch (err) {
      await message.reply('❌ Пользователь с таким ID не найден на сервере.');
      return;
    }
    
    const saved = await db.saveReferral(userId, inviterId);
    if (!saved) {
      await message.reply('❌ Ошибка: приглашение уже существует.');
      return;
    }
    
    await message.reply(`✅ Принято! Как только ты получишь роль Main — <@${inviterId}> получит награду ${config.REWARD_AMOUNT}.`);
    console.log(`🔗 Сохранено приглашение: ${message.author.tag} -> ${inviterMember.user.tag}`);
  }
});

// Обработка кнопок
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  
  const member = interaction.member;
  
  if (interaction.customId === 'my_invites') {
    await interaction.deferReply({ ephemeral: true });
    const stats = await db.getUserStats(interaction.user.id);
    const content = `📊 **Твоя статистика:**\n\n👥 Привёл человек: **${stats.total}**\n✅ Достигли Main: **${stats.completed}**`;
    await interaction.editReply({ content });
  }
  
  if (interaction.customId === 'who_invited') {
    const modal = new ModalBuilder()
      .setCustomId('who_invited_modal')
      .setTitle('Кто пригласил?');
    
    const userInput = new TextInputBuilder()
      .setCustomId('target_user')
      .setLabel('Введите Discord ID пользователя')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Например: 1073902834577330196')
      .setRequired(true);
    
    modal.addComponents(new ActionRowBuilder().addComponents(userInput));
    await interaction.showModal(modal);
  }
  
  if (interaction.customId === 'repeat_request') {
    const admin = await isAdmin(member);
    if (!admin) {
      return interaction.reply({ content: '❌ У вас нет прав. Требуется роль <@&' + config.ADMIN_ROLE_ID + '>', ephemeral: true });
    }
    
    const modal = new ModalBuilder()
      .setCustomId('repeat_request_modal')
      .setTitle('Повторить заявку');
    
    const userInput = new TextInputBuilder()
      .setCustomId('target_user')
      .setLabel('Введите Discord ID новичка')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ID пользователя, который получил Main')
      .setRequired(true);
    
    modal.addComponents(new ActionRowBuilder().addComponents(userInput));
    await interaction.showModal(modal);
  }
  
  if (interaction.customId === 'reset_user') {
    const admin = await isAdmin(member);
    if (!admin) {
      return interaction.reply({ content: '❌ У вас нет прав. Требуется роль <@&' + config.ADMIN_ROLE_ID + '>', ephemeral: true });
    }
    
    const modal = new ModalBuilder()
      .setCustomId('reset_user_modal')
      .setTitle('Сбросить участника');
    
    const userInput = new TextInputBuilder()
      .setCustomId('target_user')
      .setLabel('Введите Discord ID пользователя')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ID пользователя, которого нужно сбросить')
      .setRequired(true);
    
    modal.addComponents(new ActionRowBuilder().addComponents(userInput));
    await interaction.showModal(modal);
  }
});

// Обработка модальных окон
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  
  if (interaction.customId === 'who_invited_modal') {
    await interaction.deferReply({ ephemeral: true });
    const targetId = interaction.fields.getTextInputValue('target_user').replace(/[<@!>]/g, '').trim();
    
    if (!/^\d+$/.test(targetId)) {
      return interaction.editReply({ content: '❌ Неверный формат. Введите Discord ID (только цифры).' });
    }
    
    const referral = await db.getReferral(targetId);
    if (!referral) {
      return interaction.editReply({ content: `ℹ️ Пользователь <@${targetId}> не был никем приглашён.` });
    }
    
    const statusText = referral.status === 'pending' ? '⏳ Ожидает получения Main' : '✅ Заявка отправлена';
    await interaction.editReply({ content: `📊 Пользователь <@${targetId}> приглашён <@${referral.inviter_id}>\nСтатус: ${statusText}` });
  }
  
  if (interaction.customId === 'repeat_request_modal') {
    await interaction.deferReply({ ephemeral: true });
    const targetId = interaction.fields.getTextInputValue('target_user').replace(/[<@!>]/g, '').trim();
    
    if (!/^\d+$/.test(targetId)) {
      return interaction.editReply({ content: '❌ Неверный формат. Введите Discord ID (только цифры).' });
    }
    
    const referral = await db.getReferral(targetId);
    if (!referral || referral.status !== 'pending') {
      return interaction.editReply({ content: `❌ Нет активного приглашения для <@${targetId}>.` });
    }
    
    const channel = client.channels.cache.get(config.CHANNEL_ID);
    if (!channel) {
      return interaction.editReply({ content: '❌ Канал для заявок не найден!' });
    }
    
    await channel.send({
      content: `<@&${config.HIGH_ROLE_ID}>, 🔁 ПОВТОРНАЯ ЗАЯВКА: Игрок <@${referral.inviter_id}> привёл друга <@${targetId}>, который достиг роли Main!\n💰 Просьба выдать награду ${config.REWARD_AMOUNT}`
    });
    
    await interaction.editReply({ content: `✅ Повторная заявка для <@${targetId}> отправлена!` });
    console.log(`📨 Повторная заявка от ${interaction.user.tag} для ${targetId}`);
  }
  
  if (interaction.customId === 'reset_user_modal') {
    await interaction.deferReply({ ephemeral: true });
    const targetId = interaction.fields.getTextInputValue('target_user').replace(/[<@!>]/g, '').trim();
    
    if (!/^\d+$/.test(targetId)) {
      return interaction.editReply({ content: '❌ Неверный формат. Введите Discord ID (только цифры).' });
    }
    
    const referral = await db.getReferral(targetId);
    if (!referral) {
      return interaction.editReply({ content: `❌ Нет приглашения для <@${targetId}> в базе данных.` });
    }
    
    const inviterId = referral.inviter_id;
    
    await db.deleteReferral(targetId);
    await db.resetUserInviteFlag(targetId);
    
    const guild = client.guilds.cache.first();
    let targetMember;
    try {
      targetMember = await guild.members.fetch(targetId);
    } catch (err) {
      console.log(`❌ Не удалось найти пользователя ${targetId} на сервере`);
    }
    
    if (targetMember) {
      try {
        await targetMember.send(`🔄 **Ваше приглашение было сброшено администратором!**
        
Если тебя кто-то пригласил — напиши сюда **Discord ID** пригласившего.

**Как получить Discord ID:**
1. Включи в Discord "Режим разработчика" (Настройки → Дополнительно → Режим разработчика)
2. Нажми ПКМ на имени пригласившего → "Копировать ID"
3. Вставь этот ID в ответ на это сообщение

Если тебя никто не приглашал — просто проигнорируй это сообщение.`);
        console.log(`📨 Отправлено ЛС для ${targetMember.user.tag} о сбросе приглашения`);
      } catch (err) {
        console.log(`❌ Не удалось отправить ЛС ${targetMember.user.tag}: ${err.message}`);
      }
    }
    
    await interaction.editReply({ content: `✅ Приглашение для <@${targetId}> удалено из базы данных.\n📨 Пользователю отправлено ЛС с предложением заново указать пригласившего.\n\nПриглашавший: <@${inviterId}>` });
    console.log(`🗑️ Сброшен участник ${targetId} админом ${interaction.user.tag}. Приглашал: ${inviterId}`);
  }
});

// Отслеживание роли Main
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const hadMain = oldMember.roles.cache.has(config.MAIN_ROLE_ID);
  const hasMain = newMember.roles.cache.has(config.MAIN_ROLE_ID);
  
  if (!hadMain && hasMain) {
    console.log(`⭐ ${newMember.user.tag} получил роль Main!`);
    
    const referral = await db.getReferral(newMember.id);
    if (!referral || referral.status !== 'pending') {
      console.log(`ℹ️ Нет активного приглашения для ${newMember.user.tag}`);
      return;
    }
    
    const channel = client.channels.cache.get(config.CHANNEL_ID);
    if (!channel) {
      console.log(`❌ Канал ${config.CHANNEL_ID} не найден!`);
      return;
    }
    
    await channel.send({
      content: `<@&${config.HIGH_ROLE_ID}>, 🎉 Игрок <@${referral.inviter_id}> привёл друга <@${newMember.id}>, который достиг роли Main!\n💰 Просьба выдать награду ${config.REWARD_AMOUNT}`
    });
    
    await db.completeReferral(newMember.id);
    console.log(`📨 Отправлена заявка в канал для ${newMember.user.tag}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
