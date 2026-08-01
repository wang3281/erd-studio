import type { EntityStatus } from "../core/model/types";

export const HEADER_HEIGHT = 40;
export const HEADER_HEIGHT_WITH_COMMENT = 52;
export const ROW_HEIGHT = 28;
export const DEFAULT_WIDTH = 220;
export const ENTITY_PADDING = 12;
export const GRID_SIZE = 20;

export function getHeaderHeight(hasComment: boolean): number {
  return hasComment ? HEADER_HEIGHT_WITH_COMMENT : HEADER_HEIGHT;
}

export type Theme = "light" | "dark";

export interface ColorScheme {
  bg: string;
  gridDot: string;
  entityBg: string;
  entityHeader: string;
  entityHeaderText: string;
  entityHeaderComment: string;
  headerCommentBadgeBg: string;
  entityBorder: string;
  entityBorderSelected: string;
  entityShadow: string;
  columnText: string;
  columnComment: string;
  columnSeparator: string;
  columnType: string;
  nnBadge: string;
  uqBadge: string;
  nullBadge: string;
  pkIcon: string;
  fkIcon: string;
  relationLine: string;
  relationLineSelected: string;
  relationLineInferred: string;
  relationLineInferredSelected: string;
  relationLineAI: string;
  relationLineAISelected: string;
  relationEndpoint: string;
  relationEndpointSelected: string;
  relationEndpointRing: string;
  relationPinBg: string;
  relationPinBorder: string;
  relationPinText: string;
  fkHighlight: string;
  entityStatus: Record<EntityStatus, { bg: string; fg: string; label: string }>;
}

export const RELATION_ENDPOINT_RADIUS = 3.5;
export const RELATION_ENDPOINT_RADIUS_HOVER = 5.25;
export const RELATION_ENDPOINT_RING_WIDTH = 1.5;
export const CROW_FOOT_SIZE = 12;
export const CROW_FOOT_STROKE = 2;
export const RELATION_PIN_PADDING_X = 6;
export const RELATION_PIN_PADDING_Y = 3;
export const RELATION_PIN_OFFSET = 10;
export const RELATION_PIN_RADIUS = 6;

const LIGHT_COLORS: ColorScheme = {
  bg: "#F8FAFC",
  gridDot: "#CBD5E1",
  entityBg: "#FFFFFF",
  entityHeader: "#2563EB",
  entityHeaderText: "#FFFFFF",
  entityHeaderComment: "rgba(255,255,255,1.0)",
  headerCommentBadgeBg: "rgba(255,255,255,0.35)",
  entityBorder: "#E2E8F0",
  entityBorderSelected: "#2563EB",
  entityShadow: "rgba(15, 23, 42, 0.10)",
  columnText: "#0F172A",
  columnComment: "#475569",
  columnSeparator: "#94A3B8",
  columnType: "#64748B",
  nnBadge: "#DC2626",
  uqBadge: "#7C3AED",
  nullBadge: "#94A3B8",
  pkIcon: "#D97706",
  fkIcon: "#2563EB",
  relationLine: "#94A3B8",
  relationLineSelected: "#2563EB",
  relationLineInferred: "#D97706",
  relationLineInferredSelected: "#B45309",
  relationLineAI: "#7C3AED",
  relationLineAISelected: "#6D28D9",
  relationEndpoint: "#94A3B8",
  relationEndpointSelected: "#2563EB",
  relationEndpointRing: "#FFFFFF",
  relationPinBg: "#FFFFFF",
  relationPinBorder: "#E2E8F0",
  relationPinText: "#0F172A",
  fkHighlight: "rgba(37, 99, 235, 0.08)",
  entityStatus: {
    new: { bg: "#10B981", fg: "#FFFFFF", label: "신규" },
    existing: { bg: "#3B82F6", fg: "#FFFFFF", label: "기존" },
    modified: { bg: "#F59E0B", fg: "#0F172A", label: "변경" },
    deprecated: { bg: "#6B7280", fg: "#FFFFFF", label: "삭제예정" },
  },
};

const DARK_COLORS: ColorScheme = {
  bg: "#0F172A",
  gridDot: "#334155",
  entityBg: "#1E293B",
  entityHeader: "#1D4ED8",
  entityHeaderText: "#FFFFFF",
  entityHeaderComment: "rgba(255,255,255,0.90)",
  headerCommentBadgeBg: "rgba(255,255,255,0.20)",
  entityBorder: "#334155",
  entityBorderSelected: "#3B82F6",
  entityShadow: "rgba(0, 0, 0, 0.30)",
  columnText: "#F1F5F9",
  columnComment: "#94A3B8",
  columnSeparator: "#64748B",
  columnType: "#94A3B8",
  nnBadge: "#EF4444",
  uqBadge: "#A78BFA",
  nullBadge: "#64748B",
  pkIcon: "#F59E0B",
  fkIcon: "#3B82F6",
  relationLine: "#64748B",
  relationLineSelected: "#3B82F6",
  relationLineInferred: "#F59E0B",
  relationLineInferredSelected: "#D97706",
  relationLineAI: "#A78BFA",
  relationLineAISelected: "#8B5CF6",
  relationEndpoint: "#64748B",
  relationEndpointSelected: "#3B82F6",
  relationEndpointRing: "#0F172A",
  relationPinBg: "#1E293B",
  relationPinBorder: "#334155",
  relationPinText: "#F1F5F9",
  fkHighlight: "rgba(59, 130, 246, 0.12)",
  entityStatus: {
    new: { bg: "#059669", fg: "#FFFFFF", label: "신규" },
    existing: { bg: "#60A5FA", fg: "#0F172A", label: "기존" },
    modified: { bg: "#FBBF24", fg: "#0F172A", label: "변경" },
    deprecated: { bg: "#94A3B8", fg: "#0F172A", label: "삭제예정" },
  },
};

export const COLORS = LIGHT_COLORS;

export function getColors(theme: Theme): ColorScheme {
  return theme === "dark" ? DARK_COLORS : LIGHT_COLORS;
}

export const FONTS = {
  header: "600 14px system-ui, sans-serif",
  headerComment: "500 12px system-ui, sans-serif",
  column: "400 13px system-ui, sans-serif",
  columnComment: "500 11px system-ui, sans-serif",
  columnType: "400 12px ui-monospace, monospace",
  nnBadge: "600 10px ui-monospace, monospace",
  icon: "400 12px system-ui, sans-serif",
} as const;
