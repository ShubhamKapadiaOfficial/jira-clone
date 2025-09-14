import { createServerClient } from '@supabase/ssr';

import { TABLES } from '@/config/supabase';

interface GetMemberProps {
  supabase: ReturnType<typeof createServerClient>;
  workspaceId: string;
  userId: string;
}

export const getMember = async ({ supabase, workspaceId, userId }: GetMemberProps) => {
  const { data: member, error } = await supabase
    .from(TABLES.MEMBERS)
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();

  if (error) {
    return null;
  }

  return member;
};
