# Supabase Setup Guide for Jira Clone Migration

This guide will help you migrate from Appwrite to Supabase and set up the complete database schema for your Jira clone application.

## 🚀 Quick Start

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Click "New Project"
3. Fill in your project details:
   - **Name**: `jira-clone`
   - **Database Password**: Choose a secure password
   - **Region**: Select the closest region to your users
4. Wait for the project to be created (usually takes 2-3 minutes)

### 2. Get Project Credentials

After your project is created:

1. Go to **Settings** → **API**
2. Copy these values:
   - **Project URL**: `https://your-project-id.supabase.co`
   - **Anon public key**: Your anon key
   - **Service role key**: Your service role key (keep this secret!)

### 3. Create Environment Variables

Create a `.env.local` file in your project root:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Keep your existing app base URL
NEXT_PUBLIC_APP_BASE_URL=http://localhost:3000
```

## 🗄️ Database Schema Setup

### Option A: SQL Editor (Recommended)

Go to **Supabase Dashboard** → **SQL Editor** and run this complete schema:

```sql
-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create custom types
CREATE TYPE member_role AS ENUM ('MEMBER', 'ADMIN');
CREATE TYPE task_status AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE');

-- Create workspaces table
CREATE TABLE workspaces (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  user_id UUID NOT NULL,
  image_id TEXT,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create projects table
CREATE TABLE projects (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  image_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create tasks table
CREATE TABLE tasks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status task_status DEFAULT 'BACKLOG',
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assignee_id UUID NOT NULL,
  due_date DATE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create members table
CREATE TABLE members (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role member_role DEFAULT 'MEMBER',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, workspace_id)
);

-- Create indexes for better performance
CREATE INDEX idx_workspaces_user_id ON workspaces(user_id);
CREATE INDEX idx_projects_workspace_id ON projects(workspace_id);
CREATE INDEX idx_tasks_workspace_id ON tasks(workspace_id);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_assignee_id ON tasks(assignee_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_members_workspace_id ON members(workspace_id);
CREATE INDEX idx_members_user_id ON members(user_id);

-- Enable Row Level Security (RLS)
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for workspaces
CREATE POLICY "Users can view workspaces they are members of" ON workspaces
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.workspace_id = workspaces.id
      AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create workspaces" ON workspaces
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Workspace admins can update workspaces" ON workspaces
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.workspace_id = workspaces.id
      AND members.user_id = auth.uid()
      AND members.role = 'ADMIN'
    )
  );

CREATE POLICY "Workspace admins can delete workspaces" ON workspaces
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.workspace_id = workspaces.id
      AND members.user_id = auth.uid()
      AND members.role = 'ADMIN'
    )
  );

-- Create RLS policies for projects
CREATE POLICY "Users can view projects in their workspaces" ON projects
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.workspace_id = projects.workspace_id
      AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create projects in their workspaces" ON projects
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.workspace_id = projects.workspace_id
      AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update projects in their workspaces" ON projects
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.workspace_id = projects.workspace_id
      AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete projects in their workspaces" ON projects
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.workspace_id = projects.workspace_id
      AND members.user_id = auth.uid()
    )
  );

-- Create RLS policies for tasks
CREATE POLICY "Users can view tasks in their workspaces" ON tasks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.workspace_id = tasks.workspace_id
      AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create tasks in their workspaces" ON tasks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.workspace_id = tasks.workspace_id
      AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update tasks in their workspaces" ON tasks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.workspace_id = tasks.workspace_id
      AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete tasks in their workspaces" ON tasks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.workspace_id = tasks.workspace_id
      AND members.user_id = auth.uid()
    )
  );

-- Create RLS policies for members
CREATE POLICY "Users can view members in their workspaces" ON members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members m2
      WHERE m2.workspace_id = members.workspace_id
      AND m2.user_id = auth.uid()
    )
  );

CREATE POLICY "Workspace admins can manage members" ON members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM members m2
      WHERE m2.workspace_id = members.workspace_id
      AND m2.user_id = auth.uid()
      AND m2.role = 'ADMIN'
    )
  );

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_members_updated_at BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Option B: Table Editor (Manual)

If you prefer to create tables manually:

1. Go to **Supabase Dashboard** → **Table Editor**
2. Create each table with the exact column specifications shown above
3. Add the indexes and RLS policies as shown in the SQL

## 🗂️ Storage Setup

### Create Storage Bucket

1. Go to **Supabase Dashboard** → **Storage**
2. Click "Create bucket"
3. Name: `images`
4. Make it public (so images can be accessed via URLs)

### Storage Policies

Add these policies to the `images` bucket:

```sql
-- Allow authenticated users to upload files
CREATE POLICY "Users can upload images" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'images'
    AND auth.role() = 'authenticated'
  );

-- Allow users to view images
CREATE POLICY "Users can view images" ON storage.objects
  FOR SELECT USING (bucket_id = 'images');

-- Allow users to update their own images
CREATE POLICY "Users can update images" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to delete their own images
CREATE POLICY "Users can delete images" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
```

## 🔐 Authentication Setup

### Enable Email Authentication

1. Go to **Supabase Dashboard** → **Authentication** → **Settings**
2. Ensure "Email" is enabled under "Auth Providers"
3. Configure email templates if needed
4. Set up SMTP if you want custom email sending

### Configure Site URL

1. Go to **Authentication** → **Settings** → **Site URL**
2. Set to: `http://localhost:3000` (for development)
3. Add your production URL when deploying

## 🧪 Testing the Setup

### 1. Test Database Connection

Run this in your Supabase SQL Editor:

```sql
-- Test query to verify setup
SELECT
  'workspaces' as table_name,
  COUNT(*) as record_count
FROM workspaces
UNION ALL
SELECT
  'projects' as table_name,
  COUNT(*) as record_count
FROM projects
UNION ALL
SELECT
  'tasks' as table_name,
  COUNT(*) as record_count
FROM tasks
UNION ALL
SELECT
  'members' as table_name,
  COUNT(*) as record_count
FROM members;
```

### 2. Test Authentication

Try creating a user account through your app's registration form.

### 3. Test File Upload

Upload an image through your workspace or project creation forms.

## 🚀 Deployment Checklist

Before deploying to production:

### 1. Update Environment Variables
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-prod-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-prod-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-prod-service-role-key
NEXT_PUBLIC_APP_BASE_URL=https://your-domain.com
```

### 2. Configure Production Auth Settings
- Update Site URL to your production domain
- Configure additional redirect URLs if needed
- Set up proper email templates

### 3. Database Backups
- Enable automated backups in Supabase
- Consider setting up additional backup strategies

### 4. Monitoring
- Set up Supabase monitoring and alerts
- Configure log retention policies

## 🐛 Troubleshooting

### Common Issues:

1. **RLS Blocking Queries**
   - Check that RLS policies are correctly configured
   - Verify user authentication status

2. **Storage Upload Issues**
   - Ensure bucket is public
   - Check storage policies are applied

3. **Authentication Errors**
   - Verify environment variables are correct
   - Check site URL configuration

### Debug Queries:

```sql
-- Check current user
SELECT auth.uid();

-- Check RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename IN ('workspaces', 'projects', 'tasks', 'members');

-- Check storage policies
SELECT name, definition
FROM storage.policies
WHERE bucket_id = 'images';
```

## 📚 Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Storage Guide](https://supabase.com/docs/guides/storage)
- [Authentication Guide](https://supabase.com/docs/guides/auth)

## 🔄 Migration Complete!

Your Jira clone is now successfully migrated from Appwrite to Supabase! The application now uses:

- ✅ PostgreSQL database with proper relationships
- ✅ Built-in authentication and authorization
- ✅ Row Level Security for data protection
- ✅ File storage with public URLs
- ✅ Real-time capabilities (ready for future features)
- ✅ Better performance and scalability

Test all your features thoroughly before deploying to production! 🚀
