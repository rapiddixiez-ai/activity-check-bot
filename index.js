require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const cron = require("node-cron");

const CHECK_EMOJI = "✅";

let currentCheckMessageId = null;
let checkedInUsers = new Set();
let checkStartedAt = null;

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

async function startActivityCheck() {
  const channel = await getCheckChannel();

  // Delete old activity check message if it still exists
  if (currentCheckMessageId) {
    try {
      const oldMessage = await channel.messages.fetch(currentCheckMessageId);
      await oldMessage.delete();
      console.log("Old activity check message deleted.");
    } catch (error) {
      console.log(
        "Could not delete old activity check message. It may already be deleted."
      );
    }
  }

  checkedInUsers = new Set();
  checkStartedAt = Date.now();

  const isTestMode = process.env.TEST_MODE === "true";

  const embed = new EmbedBuilder()
    .setTitle(isTestMode ? "Test Activity Check" : "Activity Check")
    .setDescription(
      isTestMode
        ? `This is a test activity check.\n\nReact with ${CHECK_EMOJI} to test if the bot works.\n\nNo role was pinged.`
        : `React with ${CHECK_EMOJI} to confirm you are active.\n\nThis check runs every Monday and Thursday at 8:00 AM Manila time.`
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

  currentCheckMessageId = message.id;

  console.log(`New activity check started. Message ID: ${currentCheckMessageId}`);
}

async function finishActivityCheck() {
  if (!currentCheckMessageId) {
    console.log("No active check to finish.");
    return false;
  }

  const channel = await getCheckChannel();
  const guild = channel.guild;
  const isTestMode = process.env.TEST_MODE === "true";

  await guild.members.fetch();

  const activeMembers = [];
  const inactiveMembers = [];

  guild.members.cache.forEach((member) => {
    if (member.user.bot) return;

    // Only check members who have CHECK_ROLE_ID
    if (!member.roles.cache.has(process.env.CHECK_ROLE_ID)) return;

    if (checkedInUsers.has(member.id)) {
      activeMembers.push(`<@${member.id}>`);
    } else {
      inactiveMembers.push(`<@${member.id}>`);
    }
  });

  const activeText =
    activeMembers.length > 0
      ? activeMembers.slice(0, 25).join("\n")
      : "No one checked in.";

  const inactiveText =
    inactiveMembers.length > 0
      ? inactiveMembers.slice(0, 25).join("\n")
      : "Everyone checked in.";

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
      }
    )
    .setTimestamp();

  if (activeMembers.length > 25 || inactiveMembers.length > 25) {
    embed.setFooter({
      text: "Only showing the first 25 members in each list.",
    });
  }

  await channel.send({
    content: isTestMode
      ? "Test activity check results are here. No one was pinged."
      : `<@&${process.env.CHECK_ROLE_ID}> Activity check results are here.`,
    embeds: [embed],
    allowedMentions: isTestMode
      ? { parse: [] }
      : {
          roles: [process.env.CHECK_ROLE_ID],
          users: [],
        },
  });

  currentCheckMessageId = null;
  checkedInUsers = new Set();
  checkStartedAt = null;

  console.log("Activity check finished.");
  return true;
}

function resetActivityCheck() {
  currentCheckMessageId = null;
  checkedInUsers = new Set();
  checkStartedAt = null;

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

    if (reaction.message.id !== currentCheckMessageId) return;
    if (reaction.emoji.name !== CHECK_EMOJI) return;

    checkedInUsers.add(user.id);

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

    if (reaction.message.id !== currentCheckMessageId) return;
    if (reaction.emoji.name !== CHECK_EMOJI) return;

    checkedInUsers.delete(user.id);

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
            value: currentCheckMessageId ? "Active" : "Not active",
          },
          {
            name: "Checked In Users",
            value: `${checkedInUsers.size}`,
          },
          {
            name: "Started At",
            value: checkStartedAt
              ? `<t:${Math.floor(checkStartedAt / 1000)}:F>`
              : "No active check",
          },
          {
            name: "Check Message ID",
            value: currentCheckMessageId || "None",
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

      if (currentCheckMessageId) {
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
            value: currentCheckMessageId || "None",
          },
          {
            name: "Checked In Count",
            value: `${checkedInUsers.size}`,
          },
          {
            name: "Schedule",
            value: "Every Monday and Thursday at 8:00 AM Manila time",
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