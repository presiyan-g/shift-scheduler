import { redirectIfAuthed } from '@shared/auth.js';

async function init() {
  // If the user is already logged in, send them straight to the dashboard
  await redirectIfAuthed();
}

init();
