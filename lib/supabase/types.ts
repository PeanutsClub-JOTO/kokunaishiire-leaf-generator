/**
 * Supabase Database 型定義 (スキーマ v2.1 準拠)
 * 本来は `supabase gen types typescript` で自動生成するが、
 * Supabaseプロジェクト作成前のため手動定義。
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

type Rel = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

export type Database = {
  public: {
    Tables: {
      quotations: {
        Row: {
          id: string;
          source_type: 'gsheet' | 'xlsx' | 'pdf' | 'eml';
          source_ref: string | null;
          client_name: string | null;
          quoted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          source_type: 'gsheet' | 'xlsx' | 'pdf' | 'eml';
          source_ref?: string | null;
          client_name?: string | null;
          quoted_at?: string | null;
          created_at?: string;
        };
        Update: {
          source_type?: 'gsheet' | 'xlsx' | 'pdf' | 'eml';
          source_ref?: string | null;
          client_name?: string | null;
          quoted_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      sheets: {
        Row: {
          id: string;
          quotation_id: string;
          sheet_name: string | null;
          maker_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          quotation_id: string;
          sheet_name?: string | null;
          maker_name?: string | null;
          created_at?: string;
        };
        Update: {
          quotation_id?: string;
          sheet_name?: string | null;
          maker_name?: string | null;
          created_at?: string;
        };
        Relationships: [
          Rel & {
            foreignKeyName: 'sheets_quotation_id_fkey';
            columns: ['quotation_id'];
            isOneToOne: false;
            referencedRelation: 'quotations';
            referencedColumns: ['id'];
          }
        ];
      };
      products: {
        Row: {
          id: string;
          sheet_id: string;
          no: number | null;
          maker_name: string | null;
          product_name: string | null;
          spec_raw: string | null;
          spec_pieces: number | null;
          spec_grams: number | null;
          irisu_raw: string | null;
          case_qty: number | null;
          lots_per_kou: number | null;
          min_lot_raw: string | null;
          min_lot_qty: number | null;
          retail_price: number | null;
          cost: number | null;
          jan_code: string | null;
          shelf_life_days: number | null;
          sales_period_raw: string | null;
          sales_period_start: string | null;
          sales_period_end: string | null;
          piece_size: string | null;
          image_url: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          sheet_id: string;
          no?: number | null;
          maker_name?: string | null;
          product_name?: string | null;
          spec_raw?: string | null;
          spec_pieces?: number | null;
          spec_grams?: number | null;
          irisu_raw?: string | null;
          case_qty?: number | null;
          lots_per_kou?: number | null;
          min_lot_raw?: string | null;
          min_lot_qty?: number | null;
          retail_price?: number | null;
          cost?: number | null;
          jan_code?: string | null;
          shelf_life_days?: number | null;
          sales_period_raw?: string | null;
          sales_period_start?: string | null;
          sales_period_end?: string | null;
          piece_size?: string | null;
          image_url?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['products']['Insert']>;
        Relationships: [
          Rel & {
            foreignKeyName: 'products_sheet_id_fkey';
            columns: ['sheet_id'];
            isOneToOne: false;
            referencedRelation: 'sheets';
            referencedColumns: ['id'];
          }
        ];
      };
      assort_groups: {
        Row: {
          id: string;
          sheet_id: string;
          group_key: string | null;
          is_single: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          sheet_id: string;
          group_key?: string | null;
          is_single?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['assort_groups']['Insert']>;
        Relationships: [
          Rel & {
            foreignKeyName: 'assort_groups_sheet_id_fkey';
            columns: ['sheet_id'];
            isOneToOne: false;
            referencedRelation: 'sheets';
            referencedColumns: ['id'];
          }
        ];
      };
      assort_items: {
        Row: {
          id: string;
          group_id: string;
          product_id: string;
          ratio: number;
        };
        Insert: {
          id?: string;
          group_id: string;
          product_id: string;
          ratio?: number;
        };
        Update: Partial<Database['public']['Tables']['assort_items']['Insert']>;
        Relationships: [
          Rel & {
            foreignKeyName: 'assort_items_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'assort_groups';
            referencedColumns: ['id'];
          },
          Rel & {
            foreignKeyName: 'assort_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          }
        ];
      };
      leaflets: {
        Row: {
          id: string;
          group_id: string;
          product_code: string | null;
          pj_no: string | null;
          leaf_name: string | null;
          item_count: number | null;
          leaf_qty: number | null;
          cost_total: number | null;
          wholesale_price: number | null;
          unit_price: number | null;
          is_half_ok: boolean | null;
          lead_time: string | null;
          shelf_life_days: number | null;
          piece_size: string | null;
          note: string | null;
          status: 'draft' | 'final';
          pdf_url: string | null;
          leaf_image_url: string | null;
          leaf_pdf_url: string | null;
          template_version: string | null;
          render_status: string;
          render_error: string | null;
          finalized_at: string | null;
          final_visible_until: string | null;
          drive_file_id: string | null;
          drive_url: string | null;
          drive_export_status: 'none' | 'pending' | 'exporting' | 'done' | 'error';
          drive_export_error: string | null;
          assort_followup_status: 'unasked' | 'not_needed' | 'accepted' | 'declined';
          image_overrides: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          product_code?: string | null;
          pj_no?: string | null;
          leaf_name?: string | null;
          item_count?: number | null;
          leaf_qty?: number | null;
          cost_total?: number | null;
          wholesale_price?: number | null;
          unit_price?: number | null;
          is_half_ok?: boolean | null;
          lead_time?: string | null;
          shelf_life_days?: number | null;
          piece_size?: string | null;
          note?: string | null;
          status?: 'draft' | 'final';
          pdf_url?: string | null;
          leaf_image_url?: string | null;
          leaf_pdf_url?: string | null;
          template_version?: string | null;
          render_status?: string;
          render_error?: string | null;
          finalized_at?: string | null;
          final_visible_until?: string | null;
          drive_file_id?: string | null;
          drive_url?: string | null;
          drive_export_status?: 'none' | 'pending' | 'exporting' | 'done' | 'error';
          drive_export_error?: string | null;
          assort_followup_status?: 'unasked' | 'not_needed' | 'accepted' | 'declined';
          image_overrides?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['leaflets']['Insert']>;
        Relationships: [
          Rel & {
            foreignKeyName: 'leaflets_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'assort_groups';
            referencedColumns: ['id'];
          }
        ];
      };
      alert_flags: {
        Row: {
          id: string;
          target_type: 'product' | 'leaflet' | 'group';
          target_id: string;
          flag_code: string;
          message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          target_type: 'product' | 'leaflet' | 'group';
          target_id: string;
          flag_code: string;
          message?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['alert_flags']['Insert']>;
        Relationships: [];
      };
      jobs: {
        Row: {
          id: string;
          quotation_id: string | null;
          target_id: string | null;
          job_type:
            | 'import_xlsx'
            | 'import_gsheet'
            | 'import_pdf'
            | 'import_image_pdf'
            | 'import_eml'
            | 'gmail_scan'
            | 'gmail_ingest_message'
            | 'generate_pdf'
            | 'render_leaflet_image'
            | 'export_final_leaflet_to_drive';
          status: 'queued' | 'running' | 'done' | 'error';
          progress: number;
          error_message: string | null;
          created_at: string;
          started_at: string | null;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          quotation_id?: string | null;
          target_id?: string | null;
          job_type: Database['public']['Tables']['jobs']['Row']['job_type'];
          status?: Database['public']['Tables']['jobs']['Row']['status'];
          progress?: number;
          error_message?: string | null;
          created_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['jobs']['Insert']>;
        Relationships: [];
      };
      app_settings: {
        Row: {
          key: string;
          value: number;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: number;
          updated_at?: string;
        };
        Update: { value?: number; updated_at?: string };
        Relationships: [];
      };
      gmail_estimate_messages: {
        Row: {
          id: string;
          gmail_message_id: string;
          gmail_thread_id: string | null;
          subject: string | null;
          from_address: string | null;
          received_at: string | null;
          snippet: string | null;
          archive_storage_prefix: string | null;
          gmail_label_applied: boolean;
          status: 'archived' | 'queued' | 'processed' | 'error';
          error_message: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gmail_message_id: string;
          gmail_thread_id?: string | null;
          subject?: string | null;
          from_address?: string | null;
          received_at?: string | null;
          snippet?: string | null;
          archive_storage_prefix?: string | null;
          gmail_label_applied?: boolean;
          status?: Database['public']['Tables']['gmail_estimate_messages']['Row']['status'];
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['gmail_estimate_messages']['Insert']>;
        Relationships: [];
      };
      gmail_estimate_files: {
        Row: {
          id: string;
          message_id: string;
          file_name: string;
          file_sha256: string | null;
          mime_type: string | null;
          storage_path: string;
          file_kind: 'quotation' | 'eml' | 'unsupported';
          quotation_id: string | null;
          import_job_id: string | null;
          status: 'archived' | 'queued' | 'processed' | 'unsupported' | 'error';
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          message_id: string;
          file_name: string;
          file_sha256?: string | null;
          mime_type?: string | null;
          storage_path: string;
          file_kind: Database['public']['Tables']['gmail_estimate_files']['Row']['file_kind'];
          quotation_id?: string | null;
          import_job_id?: string | null;
          status?: Database['public']['Tables']['gmail_estimate_files']['Row']['status'];
          error_message?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['gmail_estimate_files']['Insert']>;
        Relationships: [
          Rel & {
            foreignKeyName: 'gmail_estimate_files_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_estimate_messages';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

// 便利な型エイリアス
export type Quotation = Database['public']['Tables']['quotations']['Row'];
export type Sheet = Database['public']['Tables']['sheets']['Row'];
export type Product = Database['public']['Tables']['products']['Row'];
export type AssortGroup = Database['public']['Tables']['assort_groups']['Row'];
export type AssortItem = Database['public']['Tables']['assort_items']['Row'];
export type Leaflet = Database['public']['Tables']['leaflets']['Row'];
export type AlertFlag = Database['public']['Tables']['alert_flags']['Row'];
export type Job = Database['public']['Tables']['jobs']['Row'];
export type AppSetting = Database['public']['Tables']['app_settings']['Row'];
export type GmailEstimateMessage = Database['public']['Tables']['gmail_estimate_messages']['Row'];
export type GmailEstimateFile = Database['public']['Tables']['gmail_estimate_files']['Row'];
