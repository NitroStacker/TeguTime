import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

/**
 * Server-level admin gate. Consolidated so future "configurable manager role"
 * work lands in exactly one place.
 */
export function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}
