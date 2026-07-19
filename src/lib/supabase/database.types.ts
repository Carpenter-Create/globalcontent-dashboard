export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      assets: {
        Row: {
          bytes: number
          content_hash: string
          content_type: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["asset_kind"]
          org_id: string
          original_filename: string | null
          provided_by: string | null
          received_at: string
          storage_key: string
          title_id: string
        }
        Insert: {
          bytes: number
          content_hash: string
          content_type?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["asset_kind"]
          org_id: string
          original_filename?: string | null
          provided_by?: string | null
          received_at?: string
          storage_key: string
          title_id: string
        }
        Update: {
          bytes?: number
          content_hash?: string
          content_type?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["asset_kind"]
          org_id?: string
          original_filename?: string | null
          provided_by?: string | null
          received_at?: string
          storage_key?: string
          title_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "titles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor: string | null
          after: Json | null
          at: string
          before: Json | null
          entity: string
          entity_id: string | null
          id: string
          org_id: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
          org_id?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
          org_id?: string | null
        }
        Relationships: []
      }
      contract_assents: {
        Row: {
          agreed_at: string
          content_hash: string
          created_at: string
          id: string
          ip: unknown
          org_id: string
          source_document_id: string
          terms_version: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          agreed_at?: string
          content_hash: string
          created_at?: string
          id?: string
          ip?: unknown
          org_id: string
          source_document_id: string
          terms_version: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          agreed_at?: string
          content_hash?: string
          created_at?: string
          id?: string
          ip?: unknown
          org_id?: string
          source_document_id?: string
          terms_version?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_assents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_assents_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_terms: {
        Row: {
          created_at: string
          effective_from: string
          effective_to: string | null
          expires_at: string
          id: string
          org_id: string
          revenue_share_rate_bp: number
          source_document_id: string | null
          term_length_months: number
          tier: Database["public"]["Enums"]["tier_enum"]
          trigger: Database["public"]["Enums"]["term_trigger_enum"]
        }
        Insert: {
          created_at?: string
          effective_from: string
          effective_to?: string | null
          expires_at: string
          id?: string
          org_id: string
          revenue_share_rate_bp: number
          source_document_id?: string | null
          term_length_months: number
          tier: Database["public"]["Enums"]["tier_enum"]
          trigger: Database["public"]["Enums"]["term_trigger_enum"]
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          expires_at?: string
          id?: string
          org_id?: string
          revenue_share_rate_bp?: number
          source_document_id?: string | null
          term_length_months?: number
          tier?: Database["public"]["Enums"]["tier_enum"]
          trigger?: Database["public"]["Enums"]["term_trigger_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "contract_terms_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_terms_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      gc_staff: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["gc_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["gc_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["gc_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          dunning_hold: boolean
          id: string
          name: string
          payout_display: string | null
          payout_status: string | null
          status: Database["public"]["Enums"]["org_status"]
          tax_form_status: string | null
          trolley_recipient_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          dunning_hold?: boolean
          id?: string
          name: string
          payout_display?: string | null
          payout_status?: string | null
          status?: Database["public"]["Enums"]["org_status"]
          tax_form_status?: string | null
          trolley_recipient_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          dunning_hold?: boolean
          id?: string
          name?: string
          payout_display?: string | null
          payout_status?: string | null
          status?: Database["public"]["Enums"]["org_status"]
          tax_form_status?: string | null
          trolley_recipient_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rights_grants: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          org_id: string
          rights_type: Database["public"]["Enums"]["rights_type"]
          territories: string[]
          territory_mode: Database["public"]["Enums"]["territory_mode"]
          title_id: string
          updated_at: string
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          org_id: string
          rights_type: Database["public"]["Enums"]["rights_type"]
          territories?: string[]
          territory_mode: Database["public"]["Enums"]["territory_mode"]
          title_id: string
          updated_at?: string
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          org_id?: string
          rights_type?: Database["public"]["Enums"]["rights_type"]
          territories?: string[]
          territory_mode?: Database["public"]["Enums"]["territory_mode"]
          title_id?: string
          updated_at?: string
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rights_grants_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rights_grants_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "titles"
            referencedColumns: ["id"]
          },
        ]
      }
      source_documents: {
        Row: {
          content_hash: string
          created_at: string
          id: string
          kind: string
          org_id: string
          provided_by: string | null
          raw: Json | null
          received_at: string
          storage_key: string | null
        }
        Insert: {
          content_hash: string
          created_at?: string
          id?: string
          kind: string
          org_id: string
          provided_by?: string | null
          raw?: Json | null
          received_at?: string
          storage_key?: string | null
        }
        Update: {
          content_hash?: string
          created_at?: string
          id?: string
          kind?: string
          org_id?: string
          provided_by?: string | null
          raw?: Json | null
          received_at?: string
          storage_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      source_records: {
        Row: {
          created_at: string
          document_id: string
          id: string
          line_no: number | null
          org_id: string
          parsed: Json
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          line_no?: number | null
          org_id: string
          parsed: Json
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          line_no?: number | null
          org_id?: string
          parsed?: Json
        }
        Relationships: [
          {
            foreignKeyName: "source_records_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          annual_price_cents: number
          created_at: string
          current_period_end: string | null
          id: string
          org_id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tier: Database["public"]["Enums"]["tier_enum"]
          updated_at: string
        }
        Insert: {
          annual_price_cents: number
          created_at?: string
          current_period_end?: string | null
          id?: string
          org_id: string
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier: Database["public"]["Enums"]["tier_enum"]
          updated_at?: string
        }
        Update: {
          annual_price_cents?: number
          created_at?: string
          current_period_end?: string | null
          id?: string
          org_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: Database["public"]["Enums"]["tier_enum"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      title_metadata: {
        Row: {
          created_at: string
          data: Json
          org_id: string
          title_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data?: Json
          org_id: string
          title_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          org_id?: string
          title_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "title_metadata_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "title_metadata_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: true
            referencedRelation: "titles"
            referencedColumns: ["id"]
          },
        ]
      }
      titles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          status: Database["public"]["Enums"]["title_status"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          org_id: string
          status?: Database["public"]["Enums"]["title_status"]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          org_id?: string
          status?: Database["public"]["Enums"]["title_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "titles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_terms: {
        Args: {
          p_content_hash: string
          p_ip?: unknown
          p_rendered_text: string
          p_terms_version: string
          p_tier: Database["public"]["Enums"]["tier_enum"]
          p_user_agent?: string
        }
        Returns: Json
      }
      add_rights_grant: {
        Args: {
          p_effective_from?: string
          p_mode: Database["public"]["Enums"]["territory_mode"]
          p_org_id: string
          p_rights_types: Database["public"]["Enums"]["rights_type"][]
          p_territories: string[]
          p_title_id: string
          p_window_end?: string
          p_window_start?: string
        }
        Returns: string[]
      }
      can_deliver: {
        Args: {
          p_at: string
          p_rights_type: Database["public"]["Enums"]["rights_type"]
          p_territory: string
          p_title_id: string
        }
        Returns: boolean
      }
      create_asset: {
        Args: {
          p_bytes: number
          p_content_hash: string
          p_content_type?: string
          p_kind: Database["public"]["Enums"]["asset_kind"]
          p_org_id: string
          p_original_filename?: string
          p_storage_key: string
          p_title_id: string
        }
        Returns: string
      }
      create_org_and_membership: { Args: { p_name: string }; Returns: string }
      create_title: {
        Args: { p_org_id: string; p_title: string }
        Returns: string
      }
      finalize_paid_signup: {
        Args: {
          p_effective_from: string
          p_org: string
          p_price_cents: number
          p_source_document_id: string
          p_stripe_customer: string
          p_stripe_subscription: string
          p_tier: Database["public"]["Enums"]["tier_enum"]
        }
        Returns: undefined
      }
      is_gc_staff: { Args: { p_uid: string }; Returns: boolean }
      member_can: {
        Args: { p_capability: string; p_org: string; p_uid: string }
        Returns: boolean
      }
      set_title_metadata: {
        Args: { p_data: Json; p_org_id: string; p_title_id: string }
        Returns: undefined
      }
    }
    Enums: {
      asset_kind: "master" | "caption" | "artwork"
      gc_role:
        | "gc_account_owner"
        | "gc_accountant"
        | "gc_legal"
        | "gc_delivery_ops"
        | "gc_viewer"
      membership_status: "invited" | "active" | "removed"
      org_role:
        | "account_owner"
        | "accountant"
        | "legal"
        | "delivery_ops"
        | "viewer"
      org_status:
        | "registered"
        | "awaiting_payment"
        | "active"
        | "payment_lapsed"
        | "closed"
      rights_type:
        | "theatrical"
        | "fta"
        | "basic_cable"
        | "pay_tv"
        | "dth_satellite"
        | "ppv"
        | "pvod"
        | "svod"
        | "hvod"
        | "tvod"
        | "est"
        | "avod"
        | "fast"
        | "fvod"
        | "bvod"
        | "non_theatrical"
        | "hospitality"
        | "edu"
        | "ppl"
        | "home_video"
        | "mod"
      term_trigger_enum:
        | "signup"
        | "upgrade"
        | "downgrade"
        | "lapse"
        | "renewal"
        | "reinstate"
      territory_mode: "world" | "include" | "exclude"
      tier_enum: "access" | "pro" | "premium"
      title_status:
        | "draft"
        | "submitted"
        | "in_review"
        | "in_delivery"
        | "live"
        | "takedown_requested"
        | "taken_down"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      asset_kind: ["master", "caption", "artwork"],
      gc_role: [
        "gc_account_owner",
        "gc_accountant",
        "gc_legal",
        "gc_delivery_ops",
        "gc_viewer",
      ],
      membership_status: ["invited", "active", "removed"],
      org_role: [
        "account_owner",
        "accountant",
        "legal",
        "delivery_ops",
        "viewer",
      ],
      org_status: [
        "registered",
        "awaiting_payment",
        "active",
        "payment_lapsed",
        "closed",
      ],
      rights_type: [
        "theatrical",
        "fta",
        "basic_cable",
        "pay_tv",
        "dth_satellite",
        "ppv",
        "pvod",
        "svod",
        "hvod",
        "tvod",
        "est",
        "avod",
        "fast",
        "fvod",
        "bvod",
        "non_theatrical",
        "hospitality",
        "edu",
        "ppl",
        "home_video",
        "mod",
      ],
      term_trigger_enum: [
        "signup",
        "upgrade",
        "downgrade",
        "lapse",
        "renewal",
        "reinstate",
      ],
      territory_mode: ["world", "include", "exclude"],
      tier_enum: ["access", "pro", "premium"],
      title_status: [
        "draft",
        "submitted",
        "in_review",
        "in_delivery",
        "live",
        "takedown_requested",
        "taken_down",
      ],
    },
  },
} as const

