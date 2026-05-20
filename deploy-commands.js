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