import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

/**
 * Permission gate for "admin-like" actions — creating/editing/deleting jams,
 * editing other people's jobs, moderating art, reposting the dashboard, etc.
 *
 * **Open-access policy:** this server runs a small, fully-trusted group, so
 * every member is treated as an admin. If you ever need to re-tighten (e.g.
 * when onboarding less-trusted users), revert this to:
 *
 *     return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
 *
 * The rest of the code path (route handlers, button-state logic) is unchanged
 * — only the gate moves.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isAdmin(_interaction: ChatInputCommandInteraction): boolean {
  return true;
}

// Left intentionally imported so the fallback above (Manage Server) still
// type-checks if someone re-enables it.
void PermissionFlagsBits.ManageGuild;
