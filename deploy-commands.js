require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the bot is online."),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show the current activity check status."),

  new SlashCommandBuilder()
    .setName("startcheck")
    .setDescription("Manually start a new activity check."),

  new SlashCommandBuilder()
    .setName("finishcheck")
    .setDescription("Manually finish the current activity check and post results."),

  new SlashCommandBuilder()
    .setName("resetcheck")
    .setDescription("Reset the current activity check without posting results."),

  new SlashCommandBuilder()
    .setName("checkdebug")
    .setDescription("Show debug info for the bot."),

  new SlashCommandBuilder()
    .setName("strikes")
    .setDescription("Check a member's activity check strikes.")
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("The member to check.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clearstrikes")
    .setDescription("Clear a member's activity check strikes.")
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("The member to clear strikes for.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("testdm")
    .setDescription("Test DM messages without giving strikes or removing roles.")
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("The member to send the test DM to.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("The type of DM to test.")
        .setRequired(true)
        .addChoices(
          { name: "10-minute reminder", value: "reminder" },
          { name: "missed activity check", value: "missed" },
          { name: "3-strike demotion", value: "demoted" }
        )
    ),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function deployCommands() {
  try {
    if (!process.env.DISCORD_TOKEN) throw new Error("Missing DISCORD_TOKEN");
    if (!process.env.CLIENT_ID) throw new Error("Missing CLIENT_ID");
    if (!process.env.GUILD_ID) throw new Error("Missing GUILD_ID");

    console.log("Registering slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log("Slash commands registered successfully.");
  } catch (error) {
    console.error("Failed to register slash commands:");
    console.error(error);
  }
}

deployCommands();
