import { zValidator } from '@hono/zod-validator';
import { endOfMonth, startOfMonth, subMonths } from 'date-fns';
import { Hono } from 'hono';
import { z } from 'zod';

import { BUCKETS, TABLES, type Database } from '@/config/supabase';
import { type Member, MemberRole } from '@/features/members/types';
import { getMember } from '@/features/members/utils';
import type { Project } from '@/features/projects/types';
import { type Task, TaskStatus } from '@/features/tasks/types';
import { createWorkspaceSchema, updateWorkspaceSchema } from '@/features/workspaces/schema';
import type { Workspace } from '@/features/workspaces/types';
import { sessionMiddleware } from '@/lib/session-middleware';
import { generateInviteCode } from '@/lib/utils';

const app = new Hono()
  .get('/', sessionMiddleware, async (ctx) => {
    const supabase = ctx.get('supabase');
    const user = ctx.get('user');

    // Get members for this user
    const { data: members, error: membersError } = await supabase
      .from(TABLES.MEMBERS)
      .select('*')
      .eq('user_id', user.id);

    if (membersError || !members || members.length === 0) {
      return ctx.json({ data: { documents: [], total: 0 } });
    }

    const workspaceIds = members.map((member) => member.workspace_id);

    // Get workspaces
    const { data: workspaces, error: workspacesError, count } = await supabase
      .from(TABLES.WORKSPACES)
      .select('*')
      .in('id', workspaceIds)
      .order('created_at', { ascending: false });

    if (workspacesError) {
      return ctx.json({ error: workspacesError.message }, 500);
    }

    // Add image URLs for workspaces with images
    const workspacesWithImages = await Promise.all(
      (workspaces || []).map(async (workspace) => {
        let imageUrl: string | undefined = undefined;

        if (workspace.image_id) {
          const { data } = supabase.storage
            .from(BUCKETS.IMAGES)
            .getPublicUrl(workspace.image_id);
          imageUrl = data.publicUrl;
        }

        return {
          ...workspace,
          imageUrl,
        };
      }),
    );

    return ctx.json({
      data: {
        documents: workspacesWithImages,
        total: count || 0,
      },
    });
  })
  .post('/', zValidator('form', createWorkspaceSchema), sessionMiddleware, async (ctx) => {
    const supabase = ctx.get('supabase');
    const user = ctx.get('user');

    const { name, image } = ctx.req.valid('form');

    let uploadedImageId: string | undefined = undefined;

    if (image instanceof File) {
      const fileExt = image.name.split('.').at(-1) ?? 'png';
      const fileName = `${crypto.randomUUID()}.${fileExt}`;

      const { data: fileData, error: uploadError } = await supabase.storage
        .from(BUCKETS.IMAGES)
        .upload(fileName, image, {
          contentType: image.type,
        });

      if (uploadError) {
        return ctx.json({ error: uploadError.message }, 500);
      }

      uploadedImageId = fileData?.path;
    } else {
      uploadedImageId = image;
    }

    // Create workspace
    const { data: workspace, error: workspaceError } = await supabase
      .from(TABLES.WORKSPACES)
      .insert({
        name,
        user_id: user.id,
        image_id: uploadedImageId,
        invite_code: generateInviteCode(6),
      })
      .select()
      .single();

    if (workspaceError) {
      return ctx.json({ error: workspaceError.message }, 500);
    }

    // Add creator as admin member
    const { error: memberError } = await supabase
      .from(TABLES.MEMBERS)
      .insert({
        user_id: user.id,
        workspace_id: workspace.id,
        role: MemberRole.ADMIN,
      });

    if (memberError) {
      return ctx.json({ error: memberError.message }, 500);
    }

    return ctx.json({ data: workspace });
  })
  .get('/:workspaceId', sessionMiddleware, async (ctx) => {
    const supabase = ctx.get('supabase');
    const user = ctx.get('user');
    const { workspaceId } = ctx.req.param();

    const member = await getMember({
      supabase,
      workspaceId,
      userId: user.id,
    });

    if (!member) {
      return ctx.json(
        {
          error: 'Unauthorized.',
        },
        401,
      );
    }

    const { data: workspace, error } = await supabase
      .from(TABLES.WORKSPACES)
      .select('*')
      .eq('id', workspaceId)
      .single();

    if (error) {
      return ctx.json({ error: error.message }, 500);
    }

    let imageUrl: string | undefined = undefined;

    if (workspace.image_id) {
      const { data } = supabase.storage
        .from(BUCKETS.IMAGES)
        .getPublicUrl(workspace.image_id);
      imageUrl = data.publicUrl;
    }

    return ctx.json({
      data: {
        ...workspace,
        imageUrl,
      },
    });
  })
  .get('/:workspaceId/info', sessionMiddleware, async (ctx) => {
    const supabase = ctx.get('supabase');
    const { workspaceId } = ctx.req.param();

    const { data: workspace, error } = await supabase
      .from(TABLES.WORKSPACES)
      .select('id, name')
      .eq('id', workspaceId)
      .single();

    if (error) {
      return ctx.json({ error: error.message }, 500);
    }

    return ctx.json({
      data: workspace,
    });
  })
  .patch('/:workspaceId', sessionMiddleware, zValidator('form', updateWorkspaceSchema), async (ctx) => {
    const supabase = ctx.get('supabase');
    const user = ctx.get('user');

    const { workspaceId } = ctx.req.param();
    const { name, image } = ctx.req.valid('form');

    const member = await getMember({
      supabase,
      workspaceId,
      userId: user.id,
    });

    if (!member || member.role !== MemberRole.ADMIN) {
      return ctx.json(
        {
          error: 'Unauthorized.',
        },
        401,
      );
    }

    let uploadedImageId: string | undefined = undefined;

    if (image instanceof File) {
      const fileExt = image.name.split('.').at(-1) ?? 'png';
      const fileName = `${crypto.randomUUID()}.${fileExt}`;

      const { data: fileData, error: uploadError } = await supabase.storage
        .from(BUCKETS.IMAGES)
        .upload(fileName, image, {
          contentType: image.type,
        });

      if (uploadError) {
        return ctx.json({ error: uploadError.message }, 500);
      }

      // Get existing workspace to delete old image
      const { data: existingWorkspace } = await supabase
        .from(TABLES.WORKSPACES)
        .select('image_id')
        .eq('id', workspaceId)
        .single();

      // Delete old image if it exists
      if (existingWorkspace?.image_id) {
        await supabase.storage
          .from(BUCKETS.IMAGES)
          .remove([existingWorkspace.image_id]);
      }

      uploadedImageId = fileData?.path;
    }

    const { data: workspace, error: updateError } = await supabase
      .from(TABLES.WORKSPACES)
      .update({
        name,
        image_id: uploadedImageId,
      })
      .eq('id', workspaceId)
      .select()
      .single();

    if (updateError) {
      return ctx.json({ error: updateError.message }, 500);
    }

    return ctx.json({ data: workspace });
  })
  .delete('/:workspaceId', sessionMiddleware, async (ctx) => {
    const supabase = ctx.get('supabase');
    const user = ctx.get('user');

    const { workspaceId } = ctx.req.param();

    const member = await getMember({
      supabase,
      workspaceId,
      userId: user.id,
    });

    if (!member || member.role !== MemberRole.ADMIN) {
      return ctx.json({ error: 'Unauthorized.' }, 401);
    }

    // Get all projects and their images for cleanup
    const { data: projects } = await supabase
      .from(TABLES.PROJECTS)
      .select('image_id')
      .eq('workspace_id', workspaceId);

    // Get workspace image
    const { data: workspace } = await supabase
      .from(TABLES.WORKSPACES)
      .select('image_id')
      .eq('id', workspaceId)
      .single();

    // Delete project images from storage
    const imagesToDelete = [];
    if (projects) {
      for (const project of projects) {
        if (project.image_id) {
          imagesToDelete.push(project.image_id);
        }
      }
    }
    if (workspace?.image_id) {
      imagesToDelete.push(workspace.image_id);
    }

    if (imagesToDelete.length > 0) {
      await supabase.storage
        .from(BUCKETS.IMAGES)
        .remove(imagesToDelete);
    }

    // Delete workspace (this will cascade delete members, projects, and tasks due to foreign key constraints)
    const { error } = await supabase
      .from(TABLES.WORKSPACES)
      .delete()
      .eq('id', workspaceId);

    if (error) {
      return ctx.json({ error: error.message }, 500);
    }

    return ctx.json({ data: { id: workspaceId } });
  })
  .post('/:workspaceId/resetInviteCode', sessionMiddleware, async (ctx) => {
    const supabase = ctx.get('supabase');
    const user = ctx.get('user');

    const { workspaceId } = ctx.req.param();

    const member = await getMember({
      supabase,
      workspaceId,
      userId: user.id,
    });

    if (!member || member.role !== MemberRole.ADMIN) {
      return ctx.json({ error: 'Unauthorized.' }, 401);
    }

    const { data: workspace, error } = await supabase
      .from(TABLES.WORKSPACES)
      .update({
        invite_code: generateInviteCode(6),
      })
      .eq('id', workspaceId)
      .select()
      .single();

    if (error) {
      return ctx.json({ error: error.message }, 500);
    }

    return ctx.json({ data: workspace });
  })
  .post(
    '/:workspaceId/join',
    sessionMiddleware,
    zValidator(
      'json',
      z.object({
        code: z.string(),
      }),
    ),
    async (ctx) => {
      const { workspaceId } = ctx.req.param();
      const { code } = ctx.req.valid('json');

      const supabase = ctx.get('supabase');
      const user = ctx.get('user');

      const member = await getMember({
        supabase,
        workspaceId,
        userId: user.id,
      });

      if (member) {
        return ctx.json({ error: 'Already a member.' }, 400);
      }

      const { data: workspace, error: workspaceError } = await supabase
        .from(TABLES.WORKSPACES)
        .select('*')
        .eq('id', workspaceId)
        .single();

      if (workspaceError) {
        return ctx.json({ error: workspaceError.message }, 500);
      }

      if (workspace.invite_code !== code) {
        return ctx.json({ error: 'Invalid invite code.' }, 400);
      }

      const { error: memberError } = await supabase
        .from(TABLES.MEMBERS)
        .insert({
          workspace_id: workspaceId,
          user_id: user.id,
          role: MemberRole.MEMBER,
        });

      if (memberError) {
        return ctx.json({ error: memberError.message }, 500);
      }

      return ctx.json({ data: workspace });
    },
  )
  .get('/:workspaceId/analytics', sessionMiddleware, async (ctx) => {
    const supabase = ctx.get('supabase');
    const user = ctx.get('user');
    const { workspaceId } = ctx.req.param();

    const member = await getMember({
      supabase,
      workspaceId,
      userId: user.id,
    });

    if (!member) {
      return ctx.json({ error: 'Unauthorized.' }, 401);
    }

    const now = new Date();
    const thisMonthStart = startOfMonth(now);
    const thisMonthEnd = endOfMonth(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));

    // Get task counts for this month
    const { count: thisMonthTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .gte('created_at', thisMonthStart.toISOString())
      .lte('created_at', thisMonthEnd.toISOString());

    // Get task counts for last month
    const { count: lastMonthTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .gte('created_at', lastMonthStart.toISOString())
      .lte('created_at', lastMonthEnd.toISOString());

    const taskCount = thisMonthTaskCount || 0;
    const taskDifference = taskCount - (lastMonthTaskCount || 0);

    // Get assigned task counts for this month
    const { count: thisMonthAssignedTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('assignee_id', member.id)
      .gte('created_at', thisMonthStart.toISOString())
      .lte('created_at', thisMonthEnd.toISOString());

    // Get assigned task counts for last month
    const { count: lastMonthAssignedTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('assignee_id', member.id)
      .gte('created_at', lastMonthStart.toISOString())
      .lte('created_at', lastMonthEnd.toISOString());

    const assignedTaskCount = thisMonthAssignedTaskCount || 0;
    const assignedTaskDifference = assignedTaskCount - (lastMonthAssignedTaskCount || 0);

    // Get incomplete task counts for this month
    const { count: thisMonthIncompleteTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .neq('status', TaskStatus.DONE)
      .gte('created_at', thisMonthStart.toISOString())
      .lte('created_at', thisMonthEnd.toISOString());

    // Get incomplete task counts for last month
    const { count: lastMonthIncompleteTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .neq('status', TaskStatus.DONE)
      .gte('created_at', lastMonthStart.toISOString())
      .lte('created_at', lastMonthEnd.toISOString());

    const incompleteTaskCount = thisMonthIncompleteTaskCount || 0;
    const incompleteTaskDifference = incompleteTaskCount - (lastMonthIncompleteTaskCount || 0);

    // Get completed task counts for this month
    const { count: thisMonthCompletedTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', TaskStatus.DONE)
      .gte('created_at', thisMonthStart.toISOString())
      .lte('created_at', thisMonthEnd.toISOString());

    // Get completed task counts for last month
    const { count: lastMonthCompletedTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', TaskStatus.DONE)
      .gte('created_at', lastMonthStart.toISOString())
      .lte('created_at', lastMonthEnd.toISOString());

    const completedTaskCount = thisMonthCompletedTaskCount || 0;
    const completedTaskDifference = completedTaskCount - (lastMonthCompletedTaskCount || 0);

    // Get overdue task counts for this month
    const { count: thisMonthOverdueTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .neq('status', TaskStatus.DONE)
      .lt('due_date', now.toISOString())
      .gte('created_at', thisMonthStart.toISOString())
      .lte('created_at', thisMonthEnd.toISOString());

    // Get overdue task counts for last month
    const { count: lastMonthOverdueTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .neq('status', TaskStatus.DONE)
      .lt('due_date', now.toISOString())
      .gte('created_at', lastMonthStart.toISOString())
      .lte('created_at', lastMonthEnd.toISOString());

    const overdueTaskCount = thisMonthOverdueTaskCount || 0;
    const overdueTaskDifference = overdueTaskCount - (lastMonthOverdueTaskCount || 0);

    return ctx.json({
      data: {
        taskCount,
        taskDifference,
        assignedTaskCount,
        assignedTaskDifference,
        completedTaskCount,
        completedTaskDifference,
        incompleteTaskCount,
        incompleteTaskDifference,
        overdueTaskCount,
        overdueTaskDifference,
      },
    });
  });

export default app;
