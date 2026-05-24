require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const cron = require("node-cron");

const CHECK_EMOJI = "✅";
const DATA_FILE = path.join(__dirname, "data.json");

let data = loadData();

function loadData() {
  const defaultData = {
    currentCheckMessageId: null,
    checkedInUsers: [],
    checkStartedAt: null,
    strikes: {},
  };

  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }

    const fileContent = fs.readFileSync(DATA_FILE, "utf8");

    if (!fileContent.trim()) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }

    return JSON.parse(fileContent);
  } catch (error) {
    console.error("Failed to load data.json:", error);
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getCheckedInSet() {
  return new Set(data.checkedInUsers || []);
}

function setCheckedInSet(set) {
  data.checkedInUsers = Array.from(set);
  saveData();
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(
    "Bot is online. Waiting until Monday or Thursday at 8:00 AM Manila time to start activity check."
  );

  // Sends DM reminder every Monday and Thursday at 7:50 AM Manila time
  cron.schedule(
    "50 7 * * 1,4",
    async () => {
      console.log("Sending 10-minute activity check reminders...");
      await sendActivityCheckReminder();
    },
    {
      timezone: "Asia/Manila",
    }
  );

  // Runs every Monday and Thursday at 8:00 AM Manila time
  cron.schedule(
    "0 8 * * 1,4",
    async () => {
      console.log("Monday/Thursday activity check started...");

      await finishActivityCheck();
      await startActivityCheck();

      console.log("Monday/Thursday activity check posted.");
    },
    {
      timezone: "Asia/Manila",
    }
  );
});

async function getCheckChannel() {
  const channel = await client.channels.fetch(process.env.CHECK_CHANNEL_ID);

  if (!channel) {
    throw new Error("Check channel not found. Check CHECK_CHANNEL_ID.");
  }

  return channel;
}

async function sendSafeDM(user, message) {
  try {
    await user.send(message);
    return true;
  } catch (error) {
    console.log(`Could not DM ${user.tag}. Their DMs may be closed.`);
    return false;
  }
}

async function sendActivityCheckReminder() {
  const isTestMode = process.env.TEST_MODE === "true";

  if (isTestMode) {
    console.log("TEST_MODE is enabled. Reminder DMs were skipped.");
    return;
  }

  const channel = await getCheckChannel();
  const guild = channel.guild;

  await guild.members.fetch();

  const roleMembers = guild.members.cache.filter(
    (member) =>
      !member.user.bot && member.roles.cache.has(process.env.CHECK_ROLE_ID)
  );

  for (const member of roleMembers.values()) {
    await sendSafeDM(
      member.user,
      `Reminder: The activity check for **${guild.name}** opens in 10 minutes. Please react with ${CHECK_EMOJI} when it is posted.`
    );
  }

  console.log(`Reminder DMs sent to ${roleMembers.size} role members.`);
}

async function startActivityCheck() {
  const channel = await getCheckChannel();

  // Delete old activity check message if it still exists
  if (data.currentCheckMessageId) {
    try {
      const oldMessage = await channel.messages.fetch(data.currentCheckMessageId);
      await oldMessage.delete();
      console.log("Old activity check message deleted.");
    } catch (error) {
      console.log(
        "Could not delete old activity check message. It may already be deleted."
      );
    }
  }

  data.checkedInUsers = [];
  data.checkStartedAt = Date.now();

  const isTestMode = process.env.TEST_MODE === "true";

  const embed = new EmbedBuilder()
    .setTitle(isTestMode ? "Test Activity Check" : "Activity Check")
    .setDescription(
      isTestMode
        ? `This is a test activity check.\n\nReact with ${CHECK_EMOJI} to test if the bot works.\n\nNo role was pinged. No strikes will be given.`
        : `React with ${CHECK_EMOJI} to confirm you are active.\n\nThis check runs every Monday and Thursday at 8:00 AM Manila time.\n\nMissing a check gives you 1 strike. At 3/3 strikes, the checked role will be removed.`
    )
    .setColor(isTestMode ? "#FEE75C" : "#57F287")
    .setTimestamp();

  const message = await channel.send({
    content: isTestMode
      ? "Test activity check is now open. No one was pinged."
      : `<@&${process.env.CHECK_ROLE_ID}> Activity check is now open!`,
    embeds: [embed],
    allowedMentions: isTestMode
      ? { parse: [] }
      : {
          roles: [process.env.CHECK_ROLE_ID],
        },
  });

  await message.react(CHECK_EMOJI);

  data.currentCheckMessageId = message.id;
  saveData();

  console.log(`New activity check started. Message ID: ${data.currentCheckMessageId}`);
}

async function finishActivityCheck() {
  if (!data.currentCheckMessageId) {
    console.log("No active check to finish.");
    return false;
  }

  const channel = await getCheckChannel();
  const guild = channel.guild;
  const isTestMode = process.env.TEST_MODE === "true";

  await guild.members.fetch();

  const checkedInSet = getCheckedInSet();
  const activeMembers = [];
  const inactiveMembers = [];
  const demotedMembers = [];

  const roleMembers = guild.members.cache.filter(
    (member) =>
      !member.user.bot && member.roles.cache.has(process.env.CHECK_ROLE_ID)
  );

  for (const member of roleMembers.values()) {
    if (checkedInSet.has(member.id)) {
      activeMembers.push(`<@${member.id}>`);
      continue;
    }

    inactiveMembers.push(`<@${member.id}>`);

    if (!isTestMode) {
      const oldStrikes = data.strikes[member.id] || 0;
      const newStrikes = oldStrikes + 1;

      data.strikes[member.id] = newStrikes;

      if (newStrikes >= 3) {
        try {
          await member.roles.remove(
            process.env.CHECK_ROLE_ID,
            "Reached 3/3 activity check strikes"
          );

          demotedMembers.push(`<@${member.id}>`);

          await sendSafeDM(
            member.user,
            `You missed the activity check in **${guild.name}** and reached **3/3 strikes**. The checked role has been removed.`
          );
        } catch (error) {
          console.error(`Failed to remove role from ${member.user.tag}:`, error);
        }
      } else {
        await sendSafeDM(
          member.user,
          `You missed the activity check in **${guild.name}**. You now have **${newStrikes}/3 strikes**. At **3/3 strikes**, you will be demoted and the checked role will be removed.`
        );
      }
    }
  }

  saveData();

  const activeText =
    activeMembers.length > 0
      ? activeMembers.slice(0, 25).join("\n")
      : "No one checked in.";

  const inactiveText =
    inactiveMembers.length > 0
      ? inactiveMembers.slice(0, 25).join("\n")
      : "Everyone checked in.";

  const demotedText =
    demotedMembers.length > 0
      ? demotedMembers.slice(0, 25).join("\n")
      : "No one was demoted.";

  const embed = new EmbedBuilder()
    .setTitle(isTestMode ? "Test Activity Check Results" : "Activity Check Results")
    .setColor("#5865F2")
    .addFields(
      {
        name: `Checked In: ${activeMembers.length}`,
        value: activeText,
      },
      {
        name: `Did Not Check In: ${inactiveMembers.length}`,
        value: inactiveText,
      },
      {
        name: `Demoted / Role Removed: ${demotedMembers.length}`,
        value: demotedText,
      }
    )
    .setTimestamp();

  if (
    activeMembers.length > 25 ||
    inactiveMembers.length > 25 ||
    demotedMembers.length > 25
  ) {
    embed.setFooter({
      text: "Only showing the first 25 members in each list.",
    });
  }

  await channel.send({
    content: isTestMode
      ? "Test activity check results are here. No one was pinged. No strikes were given."
      : `<@&${process.env.CHECK_ROLE_ID}> Activity check results are here.`,
    embeds: [embed],
    allowedMentions: isTestMode
      ? { parse: [] }
      : {
          roles: [process.env.CHECK_ROLE_ID],
          users: [],
        },
  });

  data.currentCheckMessageId = null;
  data.checkedInUsers = [];
  data.checkStartedAt = null;
  saveData();

  console.log("Activity check finished.");
  return true;
}

function resetActivityCheck() {
  data.currentCheckMessageId = null;
  data.checkedInUsers = [];
  data.checkStartedAt = null;
  saveData();

  console.log("Activity check reset.");
}

function isAdmin(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
}

client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;

  try {
    if (reaction.partial) {
      await reaction.fetch();
    }

    if (reaction.message.id !== data.currentCheckMessageId) return;
    if (reaction.emoji.name !== CHECK_EMOJI) return;

    const checkedInSet = getCheckedInSet();
    checkedInSet.add(user.id);
    setCheckedInSet(checkedInSet);

    console.log(`${user.tag} checked in.`);
  } catch (error) {
    console.error("Reaction add error:", error);
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  if (user.bot) return;

  try {
    if (reaction.partial) {
      await reaction.fetch();
    }

    if (reaction.message.id !== data.currentCheckMessageId) return;
    if (reaction.emoji.name !== CHECK_EMOJI) return;

    const checkedInSet = getCheckedInSet();
    checkedInSet.delete(user.id);
    setCheckedInSet(checkedInSet);

    console.log(`${user.tag} removed their check-in.`);
  } catch (error) {
    console.error("Reaction remove error:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  console.log("Interaction received:", interaction.commandName);

  const command = interaction.commandName;

  try {
    if (command === "ping") {
      return interaction.reply({
        content: `Pong! Bot latency: ${client.ws.ping}ms`,
        ephemeral: true,
      });
    }

    if (command === "status") {
      const statusEmbed = new EmbedBuilder()
        .setTitle("Activity Check Status")
        .setColor("#FEE75C")
        .addFields(
          {
            name: "Current Check",
            value: data.currentCheckMessageId ? "Active" : "Not active",
          },
          {
            name: "Checked In Users",
            value: `${data.checkedInUsers.length}`,
          },
          {
            name: "Started At",
            value: data.checkStartedAt
              ? `<t:${Math.floor(data.checkStartedAt / 1000)}:F>`
              : "No active check",
          },
          {
            name: "Check Message ID",
            value: data.currentCheckMessageId || "None",
          },
          {
            name: "Checked Role",
            value: `<@&${process.env.CHECK_ROLE_ID}>`,
          },
          {
            name: "Schedule",
            value: "Every Monday and Thursday at 8:00 AM Manila time",
          },
          {
            name: "Reminder",
            value: "DM reminder is sent 10 minutes before the check.",
          },
          {
            name: "Test Mode",
            value: process.env.TEST_MODE === "true" ? "Enabled" : "Disabled",
          }
        )
        .setTimestamp();

      return interaction.reply({
        embeds: [statusEmbed],
        ephemeral: true,
      });
    }

    if (command === "startcheck") {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: "You need Manage Server permission to use this command.",
          ephemeral: true,
        });
      }

      if (data.currentCheckMessageId) {
        return interaction.reply({
          content:
            "There is already an active check. Use /finishcheck or /resetcheck first.",
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });
      await startActivityCheck();

      return interaction.editReply({
        content: "New activity check started.",
      });
    }

    if (command === "finishcheck") {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: "You need Manage Server permission to use this command.",
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });
      const finished = await finishActivityCheck();

      return interaction.editReply({
        content: finished
          ? "Activity check finished and results were posted."
          : "There is no active activity check to finish.",
      });
    }

    if (command === "resetcheck") {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: "You need Manage Server permission to use this command.",
          ephemeral: true,
        });
      }

      resetActivityCheck();

      return interaction.reply({
        content: "Activity check was reset without posting results.",
        ephemeral: true,
      });
    }

    if (command === "checkdebug") {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: "You need Manage Server permission to use this command.",
          ephemeral: true,
        });
      }

      const channel = await getCheckChannel();
      const guild = channel.guild;

      await guild.members.fetch();

      const roleMembers = guild.members.cache.filter(
        (member) =>
          !member.user.bot &&
          member.roles.cache.has(process.env.CHECK_ROLE_ID)
      );

      const debugEmbed = new EmbedBuilder()
        .setTitle("Bot Debug Info")
        .setColor("#ED4245")
        .addFields(
          {
            name: "Bot Tag",
            value: client.user.tag,
          },
          {
            name: "Bot ID",
            value: client.user.id,
          },
          {
            name: "Guild",
            value: guild.name,
          },
          {
            name: "Check Channel",
            value: `<#${process.env.CHECK_CHANNEL_ID}>`,
          },
          {
            name: "Checked Role",
            value: `<@&${process.env.CHECK_ROLE_ID}>`,
          },
          {
            name: "Members With Checked Role",
            value: `${roleMembers.size}`,
          },
          {
            name: "Current Check Message ID",
            value: data.currentCheckMessageId || "None",
          },
          {
            name: "Checked In Count",
            value: `${data.checkedInUsers.length}`,
          },
          {
            name: "Schedule",
            value: "Every Monday and Thursday at 8:00 AM Manila time",
          },
          {
            name: "Reminder",
            value: "10 minutes before activity check",
          },
          {
            name: "Test Mode",
            value: process.env.TEST_MODE === "true" ? "Enabled" : "Disabled",
          },
          {
            name: "WebSocket Ping",
            value: `${client.ws.ping}ms`,
          }
        )
        .setTimestamp();

      return interaction.reply({
        embeds: [debugEmbed],
        ephemeral: true,
      });
    }

    if (command === "strikes") {
      const target = interaction.options.getUser("member");
      const strikeCount = data.strikes[target.id] || 0;

      return interaction.reply({
        content: `${target} has **${strikeCount}/3 strikes**.`,
        ephemeral: true,
      });
    }

    if (command === "clearstrikes") {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: "You need Manage Server permission to use this command.",
          ephemeral: true,
        });
      }

      const target = interaction.options.getUser("member");
      data.strikes[target.id] = 0;
      saveData();

      return interaction.reply({
        content: `${target}'s strikes have been cleared. They now have **0/3 strikes**.`,
        ephemeral: true,
      });
    }

    if (command === "testdm") {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: "You need Manage Server permission to use this command.",
          ephemeral: true,
        });
      }

      const target = interaction.options.getUser("member");
      const type = interaction.options.getString("type");

      const channel = await getCheckChannel();
      const guild = channel.guild;

      let dmMessage = "";

      if (type === "reminder") {
        dmMessage = `Reminder: The activity check for **${guild.name}** opens in 10 minutes. Please react with ${CHECK_EMOJI} when it is posted.`;
      }

      if (type === "missed") {
        dmMessage = `You missed the activity check in **${guild.name}**. You now have **1/3 strikes**. At **3/3 strikes**, you will be demoted and the checked role will be removed.`;
      }

      if (type === "demoted") {
        dmMessage = `You missed the activity check in **${guild.name}** and reached **3/3 strikes**. The checked role has been removed.`;
      }

      const sent = await sendSafeDM(target, dmMessage);

      return interaction.reply({
        content: sent
          ? `Test DM sent to ${target}.`
          : `Could not DM ${target}. Their DMs may be closed.`,
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error("Command error:", error);

    if (interaction.deferred || interaction.replied) {
      return interaction.followUp({
        content: "An error happened while running this command.",
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: "An error happened while running this command.",
      ephemeral: true,
    });
  }
});

console.log("Token loaded:", process.env.DISCORD_TOKEN ? "YES" : "NO");
console.log("Token length:", process.env.DISCORD_TOKEN?.length);

client.login(process.env.DISCORD_TOKEN);
