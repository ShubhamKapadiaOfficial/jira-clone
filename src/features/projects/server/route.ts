import { zValidator } from '@hono/zod-validator';
import { endOfMonth, startOfMonth, subMonths } from 'date-fns';
import { Hono } from 'hono';
import { z } from 'zod';

import { BUCKETS, TABLES } from '@/config/supabase';
import { getMember } from '@/features/members/utils';
import { createProjectSchema, updateProjectSchema } from '@/features/projects/schema';
import type { Project } from '@/features/projects/types';
import { type Task, TaskStatus } from '@/features/tasks/types';
import { sessionMiddleware } from '@/lib/session-middleware';

const app = new Hono()
  .post('/', sessionMiddleware, zValidator('form', createProjectSchema), async (ctx) => {
    const supabase = ctx.get('supabase');
    const user = ctx.get('user');

    const { name, image, workspaceId } = ctx.req.valid('form');

    const member = await getMember({
      supabase,
      workspaceId,
      userId: user.id,
    });

    if (!member) {
      return ctx.json({ error: 'Unauthorized.' }, 401);
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

      uploadedImageId = fileData?.path;
    } else {
      uploadedImageId = image;
    }

    const { data: project, error: projectError } = await supabase
      .from(TABLES.PROJECTS)
      .insert({
        name,
        image_id: uploadedImageId,
        workspace_id: workspaceId,
      })
      .select()
      .single();

    if (projectError) {
      return ctx.json({ error: projectError.message }, 500);
    }

    return ctx.json({ data: project });
  })
  .get(
    '/',
    sessionMiddleware,
    zValidator(
      'query',
      z.object({
        workspaceId: z.string(),
      }),
    ),
    async (ctx) => {
      const supabase = ctx.get('supabase');
      const user = ctx.get('user');

      const { workspaceId } = ctx.req.valid('query');

      const member = await getMember({
        supabase,
        workspaceId,
        userId: user.id,
      });

      if (!member) {
        return ctx.json({ error: 'Unauthorized.' }, 401);
      }

      const { data: projects, error, count } = await supabase
        .from(TABLES.PROJECTS)
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });

      if (error) {
        return ctx.json({ error: error.message }, 500);
      }

      const projectsWithImages = await Promise.all(
        (projects || []).map(async (project) => {
          let imageUrl: string | undefined = undefined;

          if (project.image_id) {
            const { data } = supabase.storage
              .from(BUCKETS.IMAGES)
              .getPublicUrl(project.image_id);
            imageUrl = data.publicUrl;
          }

          return {
            ...project,
            imageUrl,
          };
        }),
      );

      return ctx.json({
        data: {
          documents: projectsWithImages,
          total: count || 0,
        },
      });
    },
  )
  .get('/:projectId', sessionMiddleware, async (ctx) => {
    const supabase = ctx.get('supabase');
    const user = ctx.get('user');

    const { projectId } = ctx.req.param();

    const { data: project, error: projectError } = await supabase
      .from(TABLES.PROJECTS)
      .select('*')
      .eq('id', projectId)
      .single();

    if (projectError) {
      return ctx.json({ error: projectError.message }, 500);
    }

    const member = await getMember({
      supabase,
      workspaceId: project.workspace_id,
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

    let imageUrl: string | undefined = undefined;

    if (project.image_id) {
      const { data } = supabase.storage
        .from(BUCKETS.IMAGES)
        .getPublicUrl(project.image_id);
      imageUrl = data.publicUrl;
    }

    return ctx.json({
      data: {
        ...project,
        imageUrl,
      },
    });
  })
  .patch('/:projectId', sessionMiddleware, zValidator('form', updateProjectSchema), async (ctx) => {
    const supabase = ctx.get('supabase');
    const user = ctx.get('user');

    const { projectId } = ctx.req.param();
    const { name, image } = ctx.req.valid('form');

    // Get existing project first
    const { data: existingProject, error: getError } = await supabase
      .from(TABLES.PROJECTS)
      .select('*')
      .eq('id', projectId)
      .single();

    if (getError) {
      return ctx.json({ error: getError.message }, 500);
    }

    const member = await getMember({
      supabase,
      workspaceId: existingProject.workspace_id,
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

      // Delete old project image
      if (existingProject.image_id) {
        await supabase.storage
          .from(BUCKETS.IMAGES)
          .remove([existingProject.image_id]);
      }

      uploadedImageId = fileData?.path;
    }

    const { data: project, error: updateError } = await supabase
      .from(TABLES.PROJECTS)
      .update({
        name,
        image_id: uploadedImageId,
      })
      .eq('id', projectId)
      .select()
      .single();

    if (updateError) {
      return ctx.json({ error: updateError.message }, 500);
    }

    return ctx.json({ data: project });
  })
  .delete('/:projectId', sessionMiddleware, async (ctx) => {
    const supabase = ctx.get('supabase');
    const user = ctx.get('user');

    const { projectId } = ctx.req.param();

    const { data: existingProject, error: getError } = await supabase
      .from(TABLES.PROJECTS)
      .select('*')
      .eq('id', projectId)
      .single();

    if (getError) {
      return ctx.json({ error: getError.message }, 500);
    }

    const member = await getMember({
      supabase,
      workspaceId: existingProject.workspace_id,
      userId: user.id,
    });

    if (!member) {
      return ctx.json({ error: 'Unauthorized.' }, 401);
    }

    // Delete project image if it exists
    if (existingProject.image_id) {
      await supabase.storage
        .from(BUCKETS.IMAGES)
        .remove([existingProject.image_id]);
    }

    // Delete project (this will cascade delete tasks due to foreign key constraints)
    const { error: deleteError } = await supabase
      .from(TABLES.PROJECTS)
      .delete()
      .eq('id', projectId);

    if (deleteError) {
      return ctx.json({ error: deleteError.message }, 500);
    }

    return ctx.json({ data: { id: existingProject.id, workspace_id: existingProject.workspace_id } });
  })
  .get('/:projectId/analytics', sessionMiddleware, async (ctx) => {
    const supabase = ctx.get('supabase');
    const user = ctx.get('user');
    const { projectId } = ctx.req.param();

    const { data: project, error: projectError } = await supabase
      .from(TABLES.PROJECTS)
      .select('*')
      .eq('id', projectId)
      .single();

    if (projectError) {
      return ctx.json({ error: projectError.message }, 500);
    }

    const member = await getMember({
      supabase,
      workspaceId: project.workspace_id,
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
      .eq('project_id', projectId)
      .gte('created_at', thisMonthStart.toISOString())
      .lte('created_at', thisMonthEnd.toISOString());

    // Get task counts for last month
    const { count: lastMonthTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .gte('created_at', lastMonthStart.toISOString())
      .lte('created_at', lastMonthEnd.toISOString());

    const taskCount = thisMonthTaskCount || 0;
    const taskDifference = taskCount - (lastMonthTaskCount || 0);

    // Get assigned task counts for this month
    const { count: thisMonthAssignedTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('assignee_id', member.id)
      .gte('created_at', thisMonthStart.toISOString())
      .lte('created_at', thisMonthEnd.toISOString());

    // Get assigned task counts for last month
    const { count: lastMonthAssignedTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('assignee_id', member.id)
      .gte('created_at', lastMonthStart.toISOString())
      .lte('created_at', lastMonthEnd.toISOString());

    const assignedTaskCount = thisMonthAssignedTaskCount || 0;
    const assignedTaskDifference = assignedTaskCount - (lastMonthAssignedTaskCount || 0);

    // Get incomplete task counts for this month
    const { count: thisMonthIncompleteTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .neq('status', TaskStatus.DONE)
      .gte('created_at', thisMonthStart.toISOString())
      .lte('created_at', thisMonthEnd.toISOString());

    // Get incomplete task counts for last month
    const { count: lastMonthIncompleteTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .neq('status', TaskStatus.DONE)
      .gte('created_at', lastMonthStart.toISOString())
      .lte('created_at', lastMonthEnd.toISOString());

    const incompleteTaskCount = thisMonthIncompleteTaskCount || 0;
    const incompleteTaskDifference = incompleteTaskCount - (lastMonthIncompleteTaskCount || 0);

    // Get completed task counts for this month
    const { count: thisMonthCompletedTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('status', TaskStatus.DONE)
      .gte('created_at', thisMonthStart.toISOString())
      .lte('created_at', thisMonthEnd.toISOString());

    // Get completed task counts for last month
    const { count: lastMonthCompletedTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('status', TaskStatus.DONE)
      .gte('created_at', lastMonthStart.toISOString())
      .lte('created_at', lastMonthEnd.toISOString());

    const completedTaskCount = thisMonthCompletedTaskCount || 0;
    const completedTaskDifference = completedTaskCount - (lastMonthCompletedTaskCount || 0);

    // Get overdue task counts for this month
    const { count: thisMonthOverdueTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .neq('status', TaskStatus.DONE)
      .lt('due_date', now.toISOString())
      .gte('created_at', thisMonthStart.toISOString())
      .lte('created_at', thisMonthEnd.toISOString());

    // Get overdue task counts for last month
    const { count: lastMonthOverdueTaskCount } = await supabase
      .from(TABLES.TASKS)
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
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
