// Supabase table names (PostgreSQL tables)
export const TABLES = {
  MEMBERS: 'members',
  PROJECTS: 'projects',
  TASKS: 'tasks',
  WORKSPACES: 'workspaces',
} as const

// Supabase storage bucket names
export const BUCKETS = {
  IMAGES: 'images',
} as const

// Database types for TypeScript
export type Database = {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string
          name: string
          user_id: string
          image_id: string | null
          invite_code: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          user_id: string
          image_id?: string | null
          invite_code: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          user_id?: string
          image_id?: string | null
          invite_code?: string
          created_at?: string
          updated_at?: string
        }
      }
      projects: {
        Row: {
          id: string
          name: string
          description: string | null
          workspace_id: string
          image_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          workspace_id: string
          image_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          workspace_id?: string
          image_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      tasks: {
        Row: {
          id: string
          name: string
          description: string | null
          status: string
          workspace_id: string
          project_id: string
          assignee_id: string
          due_date: string | null
          position: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          status: string
          workspace_id: string
          project_id: string
          assignee_id: string
          due_date?: string | null
          position: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          status?: string
          workspace_id?: string
          project_id?: string
          assignee_id?: string
          due_date?: string | null
          position?: number
          created_at?: string
          updated_at?: string
        }
      }
      members: {
        Row: {
          id: string
          user_id: string
          workspace_id: string
          role: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          workspace_id: string
          role: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          workspace_id?: string
          role?: string
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}
