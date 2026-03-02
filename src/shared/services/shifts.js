import { supabase } from '@shared/supabase.js';

export async function completeExpiredShifts() {
  const { data, error } = await supabase.rpc('complete_past_shifts');
  if (error) {
    console.error('completeExpiredShifts error:', error);
    return 0;
  }
  return data ?? 0;
}
