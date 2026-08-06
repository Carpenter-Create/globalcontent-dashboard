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
      deliveries: {
        Row: {
          created_at: string
          created_by: string | null
          grant_id: string
          id: string
          org_id: string
          status: Database["public"]["Enums"]["delivery_status"]
          status_note: string | null
          territory: string
          title_id: string
          updated_at: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          grant_id: string
          id?: string
          org_id: string
          status?: Database["public"]["Enums"]["delivery_status"]
          status_note?: string | null
          territory: string
          title_id: string
          updated_at?: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          grant_id?: string
          id?: string
          org_id?: string
          status?: Database["public"]["Enums"]["delivery_status"]
          status_note?: string | null
          territory?: string
          title_id?: string
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "rights_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "titles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      export_records: {
        Row: {
          exported_at: string
          exported_by: string | null
          id: string
          payload: Json
          title_ids: string[]
          vendor_id: string
        }
        Insert: {
          exported_at?: string
          exported_by?: string | null
          id?: string
          payload: Json
          title_ids: string[]
          vendor_id: string
        }
        Update: {
          exported_at?: string
          exported_by?: string | null
          id?: string
          payload?: Json
          title_ids?: string[]
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_records_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      findings: {
        Row: {
          code: string
          created_at: string
          derived_at: string
          entity_id: string
          entity_type: string
          id: string
          logic_version: string
          message: string
          org_id: string
          resolved_at: string | null
          sender: Database["public"]["Enums"]["finding_sender"]
          severity: Database["public"]["Enums"]["finding_severity"]
          source: Database["public"]["Enums"]["finding_source"]
          source_refs: Json
          status: Database["public"]["Enums"]["finding_status"]
        }
        Insert: {
          code: string
          created_at?: string
          derived_at?: string
          entity_id: string
          entity_type: string
          id?: string
          logic_version: string
          message: string
          org_id: string
          resolved_at?: string | null
          sender?: Database["public"]["Enums"]["finding_sender"]
          severity: Database["public"]["Enums"]["finding_severity"]
          source: Database["public"]["Enums"]["finding_source"]
          source_refs: Json
          status?: Database["public"]["Enums"]["finding_status"]
        }
        Update: {
          code?: string
          created_at?: string
          derived_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          logic_version?: string
          message?: string
          org_id?: string
          resolved_at?: string | null
          sender?: Database["public"]["Enums"]["finding_sender"]
          severity?: Database["public"]["Enums"]["finding_severity"]
          source?: Database["public"]["Enums"]["finding_source"]
          source_refs?: Json
          status?: Database["public"]["Enums"]["finding_status"]
        }
        Relationships: [
          {
            foreignKeyName: "findings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      notification_reads: {
        Row: {
          notification_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          notification_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          notification_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          org_id: string
          sender: Database["public"]["Enums"]["notification_sender"]
          source_refs: Json
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          org_id: string
          sender?: Database["public"]["Enums"]["notification_sender"]
          source_refs: Json
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          org_id?: string
          sender?: Database["public"]["Enums"]["notification_sender"]
          source_refs?: Json
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_payout_details: {
        Row: {
          created_at: string
          org_id: string
          payout_display: string | null
          payout_status: string | null
          tax_form_status: string | null
          trolley_recipient_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          org_id: string
          payout_display?: string | null
          payout_status?: string | null
          tax_form_status?: string | null
          trolley_recipient_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          org_id?: string
          payout_display?: string | null
          payout_status?: string | null
          tax_form_status?: string | null
          trolley_recipient_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_payout_details_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
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
          status: Database["public"]["Enums"]["org_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          dunning_hold?: boolean
          id?: string
          name: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          dunning_hold?: boolean
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Relationships: []
      }
      portal_access_events: {
        Row: {
          company: string | null
          email: string | null
          event_type: Database["public"]["Enums"]["portal_event"]
          id: string
          ip: unknown
          link_id: string
          name: string | null
          occurred_at: string
          session_id: string | null
          user_agent: string | null
        }
        Insert: {
          company?: string | null
          email?: string | null
          event_type: Database["public"]["Enums"]["portal_event"]
          id?: string
          ip?: unknown
          link_id: string
          name?: string | null
          occurred_at?: string
          session_id?: string | null
          user_agent?: string | null
        }
        Update: {
          company?: string | null
          email?: string | null
          event_type?: Database["public"]["Enums"]["portal_event"]
          id?: string
          ip?: unknown
          link_id?: string
          name?: string | null
          occurred_at?: string
          session_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_access_events_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "portal_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_access_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "portal_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_links: {
        Row: {
          asset_id: string | null
          created_at: string
          created_by: string | null
          delivery_id: string | null
          expires_at: string
          id: string
          purpose: Database["public"]["Enums"]["portal_link_purpose"]
          recipient_name: string | null
          revoked_at: string | null
          share_token: string | null
          title_id: string | null
          token_hash: string
          vendor_id: string | null
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          created_by?: string | null
          delivery_id?: string | null
          expires_at: string
          id?: string
          purpose?: Database["public"]["Enums"]["portal_link_purpose"]
          recipient_name?: string | null
          revoked_at?: string | null
          share_token?: string | null
          title_id?: string | null
          token_hash: string
          vendor_id?: string | null
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          created_by?: string | null
          delivery_id?: string | null
          expires_at?: string
          id?: string
          purpose?: Database["public"]["Enums"]["portal_link_purpose"]
          recipient_name?: string | null
          revoked_at?: string | null
          share_token?: string | null
          title_id?: string | null
          token_hash?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_links_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_links_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_links_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "titles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_links_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_otps: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          link_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          link_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          link_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_otps_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "portal_links"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_sessions: {
        Row: {
          company: string
          created_at: string
          email: string
          expires_at: string
          id: string
          link_id: string
          name: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          company: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          link_id: string
          name: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          company?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          link_id?: string
          name?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_sessions_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "portal_links"
            referencedColumns: ["id"]
          },
        ]
      }
      rights_grants: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          exclusive: boolean
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
          exclusive?: boolean
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
          exclusive?: boolean
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
      screener_view_events: {
        Row: {
          event_type: Database["public"]["Enums"]["screener_event"]
          id: string
          link_id: string
          occurred_at: string
          position_seconds: number
          runtime_seconds: number | null
          session_id: string
        }
        Insert: {
          event_type: Database["public"]["Enums"]["screener_event"]
          id?: string
          link_id: string
          occurred_at?: string
          position_seconds?: number
          runtime_seconds?: number | null
          session_id: string
        }
        Update: {
          event_type?: Database["public"]["Enums"]["screener_event"]
          id?: string
          link_id?: string
          occurred_at?: string
          position_seconds?: number
          runtime_seconds?: number | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "screener_view_events_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "portal_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screener_view_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "portal_sessions"
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
      title_reviews: {
        Row: {
          created_at: string
          decision: Database["public"]["Enums"]["review_decision"]
          id: string
          org_id: string
          reason: string | null
          reviewer: string | null
          title_id: string
        }
        Insert: {
          created_at?: string
          decision: Database["public"]["Enums"]["review_decision"]
          id?: string
          org_id: string
          reason?: string | null
          reviewer?: string | null
          title_id: string
        }
        Update: {
          created_at?: string
          decision?: Database["public"]["Enums"]["review_decision"]
          id?: string
          org_id?: string
          reason?: string | null
          reviewer?: string | null
          title_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "title_reviews_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "title_reviews_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "titles"
            referencedColumns: ["id"]
          },
        ]
      }
      titles: {
        Row: {
          catalog_id: string | null
          catalog_no: number
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          original_release_date: string | null
          release_date: string | null
          release_type: Database["public"]["Enums"]["release_type"]
          screener_source: Database["public"]["Enums"]["screener_source"]
          status: Database["public"]["Enums"]["title_status"]
          title: string
          updated_at: string
          work_id: string | null
        }
        Insert: {
          catalog_id?: string | null
          catalog_no?: number
          created_at?: string
          created_by?: string | null
          id?: string
          org_id: string
          original_release_date?: string | null
          release_date?: string | null
          release_type?: Database["public"]["Enums"]["release_type"]
          screener_source?: Database["public"]["Enums"]["screener_source"]
          status?: Database["public"]["Enums"]["title_status"]
          title: string
          updated_at?: string
          work_id?: string | null
        }
        Update: {
          catalog_id?: string | null
          catalog_no?: number
          created_at?: string
          created_by?: string | null
          id?: string
          org_id?: string
          original_release_date?: string | null
          release_date?: string | null
          release_type?: Database["public"]["Enums"]["release_type"]
          screener_source?: Database["public"]["Enums"]["screener_source"]
          status?: Database["public"]["Enums"]["title_status"]
          title?: string
          updated_at?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "titles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titles_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          active: boolean
          company_info: Json | null
          created_at: string
          delivery_mode: Database["public"]["Enums"]["vendor_mode"]
          email_cc: string[]
          email_template: string | null
          email_to: string[]
          export_format_spec: Json | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          company_info?: Json | null
          created_at?: string
          delivery_mode: Database["public"]["Enums"]["vendor_mode"]
          email_cc?: string[]
          email_template?: string | null
          email_to?: string[]
          export_format_spec?: Json | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          company_info?: Json | null
          created_at?: string
          delivery_mode?: Database["public"]["Enums"]["vendor_mode"]
          email_cc?: string[]
          email_template?: string | null
          email_to?: string[]
          export_format_spec?: Json | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      works: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          updated_at?: string
        }
        Relationships: []
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
          p_exclusive: boolean
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
      attach_link_vendor: {
        // p_vendor_id is required (no SQL DEFAULT) but explicitly nullable — passing null is
        // how a caller detaches a vendor from a link, not an omitted argument.
        Args: { p_force?: boolean; p_link_id: string; p_vendor_id: string | null }
        Returns: undefined
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
      create_delivery: {
        Args: {
          p_grant_id: string
          p_territory: string
          p_title_id: string
          p_vendor_id: string
        }
        Returns: string
      }
      create_notification: {
        Args: {
          p_body: string
          p_kind: Database["public"]["Enums"]["notification_kind"]
          p_org_id: string
          p_source_refs: Json
          p_title: string
        }
        Returns: string
      }
      create_org_and_membership: { Args: { p_name: string }; Returns: string }
      create_portal_link: {
        Args: {
          p_asset_id: string
          p_delivery_id: string
          p_expires_at?: string
          p_token_hash: string
        }
        Returns: string
      }
      create_screener_link: {
        Args: {
          p_expires_at?: string
          p_recipient_name?: string
          p_share_token?: string
          p_title_id: string
          p_token_hash: string
        }
        Returns: string
      }
      create_title: {
        Args: {
          p_org_id: string
          p_original_release_date?: string
          p_release_type: Database["public"]["Enums"]["release_type"]
          p_title: string
        }
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
      gc_can: {
        Args: { p_capability: string; p_uid: string }
        Returns: boolean
      }
      gc_check_digit: { Args: { p_n: number }; Returns: number }
      is_gc_staff: { Args: { p_uid: string }; Returns: boolean }
      lapse_org: {
        Args: { p_first_failure: string; p_org: string }
        Returns: string
      }
      link_title_to_work_of: {
        Args: { p_target_title_id: string; p_title_id: string }
        Returns: string
      }
      mark_notifications_read: { Args: { p_ids: string[] }; Returns: undefined }
      member_can: {
        Args: { p_capability: string; p_org: string; p_uid: string }
        Returns: boolean
      }
      my_deliveries: {
        Args: never
        Returns: {
          delivery_id: string
          status: Database["public"]["Enums"]["delivery_status"]
          territory: string
          title: string
          title_id: string
          updated_at: string
          vendor_name: string
        }[]
      }
      my_findings: {
        Args: never
        Returns: {
          code: string
          created_at: string
          derived_at: string
          entity_id: string
          entity_type: string
          id: string
          logic_version: string
          message: string
          org_id: string
          resolved_at: string | null
          sender: Database["public"]["Enums"]["finding_sender"]
          severity: Database["public"]["Enums"]["finding_severity"]
          source: Database["public"]["Enums"]["finding_source"]
          source_refs: Json
          status: Database["public"]["Enums"]["finding_status"]
        }[]
        SetofOptions: {
          from: "*"
          to: "findings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      my_notifications: {
        Args: never
        Returns: {
          body: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          org_id: string
          source_refs: Json
          title: string
          unread: boolean
        }[]
      }
      my_unread_count: { Args: never; Returns: number }
      org_notification_recipients: {
        Args: { p_org_id: string }
        Returns: string[]
      }
      portal_resolve_download: {
        Args: { p_session_token_hash: string }
        Returns: {
          link_id: string
          session_id: string
          storage_key: string
        }[]
      }
      portal_resolve_screener: {
        Args: { p_session_token_hash: string }
        Returns: {
          link_id: string
          session_id: string
          storage_key: string
          title_id: string
        }[]
      }
      reconcile_title_findings: {
        Args: {
          p_findings: Json
          p_logic_version: string
          p_org_id: string
          p_title_id: string
        }
        Returns: undefined
      }
      record_export: {
        Args: { p_payload: Json; p_title_ids: string[]; p_vendor_id: string }
        Returns: string
      }
      record_renewal: {
        Args: { p_effective_from: string; p_org: string }
        Returns: string
      }
      review_title: {
        Args: {
          p_decision: Database["public"]["Enums"]["review_decision"]
          p_reason: string
          p_title_id: string
        }
        Returns: undefined
      }
      revoke_portal_link: { Args: { p_link_id: string }; Returns: undefined }
      revoke_portal_session: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      same_work_conflicts: {
        Args: { p_title_id: string }
        Returns: {
          other_org_name: string
          other_title: string
          other_title_id: string
          rights_type: Database["public"]["Enums"]["rights_type"]
        }[]
      }
      screener_engagement: {
        Args: { p_link_id: string }
        Returns: {
          company: string
          completed: boolean
          email: string
          last_viewed: string
          name: string
          replays: number
          session_id: string
          watched_pct: number
        }[]
      }
      set_delivery_status: {
        Args: {
          p_delivery_id: string
          p_note?: string
          p_status: Database["public"]["Enums"]["delivery_status"]
        }
        Returns: undefined
      }
      set_release_date: {
        Args: { p_date?: string; p_title_id: string }
        Returns: undefined
      }
      set_screener_source: {
        Args: {
          p_source: Database["public"]["Enums"]["screener_source"]
          p_title_id: string
        }
        Returns: undefined
      }
      set_title_metadata: {
        Args: { p_data: Json; p_org_id: string; p_title_id: string }
        Returns: undefined
      }
      set_title_release_info: {
        Args: {
          p_org_id: string
          p_original_release_date?: string
          p_release_type: Database["public"]["Enums"]["release_type"]
          p_title_id: string
        }
        Returns: undefined
      }
      submit_title: {
        Args: { p_org_id: string; p_title_id: string }
        Returns: undefined
      }
      suggest_same_work: {
        Args: { p_title_id: string }
        Returns: {
          org_name: string
          release_year: string
          title: string
          title_id: string
        }[]
      }
      territories_overlap: {
        Args: {
          p_mode_a: Database["public"]["Enums"]["territory_mode"]
          p_mode_b: Database["public"]["Enums"]["territory_mode"]
          p_terr_a: string[]
          p_terr_b: string[]
        }
        Returns: boolean
      }
      tier_allows: {
        Args: { p_action: string; p_org: string }
        Returns: boolean
      }
      tier_revenue_share_bp: {
        Args: { p_tier: Database["public"]["Enums"]["tier_enum"] }
        Returns: number
      }
      title_vendor_licensed: {
        Args: { p_title_id: string; p_vendor_id: string }
        Returns: boolean
      }
    }
    Enums: {
      asset_kind:
        | "master"
        | "caption"
        | "artwork"
        | "screener"
        | "poster"
        | "banner"
        | "trailer"
      delivery_status:
        | "pending"
        | "delivered"
        | "live"
        | "rejected"
        | "taken_down"
      finding_sender: "gc_support" | "globee"
      finding_severity: "high" | "low"
      finding_source: "validator" | "ai"
      finding_status: "open" | "resolved"
      gc_role:
        | "gc_account_owner"
        | "gc_accountant"
        | "gc_legal"
        | "gc_delivery_ops"
        | "gc_viewer"
      membership_status: "invited" | "active" | "removed"
      notification_kind: "title_rejected" | "delivery_update"
      notification_sender: "gc_support" | "globee"
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
      portal_event:
        | "room_viewed"
        | "otp_sent"
        | "otp_verified"
        | "download"
        | "restore_requested"
      portal_link_purpose: "master_download" | "screener_view"
      release_type: "new_release" | "re_release"
      review_decision: "approve" | "reject"
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
      screener_event: "play" | "pause" | "seek" | "progress" | "ended"
      screener_source: "master" | "dedicated"
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
      vendor_mode: "portal_upload" | "email"
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
      asset_kind: [
        "master",
        "caption",
        "artwork",
        "screener",
        "poster",
        "banner",
        "trailer",
      ],
      delivery_status: [
        "pending",
        "delivered",
        "live",
        "rejected",
        "taken_down",
      ],
      finding_sender: ["gc_support", "globee"],
      finding_severity: ["high", "low"],
      finding_source: ["validator", "ai"],
      finding_status: ["open", "resolved"],
      gc_role: [
        "gc_account_owner",
        "gc_accountant",
        "gc_legal",
        "gc_delivery_ops",
        "gc_viewer",
      ],
      membership_status: ["invited", "active", "removed"],
      notification_kind: ["title_rejected", "delivery_update"],
      notification_sender: ["gc_support", "globee"],
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
      portal_event: [
        "room_viewed",
        "otp_sent",
        "otp_verified",
        "download",
        "restore_requested",
      ],
      portal_link_purpose: ["master_download", "screener_view"],
      release_type: ["new_release", "re_release"],
      review_decision: ["approve", "reject"],
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
      screener_event: ["play", "pause", "seek", "progress", "ended"],
      screener_source: ["master", "dedicated"],
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
      vendor_mode: ["portal_upload", "email"],
    },
  },
} as const

