/**
 * Shared avatar component.
 *
 * Renders a circular avatar with image + initials fallback, or initials only,
 * or an icon placeholder. Used across navbar, admin, profile, and leave pages.
 */

import { escapeHtml, getInitials } from '@shared/formatting.js';

/**
 * Build the inner HTML for an avatar bubble.
 *
 * @param {string}  name      - Full name (used for initials fallback)
 * @param {string|null} avatarUrl - URL to avatar image (null = show initials)
 * @returns {string} HTML string to place inside an `.avatar` wrapper
 */
export function buildAvatarHtml(name, avatarUrl) {
  if (avatarUrl) {
    return `<img src="${escapeHtml(avatarUrl)}" alt="Avatar" class="avatar-img"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
      <span class="avatar-initials" style="display:none">${getInitials(name)}</span>`;
  }
  if (name) {
    return `<span class="avatar-initials">${getInitials(name)}</span>`;
  }
  return `<i class="bi bi-person-fill"></i>`;
}
