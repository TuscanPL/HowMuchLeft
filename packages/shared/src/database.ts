export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

// Hand-written to match the migrations; `pnpm db:types` regenerates it from a local stack.
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id: string
          display_name: string
          avatar_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          display_name?: string
          avatar_url?: string | null
          created_at?: string
        }
        Relationships: []
      }
      households: {
        Row: {
          id: string
          name: string
          currency: string
          period_start_day: number
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          currency?: string
          period_start_day?: number
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          currency?: string
          period_start_day?: number
          created_by?: string
          created_at?: string
        }
        Relationships: []
      }
      household_members: {
        Row: {
          household_id: string
          user_id: string
          role: Database['public']['Enums']['household_role']
          joined_at: string
        }
        Insert: {
          household_id: string
          user_id: string
          role?: Database['public']['Enums']['household_role']
          joined_at?: string
        }
        Update: {
          household_id?: string
          user_id?: string
          role?: Database['public']['Enums']['household_role']
          joined_at?: string
        }
        Relationships: []
      }
      household_invites: {
        Row: {
          id: string
          household_id: string
          token: string
          created_by: string
          expires_at: string
          used_by: string | null
          used_at: string | null
        }
        Insert: {
          id?: string
          household_id: string
          token?: string
          created_by?: string
          expires_at?: string
          used_by?: string | null
          used_at?: string | null
        }
        Update: {
          id?: string
          household_id?: string
          token?: string
          created_by?: string
          expires_at?: string
          used_by?: string | null
          used_at?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          id: string
          household_id: string
          name: string
          emoji: string
          kind: Database['public']['Enums']['category_kind']
          monthly_limit: number | null
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          name: string
          emoji?: string
          kind?: Database['public']['Enums']['category_kind']
          monthly_limit?: number | null
          position?: number
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          name?: string
          emoji?: string
          kind?: Database['public']['Enums']['category_kind']
          monthly_limit?: number | null
          position?: number
          created_at?: string
        }
        Relationships: []
      }
      bills: {
        Row: {
          id: string
          household_id: string
          name: string
          amount: number
          due_day: number
          category_id: string | null
          match: string | null
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          name: string
          amount: number
          due_day: number
          category_id?: string | null
          match?: string | null
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          name?: string
          amount?: number
          due_day?: number
          category_id?: string | null
          match?: string | null
          active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      incomes: {
        Row: {
          id: string
          household_id: string
          name: string
          amount: number
          pay_day: number
          match: string | null
          active: boolean
          starts_month: boolean
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          name: string
          amount: number
          pay_day?: number
          match?: string | null
          active?: boolean
          starts_month?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          name?: string
          amount?: number
          pay_day?: number
          match?: string | null
          active?: boolean
          starts_month?: boolean
          created_at?: string
        }
        Relationships: []
      }
      goals: {
        Row: {
          id: string
          household_id: string
          name: string
          emoji: string
          target: number
          saved: number
          monthly_contribution: number
          target_date: string | null
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          name: string
          emoji?: string
          target: number
          saved?: number
          monthly_contribution?: number
          target_date?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          name?: string
          emoji?: string
          target?: number
          saved?: number
          monthly_contribution?: number
          target_date?: string | null
          created_at?: string
        }
        Relationships: []
      }
      rules: {
        Row: {
          id: string
          household_id: string
          match: string
          category_id: string
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          match: string
          category_id: string
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          match?: string
          category_id?: string
          created_at?: string
        }
        Relationships: []
      }
      bank_connections: {
        Row: {
          id: string
          household_id: string
          created_by: string
          aspsp_name: string
          aspsp_country: string
          status: Database['public']['Enums']['connection_status']
          valid_until: string | null
          last_synced_at: string | null
          last_error: string | null
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          created_by: string
          aspsp_name: string
          aspsp_country?: string
          status?: Database['public']['Enums']['connection_status']
          valid_until?: string | null
          last_synced_at?: string | null
          last_error?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          created_by?: string
          aspsp_name?: string
          aspsp_country?: string
          status?: Database['public']['Enums']['connection_status']
          valid_until?: string | null
          last_synced_at?: string | null
          last_error?: string | null
          created_at?: string
        }
        Relationships: []
      }
      bank_connection_secrets: {
        Row: {
          connection_id: string
          auth_state: string | null
          session_id: string | null
        }
        Insert: {
          connection_id: string
          auth_state?: string | null
          session_id?: string | null
        }
        Update: {
          connection_id?: string
          auth_state?: string | null
          session_id?: string | null
        }
        Relationships: []
      }
      paydays: {
        Row: {
          household_id: string
          starts_on: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          household_id: string
          starts_on: string
          created_by?: string | null
          created_at?: string
        }
        Update: {
          household_id?: string
          starts_on?: string
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      accounts: {
        Row: {
          id: string
          household_id: string
          connection_id: string | null
          external_uid: string | null
          owner_id: string | null
          name: string
          iban: string | null
          currency: string
          balance: number | null
          balance_at: string | null
          include_in_pocket: boolean
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          connection_id?: string | null
          external_uid?: string | null
          owner_id?: string | null
          name: string
          iban?: string | null
          currency?: string
          balance?: number | null
          balance_at?: string | null
          include_in_pocket?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          connection_id?: string | null
          external_uid?: string | null
          owner_id?: string | null
          name?: string
          iban?: string | null
          currency?: string
          balance?: number | null
          balance_at?: string | null
          include_in_pocket?: boolean
          created_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          id: string
          household_id: string
          account_id: string
          external_id: string
          status: Database['public']['Enums']['tx_status']
          booked_on: string
          amount: number
          currency: string
          description: string
          counterparty: string | null
          counterparty_iban: string | null
          category_id: string | null
          bill_id: string | null
          income_id: string | null
          note: string | null
          ignored: boolean
          manual: boolean
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          account_id: string
          external_id: string
          status?: Database['public']['Enums']['tx_status']
          booked_on: string
          amount: number
          currency?: string
          description?: string
          counterparty?: string | null
          counterparty_iban?: string | null
          category_id?: string | null
          bill_id?: string | null
          income_id?: string | null
          note?: string | null
          ignored?: boolean
          manual?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          account_id?: string
          external_id?: string
          status?: Database['public']['Enums']['tx_status']
          booked_on?: string
          amount?: number
          currency?: string
          description?: string
          counterparty?: string | null
          counterparty_iban?: string | null
          category_id?: string | null
          bill_id?: string | null
          income_id?: string | null
          note?: string | null
          ignored?: boolean
          manual?: boolean
          created_at?: string
        }
        Relationships: []
      }
      signup_allowlist: {
        Row: {
          entry: string
          added_at: string
        }
        Insert: {
          entry: string
          added_at?: string
        }
        Update: {
          entry?: string
          added_at?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      create_household: {
        Args: { p_name: string; p_period_start_day?: number }
        Returns: Database['public']['Tables']['households']['Row']
      }
      invite_preview: {
        Args: { p_token: string }
        Returns: {
          household_id: string
          household_name: string
          invited_by: string
          expires_at: string
          is_valid: boolean
          already_member: boolean
        }[]
      }
      mark_payday: {
        Args: { p_household_id: string; p_date: string; p_move?: boolean }
        Returns: { starts_on: string; created_by: string | null; created: boolean }[]
      }
      redeem_invite: { Args: { p_token: string }; Returns: string }
      recategorize: { Args: { p_household_id: string; p_since?: string }; Returns: number }
      is_household_member: { Args: { p_household_id: string }; Returns: boolean }
      is_household_owner: { Args: { p_household_id: string }; Returns: boolean }
      shares_household_with: { Args: { p_user_id: string }; Returns: boolean }
    }
    Enums: {
      household_role: 'owner' | 'member'
      category_kind: 'expense' | 'income' | 'transfer' | 'savings'
      connection_status: 'pending' | 'active' | 'expired' | 'error' | 'revoked'
      tx_status: 'booked' | 'pending'
    }
    CompositeTypes: { [_ in never]: never }
  }
}
